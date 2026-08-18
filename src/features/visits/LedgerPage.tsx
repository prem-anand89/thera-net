import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, visitService } from '@/services';
import { db } from '@/lib/db';
import { syncStatus } from '@/sync/status';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { visitsToCsv, type VisitsCsvRow } from '@/domain/visitsCsv';
import { computeVisitPaymentState, isCollected } from '@/domain/paymentState';
import {
  clinicBillingConfig,
  clinicShareLabels,
  type Patient,
  type PaymentStatus,
  type Therapist,
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
  ErrorNote,
  Field,
  SectionCard,
  StatTile,
} from '@/components/ui';
import { PatientOverview } from './PatientOverview';
import { EditVisitModal } from './EditVisitModal';
import { toFriendlyMessage } from '@/lib/errors';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
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
const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

function visitToCardData(
  v: Visit,
  patientById: Map<UUID, Patient>,
  therapistName: Map<UUID, string>,
  therapistNameByUserId: Map<string, string>,
  serviceName: Map<UUID, string>,
  syncErrorByVisitId: Map<UUID, string>,
  openPackageGroupIds: Set<UUID>,
  therapistSplit: boolean,
  statusByInvoiceId: Map<UUID, PaymentStatus>,
  directPaymentByVisitId: Map<UUID, number>,
  isAdmin: boolean,
  myTherapistId: UUID | undefined,
  canViewClinicalNotes: boolean
): VisitCardData {
  const p = patientById.get(v.patientId);
  const editedBy = v.createdBy && v.updatedBy && v.createdBy !== v.updatedBy
    ? therapistNameByUserId.get(v.updatedBy) ?? 'another user'
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

  return {
    visitId: v.id,
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
    billPaise: v.actualBillPaise,
    paymentState,
    invoiceId: v.invoiceId ?? null,
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
    canDelete: !v.invoiceId && canModify,
    needsNote: v.clinicalStatus === 'pending',
    canViewNotes: canViewClinicalNotes,
    consultationNoteId: v.consultationNoteId ?? null,
  };
}

type InvoicingTarget = IssueInvoiceTarget;

export function LedgerPage() {
  const clinic = useClinic();
  const { canBill, isAdmin, canViewClinicalNotes, canViewPayouts } = usePermissions();
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
  useEffect(() => {
    if (recordsView === 'invoices' && !canBill) setRecordsView('visits');
  }, [recordsView, canBill, setRecordsView]);
  const [from, setFrom] = useState(() => toIsoDate(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(() => toIsoDate(new Date()));
  const [datePreset, setDatePreset] = useState<DatePreset>('week');
  const [therapistId, setTherapistId] = useState('');
  const [onlyCollectedNoReceipt, setOnlyCollectedNoReceipt] = useState(false);
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
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      setFrom(toIsoDate(start));
      setTo(toIsoDate(now));
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
    () => new Map((therapists ?? []).filter((t) => t.userId).map((t) => [t.userId as string, t.name])),
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

  const filteredPatient = search.patientId ? patientById.get(search.patientId) : undefined;
  const editPatient = useLiveQuery(() => (editPatientId ? repos.patients.get(editPatientId) : undefined), [editPatientId]);

  const patientMatches = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return [];
    return (patients ?? [])
      .filter((p) => !p.deletedAt && (p.mrno.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q)))
      .slice(0, PATIENT_SEARCH_LIMIT);
  }, [patients, patientQuery]);

  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const followUps = useMemo(() => (openPackages ?? []).filter((p) => p.stale), [openPackages]);
  const openPackageGroupIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
  );
  const outstanding = useLiveQuery(() => dashboardService.outstandingInvoices(clinic.id), [clinic.id]);

  const cardRows = useMemo(
    () =>
      (visits ?? []).map((v) =>
        visitToCardData(
          v,
          patientById,
          therapistName,
          therapistNameByUserId,
          serviceName,
          syncErrorByVisitId,
          openPackageGroupIds,
          therapistSplit,
          statusByInvoiceId,
          directPaymentByVisitId,
          isAdmin,
          myTherapistId,
          canViewClinicalNotes
        )
      ),
    [
      visits,
      patientById,
      therapistName,
      therapistNameByUserId,
      serviceName,
      syncErrorByVisitId,
      openPackageGroupIds,
      therapistSplit,
      statusByInvoiceId,
      directPaymentByVisitId,
      isAdmin,
      myTherapistId,
      canViewClinicalNotes,
    ]
  );

  const visibleRows = useMemo(
    () => (onlyCollectedNoReceipt ? cardRows.filter((r) => r.paymentState === 'collected_no_receipt') : cardRows),
    [cardRows, onlyCollectedNoReceipt]
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
          outstanding: acc.outstanding + (!isCollected(r.paymentState) && r.paymentState !== 'zero_session' ? r.billPaise : 0),
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
    const patientText = filteredPatient ? `${filteredPatient.name} (${filteredPatient.mrno})` : 'All';
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
  const unsyncedVisitCount = useLiveQuery(() => db.outbox.filter((e) => e.table === 'visits').count(), []) ?? 0;
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
            .filter((v) => v.key !== 'invoices' || canBill)
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
              <select className={inputCls} value={therapistId} onChange={(e) => setTherapistId(e.target.value)}>
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
                    <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
                  </Field>
                  <Field label="To">
                    <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
                  </Field>
                </div>
              )}
              <button className={btnSecondary} disabled={!visits?.length} onClick={downloadCsv}>
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
          <div className="overflow-x-auto">
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
                      <Link
                        to="/ledger"
                        search={{ patientId: p.patientId }}
                        className="font-medium text-[var(--teal)] hover:underline"
                      >
                        View
                      </Link>
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
          <div className="overflow-x-auto">
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
                    <td className={td}>{formatDateDMY(r.issuedAt)}</td>
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
                    patientLabel: row.patientName,
                    serviceLabel: row.serviceName,
                    isPackage: row.packageTotal != null,
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
                canInvoice={canBill}
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
        <IssueInvoiceDialog clinicId={clinic.id} target={invoicing} onClose={() => setInvoicing(null)} />
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
        <EditVisitModal
          visitId={editing}
          onClose={() => setEditing(null)}
          setError={setError}
        />
      )}
    </div>
  );
}

function SplitModal({
  visit,
  therapists,
  primaryName,
  onClose,
}: {
  visit: Visit;
  therapists: Therapist[];
  primaryName: string;
  onClose: () => void;
}) {
  const [sharedTherapistId, setSharedTherapistId] = useState(visit.sharedTherapistId ?? '');
  const [pct, setPct] = useState(visit.sharedPct != null ? String(visit.sharedPct) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pctNum = Number(pct);
  const preview =
    pctNum > 0 && pctNum <= 100 ? Math.round((visit.actualBillPaise * pctNum) / 100) : null;

  async function save(clear: boolean) {
    setError(null);
    setBusy(true);
    try {
      await visitService.setSplit(visit.id, {
        sharedTherapistId: clear ? null : sharedTherapistId || null,
        sharedPct: clear ? null : pctNum,
      });
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Share visit revenue</h2>
        <p className="text-sm text-[var(--muted)]">
          Credit part of this {formatINR(visit.actualBillPaise)} visit (billed under {primaryName}) to
          an assisting therapist. This is internal only - the billed amount, date, and therapist the
          hospital sees don't change.
        </p>
        <Field label="Assisting therapist">
          <select
            className={inputCls}
            value={sharedTherapistId}
            onChange={(e) => setSharedTherapistId(e.target.value)}
          >
            <option value="">Select...</option>
            {therapists.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Their share (%)">
          <input
            type="number"
            min={1}
            max={100}
            className={inputCls}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
        </Field>
        {preview != null && sharedTherapistId && (
          <p className="text-xs text-[var(--muted)]">
            {formatINR(preview)} moves to {therapists.find((t) => t.id === sharedTherapistId)?.name} in
            the Shared column; {formatINR(visit.actualBillPaise - preview)} stays with {primaryName}.
          </p>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-between gap-2">
          <div>
            {visit.sharedTherapistId && (
              <button className={btnSecondary} disabled={busy} onClick={() => void save(true)}>
                Remove split
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              className={btnPrimary}
              disabled={busy || !sharedTherapistId || !(pctNum > 0)}
              onClick={() => void save(false)}
            >
              {busy ? 'Saving...' : 'Save split'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

