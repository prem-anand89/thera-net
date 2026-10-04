import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, reportService, feedbackService, bookingService } from '@/services';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import {
  clinicBillingConfig,
  type ConsultationNote,
  type FeedbackRequest,
  type FeedbackResponse,
  type Appointment,
  type AppointmentRequest,
  type Visit,
} from '@/domain/types';
import { appointmentStartsOnDate, minutesOfDay, patientAttendance, toLocalDateStr } from '@/domain/schedule';
import { TodayAppointments } from '@/components/schedule/TodayAppointments';
import { usePatientFlagContext } from '@/components/schedule/usePatientFlagContext';
import { patientFlags } from '@/domain/patientFlags';
import { StartVisitSheet } from '@/components/StartVisitSheet';
import { AppointmentDetailsPanel } from '@/components/schedule/AppointmentDetailsPanel';
import { UNASSIGNED_COLOR, therapistColor } from '@/components/schedule/scheduleColors';
import { BookSlotSheet } from '@/components/BookSlotSheet';
import { InstallAppBanner } from '@/components/InstallAppBanner';
import { noteForVisit } from '@/domain/noteLinks';
import { toFriendlyMessage } from '@/lib/errors';
import { canAskForFeedbackOnVisit } from '@/domain/patientComms';
import type { OpenPackageRow, TodayVisitRow } from '@/services/dashboardService';
import {
  btnPrimary,
  btnSecondary,
  SectionCard,
  StatStrip,
  ConfirmDialog,
  Pill,
  PackageThread,
  th,
  thNum,
  td,
  tdNum,
} from '@/components/ui';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
import {
  useNewFeedbackResponseCount,
  useGoogleReviewEligibleRequestIds,
} from '@/features/schedule/scheduleSignals';
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { SplitModal } from '@/components/SplitModal';
import { TherapistComparisonCard } from '@/components/TherapistComparisonCard';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { AddPatientDetailsModal } from '@/features/visits/AddPatientDetailsModal';
import { EditVisitModal } from '@/features/visits/EditVisitModal';
import { FirstWeekSetupLink } from '@/features/settings/FirstWeekChecklist';
import {
  IconBook,
  IconCloud,
  IconPen,
  IconPlus,
  IconRupee,
  IconStar,
  IconWallet,
  IconUserCheck,
} from '@/components/StatIcons';

/** What the invoice-issuance modal needs, independent of which card opened it. */
type InvoicingTarget = IssueInvoiceTarget;

/** A changed hasPartner/clinicSplitPct/taxPct/tdsBasis/clinicType (stamped as
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

function todayRowToCardData(
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
  googleReviewUrl: string | null
): VisitCardData {
  const canModify = isAdmin || row.therapistId === myTherapistId;
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
    issuedAt: row.issuedAt,
    canRepeat: Boolean(row.packageGroupId && openPackageGroupIds.has(row.packageGroupId)),
    canSplit: therapistSplit && row.billPaise > 0 && canModify,
    hasSplit: Boolean(row.sharedTherapistId),
    sharedPct: row.sharedPct,
    sharedTherapistName: row.sharedTherapistName,
    // Pre-flight mirror of visits_delete's RLS check (is_clinic_admin or
    // is_own_therapist). front_desk is never either, so this always comes
    // out false for them — matching RLS, which rejects their delete too.
    canDelete: !row.invoiceId && canModify,
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
  if (pkg.stale) return <Pill tone="amber">Stale</Pill>;
  if (pkg.nearingCompletion) return <Pill tone="amber">Renew soon</Pill>;
  return <Pill tone="green">Open</Pill>;
}

export function WorkspacePage() {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const { canBill, canViewClinicalNotes, canEditSettings } = usePermissions();
  const navigate = useNavigate();

  const { therapistSplit } = clinicBillingConfig(clinic);
  // Patient Communications, Slice 2 — "something arrived" surface per the
  // handoff doc's own question table: admin-only (feedback content is
  // admin-only at RLS too), gated on the module being on.
  const newFeedbackCount = useNewFeedbackResponseCount(
    clinic.id,
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
    // Loaded even with patient comms off: a walk-in started from "Start a note
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
          .map((t, index) => [t.id, { name: t.name, phone: t.phone ?? null, color: therapistColor(index) }] as const)
      ),
    [workspaceTherapists]
  );
  // Same scoping as "Seen today": clinic-wide for admin/front desk, own column
  // for a therapist (scopeTherapistId is undefined for the clinic-wide roles).
  const expectedToday = useMemo(() => {
    const todayStr = toLocalDateStr(new Date());
    return (workspaceAppointments ?? [])
      .filter(
        (a) =>
          a.status !== 'cancelled' &&
          appointmentStartsOnDate(a, todayStr) &&
          (!scope.scopeTherapistId || a.therapistId === scope.scopeTherapistId)
      )
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }, [workspaceAppointments, scope.scopeTherapistId]);
  // Visits started (arrived / walk-in) but not completed with a service yet —
  // today's plus any left open in the last week, so none are forgotten.
  const todayAppointments = useMemo(() => {
    const weekAgo = toLocalDateStr(new Date(Date.now() - 7 * 86_400_000));
    const todayStr = toLocalDateStr(new Date());
    const olderOpen = (workspaceAppointments ?? []).filter((a) => {
      const day = toLocalDateStr(new Date(a.scheduledAt));
      return (
        a.status === 'arrived' && !a.visitId && day < todayStr && day >= weekAgo &&
        (!scope.scopeTherapistId || a.therapistId === scope.scopeTherapistId)
      );
    });
    // Patient comms off: no bookings to show, only visits in progress.
    const todays = clinic.enablePatientComms
      ? expectedToday
      : expectedToday.filter((a) => a.status === 'arrived' && !a.visitId);
    return [...olderOpen, ...todays];
  }, [workspaceAppointments, expectedToday, scope.scopeTherapistId, clinic.enablePatientComms]);
  const toCompleteCount = todayAppointments.filter((a) => a.status === 'arrived' && !a.visitId).length;
  // The Appointments tab: always with patient comms; otherwise only while a
  // walk-in visit is in progress.
  const showAppointmentsTab = Boolean(clinic.enablePatientComms) || toCompleteCount > 0;
  const [todayTab, setTodayTabState] = useState<'appointments' | 'visits'>(() => {
    try {
      return (window.localStorage.getItem('thera-net:workspace-today-tab') as 'appointments' | 'visits') ?? 'appointments';
    } catch {
      return 'appointments';
    }
  });
  const setTodayTab = (tab: 'appointments' | 'visits') => {
    setTodayTabState(tab);
    try {
      window.localStorage.setItem('thera-net:workspace-today-tab', tab);
    } catch {
      // Private mode: the tab just isn't remembered.
    }
  };
  // "Next up": the first still-to-come appointment (15 minutes' grace for late arrivals).
  const nextUpId = expectedToday.find(
    (a) => (a.status === 'confirmed' || a.status === 'rescheduled') && minutesOfDay(a.scheduledAt) >= nowMinutes - 15
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
  const [bookingOpen, setBookingOpen] = useState(false);
  const [startVisit, setStartVisit] = useState<{ appointment?: Appointment } | null>(null);
  const hour = new Date().getHours();
  const greeting = hour < 4 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const myTherapistName = scope.myTherapistId ? therapistRoster.get(scope.myTherapistId)?.name : undefined;
  const firstName = (myTherapistName ?? '').replace(/^Dr\.?\s+/i, '').split(/\s+/)[0] || '';
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
      canManageBookings && clinic.enablePatientComms
        ? repos.appointmentRequests.listByClinic(clinic.id)
        : undefined,
    [clinic.id, clinic.enablePatientComms, canManageBookings]
  );
  const pendingRequests = useMemo(
    () =>
      (appointmentRequests ?? [])
        .filter((r) => r.status === 'pending')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [appointmentRequests]
  );
  const pendingRequestCount = pendingRequests.length;
  const [confirmingRequest, setConfirmingRequest] = useState<AppointmentRequest | null>(null);
  const [decliningRequest, setDecliningRequest] = useState<AppointmentRequest | null>(null);
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [takingPayment, setTakingPayment] = useState<VisitCardData | null>(null);
  const [editPatientId, setEditPatientId] = useState<string | null>(null);
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [, setVisitEditError] = useState<string | null>(null);
  const [newPatientId, setNewPatientId] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<Visit | null>(null);
  // "Open" = every open package, the ones needing a call (gone quiet, or
  // nearly used up) sorted first; "Needs attention" narrows to just those.
  const [pkgStatusFilter, setPkgStatusFilter] = useState<'open' | 'attention'>('open');
  // Defaults on for anyone with a linked therapist record — admin included,
  // since in most solo/small clinics the admin *is* the primary therapist.
  // Role plays no part here: only whether this login has a `therapists` row
  // to scope to.
  const [pkgMineOnly, setPkgMineOnly] = useState(true);

  // Staff (therapist) tier sees only their own visits in the today-scoped
  // stats and Seen today (one shared query drives both); admin sees the
  // whole clinic. While role hasn't resolved yet ('unknown'), useWorkspaceScope
  // defaults to the narrower staff-scoped view rather than flashing
  // clinic-wide data.
  const today = useLiveQuery(
    () => dashboardService.todayWorklist(clinic.id, new Date(), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  // Clinic-wide for admin/front_desk, scoped to just this therapist's own
  // visits otherwise — matches "Collected today" above, which already
  // scopes the same way via scope.scopeTherapistId.
  const monthlyNew = useLiveQuery(
    () => dashboardService.monthlyNewCounts(clinic.id, new Date(), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  // Clinic-wide open-packages list — feeds the Packages panel below.
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const openPackageGroupIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
  );
  const needsAttention = (p: OpenPackageRow) => p.stale || p.nearingCompletion;
  const scopedPackages = useMemo(
    () =>
      pkgMineOnly && scope.myTherapistId
        ? (openPackages ?? []).filter((p) => p.startedByTherapistId === scope.myTherapistId)
        : openPackages ?? [],
    [openPackages, pkgMineOnly, scope.myTherapistId]
  );
  const attentionCount = scopedPackages.filter(needsAttention).length;
  const filteredPackages = useMemo(() => {
    if (pkgStatusFilter === 'attention') return scopedPackages.filter(needsAttention);
    // Stable sort: attention rows first, otherwise the service's own order.
    return [...scopedPackages].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
  }, [scopedPackages, pkgStatusFilter]);

  const now = new Date();
  const calendarMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };
  // "This month" numbers: a therapist's own row, or the clinic total.
  const monthReport = useLiveQuery(
    () => reportService.monthly(clinic.id, calendarMonth),
    [clinic.id, calendarMonth.year, calendarMonth.month]
  );
  const myMonthRow = monthReport?.rows.find((r) => r.therapistId === scope.myTherapistId);
  // "Collected" = money received today (the Daybook's figure), scoped to the
  // therapist's own visits for a therapist login.
  const receivedToday = useLiveQuery(
    () => dashboardService.receivedOnDate(clinic.id, toLocalDateStr(new Date()), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  // Dues: what's still owed — the whole clinic for admin/front desk, a
  // therapist's own visits for them (when billing is open to them). Per visit,
  // so "Take payment later" visits count too.
  const showDues = canBill && (scope.isClinicWideView || Boolean(scope.myTherapistId));
  const dues = useLiveQuery(
    () => (showDues ? dashboardService.duesSummary(clinic.id, scope.scopeTherapistId) : undefined),
    [clinic.id, showDues, scope.scopeTherapistId]
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
  }, [candidatePendingGroupIds]) ?? new Set<string>();

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

  const therapistNameById = new Map((therapists ?? []).map((t) => [t.id, t.name]));

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
        <span className={`${needsItem} !text-[var(--amber)] hover:!no-underline`}>
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
  const monthShort = now.toLocaleDateString('en-IN', { month: 'short' });
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
    value: receivedToday === undefined ? <LoadingValue /> : formatINR(receivedToday),
    icon: <IconRupee />,
    tone: 'moss' as const,
    kind: 'money' as const,
    onClick: canBill && scope.isClinicWideView ? () => void navigate({ to: '/ledger', search: { tab: 'daybook' } }) : undefined,
  };
  const duesCell = {
    label: duesCount > 0 ? `Dues · ${duesCount}` : 'Dues',
    value: dues === undefined ? <LoadingValue /> : formatINR(dues.totalPaise),
    icon: <IconWallet />,
    tone: 'amber' as const,
    kind: 'money' as const,
    // Straight to the unpaid visits, all dates (a therapist's own).
    onClick: () => void navigate({ to: '/ledger', search: { tab: 'visits', filter: 'not_collected' } }),
  };
  const visitsCell = {
    label: `${monthShort} visits · packages`,
    value:
      monthReport === undefined || monthlyNew === undefined || (therapistSplit && therapists === undefined) ? (
        <LoadingValue />
      ) : (
        `${myMonthRow?.visitCount ?? 0} · ${monthlyNew.newPackages}`
      ),
    icon: <IconUserCheck />,
    tone: 'sky' as const,
  };
  const statCells = scope.isClinicWideView
    ? [collectedCell, duesCell]
    : showDues
      ? // A therapist who bills: what they've collected, what's owed on their
        // visits, and their month. (Open packages are listed below.)
        [collectedCell, duesCell, visitsCell]
      : [collectedCell, visitsCell];

  return (
    <div className="space-y-5">
      <InstallAppBanner />
      <AppointmentDetailsPanel
        returnTo="/workspace"
        appointment={openAppointment}
        therapistName={openAppointment ? appointmentTherapistName(openAppointment) : ''}
        therapistColor={openAppointment ? appointmentColor(openAppointment) : UNASSIGNED_COLOR}
        therapistPhone={openAppointment?.therapistId ? therapistRoster.get(openAppointment.therapistId)?.phone ?? null : null}
        attendance={
          openAppointment
            ? patientAttendance(workspaceAppointments ?? [], { patientId: openAppointment.patientId, phone: openAppointment.patientPhone }, new Date(), { excludeId: openAppointment.id })
            : null
        }
        slotMinutes={clinic.slotDurationMinutes || 30}
        flags={openAppointment ? patientFlags(openAppointment, flagContext) : []}
        condition={openAppointment?.patientId ? flagContext?.conditionByPatient.get(openAppointment.patientId) ?? null : null}
        canManage={Boolean(openAppointment) && (canManageBookings || openAppointment?.therapistId === scope.myTherapistId)}
        onClose={() => setOpenAppointmentId(null)}
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
      />
      <BookSlotSheet
        isOpen={confirmingRequest !== null}
        onClose={() => setConfirmingRequest(null)}
        appointments={workspaceAppointments ?? []}
        prefilledDate={
          confirmingRequest?.preferredDate && confirmingRequest.preferredDate >= toLocalDateStr(new Date())
            ? confirmingRequest.preferredDate
            : undefined
        }
        prefilledTherapistId={confirmingRequest?.preferredTherapistId ?? undefined}
        prefilledPatientName={confirmingRequest?.name}
        prefilledPatientPhone={confirmingRequest?.phone}
        requestId={confirmingRequest?.id}
        requestNotes={confirmingRequest?.notes ?? undefined}
        requestPreferredTimeText={confirmingRequest?.preferredTimeText ?? undefined}
      />
      <ConfirmDialog
        open={decliningRequest !== null}
        title="Decline this request?"
        message={decliningRequest ? `${decliningRequest.name}'s request will be removed from the list. Let them know separately if needed.` : ''}
        confirmLabel="Decline"
        destructive
        onCancel={() => setDecliningRequest(null)}
        onConfirm={() => {
          const request = decliningRequest;
          setDecliningRequest(null);
          if (request) {
            bookingService.declineAppointmentRequest(request.id).catch((error: unknown) => alert(toFriendlyMessage(error)));
          }
        }}
      />
      <BookSlotSheet
        isOpen={reschedulingAppointment !== null}
        onClose={() => setReschedulingAppointment(null)}
        appointments={workspaceAppointments ?? []}
        rescheduleAppointment={reschedulingAppointment ?? undefined}
      />
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
            {canEditSettings && <FirstWeekSetupLink clinicId={clinic.id} />}
          </div>
          <div className="flex shrink-0 gap-2">
            {clinic.enablePatientComms && (canManageBookings || scope.myTherapistId) && (
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
        {scope.isClinicWideView && (
          <Link
            to="/insights"
            className="flex items-center justify-between gap-2 text-xs text-[var(--muted)] hover:text-[var(--teal)]"
          >
            <span className="min-w-0 truncate">
              {monthCaption}: {monthReport ? formatINR(monthReport.total.netPostTaxPaise) : '—'} net revenue ·{' '}
              {monthReport ? monthReport.total.visitCount : '—'} visits
            </span>
            <span className="shrink-0 font-medium text-[var(--teal)]">Reports ›</span>
          </Link>
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

      {scope.isUnlinkedTherapist && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">
            Link your login
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Today’s visits and packages aren’t showing because this login isn’t linked to a
            therapist record yet. Ask your admin to set it from Settings → Team → Linked login.
          </p>
        </section>
      )}

      {clinic.lastSplitChangeAt && (
        <SplitChangeBanner clinicId={clinic.id} changedAt={clinic.lastSplitChangeAt} />
      )}


      <SectionCard
        title="Today"
        action={
          showAppointmentsTab ? (
            <div className="flex rounded-lg border border-[var(--border)] p-0.5" role="tablist" aria-label="Today">
              {(['appointments', 'visits'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={todayTab === tab}
                  onClick={() => setTodayTab(tab)}
                  className={`min-h-9 rounded-md px-3 text-xs font-medium ${todayTab === tab ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
                >
                  {tab === 'appointments' ? `Appointments (${todayAppointments.length + pendingRequestCount})` : `Visits (${today?.visits.length ?? 0})`}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        {showAppointmentsTab && todayTab === 'appointments' ? (
          <>
            <TodayAppointments
              appointments={todayAppointments}
              slotMinutes={clinic.slotDurationMinutes || 30}
              nextUpId={nextUpId}
              colorFor={appointmentColor}
              therapistNameFor={appointmentTherapistName}
              showTherapist={canManageBookings}
              onSelect={(a) => setOpenAppointmentId(a.id)}
              requests={pendingRequests}
              therapistNameForId={(id) => (id ? therapistRoster.get(id)?.name ?? null : null)}
              onConfirmRequest={setConfirmingRequest}
              onDeclineRequest={setDecliningRequest}
              onSeeAllRequests={() => void navigate({ to: '/schedule', search: { tab: 'bookings', view: 'requests' } })}
              flagContext={flagContext}
            />
            <Link to="/schedule" className="mt-3 inline-block text-sm font-medium text-[var(--teal)] hover:underline">
              Open schedule →
            </Link>
          </>
        ) : !today || today.visits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No visits logged today — log one with &ldquo;+ New visit&rdquo;.
          </p>
        ) : (
          <ResponsiveVisitList
            rows={today.visits.map((row) =>
              todayRowToCardData(
                row,
                openPackageGroupIds,
                scope.isAdmin,
                scope.isFrontDesk,
                scope.myTherapistId,
                canViewClinicalNotes,
                therapistSplit,
                treatmentName,
                invoicedSiblingGroupIds ?? new Set(),
                consultationNotes,
                clinic.enablePatientComms ?? false,
                feedbackRequestByVisitId,
                responseByRequestId,
                googleReviewEligibleIds,
                clinic.googleReviewUrl ?? null
              )
            )}
            showDate={false}
            showPatient={true}
            onInvoice={(row) => openInvoiceFor(row)}
            onTakePayment={(row) => setTakingPayment(row)}
            onEditPatient={(row) => setEditPatientId(row.patientId)}
            onEdit={(row) => {
              setVisitEditError(null);
              setEditingVisitId(row.visitId);
            }}
            onSplit={
              therapistSplit
                ? (row) => {
                    void repos.visits.get(row.visitId).then((v) => {
                      if (v) setSplitting(v);
                    });
                  }
                : undefined
            }
            onDelete={(row) => {
              if (confirm('Delete this visit?')) void repos.visits.softDelete(row.visitId);
            }}
            onAskForFeedback={(row) => {
              void feedbackService
                .askForFeedback(row.visitId, row.patientName, row.patientPhone ?? null, clinic.name)
                .catch((e) => alert(toFriendlyMessage(e)));
            }}
            onResendFeedback={(row) => {
              const request = feedbackRequestByVisitId.get(row.visitId);
              if (!request?.token) return;
              void feedbackService
                .resend(request, row.patientName, row.patientPhone ?? null, clinic.name)
                .catch((e) => alert(toFriendlyMessage(e)));
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
                .catch((e) => alert(toFriendlyMessage(e)));
            }}
            canInvoice={canBill}
            backTo="/workspace"
          />
        )}
      </SectionCard>

      {!scope.isClinicWideView && <TherapistComparisonCard />}

      <SectionCard title="Packages">
        <p className="mb-3 text-xs text-[var(--muted)]">
          Every patient on a package — who&rsquo;s still owed sessions, and whose package has gone
          quiet.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            {(
              [
                { key: 'open', label: 'Open' },
                { key: 'attention', label: `Needs attention${attentionCount ? ` (${attentionCount})` : ''}` },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPkgStatusFilter(opt.key)}
                className="rounded-full border px-3 py-1 text-xs font-medium"
                style={{
                  background: pkgStatusFilter === opt.key ? 'var(--teal-light)' : 'var(--surface)',
                  borderColor: pkgStatusFilter === opt.key ? 'transparent' : 'var(--border)',
                  color: pkgStatusFilter === opt.key ? 'var(--teal)' : 'var(--muted)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {scope.myTherapistId && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={pkgMineOnly}
                onChange={(e) => setPkgMineOnly(e.target.checked)}
              />
              Mine only
            </label>
          )}
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
              {filteredPackages.map((p) => (
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
                      {p.stale && clinic.enablePatientComms && (
                        <button
                          type="button"
                          className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                          onClick={() => {
                            void feedbackService
                              .sendStalePackageReminder(
                                clinic.id,
                                p.patientName,
                                p.phone,
                                clinic.name,
                                p.serviceName
                              )
                              .catch((e) => alert(toFriendlyMessage(e)));
                          }}
                        >
                          Send reminder
                        </button>
                      )}
                      <Link
                        to="/visits/new"
                        search={{ repeatVisitId: p.lastVisitId }}
                        className="rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
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
                  {filteredPackages.map((p) => (
                    <tr key={p.packageGroupId}>
                      <td className={td}>
                        <span className="font-display font-medium">{p.patientName}</span>{' '}
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
                          {p.stale && clinic.enablePatientComms && (
                            <button
                              type="button"
                              className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
                              onClick={() => {
                                void feedbackService
                                  .sendStalePackageReminder(
                                    clinic.id,
                                    p.patientName,
                                    p.phone,
                                    clinic.name,
                                    p.serviceName
                                  )
                                  .catch((e) => alert(toFriendlyMessage(e)));
                              }}
                            >
                              Send reminder
                            </button>
                          )}
                          <Link
                            to="/visits/new"
                            search={{ repeatVisitId: p.lastVisitId }}
                            className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
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
          </>
        )}
      </SectionCard>

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
        <SplitModal
          visit={splitting}
          therapists={(therapists ?? []).filter((t) => t.id !== splitting.therapistId)}
          primaryName={therapistNameById.get(splitting.therapistId) ?? '-'}
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
