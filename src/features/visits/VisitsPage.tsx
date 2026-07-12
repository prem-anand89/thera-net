import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, invoiceService, paymentService, visitService, patientService } from '@/services';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { fiscalYearOf, monthsOfFiscalYear, monthDateRange, monthName, formatDateDMY } from '@/domain/fiscalYear';
import {
  clinicBillingConfig,
  clinicShareLabels,
  referringSourceDetailLabel,
  REFERRING_SOURCE_LABELS,
  visibleVisitColumns,
  type Invoice,
  type Patient,
  type PaymentMode,
  type ReferringSource,
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
  Pill,
  PackageThread,
  SectionCard,
  StatTile,
} from '@/components/ui';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { PatientOverview } from './PatientOverview';
import { toFriendlyMessage } from '@/lib/errors';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];
const PATIENT_SEARCH_LIMIT = 6;

type ArchiveTab = 'records' | 'invoices';
type RecordsView = 'visits' | 'patients';

type PatientSortKey = 'name' | 'mrno' | 'age' | 'condition';
const PATIENT_COMPARATORS = {
  name: byString<Patient>((p) => p.name),
  mrno: byString<Patient>((p) => p.mrno),
  age: byNumber<Patient>((p) => p.age ?? -1),
  condition: byString<Patient>((p) => p.primaryCondition ?? ''),
};

type DatePreset = 'week' | 'month' | 'lastMonth' | 'all';
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All time' },
];
const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
const TREATMENT_TRUNCATE = 40;

/** What the invoice-issuance modal needs, independent of which tab opened it. */
interface InvoicingTarget {
  visitId: UUID;
  patientLabel: string;
  serviceLabel: string;
  isPackage: boolean;
}

export function VisitsPage() {
  const clinic = useClinic();
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit, therapistSplit } = clinicBillingConfig(clinic);
  const cols = visibleVisitColumns(clinic);
  // Fixed columns: Date, Patient, Therapist, Service (before Bill) + Bill,
  // Invoice, actions. Optional: Condition, Treatment, and the two
  // hospital-split columns. The Totals label spans everything before Bill.
  const labelSpan = 4 + (cols.condition ? 1 : 0) + (cols.treatment ? 1 : 0);
  const columnCount = labelSpan + 1 + (hospitalSplit ? 2 : 0) + 2;
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { patientId?: string };

  const [tab, setTab] = useState<ArchiveTab>('records');
  const [recordsView, setRecordsView] = useState<RecordsView>('visits');
  const [from, setFrom] = useState(() => toIsoDate(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(() => toIsoDate(new Date()));
  const [datePreset, setDatePreset] = useState<DatePreset>('week');
  const [therapistId, setTherapistId] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [splitting, setSplitting] = useState<Visit | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [paidNow, setPaidNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedTreatment, setExpandedTreatment] = useState<Set<string>>(new Set());

  function toggleTreatment(id: string) {
    setExpandedTreatment((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    }
  }

  function selectTab(next: ArchiveTab) {
    setTab(next);
    if (next === 'records' && recordsView === 'visits' && !from && !to) {
      applyDatePreset('week');
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
  const invoices = useLiveQuery(() => repos.invoices.list(clinic.id), [clinic.id]);
  const payments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);

  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );
  const therapistNameByUserId = useMemo(
    () => new Map((therapists ?? []).filter((t) => t.userId).map((t) => [t.userId as string, t.name])),
    [therapists]
  );
  const patientById = useMemo(() => new Map((patients ?? []).map((p) => [p.id, p])), [patients]);
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

  const filteredPatient = search.patientId ? patientById.get(search.patientId) : undefined;

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

  const weeklySummary = useLiveQuery(() => dashboardService.weeklySummary(clinic.id), [clinic.id]);
  const monthlyNew = useLiveQuery(() => dashboardService.monthlyNewCounts(clinic.id), [clinic.id]);

  const sort = useSort<'date' | 'patient' | 'therapist' | 'bill' | 'bmShare' | 'postTax'>('date', 'desc');
  const sortedVisits = applySort(
    visits ?? [],
    {
      date: byString<Visit>((v) => v.visitDate),
      patient: byString<Visit>((v) => patientById.get(v.patientId)?.name ?? ''),
      therapist: byString<Visit>((v) => therapistName.get(v.therapistId) ?? ''),
      bill: byNumber<Visit>((v) => v.actualBillPaise),
      bmShare: byNumber<Visit>((v) => v.bmSharePaise),
      postTax: byNumber<Visit>((v) => v.postTaxPaise),
    },
    sort
  );

  const invoiceSort = useSort<'no' | 'date' | 'patient' | 'total' | 'status'>('date', 'desc');
  const statusByInvoiceId = useMemo(
    () => new Map((payments ?? []).map((p) => [p.invoiceId, p.status])),
    [payments]
  );
  const sortedInvoices = applySort(
    invoices ?? [],
    {
      no: byNumber<Invoice>((inv) => inv.seq),
      date: byString<Invoice>((inv) => inv.issuedAt),
      patient: byString<Invoice>((inv) => inv.patientSnapshot.name),
      total: byNumber<Invoice>((inv) => inv.totalPaise),
      status: byString<Invoice>((inv) => statusByInvoiceId.get(inv.id) ?? 'paid'),
    },
    invoiceSort
  );

  const totals = useMemo(
    () =>
      (visits ?? []).reduce(
        (acc, v) => ({
          bill: acc.bill + v.actualBillPaise,
          bmShare: acc.bmShare + v.bmSharePaise,
          postTax: acc.postTax + v.postTaxPaise,
        }),
        { bill: 0, bmShare: 0, postTax: 0 }
      ),
    [visits]
  );

  async function issue() {
    if (!invoicing) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await invoiceService.issueForVisit(invoicing.visitId, paymentMode);
      try {
        await paymentService.setStatus(invoice.id, clinic.id, paidNow ? 'paid' : 'outstanding');
      } catch (statusError) {
        // Non-fatal: the invoice IS issued (retrying would fail with
        // "already invoiced"), and a missing status row reads as Paid —
        // correctable anytime from the Invoices page.
        console.error('Could not record payment status', statusError);
      }
      setInvoicing(null);
      void navigate({ to: '/invoices/$invoiceId/print', params: { invoiceId: invoice.id } });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleInvoiceStatus(invoiceId: string, current: 'paid' | 'outstanding') {
    await paymentService.setStatus(invoiceId, clinic.id, current === 'paid' ? 'outstanding' : 'paid');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Archive</h1>
          {filteredPatient && (
            <span className="rounded-full bg-[var(--teal-light)] px-3 py-1 text-xs text-[var(--teal)]">
              {filteredPatient.name} ({filteredPatient.mrno})
              <Link to="/archive" className="ml-2 font-medium">
                ✕
              </Link>
            </span>
          )}
        </div>
        <Link to="/visits/new" className={btnPrimary}>
          + New visit
        </Link>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
        {(
          [
            { key: 'records', label: 'Records' },
            { key: 'invoices', label: 'Invoices' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${
              tab === t.key
                ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
            onClick={() => selectTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'records' && (
        <div className="flex w-fit gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
          {(
            [
              { key: 'visits', label: 'Visits' },
              { key: 'patients', label: 'Patients' },
            ] as const
          ).map((v) => (
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
      )}

      {tab === 'records' && recordsView === 'visits' && (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="relative">
              <Field label="Find patient">
                <input
                  className={inputCls}
                  placeholder="Name or Patient ID…"
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
                        void navigate({ to: '/archive', search: { patientId: p.id } });
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
            <div className="ml-auto flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
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
          </div>

          {filteredPatient && <PatientOverview patient={filteredPatient} />}

          <div className="flex flex-wrap gap-3">
            <StatTile label="This week's visits" value={weeklySummary?.visitCount ?? 0} />
            <StatTile label="Collected this week" value={formatINR(weeklySummary?.collectedPaise ?? 0)} />
            <StatTile label="Packages this month" value={monthlyNew?.newPackages ?? 0} />
            <StatTile label="New patients this month" value={monthlyNew?.newPatients ?? 0} />
          </div>
        </>
      )}

      {tab === 'records' && recordsView === 'visits' && followUps.length > 0 && (
        <SectionCard title="Due for follow-up">
          <p className="mb-3 text-xs text-[var(--muted)]">
            Mid-package and not seen in over 14 days — your actionable retention list.
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
                        to="/archive"
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

      {tab === 'records' && recordsView === 'visits' && (
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <SortHeader label="Date" k="date" sort={sort} firstDir="desc" />
              <SortHeader label="Patient" k="patient" sort={sort} />
              <SortHeader label="Therapist" k="therapist" sort={sort} />
              <th className={th}>Service</th>
              {cols.condition && <th className={th}>Condition</th>}
              {cols.treatment && <th className={th}>Treatment</th>}
              <SortHeader label="Bill" k="bill" sort={sort} numeric firstDir="desc" />
              {hospitalSplit && (
                <SortHeader label={`${labels.own} Share`} k="bmShare" sort={sort} numeric firstDir="desc" />
              )}
              {hospitalSplit && (
                <SortHeader label="Post Tax" k="postTax" sort={sort} numeric firstDir="desc" />
              )}
              <th className={th}>Invoice</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sortedVisits.map((v) => {
              const p = patientById.get(v.patientId);
              return (
                <tr key={v.id} className="hover:bg-[var(--paper)]">
                  <td className={td}>
                    {formatDateDMY(v.visitDate)}
                    {v.createdBy && v.updatedBy && v.createdBy !== v.updatedBy && (
                      <span
                        className="ml-1 text-[var(--muted)]"
                        title={`Edited by ${therapistNameByUserId.get(v.updatedBy) ?? 'another user'}`}
                      >
                        ✎
                      </span>
                    )}
                    {syncErrorByVisitId.has(v.id) && (
                      <span
                        className="ml-1 text-[var(--rust)]"
                        title={`Sync issue: ${syncErrorByVisitId.get(v.id)}`}
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    <div className="font-display">{p?.name ?? '—'}</div>
                    <div className="text-xs text-[var(--muted)]">{p?.mrno}</div>
                  </td>
                  <td className={td}>
                    {therapistName.get(v.therapistId) ?? '—'}
                    {therapistSplit && v.sharedTherapistId && (
                      <div className="text-xs font-medium text-[var(--moss-strong)]" title="Internal revenue split">
                        ⇄ {therapistName.get(v.sharedTherapistId) ?? '—'} {v.sharedPct}%
                      </div>
                    )}
                  </td>
                  <td className={td}>
                    {serviceName.get(v.serviceCatalogId) ?? '—'}
                    {v.sessionIndex && v.packageTotal && (
                      <span className="ml-1.5">
                        <PackageThread sessionIndex={v.sessionIndex} packageTotal={v.packageTotal} />
                      </span>
                    )}
                  </td>
                  {cols.condition && <td className={td}>{v.condition ?? '—'}</td>}
                  {cols.treatment && (
                    <td className={`${td} max-w-56`}>
                      {v.treatmentNotes ? (
                        v.treatmentNotes.length > TREATMENT_TRUNCATE ? (
                          <button
                            type="button"
                            className="text-left hover:text-[var(--teal)]"
                            onClick={() => toggleTreatment(v.id)}
                          >
                            {expandedTreatment.has(v.id)
                              ? v.treatmentNotes
                              : `${v.treatmentNotes.slice(0, TREATMENT_TRUNCATE)}…`}
                          </button>
                        ) : (
                          v.treatmentNotes
                        )
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                  )}
                  <td className={tdNum}>{formatINR(v.actualBillPaise)}</td>
                  {hospitalSplit && <td className={tdNum}>{formatINR(v.bmSharePaise)}</td>}
                  {hospitalSplit && <td className={tdNum}>{formatINR(v.postTaxPaise)}</td>}
                  <td className={td}>
                    {v.invoiceId ? (
                      <Link
                        to="/invoices/$invoiceId/print"
                        params={{ invoiceId: v.invoiceId }}
                        className="font-medium text-[var(--teal)] hover:underline"
                      >
                        View
                      </Link>
                    ) : v.actualBillPaise > 0 ? (
                      <button
                        className="font-medium text-[var(--teal)] hover:underline"
                        onClick={() => {
                          setError(null);
                          setPaidNow(true);
                          setInvoicing({
                            visitId: v.id,
                            patientLabel: p?.name ?? '—',
                            serviceLabel: serviceName.get(v.serviceCatalogId) ?? '—',
                            isPackage: Boolean(v.packageGroupId),
                          });
                        }}
                      >
                        Invoice…
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">₹0 session</span>
                    )}
                  </td>
                  <td className={td}>
                    <div className="flex gap-3">
                      {v.packageGroupId && openPackageGroupIds.has(v.packageGroupId) && (
                        <Link
                          to="/visits/new"
                          search={{ repeatVisitId: v.id }}
                          className="text-xs text-[var(--muted)] hover:text-[var(--teal)]"
                          title="Start the next session with this visit's therapist, service, and condition pre-filled"
                        >
                          Repeat
                        </Link>
                      )}
                      {therapistSplit && v.actualBillPaise > 0 && (
                        <button
                          className="text-xs text-[var(--muted)] hover:text-[var(--moss)]"
                          title="Share this visit's revenue with another therapist"
                          onClick={() => {
                            setError(null);
                            setSplitting(v);
                          }}
                        >
                          {v.sharedTherapistId ? 'Edit split' : 'Split'}
                        </button>
                      )}
                      {!v.invoiceId && (
                        <button
                          className="text-xs text-[var(--muted)] hover:text-[var(--rust)]"
                          title="Delete visit"
                          onClick={() => {
                            if (confirm('Delete this visit?')) void repos.visits.softDelete(v.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visits?.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                  No visits match — log one with “New visit”.
                </td>
              </tr>
            )}
          </tbody>
          {visits && visits.length > 0 && (
            <tfoot className="border-t-2 border-[var(--border)] bg-[var(--paper)]">
              <tr>
                <td colSpan={labelSpan} className="px-3 py-2 text-sm font-semibold text-[var(--ink)]">
                  Totals ({visits.length} visit{visits.length === 1 ? '' : 's'})
                </td>
                <td className={tdNum}>{formatINR(totals.bill)}</td>
                {hospitalSplit && <td className={tdNum}>{formatINR(totals.bmShare)}</td>}
                {hospitalSplit && <td className={tdNum}>{formatINR(totals.postTax)}</td>}
                <td className={td}></td>
                <td className={td}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}

      {tab === 'records' && recordsView === 'patients' && <AllPatientsSection />}

      {tab === 'invoices' && (
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--paper)]">
              <tr>
                <SortHeader label="Invoice No" k="no" sort={invoiceSort} firstDir="desc" />
                <SortHeader label="Date" k="date" sort={invoiceSort} firstDir="desc" />
                <SortHeader label="Patient" k="patient" sort={invoiceSort} />
                <th className={th}>Patient ID</th>
                <SortHeader label="Total" k="total" sort={invoiceSort} numeric firstDir="desc" />
                <th className={th}>Mode</th>
                <SortHeader label="Status" k="status" sort={invoiceSort} />
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sortedInvoices.map((inv) => {
                const status = statusByInvoiceId.get(inv.id) ?? 'paid';
                return (
                  <tr key={inv.id} className="hover:bg-[var(--paper)]">
                    <td className={`${td} font-medium`}>{inv.invoiceNo}</td>
                    <td className={td}>{formatDateDMY(inv.issuedAt)}</td>
                    <td className={`${td} font-display`}>{inv.patientSnapshot.name}</td>
                    <td className={td}>{inv.patientSnapshot.mrno}</td>
                    <td className={tdNum}>{formatINR(inv.totalPaise)}</td>
                    <td className={td}>{inv.paymentMode}</td>
                    <td className={td}>
                      <Pill tone={status === 'paid' ? 'green' : 'amber'}>
                        {status === 'paid' ? 'Paid' : 'Outstanding'}
                      </Pill>
                      <button
                        className="ml-2 text-xs text-[var(--teal)] hover:underline"
                        onClick={() => void toggleInvoiceStatus(inv.id, status)}
                      >
                        Mark {status === 'paid' ? 'outstanding' : 'paid'}
                      </button>
                    </td>
                    <td className={td}>
                      <Link
                        to="/invoices/$invoiceId/print"
                        params={{ invoiceId: inv.id }}
                        className="font-medium text-[var(--teal)] hover:underline"
                      >
                        Print
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {invoices?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                    No invoices issued yet — issue one from the Visits table.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--muted)]">
          Issued invoices are immutable; numbering is sequential per fiscal year and gap-free.
          Payment status is tracked separately and doesn't affect the invoice itself.
        </p>
      </div>
      )}

      {invoicing && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Issue invoice</h2>
            <p className="text-sm text-[var(--muted)]">
              {invoicing.patientLabel} — {invoicing.serviceLabel}
              {invoicing.isPackage && ', all sessions of this package'}
            </p>
            <Field label="Payment mode">
              <select
                className={inputCls}
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={paidNow} onChange={() => setPaidNow(true)} />
                Paid now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={!paidNow} onChange={() => setPaidNow(false)} />
                Outstanding — pay later
              </label>
            </div>
            <ErrorNote message={error} />
            <p className="text-xs text-[var(--muted)]">
              The invoice number is issued by the server and the bill becomes immutable — this
              needs a connection and cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setInvoicing(null)}>
                Cancel
              </button>
              <button className={btnPrimary} disabled={busy} onClick={() => void issue()}>
                {busy ? 'Issuing…' : 'Issue invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {splitting && (
        <SplitModal
          visit={splitting}
          therapists={(therapists ?? []).filter((t) => t.id !== splitting.therapistId)}
          primaryName={therapistName.get(splitting.therapistId) ?? '—'}
          onClose={() => setSplitting(null)}
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
          an assisting therapist. This is internal only — the billed amount, date, and therapist the
          hospital sees don’t change.
        </p>
        <Field label="Assisting therapist">
          <select
            className={inputCls}
            value={sharedTherapistId}
            onChange={(e) => setSharedTherapistId(e.target.value)}
          >
            <option value="">Select…</option>
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
              {busy ? 'Saving…' : 'Save split'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AllPatientsSection() {
  const clinic = useClinic();
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const sort = useSort<PatientSortKey>('name');

  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const [fyStartYear, setFyStartYear] = useState(currentFy.startYear);
  const [month, setMonth] = useState(''); // '' = all time

  const months = useMemo(
    () => monthsOfFiscalYear(fyStartYear, clinic.fyStartMonth),
    [fyStartYear, clinic.fyStartMonth]
  );
  const selectedPeriod = useMemo(() => {
    if (!month) return null;
    const [y, m] = month.split('-').map(Number);
    return { year: y, month: m };
  }, [month]);

  const periodVisits = useLiveQuery(() => {
    if (!selectedPeriod) return Promise.resolve(null);
    const { from, to } = monthDateRange(selectedPeriod);
    return repos.visits.list({ clinicId: clinic.id, from, to });
  }, [clinic.id, selectedPeriod?.year, selectedPeriod?.month]);
  const periodPatientIds = useMemo(
    () => (periodVisits ? new Set(periodVisits.map((v) => v.patientId)) : null),
    [periodVisits]
  );

  const all = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const allVisits = useLiveQuery(() => repos.visits.list({ clinicId: clinic.id }), [clinic.id]);
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const outstanding = useLiveQuery(() => dashboardService.outstandingInvoices(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);

  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );

  const visitStatsByPatient = useMemo(() => {
    const map = new Map<string, { lastVisitOn: string; visitCount: number; latestVisit: Visit }>();
    for (const v of allVisits ?? []) {
      if (v.deleted) continue;
      const cur = map.get(v.patientId);
      if (!cur) {
        map.set(v.patientId, { lastVisitOn: v.visitDate, visitCount: 1, latestVisit: v });
      } else {
        cur.visitCount += 1;
        if (v.visitDate > cur.lastVisitOn) {
          cur.lastVisitOn = v.visitDate;
          cur.latestVisit = v;
        }
      }
    }
    return map;
  }, [allVisits]);

  const openPackageByPatient = useMemo(() => {
    const map = new Map<string, { sessionsLogged: number; packageTotal: number }>();
    for (const p of openPackages ?? []) {
      if (!map.has(p.patientId)) map.set(p.patientId, { sessionsLogged: p.sessionsLogged, packageTotal: p.packageTotal });
    }
    return map;
  }, [openPackages]);

  const outstandingMrnos = useMemo(
    () => new Set((outstanding?.rows ?? []).map((r) => r.mrno)),
    [outstanding]
  );

  const q = query.trim().toLowerCase();
  const active = (all ?? []).filter(
    (p) =>
      !p.deletedAt &&
      (!q || p.mrno.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q)) &&
      (periodPatientIds === null || periodPatientIds.has(p.id))
  );
  const hidden = (all ?? []).filter((p) => p.deletedAt);
  const rows = applySort(active, PATIENT_COMPARATORS, sort);

  async function hide(p: Patient) {
    if (
      !confirm(
        `Hide ${p.name} (${p.mrno})?\n\nThey disappear from search and pickers; their visits stay in the records. You can restore them anytime from "Hidden patients" below.`
      )
    )
      return;
    setError(null);
    try {
      await patientService.hide(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function restore(p: Patient) {
    setError(null);
    try {
      await patientService.restore(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function hardDelete(p: Patient) {
    setError(null);
    try {
      const visits = await repos.visits.list({ clinicId: clinic.id, patientId: p.id });
      if (visits.length > 0) {
        alert(
          `${p.name} has ${visits.length} visit(s) on record, so they can't be permanently deleted — keep them hidden instead.`
        );
        return;
      }
      const typed = prompt(
        `Permanently delete ${p.name} (${p.mrno})? This cannot be undone.\n\nType the patient's name to confirm:`
      );
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== p.name.trim().toLowerCase()) {
        alert('Name did not match — nothing was deleted.');
        return;
      }
      await patientService.hardDelete(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  return (
    <SectionCard title="All Patients">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div className="flex gap-2">
            <select
              className={inputCls}
              value={fyStartYear}
              onChange={(e) => setFyStartYear(Number(e.target.value))}
            >
              {[currentFy.startYear - 2, currentFy.startYear - 1, currentFy.startYear].map((y) => (
                <option key={y} value={y}>
                  FY {fiscalYearOf(new Date(y, clinic.fyStartMonth - 1, 1), clinic.fyStartMonth).label}
                </option>
              ))}
            </select>
            <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All time</option>
              {months.map((m) => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                  {monthName(m.month)} {m.year}
                </option>
              ))}
            </select>
          </div>
          <input
            className={`${inputCls} max-w-xs`}
            placeholder="Search by Patient ID or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {selectedPeriod && (
        <p className="mb-3 text-xs text-[var(--muted)]">
          Showing patients seen in {monthName(selectedPeriod.month)} {selectedPeriod.year}.{' '}
          <button className="font-medium text-[var(--teal)] hover:underline" onClick={() => setMonth('')}>
            Show all time
          </button>
        </p>
      )}

      <ErrorNote message={error} />

      <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <SortHeader label="Patient ID" k="mrno" sort={sort} />
              <SortHeader label="Name" k="name" sort={sort} />
              <SortHeader label="Primary condition" k="condition" sort={sort} />
              <th className={th}>Last visit</th>
              <th className={th}>Therapist</th>
              <th className={th}>Treatment</th>
              <th className={th}>Bill</th>
              <th className={th}>Phone</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((p) => {
              const stats = visitStatsByPatient.get(p.id);
              const pkg = openPackageByPatient.get(p.id);
              const isOutstanding = outstandingMrnos.has(p.mrno);
              return (
                <tr key={p.id} className="hover:bg-[var(--paper)]">
                  <td className={td}>
                    {p.mrno}
                    {p.mrnoSource === 'auto' && (
                      <span className="ml-1.5">
                        <Pill tone="slate">walk-in</Pill>
                      </span>
                    )}
                  </td>
                  <td className={`${td} font-display`}>
                    <Link to="/patients/$patientId" params={{ patientId: p.id }} className="hover:underline">
                      {p.name}
                    </Link>
                    {(p.age || p.sex) && (
                      <div className="text-xs text-[var(--muted)]">
                        {p.age ?? '-'} / {p.sex ?? '-'}
                      </div>
                    )}
                  </td>
                  <td className={td}>{p.primaryCondition ?? '-'}</td>
                  <td className={td}>
                    {stats ? (
                      <>
                        <div className="font-num text-xs text-[var(--ink)]">
                          {formatDateDMY(stats.lastVisitOn)}
                          <span className="text-[var(--muted)]"> · {stats.visitCount} visit{stats.visitCount === 1 ? '' : 's'}</span>
                        </div>
                        {(pkg || isOutstanding) && (
                          <div className="mt-1 flex items-center gap-1.5">
                            {pkg && (
                              <PackageThread sessionIndex={pkg.sessionsLogged} packageTotal={pkg.packageTotal} />
                            )}
                            {isOutstanding && <Pill tone="amber">Outstanding</Pill>}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">No visits yet</span>
                    )}
                  </td>
                  <td className={td}>
                    {stats?.latestVisit ? therapistName.get(stats.latestVisit.therapistId) ?? '-' : '-'}
                  </td>
                  <td className={td}>
                    {stats?.latestVisit?.treatmentNotes ? (
                      <span className="text-xs">{stats.latestVisit.treatmentNotes}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className={`${td} font-num text-right`}>
                    {stats?.latestVisit ? (
                      <span className="text-sm">INR {Math.round(stats.latestVisit.actualBillPaise / 100)}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className={td}>{p.phone ?? '-'}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    <Link to="/archive" search={{ patientId: p.id }} className="font-medium text-[var(--teal)] hover:underline">
                      Visit history
                    </Link>
                    <button className="ml-3 text-xs text-[var(--muted)] hover:text-[var(--teal)]" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                    <button className="ml-3 text-xs text-[var(--muted)] hover:text-[var(--rust)]" onClick={() => void hide(p)}>
                      Hide
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                  {q
                    ? 'No patients match your search.'
                    : selectedPeriod
                      ? 'No patients were seen in this period.'
                      : 'No patients yet — they’re created from the “New visit” flow.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hidden.length > 0 && (
        <div className="mt-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <button
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
            onClick={() => setShowHidden((s) => !s)}
          >
            <span>Hidden patients ({hidden.length})</span>
            <span className="text-xs text-[var(--muted)]">{showHidden ? 'Collapse' : 'Show'}</span>
          </button>
          {showHidden && (
            <table className="min-w-full divide-y divide-[var(--border)] border-t border-[var(--border)]">
              <tbody className="divide-y divide-[var(--border)]">
                {hidden.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--paper)]">
                    <td className={td}>
                      <span className="font-display">{p.name}</span> <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                    </td>
                    <td className={td}>
                      <Pill tone="slate">Hidden {p.deletedAt && formatDateDMY(p.deletedAt)}</Pill>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <button className="text-xs text-[var(--teal)] hover:underline" onClick={() => void restore(p)}>
                        Restore
                      </button>
                      <button className="ml-3 text-xs text-[var(--muted)] hover:text-[var(--rust)]" onClick={() => void hardDelete(p)}>
                        Delete permanently
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && <EditPatientModal patient={editing} onClose={() => setEditing(null)} />}
    </SectionCard>
  );
}

function EditPatientModal({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const [form, setForm] = useState(patient);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm(patient), [patient]);

  const set = (patch: Partial<Patient>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setError(null);
    if (form.mrno.trim() !== patient.mrno && !confirm(`Change Patient ID from ${patient.mrno} to ${form.mrno.trim()}?`)) {
      return;
    }
    setBusy(true);
    try {
      await patientService.update(patient.id, {
        mrno: form.mrno,
        name: form.name,
        age: form.age,
        sex: form.sex,
        phone: form.phone,
        primaryCondition: form.primaryCondition,
        referringSource: form.referringSource,
        referringSourceDetail: form.referringSourceDetail,
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
      <div className="w-full max-w-md space-y-4 rounded-[10px] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Edit patient</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Patient ID">
            <input className={inputCls} value={form.mrno} onChange={(e) => set({ mrno: e.target.value })} />
          </Field>
          <Field label="Age">
            <input
              type="number"
              className={inputCls}
              value={form.age ?? ''}
              onChange={(e) => set({ age: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>
          <Field label="Sex">
            <select
              className={inputCls}
              value={form.sex ?? ''}
              onChange={(e) => set({ sex: (e.target.value || null) as Patient['sex'] })}
            >
              <option value="">—</option>
              <option value="M">M</option>
              <option value="F">F</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value || null })} />
          </Field>
          <Field label="Primary condition">
            <input
              className={inputCls}
              value={form.primaryCondition ?? ''}
              onChange={(e) => set({ primaryCondition: e.target.value || null })}
            />
          </Field>
          <Field label="Referring source">
            <select
              className={inputCls}
              value={form.referringSource ?? ''}
              onChange={(e) =>
                set({
                  referringSource: (e.target.value || null) as ReferringSource | null,
                  referringSourceDetail: null,
                })
              }
            >
              <option value="">—</option>
              {(Object.entries(REFERRING_SOURCE_LABELS) as [ReferringSource, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {referringSourceDetailLabel(form.referringSource) && (
            <Field label={referringSourceDetailLabel(form.referringSource)!}>
              <input
                className={inputCls}
                value={form.referringSourceDetail ?? ''}
                onChange={(e) => set({ referringSourceDetail: e.target.value })}
              />
            </Field>
          )}
        </div>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
