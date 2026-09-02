import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, feedbackService } from '@/services';
import { db } from '@/lib/db';
import { syncStatus } from '@/sync/status';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { useGoogleReviewEligibleRequestIds } from '@/features/requests/requestsSignals';
import { formatINR } from '@/domain/money';
import { formatDateDMY, formatDateDM, currentWeekRange } from '@/domain/fiscalYear';
import { visitsToCsv, type VisitsCsvRow } from '@/domain/visitsCsv';
import { computeVisitPaymentState, isCollected } from '@/domain/paymentState';
import { noteForVisit } from '@/domain/noteLinks';
import {
  clinicBillingConfig,
  clinicShareLabels,
  type ConsultationNote,
  type FeedbackRequest,
  type FeedbackResponse,
  type Patient,
  type PaymentStatus,
  type UUID,
  type Visit,
} from '@/domain/types';
import {
  btnPrimary,
  btnSecondary,
  inputCls,
  th,
  thNum,
  td,
  tdNum,
  Field,
  SectionCard,
  StatTile,
  CountBadge,
} from '@/components/ui';
import { PatientOverview } from './PatientOverview';
import { EditVisitModal } from './EditVisitModal';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
import { SplitModal } from '@/components/SplitModal';
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';

const PATIENT_SEARCH_LIMIT = 6;

type RecordsView = 'visits' | 'invoices';

type DatePreset = 'week' | 'month' | 'lastMonth' | 'all' | 'custom';
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
];
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
            ? (responseByRequestId.get(feedbackRequest.id)?.rating ?? 0) >= 4
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

export function LedgerPage() {
  const clinic = useClinic();
  const { canBill, isAdmin, canViewClinicalNotes, canViewPayouts, entitlementsLoading } =
    usePermissions();
  const { myTherapistId } = useWorkspaceScope();
  const { hospitalSplit, therapistSplit } = clinicBillingConfig(clinic);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { patientId?: string; tab?: RecordsView };

  // URL is the source of truth (not local state) so the /invoices redirect,
  // and any bookmark/shared link with ?tab=, land on the right sub-tab
  // instead of always Visits. replace: true so tab switches don't pile up
  // browser-back history entries.
  const recordsView: RecordsView = search.tab ?? 'visits';
  const setRecordsView = useCallback(
    (next: RecordsView) => {
      void navigate({
        to: '/ledger',
        search: { patientId: search.patientId, tab: next === 'visits' ? undefined : next },
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
    if (recordsView === 'invoices' && !canBill) setRecordsView('visits');
  }, [recordsView, canBill, entitlementsLoading, setRecordsView]);
  const initialWeek = currentWeekRange();
  const [from, setFrom] = useState(initialWeek.from);
  const [to, setTo] = useState(initialWeek.to);
  const [datePreset, setDatePreset] = useState<DatePreset>('week');
  const [therapistId, setTherapistId] = useState('');
  const [onlyCollectedNoReceipt, setOnlyCollectedNoReceipt] = useState(false);
  const [onlyNotCollected, setOnlyNotCollected] = useState(false);
  const [onlyNotDocumented, setOnlyNotDocumented] = useState(false);
  const [patientQuery, setPatientQuery] = useState('');
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [takingPayment, setTakingPayment] = useState<VisitCardData | null>(null);
  const [splitting, setSplitting] = useState<Visit | null>(null);
  const [editing, setEditing] = useState<UUID | null>(null);
  const [editPatientId, setEditPatientId] = useState<UUID | null>(null);
  const [, setError] = useState<string | null>(null);

  function applyDatePreset(preset: DatePreset) {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'week') {
      const { from: weekFrom, to: weekTo } = currentWeekRange(now);
      setFrom(weekFrom);
      setTo(weekTo);
    } else if (preset === 'month') {
      setFrom(toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setTo(toIsoDate(now));
    } else if (preset === 'lastMonth') {
      setFrom(toIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setTo(toIsoDate(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else if (preset === 'all') {
      setFrom('');
      setTo('');
    } else if (preset === 'custom') {
      // Custom: just set the preset, don't auto-fill dates
    }
  }

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
  const followUps = useMemo(() => (openPackages ?? []).filter((p) => p.stale), [openPackages]);
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
        .filter(
          (r) =>
            !onlyNotCollected || r.paymentState === 'outstanding' || r.paymentState === 'uninvoiced'
        )
        .filter((r) => !onlyNotDocumented || r.needsNote),
    [cardRows, onlyCollectedNoReceipt, onlyNotCollected, onlyNotDocumented]
  );

  // Billed = every visit's bill amount, same as before. Collected/outstanding
  // now read the same paymentState the chips show, rather than being
  // (accidentally) impossible to tell apart from "has an invoiceId".
  const totals = useMemo(
    () =>
      visibleRows.reduce(
        (acc, r) => ({
          bill: acc.bill + r.billPaise,
          collected: acc.collected + (isCollected(r.paymentState) ? r.billPaise : 0),
          outstanding:
            acc.outstanding +
            (!isCollected(r.paymentState) && r.paymentState !== 'zero_session' ? r.billPaise : 0),
        }),
        { bill: 0, collected: 0, outstanding: 0 }
      ),
    [visibleRows]
  );

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
      bmSharePaise: v.bmSharePaise,
      postTaxPaise: v.postTaxPaise,
      invoiced: v.invoiceId != null,
    }));
    const csv = visitsToCsv(rows, {
      filterDescription,
      hospitalSplit,
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
  const syncCaption =
    unsyncedVisitCount > 0
      ? `Includes ${unsyncedVisitCount} unsynced visit${unsyncedVisitCount === 1 ? '' : 's'}.`
      : syncSnapshot.lastSyncAt
        ? `As of last sync ${new Date(syncSnapshot.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
        : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Ledger</h1>
          {filteredPatient && (
            <span className="rounded-full bg-[var(--teal-light)] px-3 py-1 text-xs text-[var(--teal)]">
              {filteredPatient.name} ({filteredPatient.mrno})
              <Link to="/ledger" className="ml-2 font-medium">
                ✕
              </Link>
            </span>
          )}
        </div>
        <Link to="/visits/new" className={btnPrimary}>
          + New visit
        </Link>
      </div>

      <div className="flex w-fit gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
        {(
          [
            { key: 'visits', label: 'Visits' },
            { key: 'invoices', label: 'Invoices' },
          ] as const
        )
          .filter((v) => v.key !== 'invoices' || canBill || entitlementsLoading)
          .map((v) => (
            <button
              key={v.key}
              type="button"
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                recordsView === v.key
                  ? 'bg-[var(--teal)] text-white'
                  : 'text-[var(--muted)] hover:bg-[var(--surface)]'
              }`}
              onClick={() => setRecordsView(v.key)}
            >
              {v.label}
              {v.key === 'invoices' && (
                <CountBadge count={needsReceipt?.length ?? 0} tone="amber" />
              )}
            </button>
          ))}
      </div>

      {recordsView === 'visits' && (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="relative">
              <Field label="Find patient">
                <input
                  className={inputCls}
                  placeholder="Name or Patient ID..."
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  onBlur={() => setTimeout(() => setPatientQuery(''), 150)}
                />
              </Field>
              {patientMatches.length > 0 && (
                <div className="absolute z-10 mt-1 w-64 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-sm">
                  {patientMatches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--paper)]"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setPatientQuery('');
                        void navigate({ to: '/ledger', search: { patientId: p.id } });
                      }}
                    >
                      <span className="font-display">{p.name}</span>{' '}
                      <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Field label="Therapist">
              <select
                className={inputCls}
                value={therapistId}
                onChange={(e) => setTherapistId(e.target.value)}
              >
                <option value="">All</option>
                {(therapists ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={onlyCollectedNoReceipt}
                onChange={(e) => setOnlyCollectedNoReceipt(e.target.checked)}
              />
              Collected, no invoice
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={onlyNotCollected}
                onChange={(e) => setOnlyNotCollected(e.target.checked)}
              />
              Not collected
            </label>
            {clinic.clinicalDocsEnabled && (
              <label className="flex items-center gap-1.5 pb-2 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={onlyNotDocumented}
                  onChange={(e) => setOnlyNotDocumented(e.target.checked)}
                />
                Not documented
              </label>
            )}
            <div className="ml-auto flex flex-wrap items-end gap-2">
              <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      datePreset === p.key
                        ? 'bg-[var(--teal)] text-white'
                        : 'text-[var(--muted)] hover:bg-[var(--surface)]'
                    }`}
                    onClick={() => applyDatePreset(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {datePreset === 'custom' && (
                <div className="flex flex-wrap gap-2">
                  <Field label="From">
                    <input
                      type="date"
                      className={inputCls}
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </Field>
                  <Field label="To">
                    <input
                      type="date"
                      className={inputCls}
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </Field>
                </div>
              )}
              <button
                type="button"
                className={btnSecondary}
                disabled={!visits?.length}
                onClick={downloadCsv}
              >
                Export CSV
              </button>
              {canViewPayouts && (
                <Link to="/insights" search={{ tab: 'monthly' }} className={btnSecondary}>
                  Generate report
                </Link>
              )}
            </div>
          </div>

          {syncCaption && <p className="text-xs text-[var(--slate)]">{syncCaption}</p>}

          {filteredPatient && <PatientOverview patient={filteredPatient} />}
        </>
      )}

      {recordsView === 'visits' && followUps.length > 0 && (
        <SectionCard title="Due for follow-up">
          <p className="mb-3 text-xs text-[var(--muted)]">
            Mid-package and not seen in over 14 days - your actionable retention list.
          </p>
          {/* Below tab: — boxed cards instead of forcing this 6-column
              table to scroll sideways on a phone. */}
          <div className="tab:hidden space-y-2">
            {followUps.map((p) => (
              <div
                key={p.packageGroupId}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display text-sm font-medium text-[var(--ink)]">
                      {p.patientName}{' '}
                      <span className="text-xs font-normal text-[var(--muted)]">{p.mrno}</span>
                    </div>
                    <div className="text-xs text-[var(--muted)]">{p.serviceName}</div>
                  </div>
                  <Link
                    to="/ledger"
                    search={{ patientId: p.patientId }}
                    className="shrink-0 text-xs font-medium text-[var(--teal)] hover:underline"
                  >
                    View
                  </Link>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                  <span className="font-num">
                    {p.sessionsLogged} of {p.packageTotal} sessions
                  </span>
                  <span>Last visit {formatDateDMY(p.lastVisitOn)}</span>
                  <span className="font-num">{p.daysSinceLastVisit} days since</span>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden tab:block overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead>
                <tr>
                  <th className={th}>Patient</th>
                  <th className={th}>Service</th>
                  <th className={thNum}>Progress</th>
                  <th className={th}>Last visit</th>
                  <th className={thNum}>Days since</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {followUps.map((p) => (
                  <tr key={p.packageGroupId} className="hover:bg-[var(--paper)]">
                    <td className={td}>
                      <span className="font-display">{p.patientName}</span>{' '}
                      <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                    </td>
                    <td className={td}>{p.serviceName}</td>
                    <td className={tdNum}>
                      {p.sessionsLogged} of {p.packageTotal}
                    </td>
                    <td className={td}>{formatDateDMY(p.lastVisitOn)}</td>
                    <td className={tdNum}>{p.daysSinceLastVisit}</td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        {clinic.enablePatientComms && (
                          <button
                            type="button"
                            className="whitespace-nowrap font-medium text-[var(--teal)] hover:underline"
                            onClick={() =>
                              void feedbackService.sendStalePackageReminder(
                                p.patientName,
                                clinic.name,
                                p.serviceName
                              )
                            }
                          >
                            Send reminder
                          </button>
                        )}
                        <Link
                          to="/ledger"
                          search={{ patientId: p.patientId }}
                          className="font-medium text-[var(--teal)] hover:underline"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {recordsView === 'visits' && outstanding && outstanding.rows.length > 0 && (
        <SectionCard title="Outstanding payments">
          <div className="mb-4 flex gap-4">
            <StatTile label="Total outstanding" value={formatINR(outstanding.totalPaise)} />
            <StatTile label="Invoices" value={outstanding.count} />
          </div>
          {/* Below tab: — boxed cards instead of forcing this 5-column
              table to scroll sideways on a phone. */}
          <div className="tab:hidden space-y-2">
            {outstanding.rows.map((r) => (
              <Link
                key={r.invoiceId}
                to="/invoices/$invoiceId/print"
                params={{ invoiceId: r.invoiceId }}
                search={{ from: '/ledger' }}
                className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display text-sm font-medium text-[var(--ink)]">
                      {r.patientName}{' '}
                      <span className="text-xs font-normal text-[var(--muted)]">{r.mrno}</span>
                    </div>
                    <div className="text-xs text-[var(--teal)]">{r.invoiceNo}</div>
                  </div>
                  <span className="font-num shrink-0 text-sm font-medium text-[var(--ink)]">
                    {formatINR(r.totalPaise)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                  <span>Issued {formatDateDM(r.issuedAt)}</span>
                  <span className="font-num">{r.daysOutstanding} days outstanding</span>
                </div>
              </Link>
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
                    <td className={tdNum}>{formatINR(r.totalPaise)}</td>
                    <td className={td}>{formatDateDM(r.issuedAt)}</td>
                    <td className={tdNum}>{r.daysOutstanding}</td>
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
                rows={visibleRows}
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
                onDelete={(row) => {
                  if (confirm('Delete this visit?')) void repos.visits.softDelete(row.visitId);
                }}
                onAskForFeedback={(row) => {
                  setError(null);
                  void feedbackService
                    .askForFeedback(clinic.id, row.visitId, row.patientId, row.therapistId!)
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
                onResendFeedback={(row) => {
                  const request = feedbackRequestByVisitId.get(row.visitId);
                  if (!request?.token) return;
                  setError(null);
                  void feedbackService
                    .resend(request, row.patientName, clinic.name)
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
                onAskForGoogleReview={(row) => {
                  if (!row.googleReviewUrl) return;
                  setError(null);
                  void feedbackService
                    .askForGoogleReview(row.patientName, clinic.name, row.googleReviewUrl)
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                }}
                canInvoice={canBill}
                backTo="/ledger"
              />
              <div className="sticky bottom-0 z-10 rounded-lg border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm font-semibold text-[var(--ink)] shadow-[0_-2px_6px_rgba(0,0,0,0.06)]">
                Totals: {visibleRows.length} visit{visibleRows.length === 1 ? '' : 's'} · Billed{' '}
                {formatINR(totals.bill)} · Collected {formatINR(totals.collected)} · Outstanding{' '}
                {formatINR(totals.outstanding)}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--muted)] shadow-sm">
              No visits match "Collected, no invoice" in this range.
            </div>
          )}
        </div>
      )}

      {recordsView === 'visits' && visits?.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--muted)] shadow-sm">
          No visits match - log one with "New visit".
        </div>
      )}

      {recordsView === 'invoices' && <InvoicesPage />}

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
