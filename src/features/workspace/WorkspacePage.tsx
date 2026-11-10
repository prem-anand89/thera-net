import { confirmAndDeleteVisit } from '@/features/visits/confirmDeleteVisit';
import { hasDue } from '@/domain/paymentState';
import { notify } from '@/lib/notify';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, reportService, feedbackService, bookingService } from '@/services';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { formatAmount } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import { formatExpiryDate } from '@/domain/packageTracking';
import {
  clinicBillingConfig,
  type ConsultationNote,
  type FeedbackRequest,
  type FeedbackResponse,
  type Appointment,
  type AppointmentRequest,
  type Visit,
} from '@/domain/types';
import { appointmentStartsOnDate, minutesOfDay, patientAttendance, requestedSlotTime, toLocalDateStr } from '@/domain/schedule';
import { TodayAppointments } from '@/components/schedule/TodayAppointments';
import { usePatientFlagContext } from '@/components/schedule/usePatientFlagContext';
import { usePatientDirectory } from '@/components/usePatientDirectory';
import { patientFlags } from '@/domain/patientFlags';
import { StartVisitSheet } from '@/components/StartVisitSheet';
import { AppointmentDetailsPanel } from '@/components/schedule/AppointmentDetailsPanel';
import { UNASSIGNED_COLOR, therapistColor } from '@/components/schedule/scheduleColors';
import { BookSlotSheet, type BookedSlot } from '@/components/BookSlotSheet';
import { BookedStrip } from '@/components/schedule/BookedStrip';
import { useShowMore, ShowMoreFooter } from '@/components/ShowMore';
import { ReviewsPanel, type BookFollowUp } from '@/features/followUp/ReviewsPanel';
import { useFollowUpData } from '@/features/followUp/useFollowUpData';
import { RequestDeclinedStrip, type DeclinedRequest } from '@/components/schedule/RequestDeclinedStrip';
import { AddToWaitlistSheet } from '@/components/schedule/AddToWaitlistSheet';
import { AwaitingOpenedStrip, useAwaitingOpening, type OpenedSlot } from '@/components/schedule/AwaitingOpenedStrip';
import { awaitingMessage, awaitingWants, bookedNoteFor } from '@/domain/awaiting';
import { lastTenDigits } from '@/domain/phoneDigits';
import { requestWants } from '@/components/schedule/RequestsInbox';
import { InstallAppBanner } from '@/components/InstallAppBanner';
import { noteForVisit } from '@/domain/noteLinks';
import { toFriendlyMessage } from '@/lib/errors';
import { canAskForFeedbackOnVisit } from '@/domain/patientComms';
import type { OpenPackageRow, TodayVisitRow } from '@/services/dashboardService';
import { btnPrimary, btnSecondary, LoadingRows, SectionCard, StatStrip, ConfirmDialog, Pill, pillAccent, pillNeutral, pillSmAccent, pillSmPrimary, chipSelect, chipSelectChevron, PackageThread, th, thNum, td, tdNum, filterChip, ChipCount, segTrack, segOption } from '@/components/ui';
import {
  ResponsiveVisitList,
  VisitColumnPicker,
  type VisitCardData,
} from '@/components/VisitCard';
import { useVisitColumnPrefs } from '@/app/useVisitColumnPrefs';
import { useSession } from '@/app/useSession';
import {
  useNewFeedbackResponseCount,
  useGoogleReviewEligibleRequestIds,
} from '@/features/schedule/scheduleSignals';
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { RevenueShareEditorLoader } from '@/components/RevenueShareEditorLoader';
import { visitPermissions } from '@/features/visits/visitPermissions';
import { splitDisplay, useVisitDetails, type VisitDetails } from '@/features/visits/visitDetails';
import { useAssistedVisits } from '@/features/visits/assistedVisits';
import { AssistedVisitList } from '@/features/visits/AssistedVisitList';
import { resolveWorkspaceView, type WorkspaceViewChoice } from './workspaceView';
import { WorkspaceViewToggle } from './WorkspaceViewToggle';
import { TodayTherapistFilter, TodayVisitsTotals } from './TodayVisitsExtras';
import { therapistsInRows, todayVisitTotals } from './todayTotals';

import { useClinicRole } from '@/app/useClinicRole';
import { useDepartment } from '@/app/DepartmentContext';
import { departmentHours } from '@/domain/departmentHours';
import { inDepartment } from '@/domain/departments';
import { runningCharges, canBillInpatientStay, inpatientVisitBillingMode } from '@/domain/departmentMoney';
import { collectionsLine } from '@/domain/collectionsByMethod';
import { saveLedgerPrefs } from '@/features/visits/ledgerPrefs';
import { InpatientsCard } from './InpatientsCard';
import { HomeVisitsCard } from './HomeVisitsCard';

const EMPTY_SET = new Set<string>();

import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { AddPatientDetailsModal } from '@/features/visits/AddPatientDetailsModal';
import { EditVisitModal } from '@/features/visits/EditVisitModal';
import { SetupProgressBar } from '@/features/setup/SetupProgressBar';
import { NotificationNudge } from '@/features/notifications/NotificationNudge';
import {
  IconBook,
  IconCloud,
  IconPen,
  IconPlus,
  IconRupee,
  IconStar,
  IconWallet,
} from '@/components/StatIcons';

/** What the invoice-issuance modal needs, independent of which card opened it. */
type InvoicingTarget = IssueInvoiceTarget;

/** A changed hasPartner/clinicSplitPct/taxPct/tdsBasis (stamped as
 *  clinic.lastSplitChangeAt by SettingsPage) silently moves every
 *  not-yet-invoiced visit's split and, downstream, a therapist's Net figure
 *  — with nothing on Workspace explaining why. Surfaced for 14 days after
 *  the change, then it stops being "news." Dismissal is per-device (Dexie
 *  meta, not synced) and keyed by the exact timestamp so a *later* change
 *  re-shows the banner even if an earlier one was dismissed. */
const SPLIT_CHANGE_BANNER_WINDOW_DAYS = 14;

function SplitChangeBanner({ clinicId, changedAt }: { clinicId: string; changedAt: string }) {
  const ackKey = `splitChangeAck:${clinicId}`;
  const acked = useLiveQuery(async () => (await db.meta.get(ackKey))?.value ?? null, [ackKey]);
  const withinWindow =
    Date.now() - new Date(changedAt).getTime() <
    SPLIT_CHANGE_BANNER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  if (!withinWindow || acked === changedAt) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3">
      <p className="text-sm text-[var(--ink)]">
        The revenue split changed on {formatDateDM(changedAt)} — already-invoiced visits keep
        their original numbers, but not-yet-invoiced ones (and this month's totals) now reflect
        the new split.
      </p>
      <button
        type="button"
        className="whitespace-nowrap text-sm font-medium text-[var(--teal)] hover:underline"
        onClick={() => void db.meta.put({ key: ackKey, value: changedAt })}
      >
        Got it
      </button>
    </div>
  );
}

export function todayRowToCardData(
  row: TodayVisitRow,
  openPackageGroupIds: Set<string>,
  isAdmin: boolean,
  isFrontDesk: boolean,
  myTherapistId: string | undefined,
  canViewClinicalNotes: boolean,
  therapistSplit: boolean,
  treatmentName: Map<string, string>,
  invoicedSiblingGroupIds: Set<string>,
  consultationNotes: ConsultationNote[] | undefined,
  enablePatientComms: boolean,
  feedbackRequestByVisitId: Map<string, FeedbackRequest>,
  responseByRequestId: Map<string, FeedbackResponse>,
  googleReviewEligibleIds: Set<string>,
  googleReviewUrl: string | null,
  details?: VisitDetails,
  inpatientBilling?: 'stay_bill' | 'partner_billed' | null
): VisitCardData {
  const { canModify, canDelete } = visitPermissions({
    isAdmin,
    isFrontDesk,
    myTherapistId,
    visitTherapistId: row.therapistId,
    invoiced: Boolean(row.invoiceId),
  });
  const linkedNote = noteForVisit(
    consultationNotes ?? [],
    row.visitId,
    row.patientId,
    row.needsNote
  );
  const feedbackRequest = feedbackRequestByVisitId.get(row.visitId);
  return {
    visitId: row.visitId,
    therapistId: row.therapistId,
    visitDate: toLocalDateStr(new Date()),
    patientId: row.patientId,
    patientName: row.patientName,
    patientPhone: row.phone,
    mrno: row.mrno,
    age: row.age,
    sex: row.sex,
    condition: row.condition,
    canEdit: canModify,
    serviceName: row.serviceName,
    sessionIndex: row.sessionIndex,
    packageTotal: row.packageTotal,
    therapistName: row.therapistName,
    treatmentNotes: row.treatmentNotes,
    treatmentNames: row.treatmentIds
      .map((id) => treatmentName.get(id))
      .filter((n): n is string => !!n),
    billPaise: row.billPaise,
    paymentState: row.paymentState,
    invoiceId: row.invoiceId,
    collectedPaise: row.collectedPaise,
    partnerCollectedPaise: row.partnerCollectedPaise,
    issuedAt: row.issuedAt,
    canRepeat: Boolean(row.packageGroupId && openPackageGroupIds.has(row.packageGroupId)),
    canSplit: therapistSplit && row.billPaise > 0 && canModify,
    // Share rows rule whenever they exist; the old one-assistant line only for a visit without them.
    hasSplit: splitDisplay(details, { sharedTherapistId: row.sharedTherapistId }).hasSplit,
    creditsManual: row.creditsManual,
    details,
    sharedPct: splitDisplay(details, { sharedTherapistId: row.sharedTherapistId }).legacySplit ? row.sharedPct : null,
    sharedTherapistName: splitDisplay(details, { sharedTherapistId: row.sharedTherapistId }).legacySplit
      ? row.sharedTherapistName
      : null,
    // Delete stays admin / the visit's own therapist (front desk can correct a visit, not delete it).
    canDelete,
    needsNote: row.needsNote,
    canViewNotes: canViewClinicalNotes,
    consultationNoteId: linkedNote?.id ?? null,
    noteStatus: linkedNote?.status ?? null,
    canAskForFeedback: canAskForFeedbackOnVisit({
      enablePatientComms,
      isAdmin,
      isFrontDesk,
      myTherapistId,
      visitTherapistId: row.therapistId,
    }),
    feedbackRequest: feedbackRequest
      ? {
        id: feedbackRequest.id,
        status: feedbackRequest.status,
        token: feedbackRequest.token,
        updatedAt: feedbackRequest.updatedAt,
        // Admin gets it for free off the synced rating; front_desk (no
        // rating available at all, see feedbackRequest field's own doc
        // comment) falls back to the role-blind eligibility RPC result.
        googleReviewEligible: isAdmin
          ? (responseByRequestId.get(feedbackRequest.id)?.rating ?? 0) === 5
          : googleReviewEligibleIds.has(feedbackRequest.id),
      }
      : null,
    googleReviewUrl,
    inpatientBilling,
    canCollect: row.location === 'ward' ? false : undefined,
    packageInvoicePending:
      row.billPaise === 0 &&
      !!row.sessionIndex &&
      !!row.packageTotal &&
      !row.invoiceId &&
      !!row.packageGroupId &&
      invoicedSiblingGroupIds.has(row.packageGroupId),
  };
}

type NeedsItem = { key: string; node: ReactElement };
const EMPTY_APPOINTMENTS: Appointment[] = [];

/** Single status pill for an open package — `stale` (hasn't been visited in
 *  a while) takes priority over `nearingCompletion` (still active, just
 *  running low on sessions) since a package can't need re-engaging and be
 *  actively finishing up at the same time in any way staff should act on. */
function PackageStatusPill({ pkg }: { pkg: OpenPackageRow }) {
  if (pkg.expiry === 'expired' && pkg.expiresOn) return <Pill tone="amber">Expired · {formatExpiryDate(pkg.expiresOn)}</Pill>;
  if (pkg.expiry === 'expiring' && pkg.expiresOn) return <Pill tone="amber">Expiring soon · {formatExpiryDate(pkg.expiresOn)}</Pill>;
  if (pkg.stale) return <Pill tone="amber">Stale</Pill>;
  if (pkg.nearingCompletion) return <Pill tone="amber">Renew soon</Pill>;
  return <Pill tone="green">Open</Pill>;
}

export function WorkspacePage() {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const { department } = useDepartment();
  const { displayName: accountName } = useClinicRole(clinic.id);
  const { canBill, canCollectPayment, canViewClinicalNotes, canEditSettings } = usePermissions();
  const navigate = useNavigate();

  const { therapistSplit } = clinicBillingConfig(clinic);
  // Patient Communications, Slice 2 — "something arrived" surface per the
  // handoff doc's own question table: admin-only (feedback content is
  // admin-only at RLS too), gated on the module being on.
  const { session } = useSession();
  const newFeedbackCount = useNewFeedbackResponseCount(
    clinic.id,
    session?.user?.id,
    canEditSettings && (clinic.enablePatientComms ?? false)
  );
  // Front-desk-only fallback for the Google review nudge — admin doesn't
  // need this (derives eligibility from the synced rating instead), so
  // skip the RPC call entirely for them.
  const googleReviewEligibleIds = useGoogleReviewEligibleRequestIds(
    clinic.id,
    !canEditSettings && (clinic.enablePatientComms ?? false)
  );
  // Patient Communications, Slice 5 — "Expected today" (appointments) and
  // the pending-booking-requests banner. Scoped the same way "Seen today"
  // already is: clinic-wide for admin/front_desk, own-therapist otherwise
  // (scope.scopeTherapistId already resolves to undefined for the
  // clinic-wide roles — see useWorkspaceScope's own doc comment).
  const workspaceAppointments = useLiveQuery(
    // A walk-in started from "Start a note
    // first" is an arrived appointment, and it has to be completable here.
    () => repos.appointments.listByClinic(clinic.id),
    [clinic.id]
  );
  const workspaceTherapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const canManageBookings = scope.isClinicWideView;
  const [nowMinutes, setNowMinutes] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => {
    const timer = setInterval(() => setNowMinutes(new Date().getHours() * 60 + new Date().getMinutes()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const therapistRoster = useMemo(
    () =>
      new Map(
        [...(workspaceTherapists ?? [])]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => [t.id, { name: t.name, phone: t.phone ?? null, color: therapistColor(t.id, t.color) }] as const)
      ),
    [workspaceTherapists]
  );
  // Global Workspace scoping: pure staff therapists default to their own queue,
  // admins / front desk default to clinic-wide.
  // The person's own All | Mine choice (null until they make one); what it means is worked out on every render from
  // the role and therapist link, so it is right once those have loaded (see `resolveWorkspaceView`).
  const [viewChoice, setViewChoice] = useState<WorkspaceViewChoice | null>(null);
  const workspaceView = resolveWorkspaceView(scope, viewChoice);
  const workspaceMineOnly = workspaceView.mineOnly;
  const viewTherapistId = workspaceView.viewTherapistId;

  const expectedToday = useMemo(() => {
    const todayStr = toLocalDateStr(new Date());
    const filterTherapistId = viewTherapistId;
    return (workspaceAppointments ?? [])
      .filter(
        (a) =>
          appointmentStartsOnDate(a, todayStr) &&
          (!filterTherapistId || a.therapistId === filterTherapistId)
      )
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }, [workspaceAppointments, viewTherapistId]);
  // Visits started (arrived / walk-in) but not completed with a service yet —
  // today's plus any left open in the last week, so none are forgotten.
  const todayAppointments = useMemo(() => {
    const weekAgo = toLocalDateStr(new Date(Date.now() - 7 * 86_400_000));
    const todayStr = toLocalDateStr(new Date());
    const filterTherapistId = viewTherapistId;
    const olderOpen = (workspaceAppointments ?? []).filter((a) => {
      const day = toLocalDateStr(new Date(a.scheduledAt));
      return (
        a.status === 'arrived' && !a.visitId && day < todayStr && day >= weekAgo &&
        (!filterTherapistId || a.therapistId === filterTherapistId)
      );
    });
    return [...olderOpen, ...expectedToday];
  }, [workspaceAppointments, expectedToday, viewTherapistId]);
  // "Next up": the first still-to-come appointment (15 minutes' grace for late arrivals).
  const nextUpId = expectedToday.find(
    (a) =>
      inDepartment('clinic', a) &&
      (a.status === 'confirmed' || a.status === 'rescheduled') &&
      minutesOfDay(a.scheduledAt) >= nowMinutes - 15
  )?.id ?? null;
  const appointmentColor = useCallback(
    (a: Appointment) => (a.therapistId && therapistRoster.get(a.therapistId)?.color) || UNASSIGNED_COLOR,
    [therapistRoster]
  );
  const appointmentTherapistName = useCallback(
    (a: Appointment) => (a.therapistId ? therapistRoster.get(a.therapistId)?.name ?? 'Former therapist' : 'Unassigned'),
    [therapistRoster]
  );
  const [openAppointmentId, setOpenAppointmentId] = useState<string | null>(null);
  const flagContext = usePatientFlagContext(clinic.id, workspaceAppointments ?? EMPTY_APPOINTMENTS);
  const { mrnoFor, patients: directoryPatients } = usePatientDirectory(clinic.id);
  const directoryPatientsMap = useMemo(
    () => new Map(directoryPatients.map((p) => [p.id, p])),
    [directoryPatients]
  );
  // Awaiting entries carry only a name and number: this is how "asked not to be messaged" reaches them.
  const doNotMessagePhones = useMemo(
    () => new Set(directoryPatients.filter((p) => p.doNotMessage && p.phone).map((p) => lastTenDigits(p.phone))),
    [directoryPatients]
  );
  const [bookingOpen, setBookingOpen] = useState(false);
  const [startVisit, setStartVisit] = useState<{ appointment?: Appointment } | null>(null);
  const hour = new Date().getHours();
  const greeting = hour < 4 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const myTherapistName = scope.myTherapistId ? therapistRoster.get(scope.myTherapistId)?.name : undefined;
  // A therapist is greeted by their therapist name; front desk and admin without one by the name they set on their account.
  const firstName = (myTherapistName ?? accountName ?? '').replace(/^Dr\.?\s+/i, '').split(/\s+/)[0] || '';
  const [reschedulingAppointment, setReschedulingAppointment] = useState<Appointment | null>(null);
  const openAppointment = openAppointmentId
    ? (workspaceAppointments ?? []).find((a) => a.id === openAppointmentId) ?? null
    : null;
  // Unsynced visits make "Collected today" understate the day, so they get
  // a needs-you item (see LedgerPage on unsynced counts vs last-sync time).
  const unsyncedVisitCount =
    useLiveQuery(() => db.outbox.filter((e) => e.table === 'visits').count(), []) ?? 0;
  // Public booking requests waiting for a confirm — shown first under
  // Today → Appointments for admin / front desk, oldest first.
  const appointmentRequests = useLiveQuery(
    () =>
      canManageBookings ? repos.appointmentRequests.listByClinic(clinic.id) : undefined,
    [clinic.id, canManageBookings]
  );
  const pendingRequests = useMemo(
    () =>
      (appointmentRequests ?? [])
        .filter((r) => r.status === 'pending')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [appointmentRequests]
  );
  const awaitingOpening = useAwaitingOpening(pendingRequests);
  const [addAwaitingOpen, setAddAwaitingOpen] = useState(false);
  // Booking from the "a time opened" strip: the sheet opens on that time, not the person's own wish.
  const [openedSlot, setOpenedSlot] = useState<OpenedSlot | null>(null);
  const [confirmingRequest, setConfirmingRequest] = useState<AppointmentRequest | null>(null);
  // After a booking, a strip offers the one-tap WhatsApp to the patient (booking never messages anyone itself).
  const [booked, setBooked] = useState<BookedSlot | null>(null);
  const [declined, setDeclined] = useState<DeclinedRequest | null>(null);
  const [decliningRequest, setDecliningRequest] = useState<AppointmentRequest | null>(null);
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [takingPayment, setTakingPayment] = useState<VisitCardData | null>(null);
  const { prefs: visitColumnPrefs, setPref: setVisitColumnPref } = useVisitColumnPrefs();
  const [editPatientId, setEditPatientId] = useState<string | null>(null);
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [, setVisitEditError] = useState<string | null>(null);
  const [newPatientId, setNewPatientId] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<Visit | null>(null);
  // "Open" = every open package, the ones needing a call (gone quiet, or
  // nearly used up) sorted first; "Needs attention" narrows to just those.
  const [pkgStatusFilter, setPkgStatusFilter] = useState<'open' | 'attention'>('open');
  // "Follow up" card: Reviews (follow-ups due, missed, no-shows) and Packages share one card. With no reviews the
  // card is just Packages, as before. The tab the person last chose is remembered on this device; until then it opens
  // on Reviews when something is due and on Packages otherwise.
  const followUp = useFollowUpData(clinic.id, viewTherapistId, department);
  const [chosenFollowTab, setChosenFollowTab] = useState<'reviews' | 'packages' | null>(() => {
    try {
      const saved = localStorage.getItem('workspace.followUpTab');
      return saved === 'reviews' || saved === 'packages' ? saved : null;
    } catch {
      return null;
    }
  });
  const followTab: 'reviews' | 'packages' = chosenFollowTab ?? (followUp.due.length > 0 ? 'reviews' : 'packages');
  function chooseFollowTab(tab: 'reviews' | 'packages') {
    setChosenFollowTab(tab);
    try {
      localStorage.setItem('workspace.followUpTab', tab);
    } catch {
      /* not remembered */
    }
  }
  const [bookingFollowUp, setBookingFollowUp] = useState<BookFollowUp | null>(null);
  // The Follow up card stays short on a busy clinic: 5 rows to start (10 on request, remembered on this device), and the
  // whole card can be folded away.
  const [followPageSize, setFollowPageSizeState] = useState<5 | 10>(() => {
    try {
      return localStorage.getItem('workspace.followUpPageSize') === '10' ? 10 : 5;
    } catch {
      return 5;
    }
  });
  function setFollowPageSize(size: 5 | 10) {
    setFollowPageSizeState(size);
    try {
      localStorage.setItem('workspace.followUpPageSize', String(size));
    } catch {
      /* not remembered */
    }
  }
  const [followOpen, setFollowOpenState] = useState(() => {
    try {
      return localStorage.getItem('workspace.followUpOpen') !== 'false';
    } catch {
      return true;
    }
  });
  function setFollowOpen(open: boolean) {
    setFollowOpenState(open);
    try {
      localStorage.setItem('workspace.followUpOpen', String(open));
    } catch {
      /* not remembered */
    }
  }

  // Narrowed to the chosen therapist (Mine), or the whole clinic (All).
  const effectiveVisitsTherapistId = viewTherapistId;
  const today = useLiveQuery(
    () => dashboardService.todayWorklist(clinic.id, new Date(), effectiveVisitsTherapistId),
    [clinic.id, effectiveVisitsTherapistId]
  );
  // Monthly counts scoped to match today's chosen view and active department.
  const monthlyNew = useLiveQuery(
    () => dashboardService.monthlyNewCounts(clinic.id, new Date(), effectiveVisitsTherapistId, department),
    [clinic.id, effectiveVisitsTherapistId, department]
  );
  // Department-scoped open-packages list — feeds the Packages panel below.
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id, department), [clinic.id, department]);
  const openPackageGroupIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
  );
  const needsAttention = (p: OpenPackageRow) => p.stale || p.nearingCompletion || p.expiry !== null;
  const scopedPackages = useMemo(
    () =>
      viewTherapistId
        ? (openPackages ?? []).filter((p) => p.startedByTherapistId === viewTherapistId)
        : openPackages ?? [],
    [openPackages, viewTherapistId]
  );
  const attentionCount = scopedPackages.filter(needsAttention).length;
  const filteredPackages = useMemo(() => {
    if (pkgStatusFilter === 'attention') return scopedPackages.filter(needsAttention);
    // Stable sort: attention rows first, otherwise the service's own order.
    return [...scopedPackages].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
  }, [scopedPackages, pkgStatusFilter]);
  const hasMoreThanFiveFollowUps =
    followTab === 'reviews'
      ? Math.max(followUp.due.length, followUp.missed.length, followUp.noShows.length) > 5
      : filteredPackages.length > 5;
  const followUpReviewCount =
    followUp.due.length + followUp.missed.length + followUp.noShows.length;
  const stalePackagesCount = scopedPackages.filter((p) => p.stale).length;
  const renewPackagesCount = scopedPackages.filter((p) => !p.stale && p.nearingCompletion).length;
  const expiringPackagesCount = scopedPackages.filter(
    (p) => !p.stale && !p.nearingCompletion && p.expiry !== null
  ).length;

  const followUpBadge = useMemo(() => {
    const parts: string[] = [];
    if (followUpReviewCount > 0) {
      parts.push(`${followUpReviewCount} due`);
    }
    if (stalePackagesCount > 0) {
      parts.push(`${stalePackagesCount} stale`);
    } else if (renewPackagesCount > 0) {
      parts.push(`${renewPackagesCount} renew`);
    } else if (expiringPackagesCount > 0) {
      parts.push(`${expiringPackagesCount} expiring`);
    }
    if (parts.length === 0) {
      return <Pill tone="slate">All caught up</Pill>;
    }
    return <Pill tone="amber">{parts.join(' · ')}</Pill>;
  }, [followUpReviewCount, stalePackagesCount, renewPackagesCount, expiringPackagesCount]);

  const packageList = useShowMore(filteredPackages, `${pkgStatusFilter}|${workspaceMineOnly}`, followPageSize);

  const now = new Date();
  const calendarMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };
  // "This month" numbers: a therapist's own row, or the department total.
  const monthReport = useLiveQuery(
    () => reportService.monthly(clinic.id, calendarMonth, department),
    [clinic.id, calendarMonth.year, calendarMonth.month, department]
  );
  const myMonthRow = monthReport?.rows.find((r) => r.therapistId === scope.myTherapistId);
  // "Collected" = money received today (the Daybook's figure), scoped to the
  // therapist's own visits for a therapist login.
  const receivedToday = useLiveQuery(
    () => dashboardService.receivedOnDate(clinic.id, toLocalDateStr(new Date()), scope.scopeTherapistId, department),
    [clinic.id, scope.scopeTherapistId, department]
  );
  // Front desk: what came in today by cash / UPI / card, in place of the clinic's net revenue.
  const receivedByMethod = useLiveQuery(
    () => (scope.isFrontDesk ? dashboardService.receivedByMethodOnDate(clinic.id, toLocalDateStr(new Date()), department) : undefined),
    [clinic.id, scope.isFrontDesk, department]
  );
  // Dues: what's still owed — the whole clinic for admin/front desk, a
  // therapist's own visits for them (when billing is open to them). Per visit,
  // so "Take payment later" visits count too.
  const showDues = canCollectPayment && (scope.isClinicWideView || Boolean(scope.myTherapistId));
  const dues = useLiveQuery(
    () => (showDues && department !== 'ward' ? dashboardService.duesSummary(clinic.id, scope.scopeTherapistId, department) : undefined),
    [clinic.id, showDues, scope.scopeTherapistId, department]
  );
  const wardVisits = useLiveQuery(
    () =>
      department === 'ward' && showDues
        ? repos.visits.list({
          clinicId: clinic.id,
          ...(scope.scopeTherapistId ? { therapistId: scope.scopeTherapistId } : {}),
        })
        : undefined,
    [clinic.id, department, showDues, scope.scopeTherapistId]
  );
  const wardRunning = useMemo(
    () => (department === 'ward' && wardVisits ? runningCharges(wardVisits) : null),
    [department, wardVisits]
  );

  const editPatient = useLiveQuery(
    () => (editPatientId ? repos.patients.get(editPatientId) : undefined),
    [editPatientId]
  );
  // Only needed for the split dialog's "assisting therapist" picker — cheap
  // to skip entirely for a clinic that hasn't turned the feature on.
  const therapists = useLiveQuery(
    () => (therapistSplit ? repos.therapists.list(clinic.id, true) : undefined),
    [clinic.id, therapistSplit]
  );
  // The share editor needs someone to share with: split on and more than one active therapist.
  const canShareRevenue = therapistSplit && (therapists ?? []).filter((t) => t.active).length > 1;
  const todayDetailIds = useMemo(() => (today?.visits ?? []).map((v) => v.visitId), [today]);
  const nameOfTherapist = useCallback(
    (id: string) => (therapists ?? []).find((t) => t.id === id)?.name ?? therapistRoster.get(id)?.name ?? 'Therapist',
    [therapists, therapistRoster]
  );
  const todayDetails = useVisitDetails(todayDetailIds, nameOfTherapist, therapistSplit);
  // Visits a colleague billed where this therapist delivered a service: listed for them, never counted
  // in their Dues, Collected or visit count (those stay with the primary).
  const todayStr = toLocalDateStr(new Date());
  const assistedToday = useAssistedVisits(
    clinic.id,
    scope.isClinicWideView ? undefined : scope.myTherapistId,
    { from: todayStr, to: todayStr },
    nameOfTherapist,
    therapistSplit
  );
  const allPatients = useLiveQuery(
    () => (assistedToday.length ? repos.patients.list(clinic.id) : undefined),
    [clinic.id, assistedToday.length]
  );
  const patientNameById = useMemo(() => new Map((allPatients ?? []).map((p) => [p.id, p.name])), [allPatients]);
  const patientNameOf = useCallback((id: string) => patientNameById.get(id) ?? 'Patient', [patientNameById]);
  const treatments = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id, true), [clinic.id]);
  const treatmentName = useMemo(
    () => new Map((treatments ?? []).map((t) => [t.id, t.name])),
    [treatments]
  );

  // Draft notes never get written back onto the visit row itself (only a
  // completed note does), so showing draft-vs-completed status per visit
  // needs a real join against the notes table — see the identical note in
  // LedgerPage.tsx. Skipped for a viewer who can't see notes anyway.
  const consultationNotes = useLiveQuery(
    () => (canViewClinicalNotes ? repos.consultationNotes.listByClinic(clinic.id) : undefined),
    [clinic.id, canViewClinicalNotes]
  );
  // This therapist's unfinished notes, oldest first — the header chip opens the oldest.
  const myDraftNotes = useMemo(
    () =>
      (consultationNotes ?? [])
        .filter((n) => n.status === 'draft' && scope.myTherapistId && n.therapistId === scope.myTherapistId)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    [consultationNotes, scope.myTherapistId]
  );
  // Patient Communications, Slice 1 — same bulk-fetch-and-map shape as
  // consultationNotes above, see the identical note in LedgerPage.tsx.
  const feedbackRequests = useLiveQuery(
    () => (clinic.enablePatientComms ? repos.feedbackRequests.listByClinic(clinic.id) : undefined),
    [clinic.id, clinic.enablePatientComms]
  );
  const feedbackRequestByVisitId = useMemo(() => {
    const map = new Map<string, FeedbackRequest>();
    for (const r of feedbackRequests ?? []) {
      // Same "most recently updated wins" tie-break as the repo's own
      // getByVisitId — a visit can have more than one row over time (an
      // old expired/responded one plus a fresh pending one after
      // re-asking).
      const existing = map.get(r.visitId);
      if (!existing || r.updatedAt > existing.updatedAt) map.set(r.visitId, r);
    }
    return map;
  }, [feedbackRequests]);
  // Slice 3 — same reasoning as the identical fetch in LedgerPage.tsx: the
  // Google-review nudge needs the rating, which lives in feedback_responses.
  const feedbackResponses = useLiveQuery(
    () => (clinic.enablePatientComms ? repos.feedbackResponses.listByClinic(clinic.id) : undefined),
    [clinic.id, clinic.enablePatientComms]
  );
  const responseByRequestId = useMemo(
    () => new Map((feedbackResponses ?? []).map((r) => [r.requestId, r])),
    [feedbackResponses]
  );
  // A ₹0 package continuation logged today whose OWN invoiceId is null —
  // check the full package group (unbounded by "today") for an invoiced
  // sibling, so a session trailing an already-issued invoice gets flagged
  // instead of just silently showing no lock icon with nothing explaining
  // why. Same dedupe-and-fetch-per-group shape as packageAttributionDeltas.
  const candidatePendingGroupIds = useMemo(
    () => [
      ...new Set(
        (today?.visits ?? [])
          .filter(
            (v) =>
              v.billPaise === 0 &&
              v.sessionIndex &&
              v.packageTotal &&
              !v.invoiceId &&
              v.packageGroupId
          )
          .map((v) => v.packageGroupId!)
      ),
    ],
    [today]
  );
  const invoicedSiblingGroupIds = useLiveQuery(async () => {
    const result = new Set<string>();
    await Promise.all(
      candidatePendingGroupIds.map(async (groupId) => {
        const group = await repos.visits.listByPackageGroup(groupId);
        if (group.some((v) => v.invoiceId)) result.add(groupId);
      })
    );
    return result;
  }, [candidatePendingGroupIds]) ?? EMPTY_SET;

  function openInvoiceFor(data: VisitCardData) {
    setInvoicing({
      visitId: data.visitId,
      patientId: data.patientId,
      patientLabel: data.patientName,
      serviceLabel: data.serviceName,
      isPackage: data.packageTotal != null,
      alreadyCollected: data.paymentState === 'collected_no_receipt',
    });
  }


  const needsItem =
    'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded font-medium text-[var(--ink)] underline-offset-4 hover:text-[var(--teal)] hover:underline [&>svg]:h-4 [&>svg]:w-4';
  // Short wording on phones keeps the bar on one line; full wording from sm:.
  const both = (short: string, long: string) => (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{long}</span>
    </>
  );
  const plural = (n: number, word: string) => `${word}${n === 1 ? '' : 's'}`;
  // Only what the page doesn't already show: visits in progress and booking
  // requests are listed in the Today card right below, so they're not
  // repeated here. Unsynced visits get an item (the header's dot only says
  // "something's pending").
  const needsYou = ([
    unsyncedVisitCount > 0 && {
      key: 'unsynced',
      node: (
        <span className={`${needsItem} !text-[var(--amber-strong)] hover:!no-underline`}>
          <IconCloud />
          {both(`${unsyncedVisitCount} not synced`, `${unsyncedVisitCount} ${plural(unsyncedVisitCount, 'visit')} not synced yet`)}
        </span>
      ),
    },
    myDraftNotes.length > 0 && {
      key: 'notes',
      node: (
        <Link
          to="/patients/$patientId/notes/$noteId"
          params={{ patientId: myDraftNotes[0].patientId, noteId: myDraftNotes[0].id }}
          search={{ from: '/workspace' }}
          className={needsItem}
        >
          <IconPen className="text-[var(--slate)]" />
          {both(`${myDraftNotes.length} ${plural(myDraftNotes.length, 'note')}`, `${myDraftNotes.length} ${plural(myDraftNotes.length, 'note')} to finish`)}
        </Link>
      ),
    },
    newFeedbackCount > 0 && {
      key: 'feedback',
      node: (
        <Link to="/schedule" search={{ tab: 'feedback' }} className={needsItem}>
          <IconStar className="text-[var(--plum)]" />
          {both(`${newFeedbackCount} feedback`, `${newFeedbackCount} new feedback`)}
        </Link>
      ),
    },
  ] as (NeedsItem | false)[]).filter((item): item is NeedsItem => Boolean(item));
  const monthCaption = now.toLocaleDateString('en-IN', { month: 'long' });
  // Icon + hue per kind of number, the same wherever it appears: money in
  // (moss banknote), dues owed (amber), visits (sky patient-tick), packages
  // (plum stack). Reports (admin/front desk only) already carries the full
  // monthly breakdown with trends, so the header keeps only what Reports
  // doesn't show (today, and what's owed) plus a link to it below; a
  // therapist has no Reports access, so their header keeps the month's
  // own numbers instead.
  const duesCount = dues?.visitCount ?? 0;
  const collectedCell = {
    label: 'Collected',
    value: receivedToday === undefined ? <LoadingValue /> : formatAmount(receivedToday),
    icon: <IconRupee />,
    tone: 'moss' as const,
    kind: 'money' as const,
    onClick:
      (canBill || canCollectPayment) && scope.isClinicWideView
        ? () => void navigate({ to: '/ledger', search: { tab: 'daybook' } })
        : // A therapist: their own visits today, in the Ledger (it opens on what it was last left on, so set that first).
        scope.myTherapistId
          ? () => {
            saveLedgerPrefs(clinic.id, { tab: 'visits', datePreset: 'today', therapistId: scope.myTherapistId ?? '' });
            void navigate({ to: '/ledger', search: { tab: 'visits' } });
          }
          : undefined,
  };
  const duesCell = {
    label: duesCount > 0 ? `Dues · ${duesCount}` : 'Dues',
    value: dues === undefined ? <LoadingValue /> : formatAmount(dues.totalPaise),
    icon: <IconWallet />,
    tone: 'amber' as const,
    kind: 'money' as const,
    // Straight to the unpaid visits, all dates (a therapist's own).
    onClick: () => void navigate({ to: '/ledger', search: { tab: 'visits', filter: 'not_collected' } }),
  };
  const runningChargesCell = {
    label:
      wardRunning && wardRunning.stays > 0
        ? `Running charges · ${wardRunning.stays} ${plural(wardRunning.stays, 'stay')}`
        : 'Running charges',
    value: wardRunning === null ? <LoadingValue /> : formatAmount(wardRunning.paise),
    icon: <IconWallet />,
    tone: 'amber' as const,
    kind: 'money' as const,
  };
  const wardLoggedCell = {
    label:
      wardRunning && wardRunning.stays > 0
        ? `Logged on stays · ${wardRunning.stays} ${plural(wardRunning.stays, 'stay')}`
        : 'Logged on stays',
    value: wardRunning === null ? <LoadingValue /> : formatAmount(wardRunning.paise),
    icon: <IconWallet />,
    tone: 'amber' as const,
    kind: 'money' as const,
  };
  const canBillStays = canBillInpatientStay(clinic);
  const statCells =
    department === 'ward'
      ? !canBillStays
        ? showDues
          ? [wardLoggedCell]
          : []
        : showDues
          ? [collectedCell, runningChargesCell]
          : [collectedCell]
      : showDues
        ? [collectedCell, duesCell]
        : [collectedCell];

  // Today's visits can be narrowed to one therapist when the card shows more than the viewer's own.
  const [visitTherapistId, setVisitTherapistId] = useState('');
  const visitsInDept = useMemo(
    () => (today?.visits ?? []).filter((v) => inDepartment(department, v)),
    [today, department]
  );
  const therapistOptions = useMemo(() => therapistsInRows(visitsInDept), [visitsInDept]);
  const visitsFilterId =
    !workspaceMineOnly && therapistOptions.some((o) => o.id === visitTherapistId) ? visitTherapistId : '';
  const visitsInView = useMemo(
    () => (visitsFilterId ? visitsInDept.filter((v) => v.therapistId === visitsFilterId) : visitsInDept),
    [visitsInDept, visitsFilterId]
  );
  const visitTotals = useMemo(() => todayVisitTotals(visitsInView), [visitsInView]);

  const todayRows = useMemo(
    () =>
      today
        ? visitsInView.map((row) =>
          todayRowToCardData(
            row,
            openPackageGroupIds,
            scope.isAdmin,
            scope.isFrontDesk,
            scope.myTherapistId,
            canViewClinicalNotes,
            canShareRevenue,
            treatmentName,
            invoicedSiblingGroupIds,
            consultationNotes,
            clinic.enablePatientComms ?? false,
            feedbackRequestByVisitId,
            responseByRequestId,
            googleReviewEligibleIds,
            clinic.googleReviewUrl ?? null,
            todayDetails.get(row.visitId),
            inpatientVisitBillingMode({ location: row.location, admissionId: row.admissionId }, clinic)
          )
        )
        : [],
    [
      today,
      visitsInView,
      openPackageGroupIds,
      scope.isAdmin,
      scope.isFrontDesk,
      scope.myTherapistId,
      canViewClinicalNotes,
      canShareRevenue,
      treatmentName,
      invoicedSiblingGroupIds,
      consultationNotes,
      clinic.enablePatientComms,
      feedbackRequestByVisitId,
      responseByRequestId,
      googleReviewEligibleIds,
      clinic.googleReviewUrl,
      todayDetails,
    ]
  );
  const todayList = useShowMore(todayRows, `${todayStr}|${workspaceMineOnly}|${visitsFilterId}`, 10);
  // Today's visits that still owe money (true) or are settled (false), for the
  // finished appointments' Due / Paid markers.
  const dueByVisitId = new Map(visitsInDept.map((row) => [row.visitId, hasDue(row.paymentState)]));
  // An appointment carried over from an earlier day whose visit was logged today:
  // keep it listed (under Done) so it doesn't vanish when its visit is saved.
  const filterAppointmentsTherapistId = viewTherapistId;
  const appointmentsForList = useMemo(() => {
    const todayVisitIds = new Set(visitsInDept.map((row) => row.visitId));
    return [
      ...(workspaceAppointments ?? []).filter(
        (a) =>
          a.visitId &&
          todayVisitIds.has(a.visitId) &&
          toLocalDateStr(new Date(a.scheduledAt)) < toLocalDateStr(new Date()) &&
          (!filterAppointmentsTherapistId || a.therapistId === filterAppointmentsTherapistId)
      ),
      ...todayAppointments,
    ];
  }, [workspaceAppointments, visitsInDept, filterAppointmentsTherapistId, todayAppointments]);
  const clinicAppointments = useMemo(
    () => appointmentsForList.filter((a) => inDepartment('clinic', a)),
    [appointmentsForList]
  );
  const clinicAppointmentsLeft = useMemo(
    () =>
      clinicAppointments.filter(
        (a) => a.status === 'confirmed' || a.status === 'rescheduled' || (a.status === 'arrived' && !a.visitId)
      ).length,
    [clinicAppointments]
  );
  const homeAppointments = useMemo(
    () => appointmentsForList.filter((a) => inDepartment('home', a)),
    [appointmentsForList]
  );

  return (
    <div className="space-y-5">
      <InstallAppBanner />
      <AppointmentDetailsPanel
        returnTo="/workspace"
        appointment={openAppointment}
        therapistName={openAppointment ? appointmentTherapistName(openAppointment) : ''}
        therapistColor={openAppointment ? appointmentColor(openAppointment) : UNASSIGNED_COLOR}
        therapistPhone={openAppointment?.therapistId ? therapistRoster.get(openAppointment.therapistId)?.phone ?? null : null}
        patientMrno={mrnoFor(openAppointment?.patientId) ?? null}
        attendance={
          openAppointment
            ? patientAttendance(workspaceAppointments ?? [], { patientId: openAppointment.patientId, phone: openAppointment.patientPhone }, new Date(), { excludeId: openAppointment.id })
            : null
        }
        slotMinutes={departmentHours(clinic, department).slotMinutes}
        flags={openAppointment ? patientFlags(openAppointment, flagContext) : []}
        condition={openAppointment?.patientId ? flagContext?.conditionByPatient.get(openAppointment.patientId) ?? null : null}
        canManage={Boolean(openAppointment) && (canManageBookings || openAppointment?.therapistId === scope.myTherapistId)}
        onClose={() => setOpenAppointmentId(null)}
        onCancelled={awaitingOpening.freed}
        onReschedule={(appointment) => {
          setOpenAppointmentId(null);
          setReschedulingAppointment(appointment);
        }}
        onStartNote={
          clinic.clinicalDocsEnabled && canViewClinicalNotes
            ? (appointment) => {
              setOpenAppointmentId(null);
              setStartVisit({ appointment });
            }
            : undefined
        }
      />
      <StartVisitSheet open={startVisit !== null} appointment={startVisit?.appointment} returnTo="/workspace" onClose={() => setStartVisit(null)} />
      <BookSlotSheet
        isOpen={bookingOpen}
        onClose={() => setBookingOpen(false)}
        appointments={workspaceAppointments ?? []}
        lockTherapist={!canManageBookings}
        prefilledTherapistId={!canManageBookings ? scope.myTherapistId : undefined}
        onBooked={setBooked}
      />
      <BookSlotSheet
        isOpen={confirmingRequest !== null}
        onClose={() => {
          setConfirmingRequest(null);
          setOpenedSlot(null);
        }}
        appointments={workspaceAppointments ?? []}
        prefilledDate={
          openedSlot
            ? openedSlot.date
            : confirmingRequest?.preferredDate && confirmingRequest.preferredDate >= toLocalDateStr(new Date())
              ? confirmingRequest.preferredDate
              : undefined
        }
        prefilledTherapistId={openedSlot?.therapistId ?? confirmingRequest?.preferredTherapistId ?? undefined}
        prefilledTime={
          openedSlot
            ? openedSlot.time
            : confirmingRequest
              ? requestedSlotTime(confirmingRequest, workspaceAppointments ?? [], toLocalDateStr(new Date()), departmentHours(clinic, department).slotMinutes) ?? undefined
              : undefined
        }
        prefilledPatientName={confirmingRequest?.name}
        prefilledPatientPhone={confirmingRequest?.phone}
        requestId={confirmingRequest?.id}
        requestNotes={confirmingRequest?.notes ?? undefined}
        requestPreferredTimeText={confirmingRequest?.preferredTimeText ?? undefined}
        requestAsked={confirmingRequest ? awaitingWants(confirmingRequest, toLocalDateStr(new Date())) : undefined}
        onBooked={(result) => {
          setBooked(result);
          setOpenedSlot(null);
        }}
      />
      <ConfirmDialog
        open={decliningRequest !== null}
        title="Remove from Awaiting?"
        message={decliningRequest ? `${decliningRequest.name} will be taken off the Awaiting list. You can message them right after.` : ''}
        confirmLabel="Dismiss"
        destructive
        onCancel={() => setDecliningRequest(null)}
        onConfirm={() => {
          const request = decliningRequest;
          setDecliningRequest(null);
          if (request) {
            bookingService
              .declineAppointmentRequest(request.id)
              .then(() => setDeclined({ name: request.name, phone: request.phone, requestedFor: requestWants(request), doNotMessage: doNotMessagePhones.has(lastTenDigits(request.phone)) }))
              .catch((error: unknown) => notify.error(toFriendlyMessage(error)));
          }
        }}
      />
      <BookSlotSheet
        isOpen={reschedulingAppointment !== null}
        onClose={() => setReschedulingAppointment(null)}
        appointments={workspaceAppointments ?? []}
        rescheduleAppointment={reschedulingAppointment ?? undefined}
        onBooked={(result) => {
          setBooked(result);
          // Moved to another time or therapist: its old time is free for anyone awaiting it.
          const old = reschedulingAppointment;
          if (old && (old.scheduledAt !== result.scheduledAt || (old.therapistId ?? null) !== (result.therapistId ?? null))) {
            awaitingOpening.freed(old);
          }
        }}
      />
      <AddToWaitlistSheet
        open={addAwaitingOpen}
        clinicId={clinic.id}
        initialDate={toLocalDateStr(new Date())}
        therapists={(workspaceTherapists ?? []).filter((t) => t.active !== false)}
        pending={pendingRequests}
        appointments={workspaceAppointments ?? []}
        onClose={() => setAddAwaitingOpen(false)}
      />
      <AwaitingOpenedStrip
        matches={awaitingOpening.matches}
        onBook={(request) => {
          setOpenedSlot(awaitingOpening.slot);
          setConfirmingRequest(request);
        }}
        onDismiss={awaitingOpening.clear}
      />
      {declined && <RequestDeclinedStrip declined={declined} clinicName={clinic.name} onDismiss={() => setDeclined(null)} />}
      <BookSlotSheet
        isOpen={bookingFollowUp !== null}
        onClose={() => setBookingFollowUp(null)}
        appointments={workspaceAppointments ?? []}
        prefilledPatientId={bookingFollowUp?.patientId}
        prefilledTherapistId={bookingFollowUp?.therapistId ?? undefined}
        prefilledDate={bookingFollowUp?.date}
        onBooked={setBooked}
      />
      {booked && (
        <BookedStrip
          booked={booked}
          clinicName={clinic.name}
          therapist={workspaceTherapists?.find((t) => t.id === booked.therapistId)}
          onDismiss={() => setBooked(null)}
        />
      )}
      {canEditSettings && <SetupProgressBar clinicId={clinic.id} />}
      <NotificationNudge />
      <header className="space-y-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm sm:space-y-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <h1 className="font-display text-lg font-semibold leading-snug text-[var(--ink)]">
              {greeting}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <span className="text-xs text-[var(--muted)]">
              {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(canManageBookings || scope.myTherapistId) && department !== 'ward' && (
              <button type="button" className={`${btnSecondary} hidden gap-1.5 sm:inline-flex sm:items-center`} onClick={() => setBookingOpen(true)}>
                <IconBook className="h-4 w-4" />
                Book
              </button>
            )}
            <Link to="/visits/new" className={`${btnPrimary} hidden gap-1.5 text-center sm:inline-flex sm:items-center`}>
              <IconPlus className="h-4 w-4" />
              New visit
            </Link>
          </div>
        </div>

        <StatStrip cells={statCells} />

        {/* Month figure + a link to the full breakdown — Reports already has
            revenue, visits, new patients and packages with trends, so the
            header doesn't repeat it beyond this one line. Admin/front desk
            only; a therapist has no Reports access. */}
        {scope.isClinicWideView && !scope.isFrontDesk && (
          <Link
            to="/insights"
            className="flex items-center justify-between gap-2 text-xs text-[var(--muted)] hover:text-[var(--teal)]"
          >
            <span className="min-w-0 truncate">
              <span className="hidden sm:inline">
                <span className="font-medium text-[var(--ink)]">Whole clinic</span> ·{' '}
              </span>
              {monthCaption}: {monthReport ? formatAmount(monthReport.total.netPostTaxPaise) : '—'} net revenue ·{' '}
              {monthReport ? monthReport.total.visitCount : '—'} visits
            </span>
            <span className="hidden shrink-0 font-medium text-[var(--teal)] sm:inline">Reports ›</span>
          </Link>
        )}

        {/* Front desk does not see the clinic's net revenue: it sees what came in today, which is what should be in the drawer. */}
        {scope.isFrontDesk && scope.isClinicWideView && (
          <p className="flex items-start justify-between gap-2 text-xs text-[var(--muted)]">
            <span className="min-w-0">
              <span className="hidden sm:inline">
                <span className="font-medium text-[var(--ink)]">Whole clinic</span> ·{' '}
              </span>
              Today:{' '}
              {receivedByMethod === undefined ? '…' : collectionsLine(receivedByMethod, formatAmount) || 'nothing collected yet'}
            </span>
            {(canBill || canCollectPayment) && (
              <Link to="/ledger" search={{ tab: 'daybook' }} className="shrink-0 font-medium text-[var(--teal)]">
                Daybook ›
              </Link>
            )}
          </p>
        )}

        {!scope.isClinicWideView && scope.scopeTherapistId && (
          <p className="text-xs text-[var(--muted)]">
            <span className="hidden sm:inline">
              <span className="font-medium text-[var(--ink)]">
                {scope.myTherapistId ? (therapistRoster.get(scope.myTherapistId)?.name.split(' ')[0] ?? 'You') : 'You'}
              </span>{' '}
              ·{' '}
            </span>
            {monthCaption}:{' '}
            {monthReport === undefined || monthlyNew === undefined || (therapistSplit && therapists === undefined) ? (
              <LoadingValue />
            ) : (
              `${myMonthRow?.visitCount ?? 0} visits · ${monthlyNew.newPackages} ${monthlyNew.newPackages === 1 ? 'package' : 'packages'}`
            )}
          </p>
        )}

        {/* "Needs you": one line, only when something needs attention that
            the page doesn't already list (draft notes, new feedback,
            unsynced visits); each item jumps to where it's done. */}
        {needsYou.length > 0 && (
          <ul className="flex items-center gap-4 overflow-x-auto rounded-xl bg-[var(--paper)] px-3 py-2 text-sm" aria-label="Needs you">
            {needsYou.map((item) => (
              <li key={item.key}>{item.node}</li>
            ))}
          </ul>
        )}
      </header>

      {workspaceView.canToggle && (
        <WorkspaceViewToggle
          mineOnly={workspaceMineOnly}
          onChange={(next) => {
            setViewChoice(next);
            setVisitTherapistId('');
          }}
        />
      )}

      {scope.isUnlinkedTherapist && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">
            Link your login
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Today’s visits and packages aren’t showing because this login isn’t linked to a
            therapist record yet. Ask your admin to open you under Settings → Team and add your email to invite you.
          </p>
        </section>
      )}

      {clinic.lastSplitChangeAt && (
        <SplitChangeBanner clinicId={clinic.id} changedAt={clinic.lastSplitChangeAt} />
      )}

      {department === 'clinic' && (
        <SectionCard
          title="Appointments"
          badge={
            clinicAppointmentsLeft > 0 ? (
              <Pill tone="teal">{clinicAppointmentsLeft} left</Pill>
            ) : clinicAppointments.some((a) => a.status !== 'cancelled') ? (
              <Pill tone="slate">All done</Pill>
            ) : (
              <Pill tone="slate">None today</Pill>
            )
          }
          action={
            // The Schedule tab is in the main navigation, so there is no second link to it here.
            canManageBookings ? (
              <button type="button" className={`shrink-0 ${pillAccent}`} onClick={() => setAddAwaitingOpen(true)}>
                + Awaiting
              </button>
            ) : undefined
          }
        >
          <TodayAppointments
            appointments={clinicAppointments}
            slotMinutes={departmentHours(clinic, department).slotMinutes}
            nextUpId={nextUpId}
            colorFor={appointmentColor}
            therapistNameFor={appointmentTherapistName}
            showTherapist={canManageBookings}
            onSelect={(a) => setOpenAppointmentId(a.id)}
            requests={pendingRequests}
            therapistNameForId={(id) => (id ? therapistRoster.get(id)?.name ?? null : null)}
            onConfirmRequest={setConfirmingRequest}
            onDeclineRequest={setDecliningRequest}
            onMessageRequest={(r) => bookingService.sendText(awaitingMessage({ patientName: r.name, clinicName: clinic.name }), r.phone)}
            bookedNoteForRequest={(r) => bookedNoteFor(r, workspaceAppointments ?? [])}
            canMessageRequest={(r) => !doNotMessagePhones.has(lastTenDigits(r.phone))}
            onSeeAllRequests={() => void navigate({ to: '/schedule', search: { tab: 'bookings', view: 'requests' } })}
            flagContext={flagContext}
            mrnoFor={mrnoFor}
            dueByVisitId={dueByVisitId}
            onMarkArrived={
              canManageBookings || scope.myTherapistId
                ? (a) => bookingService.markAppointmentArrived(a.id).catch((e) => notify.error(toFriendlyMessage(e)))
                : undefined
            }
            onUndoArrived={
              canManageBookings || scope.myTherapistId
                ? (a) => bookingService.restoreArrivedAppointment(a.id).catch((e) => notify.error(toFriendlyMessage(e)))
                : undefined
            }
            onRestoreCancelled={
              canManageBookings || scope.myTherapistId
                ? (a) => bookingService.restoreCancelledAppointment(a.id).catch((e) => notify.error(toFriendlyMessage(e)))
                : undefined
            }
            onUndoNoShow={
              canManageBookings || scope.myTherapistId
                ? (a) => bookingService.restoreNoShowAppointment(a.id).catch((e) => notify.error(toFriendlyMessage(e)))
                : undefined
            }
          />
        </SectionCard>
      )}

      {department === 'home' && (
        <HomeVisitsCard
          appointments={homeAppointments}
          patientsById={directoryPatientsMap}
          therapistRoster={therapistRoster}
          showTherapist={canManageBookings}
          onSelect={(a) => setOpenAppointmentId(a.id)}
          onMarkArrived={
            canManageBookings || scope.myTherapistId
              ? (a) => bookingService.markAppointmentArrived(a.id).catch((e) => notify.error(toFriendlyMessage(e)))
              : undefined
          }
          onUndoArrived={
            canManageBookings || scope.myTherapistId
              ? (a) => bookingService.restoreArrivedAppointment(a.id).catch((e) => notify.error(toFriendlyMessage(e)))
              : undefined
          }
        />
      )}

      {department === 'ward' && (
        <InpatientsCard
          viewTherapistId={workspaceMineOnly ? scope.myTherapistId : (visitsFilterId || undefined)}
        />
      )}

      <SectionCard
        title="Today's visits"
        badge={
          visitsInView.length > 0 ? (
            <span className="font-num rounded-full bg-[var(--paper)] px-2 py-0.5 text-xs font-semibold text-[var(--ink)]">
              {visitsInView.length}
            </span>
          ) : null
        }
        action={
          visitsInView.length > 0 ? (
            <div className="flex items-center gap-2">
              {!workspaceMineOnly && therapistOptions.length > 1 && (
                <TodayTherapistFilter options={therapistOptions} value={visitsFilterId} onChange={setVisitTherapistId} />
              )}
              <div className="hidden tab:block">
                <VisitColumnPicker
                  columnPrefs={visitColumnPrefs}
                  onColumnPrefsChange={setVisitColumnPref}
                />
              </div>
            </div>
          ) : null
        }
      >
        {!today ? (
          <LoadingRows label="Loading today's visits" />
        ) : visitsInView.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No visits logged today — log one with &ldquo;+ New visit&rdquo;.
          </p>
        ) : (
          <>
            <ResponsiveVisitList
              rows={todayList.visible}
              showDate={false}
              showPatient={true}
              showColumnPicker={false}
              onInvoice={(row) => openInvoiceFor(row)}
              onTakePayment={(row) => setTakingPayment(row)}
              onEditPatient={(row) => setEditPatientId(row.patientId)}
              onEdit={(row) => {
                setVisitEditError(null);
                setEditingVisitId(row.visitId);
              }}
              onSplit={
                canShareRevenue
                  ? (row) => {
                    void repos.visits.get(row.visitId).then((v) => {
                      if (v) setSplitting(v);
                    });
                  }
                  : undefined
              }
              onDelete={(row) => void confirmAndDeleteVisit(row.visitId)}
              onAskForFeedback={(row) => {
                void feedbackService
                  .askForFeedback(row.visitId, row.patientName, row.patientPhone ?? null, clinic.name)
                  .catch((e) => notify.error(toFriendlyMessage(e)));
              }}
              onResendFeedback={(row) => {
                const request = feedbackRequestByVisitId.get(row.visitId);
                if (!request?.token) return;
                void feedbackService
                  .resend(request, row.patientName, row.patientPhone ?? null, clinic.name)
                  .catch((e) => notify.error(toFriendlyMessage(e)));
              }}
              onAskForGoogleReview={(row) => {
                if (!row.googleReviewUrl) return;
                void feedbackService
                  .askForGoogleReview(
                    clinic.id,
                    row.patientName,
                    row.patientPhone ?? null,
                    clinic.name,
                    row.googleReviewUrl
                  )
                  .catch((e) => notify.error(toFriendlyMessage(e)));
              }}
              canInvoice={canBill}
              canCollect={canCollectPayment}
              backTo="/workspace"
            />
            <ShowMoreFooter list={todayList} noun="visits" />
            <TodayVisitsTotals
              totals={visitTotals}
              label={therapistOptions.find((o) => o.id === visitsFilterId)?.name ?? 'Total'}
              showMoney={canBill || canCollectPayment}
              inpatientBillingMode={
                department === 'ward'
                  ? canBillInpatientStay(clinic)
                    ? 'stay_bill'
                    : 'partner_billed'
                  : null
              }
            />
          </>
        )}
      </SectionCard>


      {assistedToday.length > 0 && (
        <SectionCard
          title="Assisted today"
          badge={
            <span className="font-num rounded-full bg-[var(--paper)] px-2 py-0.5 text-xs font-semibold text-[var(--ink)]">
              {assistedToday.length}
            </span>
          }
        >
          <AssistedVisitList
            rows={assistedToday}
            patientName={patientNameOf}
            showDate={false}
            assistantName={nameOfTherapist(scope.myTherapistId ?? '')}
            viewerIsAssistant
          />
        </SectionCard>
      )}

      {department !== 'ward' && (
        <SectionCard
          title="Follow up"
          badge={followUpBadge}
          action={
            <button
              type="button"
              aria-expanded={followOpen}
              className={pillNeutral}
              onClick={() => setFollowOpen(!followOpen)}
            >
              <span>{followOpen ? 'Hide' : 'Show'}</span>
              <span className="text-[10px] text-[var(--muted)]" aria-hidden="true">
                {followOpen ? '▴' : '▾'}
              </span>
            </button>
          }
        >
          {!followOpen && (
            <p className="text-sm text-[var(--muted)]">
              {[
                followUp.due.length ? `${followUp.due.length} review${followUp.due.length === 1 ? '' : 's'} due` : null,
                followUp.missed.length ? `${followUp.missed.length} missed` : null,
                followUp.noShows.length ? `${followUp.noShows.length} no-show${followUp.noShows.length === 1 ? '' : 's'}` : null,
                attentionCount ? `${attentionCount} package${attentionCount === 1 ? '' : 's'} need attention` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Nothing needs following up.'}
            </p>
          )}
          {followOpen && (
            <>
              <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
                <div role="tablist" aria-label="Follow up" className={segTrack}>
                  {(
                    [
                      { key: 'reviews', label: 'Reviews', count: followUp.due.length },
                      { key: 'packages', label: 'Packages', count: scopedPackages.length },
                    ] as const
                  ).map((tab) => {
                    const active = followTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => chooseFollowTab(tab.key)}
                        className={`${segOption(active)} gap-1.5`}
                      >
                        {tab.label}
                        <ChipCount n={tab.count} />
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  {hasMoreThanFiveFollowUps && (
                    <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                      Rows
                      <select
                        aria-label="Rows per page"
                        className={chipSelect}
                        style={chipSelectChevron}
                        value={followPageSize}
                        onChange={(e) => setFollowPageSize(Number(e.target.value) as 5 | 10)}
                      >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
              {followTab === 'reviews' ? (
                <ReviewsPanel
                  data={followUp}
                  pageSize={followPageSize}
                  clinicName={clinic.name}
                  showTherapist={scope.isClinicWideView}
                  therapistNameFor={(id) => (id ? workspaceTherapists?.find((t) => t.id === id)?.name ?? null : null)}
                  onBook={setBookingFollowUp}
                />
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      {(
                        [
                          { key: 'open', label: 'Open', count: 0 },
                          { key: 'attention', label: 'Needs attention', count: attentionCount },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          aria-pressed={pkgStatusFilter === opt.key}
                          onClick={() => setPkgStatusFilter(opt.key)}
                          className={filterChip(pkgStatusFilter === opt.key)}
                        >
                          {opt.label}
                          {opt.count ? <ChipCount n={opt.count} /> : null}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-[var(--muted)]">
                      {filteredPackages.length} package{filteredPackages.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {filteredPackages.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[var(--muted)]">
                      No packages match this filter.
                    </p>
                  ) : (
                    <>
                      {/* Below tab: pill cards on phone; table from iPad portrait up. */}
                      <div className="tab:hidden space-y-2">
                        {packageList.visible.map((p) => (
                          <div
                            key={p.packageGroupId}
                            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <Link
                                to="/patients/$patientId"
                                params={{ patientId: p.patientId }}
                                search={{ from: '/workspace' }}
                                className="min-w-0"
                              >
                                <div className="font-display text-sm font-medium text-[var(--ink)]">
                                  {p.patientName}
                                </div>
                                <div className="font-num text-xs text-[var(--muted)]">{p.mrno}</div>
                              </Link>
                              <PackageStatusPill pkg={p} />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Pill tone="slate">{p.serviceName}</Pill>
                              <Pill tone="slate">{p.startedByTherapistName}</Pill>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-[var(--muted)]">
                                <PackageThread
                                  sessionIndex={p.sessionsLogged}
                                  packageTotal={p.packageTotal}
                                />
                                <span className="font-num">
                                  {p.sessionsLogged}/{p.packageTotal}
                                </span>
                                <span className="ml-1">
                                  Started {formatDateDM(p.startedOn)} · Last {formatDateDM(p.lastVisitOn)} (
                                  {p.daysSinceLastVisit}d ago)
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {p.stale && !p.doNotMessage && (
                                  <button
                                    type="button"
                                    className={pillSmAccent}
                                    onClick={() => {
                                      void feedbackService
                                        .sendStalePackageReminder(
                                          clinic.id,
                                          p.patientName,
                                          p.phone,
                                          clinic.name,
                                          p.serviceName
                                        )
                                        .catch((e) => notify.error(toFriendlyMessage(e)));
                                    }}
                                  >
                                    Send reminder
                                  </button>
                                )}
                                <Link
                                  to="/visits/new"
                                  search={{ repeatVisitId: p.lastVisitId }}
                                  className={pillSmPrimary}
                                >
                                  Log visit
                                </Link>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="hidden tab:block overflow-x-auto">
                        <table className="min-w-full divide-y divide-[var(--border)]">
                          <thead className="bg-[var(--paper)]">
                            <tr>
                              <th className={th}>Patient</th>
                              <th className={th}>Package</th>
                              <th className={th}>Therapist</th>
                              <th className={thNum}>Sessions</th>
                              <th className={th}>Started</th>
                              <th className={th}>Last visit</th>
                              <th className={th}>Status</th>
                              <th className={th}></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]">
                            {packageList.visible.map((p) => (
                              <tr key={p.packageGroupId}>
                                <td className={td}>
                                  <Link
                                    to="/patients/$patientId"
                                    params={{ patientId: p.patientId }}
                                    search={{ from: '/workspace' }}
                                    className="font-display font-medium text-[var(--ink)] hover:underline hover:text-[var(--teal)]"
                                  >
                                    {p.patientName}
                                  </Link>{' '}
                                  <span className="font-num text-xs text-[var(--muted)]">{p.mrno}</span>
                                </td>
                                <td className={td}>{p.serviceName}</td>
                                <td className={td}>{p.startedByTherapistName}</td>
                                <td className={tdNum}>
                                  <span className="inline-flex items-center gap-1.5">
                                    <PackageThread
                                      sessionIndex={p.sessionsLogged}
                                      packageTotal={p.packageTotal}
                                    />
                                    <span className="font-num">
                                      {p.sessionsLogged}/{p.packageTotal}
                                    </span>
                                  </span>
                                </td>
                                <td className={td}>{formatDateDM(p.startedOn)}</td>
                                <td className={td}>
                                  {formatDateDM(p.lastVisitOn)}{' '}
                                  <span className="text-[var(--muted)]">({p.daysSinceLastVisit}d ago)</span>
                                </td>
                                <td className={td}>
                                  <PackageStatusPill pkg={p} />
                                </td>
                                <td className={td}>
                                  <div className="flex items-center gap-2">
                                    {p.stale && !p.doNotMessage && (
                                      <button
                                        type="button"
                                        className={pillSmAccent}
                                        onClick={() => {
                                          void feedbackService
                                            .sendStalePackageReminder(
                                              clinic.id,
                                              p.patientName,
                                              p.phone,
                                              clinic.name,
                                              p.serviceName
                                            )
                                            .catch((e) => notify.error(toFriendlyMessage(e)));
                                        }}
                                      >
                                        Send reminder
                                      </button>
                                    )}
                                    <Link
                                      to="/visits/new"
                                      search={{ repeatVisitId: p.lastVisitId }}
                                      className={pillSmPrimary}
                                    >
                                      Log visit
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ShowMoreFooter list={packageList} noun="packages" />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </SectionCard>
      )}

      {invoicing && (
        <IssueInvoiceDialog
          clinicId={clinic.id}
          target={invoicing}
          onClose={() => setInvoicing(null)}
          returnTo="/workspace"
        />
      )}

      {takingPayment && (
        <TakePaymentDialog
          clinicId={clinic.id}
          visitId={takingPayment.visitId}
          invoiceId={takingPayment.invoiceId}
          amountPaise={takingPayment.billPaise}
          visitDate={takingPayment.visitDate}
          patientLabel={takingPayment.patientName}
          mrno={takingPayment.mrno}
          patientId={takingPayment.patientId}
          onClose={() => setTakingPayment(null)}
        />
      )}

      {editingVisitId && (
        <EditVisitModal
          visitId={editingVisitId}
          onClose={() => setEditingVisitId(null)}
          setError={setVisitEditError}
        />
      )}

      {editPatientId && editPatient && (
        <EditPatientModal
          patient={editPatient}
          open={true}
          onClose={() => setEditPatientId(null)}
          onSave={() => {
            setEditPatientId(null);
          }}
        />
      )}

      {newPatientId && (
        <AddPatientDetailsModal
          patientId={newPatientId}
          onClose={() => setNewPatientId(null)}
          onOpenEdit={() => setEditPatientId(newPatientId)}
        />
      )}

      {splitting && (
        <RevenueShareEditorLoader
          visit={splitting}
          therapists={therapists ?? []}
          onClose={() => setSplitting(null)}
        />
      )}
    </div>
  );
}

/** Shown while a local query is still resolving, so a not-yet-loaded total never reads as ₹0. */
function LoadingValue() {
  return <span aria-hidden className="inline-block h-5 w-16 animate-pulse rounded bg-[var(--border)] align-middle" />;
}
