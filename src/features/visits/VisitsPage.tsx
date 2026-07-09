import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, invoiceService, paymentService, visitService } from '@/services';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import {
  clinicBillingConfig,
  clinicShareLabels,
  visibleVisitColumns,
  type PaymentMode,
  type Therapist,
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
  PackageThread,
  SectionCard,
  StatTile,
} from '@/components/ui';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { PatientOverview } from './PatientOverview';
import { toFriendlyMessage } from '@/lib/errors';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];
const PATIENT_SEARCH_LIMIT = 6;

type DatePreset = 'week' | 'month' | 'lastMonth' | 'all';
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All' },
];
const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
const TREATMENT_TRUNCATE = 40;

export function VisitsPage() {
  const clinic = useClinic();
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit, therapistSplit } = clinicBillingConfig(clinic);
  const cols = visibleVisitColumns(clinic);
  // Fixed columns: Date, Patient, Therapist, Service (before Bill) + Bill,
  // Invoice, actions. Optional: Condition, Treatment, Adjustment, and the two
  // hospital-split columns. The Totals label spans everything before Bill.
  const labelSpan = 4 + (cols.condition ? 1 : 0) + (cols.treatment ? 1 : 0);
  const columnCount =
    labelSpan + 1 + (cols.adjustment ? 1 : 0) + (hospitalSplit ? 2 : 0) + 2;
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { patientId?: string };

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [therapistId, setTherapistId] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const [invoicing, setInvoicing] = useState<Visit | null>(null);
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
      const invoice = await invoiceService.issueForVisit(invoicing.id, paymentMode);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Visits</h1>
        {filteredPatient && (
          <span className="rounded-full bg-[var(--teal-light)] px-3 py-1 text-xs text-[var(--teal)]">
            {filteredPatient.name} ({filteredPatient.mrno})
            <Link to="/visits" className="ml-2 font-medium">
              ✕
            </Link>
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div className="relative">
            <Field label="Find patient">
              <input
                className={inputCls}
                placeholder="Name or MRNO…"
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                onBlur={() => setTimeout(() => setPatientQuery(''), 150)}
              />
            </Field>
            {patientMatches.length > 0 && (
              <div className="absolute z-10 mt-1 w-64 rounded-md border border-[var(--border)] bg-[var(--surface)]">
                {patientMatches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--paper)]"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setPatientQuery('');
                      void navigate({ to: '/visits', search: { patientId: p.id } });
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
          <Link to="/visits/new" className={btnPrimary}>
            + New visit
          </Link>
        </div>
      </div>

      {filteredPatient && <PatientOverview patient={filteredPatient} />}

      <div className="flex flex-wrap gap-3">
        <StatTile label="This week's visits" value={weeklySummary?.visitCount ?? 0} />
        <StatTile label="Collected this week" value={formatINR(weeklySummary?.collectedPaise ?? 0)} />
        <StatTile label="Packages this month" value={monthlyNew?.newPackages ?? 0} />
        <StatTile label="New patients this month" value={monthlyNew?.newPatients ?? 0} />
      </div>

      {followUps.length > 0 && (
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
                        to="/visits"
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

      <div className="flex justify-end">
        <div className="flex flex-wrap gap-1 rounded-md border border-[var(--border)] p-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                datePreset === p.key
                  ? 'bg-[var(--teal)] text-white'
                  : 'text-[var(--muted)] hover:bg-[var(--paper)]'
              }`}
              onClick={() => applyDatePreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
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
              {cols.adjustment && <th className={thNum}>Adj.</th>}
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
                  {cols.adjustment && (
                    <td className={tdNum} title={v.adjustmentReason ?? undefined}>
                      {v.adjustmentPaise !== 0 ? formatINR(v.adjustmentPaise) : '—'}
                    </td>
                  )}
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
                          setInvoicing(v);
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
                {cols.adjustment && <td className={tdNum}></td>}
                {hospitalSplit && <td className={tdNum}>{formatINR(totals.bmShare)}</td>}
                {hospitalSplit && <td className={tdNum}>{formatINR(totals.postTax)}</td>}
                <td className={td}></td>
                <td className={td}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {invoicing && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Issue invoice</h2>
            <p className="text-sm text-[var(--muted)]">
              {patientById.get(invoicing.patientId)?.name} —{' '}
              {serviceName.get(invoicing.serviceCatalogId)}
              {invoicing.packageGroupId && ', all sessions of this package'}
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
