import { confirmAndDeleteVisit } from '@/features/visits/confirmDeleteVisit';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, feedbackService } from '@/services';
import type { OutstandingInvoiceRow } from '@/services/dashboardService';
import { toLocalDateStr } from '@/domain/schedule';
import { db } from '@/lib/db';
import { syncStatus } from '@/sync/status';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { useGoogleReviewEligibleRequestIds } from '@/features/schedule/scheduleSignals';
import { formatINR } from '@/domain/money';
import { formatDateDMY, formatDateDM, currentWeekRange } from '@/domain/fiscalYear';
import { visitsToCsv, type VisitsCsvRow } from '@/domain/visitsCsv';
import { computeVisitPaymentState, hasDue } from '@/domain/paymentState';
import { summariseTotals } from './ledgerTotals';
import { noteForVisit } from '@/domain/noteLinks';
import { syncFreshnessCaption } from '@/domain/syncCopy';
import {
  clinicBillingConfig,
  clinicShareLabels,
  type ConsultationNote,
  type FeedbackRequest,
  type FeedbackResponse,
  type Invoice,
  type Patient,
  type PaymentStatus,
  type UUID,
  type Visit,
} from '@/domain/types';
import {
  btnPrimary,
  pillPrimary,
  th,
  thNum,
  td,
  tdNum,
  SectionCard,
  StatTile,
  CountBadge,
  KebabMenu,
  menuItem,
  chipSelectChevron,
} from '@/components/ui';
import { Pager, usePagination } from '@/components/Pager';
import { EmptyState } from '@/components/EmptyState';
import { loadLedgerPrefs, presetRange, saveLedgerPrefs } from './ledgerPrefs';
import { PatientOverview } from './PatientOverview';
import { useDueLandingScope } from './useDueLandingScope';
import { EditVisitModal } from './EditVisitModal';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
import { SplitModal } from '@/components/SplitModal';
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { VoidInvoiceDialog } from '@/components/VoidInvoiceDialog';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { PatientsList } from '@/features/patients/PatientsPage';
import { DaybookPage } from './DaybookPage';
import { DatePresetBar, DATE_PRESETS, type DatePreset } from '@/components/DatePresetBar';

const PATIENT_SEARCH_LIMIT = 6;

export type RecordsView = 'visits' | 'patients' | 'invoices' | 'daybook';

export const LEDGER_TAB_ITEMS = [
  { key: 'visits', label: 'Visits' },
  { key: 'patients', label: 'Patients' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'daybook', label: 'Daybook' },
] as const;

export function filterLedgerTabs({
  canBill,
  entitlementsLoading,
}: {
  canBill: boolean;
  entitlementsLoading: boolean;
}) {
  return LEDGER_TAB_ITEMS.filter(
    (v) => (v.key !== 'invoices' && v.key !== 'daybook') || canBill || entitlementsLoading
  );
}


// Local Y/M/D components, not toISOString() — that converts to UTC first,
// which puts "today" a day behind for roughly the first ~5.5 hours of the
// local day for an India-based clinic (UTC+5:30).
const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function visitToCardData(
  v: Visit,
  patientById: Map<UUID, Patient>,
  therapistName: Map<UUID, string>,
  therapistNameByUserId: Map<string, string>,
  serviceName: Map<UUID, string>,
  treatmentName: Map<UUID, string>,
  syncErrorByVisitId: Map<UUID, string>,
  openPackageGroupIds: Set<UUID>,
  therapistSplit: boolean,
  statusByInvoiceId: Map<UUID, PaymentStatus>,
  directPaymentByVisitId: Map<UUID, number>,
  issuedAtByInvoiceId: Map<UUID, string>,
  isAdmin: boolean,
  myTherapistId: UUID | undefined,
  canViewClinicalNotes: boolean,
  invoicedSiblingGroupIds: Set<UUID>,
  consultationNotes: ConsultationNote[] | undefined,
  enablePatientComms: boolean,
  feedbackRequestByVisitId: Map<UUID, FeedbackRequest>,
  responseByRequestId: Map<UUID, FeedbackResponse>,
  googleReviewEligibleIds: Set<UUID>,
  googleReviewUrl: string | null
): VisitCardData {
  const p = patientById.get(v.patientId);
  const editedBy =
    v.createdBy && v.updatedBy && v.createdBy !== v.updatedBy
      ? (therapistNameByUserId.get(v.updatedBy) ?? 'another user')
      : null;
  const paymentState = computeVisitPaymentState(
    v.actualBillPaise,
    v.invoiceId ?? null,
    directPaymentByVisitId.get(v.id) ?? 0,
    v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
  );
  // Pre-flight mirror of visits_update/visits_delete's RLS check
  // (is_clinic_admin or is_own_therapist) — without this, a therapist saw
  // a clickable Delete/Split on every colleague's visit in this clinic-wide
  // list and only found out it was blocked after the server rejected it.
  const canModify = isAdmin || v.therapistId === myTherapistId;
  const needsNote = v.clinicalStatus === 'pending';
  const linkedNote = noteForVisit(consultationNotes ?? [], v.id, v.patientId, needsNote);
  const feedbackRequest = feedbackRequestByVisitId.get(v.id);

  return {
    visitId: v.id,
    therapistId: v.therapistId,
    visitDate: v.visitDate,
    patientId: v.patientId,
    patientName: p?.name ?? '-',
    patientPhone: p?.phone ?? null,
    mrno: p?.mrno ?? '-',
    age: p?.age ?? null,
    sex: p?.sex ?? null,
    condition: v.condition ?? null,
    serviceName: serviceName.get(v.serviceCatalogId) ?? '-',
    sessionIndex: v.sessionIndex ?? null,
    packageTotal: v.packageTotal ?? null,
    therapistName: therapistName.get(v.therapistId) ?? '-',
    treatmentNotes: v.treatmentNotes ?? null,
    treatmentNames: (v.treatmentIds ?? [])
      .map((id) => treatmentName.get(id))
      .filter((n): n is string => !!n),
    billPaise: v.actualBillPaise,
    paymentState,
    invoiceId: v.invoiceId ?? null,
    collectedPaise: directPaymentByVisitId.get(v.id) ?? 0,
    issuedAt: v.invoiceId ? (issuedAtByInvoiceId.get(v.invoiceId) ?? null) : null,
    editedBy,
    syncError: syncErrorByVisitId.get(v.id) ?? null,
    canRepeat: v.packageGroupId ? openPackageGroupIds.has(v.packageGroupId) : false,
    // Unlike canSplit/canDelete, not gated on !v.invoiceId -- an invoiced
    // visit's clinical fields (condition, treatmentNotes) stay editable,
    // only its billing is frozen (visitService.updateBilling enforces
    // that server-side too).
    canEdit: canModify,
    canSplit: therapistSplit && v.actualBillPaise > 0 && canModify,
    hasSplit: v.sharedTherapistId ? true : false,
    sharedPct: v.sharedPct ?? null,
    sharedTherapistName: v.sharedTherapistId
      ? (therapistName.get(v.sharedTherapistId) ?? null)
      : null,
    canDelete: !v.invoiceId && canModify,
    needsNote,
    canViewNotes: canViewClinicalNotes,
    consultationNoteId: linkedNote?.id ?? null,
    noteStatus: linkedNote?.status ?? null,
    canAskForFeedback: enablePatientComms && canModify,
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
      v.actualBillPaise === 0 &&
      !!v.sessionIndex &&
      !!v.packageTotal &&
      !v.invoiceId &&
      !!v.packageGroupId &&
      invoicedSiblingGroupIds.has(v.packageGroupId),
  };
}

type InvoicingTarget = IssueInvoiceTarget;

/** The Due figure in the totals strip: a two-way toggle for the Not-collected filter. */
function DueToggle({
  active,
  outstanding,
  unpaidCount,
  onToggle,
  long = false,
}: {
  active: boolean;
  outstanding: number;
  unpaidCount: number;
  onToggle: () => void;
  /** sm+: spell the count out ("2 unpaid visits") instead of "(2)". */
  long?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Due ${formatINR(outstanding)} across ${unpaidCount} unpaid visit${unpaidCount === 1 ? '' : 's'}`}
      title={active ? 'Showing unpaid visits only. Tap to show all.' : 'Show only unpaid visits'}
      className={`min-h-8 rounded-md px-2.5 py-1 font-num font-bold transition-colors ${
        active
          ? 'bg-[var(--rust)] text-white hover:bg-[var(--rust)]/90'
          : 'bg-[var(--rust-light)] text-[var(--rust)] hover:bg-[var(--rust-light)]/80'
      }`}
      onClick={onToggle}
    >
      {long
        ? `Due ${formatINR(outstanding)} · ${unpaidCount} unpaid visit${unpaidCount === 1 ? '' : 's'}`
        : `Due ${formatINR(outstanding)} (${unpaidCount})`}
    </button>
  );
}

export function LedgerPage() {
  const clinic = useClinic();
  const { canBill, isAdmin, canViewClinicalNotes, canViewPayouts, entitlementsLoading } =
    usePermissions();
  const { myTherapistId, isClinicWideView } = useWorkspaceScope();
  const { partnerSplit, therapistSplit } = clinicBillingConfig(clinic);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { patientId?: string; tab?: RecordsView; filter?: 'not_collected' };
  // Workspace's Dues tile lands here: unpaid visits, every date.
  const dueLanding = search.filter === 'not_collected';

  // URL is the source of truth (not local state) so the /invoices redirect,
  // and any bookmark/shared link with ?tab=, land on the right sub-tab
  // instead of always Visits. replace: true so tab switches don't pile up
  // browser-back history entries.
  const recordsView: RecordsView = search.tab ?? 'visits';
  const setRecordsView = useCallback(
    (next: RecordsView) => {
      void navigate({
        to: '/ledger',
        search: { patientId: next === 'visits' ? search.patientId : undefined, tab: next === 'visits' ? undefined : next },
        replace: true,
      });
    },
    [navigate, search.patientId]
  );
  // An admin flipping invoicingAccess mid-session (synced live from another
  // device) shouldn't leave someone stranded on a tab that just disappeared.
  // Wait for entitlementsLoading to clear first — canBill reads fail-closed
  // (false) on every fresh mount until the plan-tier fetch resolves, tier
  // notwithstanding, and this effect actively navigates away (not just
  // hiding UI), so acting on that transient false would kick a fully
  // entitled admin off the Invoices tab on every page load.
  useEffect(() => {
    if (entitlementsLoading) return;
    if ((recordsView === 'invoices' || recordsView === 'daybook') && !canBill) setRecordsView('visits');
  }, [recordsView, canBill, entitlementsLoading, setRecordsView]);
  // The last tab and Visits filters are remembered per clinic on this device. A Dues landing
  // (or a patient deep link) always wins and never overwrites what was remembered.
  const [prefs] = useState(() => (dueLanding ? {} : loadLedgerPrefs(clinic.id)));
  const initialPreset: DatePreset = dueLanding ? 'all' : (prefs.datePreset ?? 'week');
  const initialRange =
    initialPreset === 'custom'
      ? { from: prefs.from ?? '', to: prefs.to ?? '' }
      : (presetRange(initialPreset) ?? currentWeekRange());
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [datePreset, setDatePreset] = useState<DatePreset>(initialPreset);
  // A therapist landing from their own Dues sees just their visits.
  const [therapistId, setTherapistId] = useState(prefs.therapistId ?? '');
  // A therapist landing from their own Dues sees just their visits.
  useDueLandingScope({ dueLanding, isClinicWideView, myTherapistId, setTherapistId });
  const [onlyCollectedNoReceipt, setOnlyCollectedNoReceipt] = useState(prefs.onlyCollectedNoReceipt ?? false);
  const [onlyNotCollected, setOnlyNotCollected] = useState(dueLanding || (prefs.onlyNotCollected ?? false));
  const [onlyNotDocumented, setOnlyNotDocumented] = useState(prefs.onlyNotDocumented ?? false);
  // Phones fold therapist + the three "only" checkboxes behind a Filters
  // button (with a count of what's on); from sm: they're always shown.
  const [filtersOpen, setFiltersOpen] = useState(
    dueLanding || Boolean(prefs.therapistId || prefs.onlyCollectedNoReceipt || prefs.onlyNotCollected || prefs.onlyNotDocumented)
  );
  const [patientQuery, setPatientQuery] = useState('');
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [takingPayment, setTakingPayment] = useState<VisitCardData | null>(null);
  const [takingInvoicePayment, setTakingInvoicePayment] = useState<OutstandingInvoiceRow | null>(null);
  const [voidingInvoice, setVoidingInvoice] = useState<Invoice | null>(null);
  const [splitting, setSplitting] = useState<Visit | null>(null);
  const [editing, setEditing] = useState<UUID | null>(null);
  const [editPatientId, setEditPatientId] = useState<UUID | null>(null);
  const [, setError] = useState<string | null>(null);

  function applyDatePreset(preset: DatePreset) {
    setDatePreset(preset);
    // Custom just switches on the From/To inputs; every other preset means a range from today.
    const range = presetRange(preset);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    }
  }

  // Restore the last tab when arriving with no tab/patient/dues in the URL (the entitlement
  // guard above still bounces a tab the user can no longer see). Runs once.
  useEffect(() => {
    if (!search.tab && !search.patientId && !dueLanding && prefs.tab && prefs.tab !== 'visits') {
      setRecordsView(prefs.tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const visits = useLiveQuery(
    () =>
      repos.visits.list({
        clinicId: clinic.id,
        from: from || undefined,
        to: to || undefined,
        therapistId: therapistId || undefined,
        patientId: search.patientId,
      }),
    [clinic.id, from, to, therapistId, search.patientId]
  );

  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );
  const therapistNameByUserId = useMemo(
    () =>
      new Map((therapists ?? []).filter((t) => t.userId).map((t) => [t.userId as string, t.name])),
    [therapists]
  );
  const patientById = useMemo(() => new Map((patients ?? []).map((p) => [p.id, p])), [patients]);
  const visitById = useMemo(() => new Map((visits ?? []).map((v) => [v.id, v])), [visits]);
  const failedVisitSyncs = useLiveQuery(
    () => db.outbox.filter((e) => e.table === 'visits' && !!e.error).toArray(),
    []
  );
  const syncErrorByVisitId = useMemo(
    () => new Map((failedVisitSyncs ?? []).map((e) => [e.rowId, e.error ?? 'Unknown error'])),
    [failedVisitSyncs]
  );
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const serviceName = useMemo(() => new Map((catalog ?? []).map((c) => [c.id, c.name])), [catalog]);
  const treatments = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id, true), [clinic.id]);
  const treatmentName = useMemo(
    () => new Map((treatments ?? []).map((t) => [t.id, t.name])),
    [treatments]
  );

  // Draft notes never get written back onto the visit row itself (only a
  // completed note does — see consultationNoteService.saveAssessment), so
  // showing draft-vs-completed status per visit needs a real join against
  // the notes table, not just the visit's own (completed-only) field.
  // Skipped entirely for a viewer who can't see notes anyway.
  const consultationNotes = useLiveQuery(
    () => (canViewClinicalNotes ? repos.consultationNotes.listByClinic(clinic.id) : undefined),
    [clinic.id, canViewClinicalNotes]
  );

  // Patient Communications, Slice 1 — same bulk-fetch-and-map shape as
  // consultationNotes above, skipped entirely when the module is off.
  const feedbackRequests = useLiveQuery(
    () => (clinic.enablePatientComms ? repos.feedbackRequests.listByClinic(clinic.id) : undefined),
    [clinic.id, clinic.enablePatientComms]
  );
  const feedbackRequestByVisitId = useMemo(() => {
    const map = new Map<UUID, FeedbackRequest>();
    for (const r of feedbackRequests ?? []) {
      // A visit can have more than one row over time (an old expired/
      // responded one plus a fresh pending one after re-asking) — keep
      // whichever was updated most recently, same tie-break as the repo's
      // own getByVisitId.
      const existing = map.get(r.visitId);
      if (!existing || r.updatedAt > existing.updatedAt) map.set(r.visitId, r);
    }
    return map;
  }, [feedbackRequests]);

  // Slice 3 — the visit row's Google-review nudge needs the rating,
  // which lives in feedback_responses, not feedback_requests. Same
  // module-off skip as the request fetch above; RLS filters this to
  // nothing for a non-admin viewer regardless (see FeedbackResponseRepo's
  // own doc comment), so no extra role check needed here.
  const feedbackResponses = useLiveQuery(
    () => (clinic.enablePatientComms ? repos.feedbackResponses.listByClinic(clinic.id) : undefined),
    [clinic.id, clinic.enablePatientComms]
  );
  const responseByRequestId = useMemo(
    () => new Map((feedbackResponses ?? []).map((r) => [r.requestId, r])),
    [feedbackResponses]
  );
  // Front-desk-only fallback for the Google review nudge (see
  // WorkspacePage's own comment on this hook for why admin skips it).
  const googleReviewEligibleIds = useGoogleReviewEligibleRequestIds(
    clinic.id,
    !isAdmin && (clinic.enablePatientComms ?? false)
  );

  // Payment state needs both facts a bare `invoiceId` check misses: whether
  // the invoice itself was ever marked paid (statusByInvoiceId), and
  // whether money was collected directly with no invoice at all
  // (directPaymentByVisitId) — same two lookups dashboardService.todayWorklist
  // already builds for Workspace's "Seen today" list.
  const invoicePayments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);
  const statusByInvoiceId = useMemo(
    () => new Map((invoicePayments ?? []).map((p) => [p.invoiceId, p.status])),
    [invoicePayments]
  );
  const directPayments = useLiveQuery(() => repos.payments.list(clinic.id), [clinic.id]);
  const directPaymentByVisitId = useMemo(() => {
    const map = new Map<UUID, number>();
    for (const p of directPayments ?? []) {
      map.set(p.visitId, (map.get(p.visitId) ?? 0) + p.amountPaise);
    }
    return map;
  }, [directPayments]);
  // D2's Overdue anchor (max(visitDate, issuedAt)) needs an invoice's issue
  // date, which statusByInvoiceId (from invoice_payments) doesn't carry —
  // a separate map off the same invoices list this page's Invoices tab
  // already loads.
  const invoices = useLiveQuery(() => repos.invoices.list(clinic.id), [clinic.id]);
  const invoiceById = useMemo(
    () => new Map((invoices ?? []).map((inv) => [inv.id, inv])),
    [invoices]
  );
  const issuedAtByInvoiceId = useMemo(
    () => new Map((invoices ?? []).map((inv) => [inv.id, inv.issuedAt])),
    [invoices]
  );

  const filteredPatient = search.patientId ? patientById.get(search.patientId) : undefined;
  const editPatient = useLiveQuery(
    () => (editPatientId ? repos.patients.get(editPatientId) : undefined),
    [editPatientId]
  );

  const patientMatches = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return [];
    return (patients ?? [])
      .filter(
        (p) =>
          !p.deletedAt && (p.mrno.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q))
      )
      .slice(0, PATIENT_SEARCH_LIMIT);
  }, [patients, patientQuery]);

  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const openPackageGroupIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
  );
  const outstanding = useLiveQuery(
    () => dashboardService.outstandingInvoices(clinic.id),
    [clinic.id]
  );
  // 1.7's needs-receipt queue count — same underlying call InvoicesPage's
  // own section uses, so the tab badge and the section can never disagree.
  const needsReceipt = useLiveQuery(() => dashboardService.needsReceipt(clinic.id), [clinic.id]);

  // Candidate ₹0 package rows whose OWN invoiceId is null — for each
  // distinct packageGroupId among them, check the full group (not just
  // whatever's in the current date-filtered `visits`, which would miss
  // a sibling invoiced outside this window) for any invoiced sibling.
  // Same dedupe-and-fetch-per-group shape as packageAttributionDeltas.
  const candidatePendingGroupIds = useMemo(
    () => [
      ...new Set(
        (visits ?? [])
          .filter(
            (v) =>
              v.actualBillPaise === 0 &&
              v.sessionIndex &&
              v.packageTotal &&
              !v.invoiceId &&
              v.packageGroupId
          )
          .map((v) => v.packageGroupId!)
      ),
    ],
    [visits]
  );
  const invoicedSiblingGroupIds = useLiveQuery(async () => {
    const result = new Set<UUID>();
    await Promise.all(
      candidatePendingGroupIds.map(async (groupId) => {
        const group = await repos.visits.listByPackageGroup(groupId);
        if (group.some((v) => v.invoiceId)) result.add(groupId);
      })
    );
    return result;
  }, [candidatePendingGroupIds]);

  const cardRows = useMemo(
    () =>
      (visits ?? []).map((v) =>
        visitToCardData(
          v,
          patientById,
          therapistName,
          therapistNameByUserId,
          serviceName,
          treatmentName,
          syncErrorByVisitId,
          openPackageGroupIds,
          therapistSplit,
          statusByInvoiceId,
          directPaymentByVisitId,
          issuedAtByInvoiceId,
          isAdmin,
          myTherapistId,
          canViewClinicalNotes,
          invoicedSiblingGroupIds ?? new Set(),
          consultationNotes,
          clinic.enablePatientComms ?? false,
          feedbackRequestByVisitId,
          responseByRequestId,
          googleReviewEligibleIds,
          clinic.googleReviewUrl ?? null
        )
      ),
    [
      visits,
      patientById,
      therapistName,
      therapistNameByUserId,
      serviceName,
      treatmentName,
      syncErrorByVisitId,
      openPackageGroupIds,
      therapistSplit,
      statusByInvoiceId,
      directPaymentByVisitId,
      issuedAtByInvoiceId,
      isAdmin,
      myTherapistId,
      canViewClinicalNotes,
      invoicedSiblingGroupIds,
      consultationNotes,
      clinic.enablePatientComms,
      feedbackRequestByVisitId,
      responseByRequestId,
      googleReviewEligibleIds,
      clinic.googleReviewUrl,
    ]
  );

  const visibleRows = useMemo(
    () =>
      cardRows
        .filter((r) => !onlyCollectedNoReceipt || r.paymentState === 'collected_no_receipt')
        // Includes part-paid visits: they still owe the rest.
        .filter((r) => !onlyNotCollected || hasDue(r.paymentState))
        .filter((r) => !onlyNotDocumented || r.needsNote),
    [cardRows, onlyCollectedNoReceipt, onlyNotCollected, onlyNotDocumented]
  );

  useEffect(() => {
    if (dueLanding) return;
    saveLedgerPrefs(clinic.id, {
      tab: recordsView,
      datePreset,
      ...(datePreset === 'custom' ? { from, to } : {}),
      therapistId,
      onlyCollectedNoReceipt,
      onlyNotCollected,
      onlyNotDocumented,
    });
  }, [clinic.id, dueLanding, recordsView, datePreset, from, to, therapistId, onlyCollectedNoReceipt, onlyNotCollected, onlyNotDocumented]);

  // A remembered therapist who has since been removed would silently hide every visit.
  useEffect(() => {
    if (therapistId && therapists && !therapists.some((t) => t.id === therapistId)) setTherapistId('');
  }, [therapistId, therapists]);

  const filtersAreDefault =
    datePreset === 'week' && !therapistId && !onlyCollectedNoReceipt && !onlyNotCollected && !onlyNotDocumented;
  function resetFilters() {
    applyDatePreset('week');
    setTherapistId('');
    setOnlyCollectedNoReceipt(false);
    setOnlyNotCollected(false);
    setOnlyNotDocumented(false);
    setPatientQuery('');
  }

  // Next steps for an empty Visits list: widen the range first, then drop filters.
  const emptyActions = [
    ...(datePreset !== 'all' && datePreset !== 'lastMonth' ? [{ label: 'Show last month', onClick: () => applyDatePreset('lastMonth') }] : []),
    ...(datePreset !== 'all' ? [{ label: 'Show all time', onClick: () => applyDatePreset('all') }] : []),
    ...(therapistId || onlyCollectedNoReceipt || onlyNotCollected || onlyNotDocumented
      ? [{ label: 'Clear filters', onClick: () => { setTherapistId(''); setOnlyCollectedNoReceipt(false); setOnlyNotCollected(false); setOnlyNotDocumented(false); } }]
      : []),
  ];

  const visitsPager = usePagination(
    visibleRows,
    `${from}|${to}|${therapistId}|${filteredPatient?.id ?? ''}|${onlyCollectedNoReceipt}|${onlyNotCollected}|${onlyNotDocumented}`,
    'ledger-visits'
  );

  const totals = useMemo(() => summariseTotals(visibleRows), [visibleRows]);
  const toggleUnpaid = () => {
    if (onlyNotCollected) {
      setOnlyNotCollected(false);
    } else {
      setOnlyNotCollected(true);
      setFiltersOpen(true);
    }
  };

  // Describes the currently-applied filter so a downloaded CSV is never
  // ambiguous about what it's a snapshot of.
  const filterDescription = useMemo(() => {
    const dateLabel = DATE_PRESETS.find((p) => p.key === datePreset)?.label ?? 'Custom';
    const rangeText =
      from && to
        ? `${formatDateDMY(from)}–${formatDateDMY(to)}`
        : from
          ? `from ${formatDateDMY(from)}`
          : to
            ? `through ${formatDateDMY(to)}`
            : 'all dates';
    const therapistText = therapistId ? (therapistName.get(therapistId) ?? 'Unknown') : 'All';
    const patientText = filteredPatient
      ? `${filteredPatient.name} (${filteredPatient.mrno})`
      : 'All';
    return `Ledger export — ${dateLabel} (${rangeText}) · Therapist: ${therapistText} · Patient: ${patientText} · generated ${new Date().toLocaleString()}`;
  }, [datePreset, from, to, therapistId, therapistName, filteredPatient]);

  function downloadCsv() {
    const rows: VisitsCsvRow[] = (visits ?? []).map((v) => ({
      visitId: v.id,
      visitDate: v.visitDate,
      patientName: patientById.get(v.patientId)?.name ?? '—',
      mrno: patientById.get(v.patientId)?.mrno ?? '—',
      therapistName: therapistName.get(v.therapistId) ?? '—',
      serviceName: serviceName.get(v.serviceCatalogId) ?? '—',
      condition: v.condition,
      billPaise: v.actualBillPaise,
      clinicSharePaise: v.clinicSharePaise,
      postTaxPaise: v.postTaxPaise,
      invoiced: v.invoiceId != null,
    }));
    const csv = visitsToCsv(rows, {
      filterDescription,
      partnerSplit,
      showPostTax: partnerSplit && (clinic.taxPct ?? 0) > 0,
      ownShareLabel: clinicShareLabels(clinic).own,
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clinic.invoicePrefix}-ledger-${toIsoDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Sync-basis caption: unsynced local changes take priority over a
  // last-sync timestamp, since "as of 14:02" would understate what's
  // actually showing if newer edits are still queued.
  const syncSnapshot = useSyncExternalStore(syncStatus.subscribe, () => syncStatus.get());
  const unsyncedVisitCount =
    useLiveQuery(() => db.outbox.filter((e) => e.table === 'visits').count(), []) ?? 0;
  const syncCaption = syncFreshnessCaption(unsyncedVisitCount, 'visits', syncSnapshot.lastSyncAt);
  const activeFilterCount =
    Number(therapistId !== '') + Number(onlyCollectedNoReceipt) + Number(onlyNotCollected) + Number(onlyNotDocumented);
  const activeFilterNames = [
    therapistId ? (therapists?.find((t) => t.id === therapistId)?.name ?? 'Selected therapist') : null,
    onlyCollectedNoReceipt ? 'Collected, no invoice' : null,
    onlyNotCollected ? 'Not collected' : null,
    onlyNotDocumented ? 'Not documented' : null,
  ].filter(Boolean) as string[];

  // Compact toolbar controls (no field labels; aria-labels instead).
  const therapistSelect = (
    <select
      aria-label="Therapist"
      className="h-10 min-h-10 appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] bg-[length:12px] bg-[right_10px_center] bg-no-repeat py-2 pl-3 pr-8 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
      style={chipSelectChevron}
      value={therapistId}
      onChange={(e) => setTherapistId(e.target.value)}
    >
      <option value="">All therapists</option>
      {(therapists ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      {/* The nav tab already names the page, so the title is for screen
          readers only. Row 1: the Visits / Invoices / Daybook switch, a
          patient filter chip when one is set, and New visit (from sm:; the
          phone bar's + is New visit). */}
      <h1 className="sr-only">Ledger</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Ledger sections" className="hide-scrollbar flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
          {filterLedgerTabs({ canBill, entitlementsLoading }).map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={recordsView === v.key}
              className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-4 ${
                recordsView === v.key
                  ? 'bg-[var(--teal)] text-white shadow-sm'
                  : 'text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'
              }`}
              onClick={() => setRecordsView(v.key)}
            >
              {v.label}
              {v.key === 'invoices' && (
                <CountBadge
                  count={clinic.invoicePolicy === 'never_nag' ? 0 : (needsReceipt?.length ?? 0)}
                  tone="amber"
                />
              )}
            </button>
          ))}
        </div>
        {filteredPatient && recordsView === 'visits' && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--teal-light)] py-1 pl-3 pr-1.5 text-xs text-[var(--teal-strong)]">
            <span>
              Visits for <strong className="font-semibold">{filteredPatient.name}</strong> ({filteredPatient.mrno})
            </span>
            <Link
              to="/ledger"
              aria-label="Clear patient filter"
              title="Show all patients"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full font-medium hover:bg-white/70"
            >
              ✕
            </Link>
          </span>
        )}
        <Link to="/visits/new" search={{ from: '/ledger' }} className={`${btnPrimary} ml-auto hidden items-center sm:inline-flex`}>
          + New visit
        </Link>
      </div>

      {recordsView === 'visits' && (
        <>
          {/* Row 2, directly on the page: the date presets on the left, then
              search · therapist · Filters · ⋮ on the right. Phones: presets
              on their own scrolling row, then search, Filters and ⋮, with
              therapist inside Filters. */}
          <div className="flex flex-wrap items-center gap-2">
            <DatePresetBar value={datePreset} onChange={applyDatePreset} />
            {!filtersAreDefault && (
              <button type="button" className="text-xs font-medium text-[var(--teal)] hover:underline" onClick={resetFilters}>
                Reset filters
              </button>
            )}
            {datePreset === 'custom' && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <input
                  type="date"
                  aria-label="From date"
                  className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <span className="font-medium text-[var(--muted)]">–</span>
                <input
                  type="date"
                  aria-label="To date"
                  className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            )}
            <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--muted)]">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                    className="h-4 w-4"
                  >
                    <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M13.5 13.5L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <input
                  type="search"
                  aria-label="Find patient"
                  className="h-10 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-8 text-sm text-[var(--ink)] placeholder-[var(--muted)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20 [&::-webkit-search-cancel-button]:hidden"
                  placeholder="Search patient or ID"
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  onBlur={() => setTimeout(() => setPatientQuery(''), 150)}
                />
                {patientQuery && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setPatientQuery('');
                    }}
                  >
                    ✕
                  </button>
                )}
                {patientMatches.length > 0 && (
                  <div className="absolute left-0 sm:left-auto sm:right-0 z-10 mt-1 w-64 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-md">
                    {patientMatches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--paper)]"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setPatientQuery('');
                          void navigate({
                            to: '/patients/$patientId',
                            params: { patientId: p.id },
                            search: { from: '/ledger' },
                          });
                        }}
                      >
                        <span className="font-display">{p.name}</span>{' '}
                        <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="hidden sm:block">{therapistSelect}</div>
              <button
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((current) => !current)}
                className={`flex h-10 min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
                  activeFilterCount > 0
                    ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]'
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                >
                  <path
                    d="M2 3.5h12M4.5 8h7M7 12.5h2"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--teal)] px-1 text-[11px] font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
                <span className="text-xs opacity-60">{filtersOpen ? '▲' : '▼'}</span>
              </button>
              <div className="flex min-h-10 shrink-0 items-center">
                <KebabMenu ariaLabel="More ledger options">
                  {(close) => (
                    <>
                      <button type="button" className={menuItem} disabled={!visits?.length} onClick={() => { downloadCsv(); close(); }}>
                        Export CSV
                      </button>
                      {canViewPayouts && (
                        <Link to="/insights" search={{ tab: 'monthly' }} className={`${menuItem} block`} onClick={close}>
                          Generate report
                        </Link>
                      )}
                    </>
                  )}
                </KebabMenu>
              </div>
            </div>
          </div>

          {filtersOpen && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--ink)] shadow-sm">
              <div className="sm:hidden">{therapistSelect}</div>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[var(--paper)]">
                <input
                  type="checkbox"
                  className="rounded text-[var(--teal)] focus:ring-[var(--teal)]"
                  checked={onlyCollectedNoReceipt}
                  onChange={(e) => setOnlyCollectedNoReceipt(e.target.checked)}
                />
                <span>Collected, no invoice</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[var(--paper)]">
                <input
                  type="checkbox"
                  className="rounded text-[var(--teal)] focus:ring-[var(--teal)]"
                  checked={onlyNotCollected}
                  onChange={(e) => setOnlyNotCollected(e.target.checked)}
                />
                <span>Not collected</span>
              </label>
              {clinic.clinicalDocsEnabled && (
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[var(--paper)]">
                  <input
                    type="checkbox"
                    className="rounded text-[var(--teal)] focus:ring-[var(--teal)]"
                    checked={onlyNotDocumented}
                    onChange={(e) => setOnlyNotDocumented(e.target.checked)}
                  />
                  <span>Not documented</span>
                </label>
              )}
            </div>
          )}

          {/* The header's sync dot covers "all synced"; the caption only
              shows while visits are still waiting to sync. */}
          {syncCaption && unsyncedVisitCount > 0 && <p className="text-xs text-[var(--amber)]">{syncCaption}</p>}

          {filteredPatient && <PatientOverview patient={filteredPatient} />}
        </>
      )}

      {recordsView === 'visits' && outstanding && outstanding.rows.length > 0 && (
        <SectionCard title="Unpaid invoices">
          <div className="mb-4 flex gap-4">
            <StatTile label="Invoiced, unpaid" value={formatINR(outstanding.totalPaise)} />
            <StatTile label="Invoices" value={outstanding.count} />
          </div>
          {canBill && (
            <p className="mb-3 text-xs text-[var(--muted)]">
              Take payment on each row, or void an invoice whose visit was removed. All dates, not just this week.
            </p>
          )}
          {/* Below tab: — boxed cards instead of forcing this 5-column
              table to scroll sideways on a phone. */}
          <div className="tab:hidden space-y-2">
            {outstanding.rows.map((r) => (
              <div
                key={r.invoiceId}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
              >
                <Link
                  to="/invoices/$invoiceId/print"
                  params={{ invoiceId: r.invoiceId }}
                  search={{ from: '/ledger' }}
                  className="block"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display text-sm font-medium text-[var(--ink)]">
                        {r.patientName}{' '}
                        <span className="text-xs font-normal text-[var(--muted)]">{r.mrno}</span>
                      </div>
                      <div className="text-xs text-[var(--teal)]">{r.invoiceNo}</div>
                    </div>
                    <span className="font-num shrink-0 text-right text-sm font-medium text-[var(--ink)]">
                      {formatINR(r.remainingPaise)}
                      {r.paidPaise > 0 && (
                        <span className="block text-[11px] font-normal text-[var(--muted)]">of {formatINR(r.totalPaise)}</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                    <span>Issued {formatDateDM(r.issuedAt)}</span>
                    <span className="font-num">{r.daysOutstanding} days outstanding</span>
                  </div>
                </Link>
                {canBill && (
                  <div className="mt-2 border-t border-[var(--border)] pt-2">
                    <OutstandingInvoiceActions
                      row={r}
                      onTakePayment={setTakingInvoicePayment}
                      onVoid={(row) => setVoidingInvoice(invoiceById.get(row.invoiceId) ?? null)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="hidden tab:block overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead>
                <tr>
                  <th className={th}>Invoice №</th>
                  <th className={th}>Patient</th>
                  <th className={thNum}>Amount</th>
                  <th className={th}>Issued</th>
                  <th className={thNum}>Days outstanding</th>
                  {canBill && <th className={th}>Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {outstanding.rows.map((r) => (
                  <tr key={r.invoiceId} className="hover:bg-[var(--paper)]">
                    <td className={td}>
                      <Link
                        to="/invoices/$invoiceId/print"
                        params={{ invoiceId: r.invoiceId }}
                        search={{ from: '/ledger' }}
                        className="text-[var(--teal)] hover:underline"
                      >
                        {r.invoiceNo}
                      </Link>
                    </td>
                    <td className={td}>
                      <span className="font-display">{r.patientName}</span>{' '}
                      <span className="text-xs text-[var(--muted)]">{r.mrno}</span>
                    </td>
                    <td className={tdNum}>
                      {formatINR(r.remainingPaise)}
                      {r.paidPaise > 0 && (
                        <span className="block text-[11px] font-normal text-[var(--muted)]">of {formatINR(r.totalPaise)}</span>
                      )}
                    </td>
                    <td className={td}>{formatDateDM(r.issuedAt)}</td>
                    <td className={tdNum}>{r.daysOutstanding}</td>
                    {canBill && (
                      <td className={td}>
                        <OutstandingInvoiceActions
                          row={r}
                          onTakePayment={setTakingInvoicePayment}
                          onVoid={(row) => setVoidingInvoice(invoiceById.get(row.invoiceId) ?? null)}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {recordsView === 'visits' && visits && visits.length > 0 && (
        <div className="space-y-4">
          {visibleRows.length > 0 ? (
            <>
              <ResponsiveVisitList
                rows={visitsPager.visible}
                showDate={true}
                showPatient={true}
                groupByDate={true}
                onInvoice={(row) => {
                  setError(null);
                  setInvoicing({
                    visitId: row.visitId,
                    patientId: row.patientId,
                    patientLabel: row.patientName,
                    serviceLabel: row.serviceName,
                    isPackage: row.packageTotal != null,
                    alreadyCollected: row.paymentState === 'collected_no_receipt',
                  });
                }}
                onTakePayment={(row) => setTakingPayment(row)}
                onEditPatient={(row) => setEditPatientId(row.patientId)}
                onEdit={(row) => {
                  setError(null);
                  setEditing(row.visitId);
                }}
                onSplit={
                  therapistSplit
                    ? (row) => {
                      const v = visitById.get(row.visitId);
                      if (!v) return;
                      setError(null);
                      setSplitting(v);
                    }
                    : undefined
                }
                onDelete={(row) => void confirmAndDeleteVisit(row.visitId)}
                onAskForFeedback={(row) => {
                  setError(null);
                  void feedbackService
                    .askForFeedback(
                      row.visitId,
                      row.patientName,
                      row.patientPhone ?? null,
                      clinic.name
                    )
                    .catch((e) => {
                      console.error("Feedback error:", e);
                      setError(e instanceof Error ? e.message : String(e));
                    });
                }}
                onResendFeedback={(row) => {
                  const request = feedbackRequestByVisitId.get(row.visitId);
                  if (!request?.token) return;
                  setError(null);
                  void feedbackService
                    .resend(request, row.patientName, row.patientPhone ?? null, clinic.name)
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
                onAskForGoogleReview={(row) => {
                  if (!row.googleReviewUrl) return;
                  setError(null);
                  void feedbackService
                    .askForGoogleReview(
                      clinic.id,
                      row.patientName,
                      row.patientPhone ?? null,
                      clinic.name,
                      row.googleReviewUrl
                    )
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
                canInvoice={canBill}
                backTo="/ledger"
              />
              <Pager list={visitsPager} noun="visits" />
              {/* Totals for EVERY filtered visit (not just this page). On phones it sits above the
                  fixed bottom nav instead of underneath it. */}
              <div
                className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[9] rounded-xl border border-[var(--teal)]/25 border-t-2 border-t-[var(--teal)] bg-[var(--surface)] px-3 py-2 text-xs shadow-[0_-6px_18px_rgba(38,38,36,0.14),0_1px_3px_rgba(38,38,36,0.08)] ring-1 ring-[var(--teal)]/15 sm:bottom-0 sm:px-4 sm:py-2.5 sm:text-sm"
                role="group"
                aria-label="Totals for all filtered visits"
                title={filterDescription}
              >
                {/* Phone (<sm): compact single line, wraps gracefully up to 2 lines if needed */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                  <span>
                    <span className="font-medium text-[var(--ink)]">
                      {totals.visitCount} visit{totals.visitCount === 1 ? '' : 's'}
                    </span>
                    {visitsPager.pageCount > 1 && ' (all pages)'}
                  </span>
                  {totals.state === 'dues' && (
                    <>
                      <span className="text-[var(--muted)]">·</span>
                      <span>
                        Billed <strong className="font-num text-[var(--ink)]">{formatINR(totals.bill)}</strong>
                      </span>
                      <span className="text-[var(--muted)]">·</span>
                      <DueToggle
                        active={onlyNotCollected}
                        outstanding={totals.outstanding}
                        unpaidCount={totals.unpaidCount}
                        onToggle={toggleUnpaid}
                      />
                    </>
                  )}
                  {totals.state === 'clear' && (
                    <>
                      <span className="text-[var(--muted)]">·</span>
                      <span>
                        <strong className="font-num font-medium text-[var(--moss-strong)]">{formatINR(totals.collected)}</strong> collected
                      </span>
                      <span className="text-[var(--muted)]">·</span>
                      <span className="font-medium text-[var(--moss-strong)]">All clear ✓</span>
                    </>
                  )}
                  {totals.state === 'no_charge' && (
                    <>
                      <span className="text-[var(--muted)]">·</span>
                      <span className="text-[var(--muted)]">no charges</span>
                    </>
                  )}
                </div>

                {/* iPad / Desktop (sm+): single row, left visits count, right aligned figures */}
                <div className="hidden items-center justify-between gap-4 sm:flex">
                  <span>
                    <span className="font-medium text-[var(--ink)]">
                      {totals.visitCount} visit{totals.visitCount === 1 ? '' : 's'}
                    </span>
                    {visitsPager.pageCount > 1 && ' across all pages'}
                  </span>
                  <div className="flex items-center gap-x-3 text-right">
                    {totals.state === 'dues' && (
                      <>
                        <span>
                          Billed <strong className="font-num text-[var(--ink)]">{formatINR(totals.bill)}</strong>
                        </span>
                        <span className="text-[var(--muted)]">·</span>
                        <span>
                          Collected <strong className="font-num text-[var(--moss-strong)]">{formatINR(totals.collected)}</strong>
                        </span>
                        <span className="text-[var(--muted)]">·</span>
                        <DueToggle
                          active={onlyNotCollected}
                          outstanding={totals.outstanding}
                          unpaidCount={totals.unpaidCount}
                          onToggle={toggleUnpaid}
                          long
                        />
                      </>
                    )}
                    {totals.state === 'clear' && (
                      <>
                        <span>
                          <strong className="font-num text-[var(--moss-strong)]">{formatINR(totals.collected)}</strong> collected
                        </span>
                        <span className="text-[var(--muted)]">·</span>
                        <span className="font-medium text-[var(--moss-strong)]">All clear ✓</span>
                      </>
                    )}
                    {totals.state === 'no_charge' && (
                      <span className="text-[var(--muted)]">no charges</span>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title="No visits match these filters"
              hint={activeFilterNames.length > 0 ? `Active: ${activeFilterNames.join(', ')}.` : 'Try a wider date range.'}
              actions={emptyActions}
            />
          )}
        </div>
      )}

      {recordsView === 'visits' && visits?.length === 0 && (
        <EmptyState
          title={datePreset === 'all' ? 'No visits logged yet' : 'No visits in this date range'}
          hint={datePreset === 'all' ? 'Log the first one with New visit.' : 'Widen the range, or log a visit.'}
          actions={emptyActions}
        >
          <Link to="/visits/new" search={{ from: '/ledger' }} className={pillPrimary}>
            + New visit
          </Link>
        </EmptyState>
      )}

      {recordsView === 'patients' && <PatientsList />}
      {recordsView === 'invoices' && <InvoicesPage />}
      {recordsView === 'daybook' && <DaybookPage />}

      {invoicing && (
        <IssueInvoiceDialog
          clinicId={clinic.id}
          target={invoicing}
          onClose={() => setInvoicing(null)}
          returnTo="/ledger"
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

      {takingInvoicePayment?.visitId && (
        <TakePaymentDialog
          clinicId={clinic.id}
          visitId={takingInvoicePayment.visitId}
          invoiceId={takingInvoicePayment.invoiceId}
          amountPaise={takingInvoicePayment.totalPaise}
          visitDate={toLocalDateStr(new Date())}
          patientLabel={takingInvoicePayment.patientName}
          mrno={takingInvoicePayment.mrno}
          patientId={takingInvoicePayment.patientId ?? undefined}
          onClose={() => setTakingInvoicePayment(null)}
        />
      )}

      {voidingInvoice && (
        <VoidInvoiceDialog
          invoice={voidingInvoice}
          receivedPaise={0}
          onClose={() => setVoidingInvoice(null)}
        />
      )}

      {editPatientId && editPatient && (
        <EditPatientModal
          patient={editPatient}
          open={true}
          onClose={() => setEditPatientId(null)}
          onSave={() => setEditPatientId(null)}
        />
      )}

      {splitting && (
        <SplitModal
          visit={splitting}
          therapists={(therapists ?? []).filter((t) => t.id !== splitting.therapistId)}
          primaryName={therapistName.get(splitting.therapistId) ?? '-'}
          onClose={() => setSplitting(null)}
        />
      )}

      {editing && (
        <EditVisitModal visitId={editing} onClose={() => setEditing(null)} setError={setError} />
      )}
    </div>
  );
}

/** Row actions for an unpaid invoice. With a live visit the money can be collected here; without one nothing can be recorded against the invoice, so the way out is to void it. */
function OutstandingInvoiceActions({
  row,
  onTakePayment,
  onVoid,
}: {
  row: OutstandingInvoiceRow;
  onTakePayment: (row: OutstandingInvoiceRow) => void;
  onVoid: (row: OutstandingInvoiceRow) => void;
}) {
  if (row.visitId) {
    return (
      <button
        type="button"
        className="inline-flex min-h-8 items-center rounded-full bg-[var(--teal)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--teal-strong)]"
        onClick={() => onTakePayment(row)}
      >
        Take payment
      </button>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-[var(--muted)]">Its visit was removed, so no payment can be recorded.</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex min-h-8 items-center rounded-full border border-[var(--rust)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--rust)] transition-colors hover:bg-[var(--rust-light)]"
          onClick={() => onVoid(row)}
        >
          Void invoice
        </button>
        <Link
          to="/invoices/$invoiceId/print"
          params={{ invoiceId: row.invoiceId }}
          search={{ from: '/ledger' }}
          className="inline-flex min-h-8 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)]"
        >
          Review
        </Link>
      </div>
    </div>
  );
}
