import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, invoiceService, paymentService, patientService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { fiscalYearOf, monthsOfFiscalYear, monthDateRange, monthName, formatDateDMY } from '@/domain/fiscalYear';
import {
  referringSourceDetailLabel,
  REFERRING_SOURCE_LABELS,
  type Patient,
  type PaymentMode,
  type ReferringSource,
  type Visit,
} from '@/domain/types';
import type { PendingWorkItem, RecentVisitRow, TodayPaymentState, TodayVisitRow } from '@/services/dashboardService';
import {
  btnPrimary,
  btnSecondary,
  inputCls,
  th,
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
import { toFriendlyMessage } from '@/lib/errors';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];
type RecentWindow = 7 | 15 | 30;

type PatientSortKey = 'name' | 'mrno' | 'age' | 'condition';
const PATIENT_COMPARATORS = {
  name: byString<Patient>((p) => p.name),
  mrno: byString<Patient>((p) => p.mrno),
  age: byNumber<Patient>((p) => p.age ?? -1),
  condition: byString<Patient>((p) => p.primaryCondition ?? ''),
};

/** What the invoice-issuance modal needs, independent of which card opened it. */
interface InvoicingTarget {
  visitId: string;
  patientLabel: string;
  serviceLabel: string;
  isPackage: boolean;
}

export function WorkspacePage() {
  const clinic = useClinic();
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [paidNow, setPaidNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const today = useLiveQuery(() => dashboardService.todayWorklist(clinic.id), [clinic.id]);
  const pendingWork = useLiveQuery(() => dashboardService.pendingWork(clinic.id), [clinic.id]);
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const openPackageGroupIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
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
        // Non-fatal: the invoice IS issued, and a missing status row reads
        // as Paid — correctable anytime from Archive's Invoices tab.
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Workspace</h1>
        <div className="flex gap-2">
          <Link to="/visits/new" search={{ newPatient: '1' }} className={btnSecondary}>
            + New patient
          </Link>
          <Link to="/visits/new" className={btnPrimary}>
            + New visit
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <StatTile label="Today's visits" value={today?.visitCount ?? 0} />
        <StatTile label="Collected today" value={formatINR(today?.collectedPaise ?? 0)} />
        <StatTile label="Outstanding today" value={formatINR(today?.outstandingPaise ?? 0)} />
        <StatTile label="Pending work" value={pendingWork?.length ?? 0} />
      </div>

      <PendingWorkList items={pendingWork ?? []} />

      <SectionCard title="Today">
        {!today || today.visits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No visits logged today — log one with &ldquo;+ New visit&rdquo;.
          </p>
        ) : (
          <div className="space-y-2.5">
            {today.visits.map((row) => (
              <TodayVisitCard
                key={row.visitId}
                row={row}
                canRepeat={Boolean(row.packageGroupId && openPackageGroupIds.has(row.packageGroupId))}
                onInvoice={() => {
                  setError(null);
                  setPaidNow(true);
                  setInvoicing({
                    visitId: row.visitId,
                    patientLabel: row.patientName,
                    serviceLabel: row.serviceName,
                    isPackage: row.packageTotal != null,
                  });
                }}
                onDelete={() => {
                  if (confirm('Delete this visit?')) void repos.visits.softDelete(row.visitId);
                }}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <RecentVisitsSection clinicId={clinic.id} />

      <AllPatientsSection />

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
    </div>
  );
}

const PENDING_KIND_LABEL: Record<PendingWorkItem['kind'], string> = {
  stale_package: 'Package',
  outstanding_payment: 'Payment',
  incomplete_note: 'Note',
};

function PendingWorkList({ items }: { items: PendingWorkItem[] }) {
  if (items.length === 0) return null;
  return (
    <SectionCard title={`Pending work (${items.length})`}>
      <ul className="divide-y divide-[var(--border)]">
        {items.map((item, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="amber">{PENDING_KIND_LABEL[item.kind]}</Pill>
              <span className="font-display">{item.patientName}</span>
              <span className="text-xs text-[var(--muted)]">{item.mrno}</span>
              <span className="text-[var(--muted)]">{item.detail}</span>
            </div>
            <div className="flex items-center gap-3">
              {item.amountPaise != null && (
                <span className="font-num text-xs font-semibold text-[var(--rust)]">
                  {formatINR(item.amountPaise)}
                </span>
              )}
              {item.patientId && (
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: item.patientId }}
                  className="text-xs font-medium text-[var(--teal)] hover:underline"
                >
                  View
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

const PAYMENT_CHIP: Record<TodayPaymentState, { tone: 'green' | 'amber' | 'slate'; label: (bill: string) => string }> = {
  paid: { tone: 'green', label: () => 'Paid' },
  outstanding: { tone: 'amber', label: (bill) => `Outstanding ${bill}` },
  uninvoiced: { tone: 'amber', label: (bill) => `Collect ${bill}` },
  zero_session: { tone: 'slate', label: () => '₹0 session' },
};

function TodayVisitCard({
  row,
  canRepeat,
  onInvoice,
  onDelete,
}: {
  row: TodayVisitRow;
  canRepeat: boolean;
  onInvoice: () => void;
  onDelete: () => void;
}) {
  const chip = PAYMENT_CHIP[row.paymentState];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="min-w-[10rem] flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-base font-semibold text-[var(--ink)]">{row.patientName}</span>
          <span className="text-xs text-[var(--muted)]">{row.mrno}</span>
          {row.condition && (
            <span className="rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-xs font-medium text-[var(--teal)]">
              {row.condition}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
          <span>{row.serviceName}</span>
          <span>·</span>
          <span>{row.therapistName}</span>
          {row.sessionIndex && row.packageTotal && (
            <span className="ml-0.5">
              <PackageThread sessionIndex={row.sessionIndex} packageTotal={row.packageTotal} />
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-num text-sm font-semibold text-[var(--ink)]">{formatINR(row.billPaise)}</span>
        {row.paymentState === 'uninvoiced' ? (
          <button
            type="button"
            className="rounded-full bg-[var(--rust-light)] px-2.5 py-1 text-xs font-medium text-[var(--rust)] hover:opacity-80"
            onClick={onInvoice}
          >
            {chip.label(formatINR(row.billPaise))}
          </button>
        ) : row.invoiceId ? (
          <Link
            to="/invoices/$invoiceId/print"
            params={{ invoiceId: row.invoiceId }}
            className="hover:opacity-80"
          >
            <Pill tone={chip.tone}>{chip.label(formatINR(row.billPaise))}</Pill>
          </Link>
        ) : (
          <Pill tone={chip.tone}>{chip.label(formatINR(row.billPaise))}</Pill>
        )}
      </div>
      <div className="flex items-center gap-3">
        {canRepeat && (
          <Link
            to="/visits/new"
            search={{ repeatVisitId: row.visitId }}
            className="text-xs text-[var(--muted)] hover:text-[var(--teal)]"
            title="Start the next session with this visit's therapist, service, and condition pre-filled"
          >
            Repeat
          </Link>
        )}
        {!row.invoiceId && (
          <button
            type="button"
            className="text-xs text-[var(--muted)] hover:text-[var(--rust)]"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function RecentVisitsSection({ clinicId }: { clinicId: string }) {
  const [days, setDays] = useState<RecentWindow>(7);
  const rows = useLiveQuery(() => dashboardService.recentVisitsWindow(clinicId, days), [clinicId, days]);
  const sort = useSort<'date' | 'patient' | 'therapist' | 'bill'>('date', 'desc');
  const sorted = applySort(
    rows ?? [],
    {
      date: byString<RecentVisitRow>((r) => r.visitDate),
      patient: byString<RecentVisitRow>((r) => r.patientName),
      therapist: byString<RecentVisitRow>((r) => r.therapistName),
      bill: byNumber<RecentVisitRow>((r) => r.billPaise),
    },
    sort
  );

  return (
    <SectionCard title="Recent">
      <div className="mb-3 flex w-fit gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
        {([7, 15, 30] as RecentWindow[]).map((d) => (
          <button
            key={d}
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              days === d ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)] hover:bg-[var(--surface)]'
            }`}
            onClick={() => setDays(d)}
          >
            {d}d
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)] text-sm">
          <thead>
            <tr>
              <SortHeader label="Date" k="date" sort={sort} firstDir="desc" />
              <SortHeader label="Patient" k="patient" sort={sort} />
              <SortHeader label="Therapist" k="therapist" sort={sort} />
              <th className={th}>Service</th>
              <SortHeader label="Bill" k="bill" sort={sort} numeric firstDir="desc" />
              <th className={th}>Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sorted.map((r) => (
              <tr key={r.visitId} className="hover:bg-[var(--paper)]">
                <td className={td}>{formatDateDMY(r.visitDate)}</td>
                <td className={td}>
                  <span className="font-display">{r.patientName}</span>{' '}
                  <span className="text-xs text-[var(--muted)]">{r.mrno}</span>
                </td>
                <td className={td}>{r.therapistName}</td>
                <td className={td}>{r.serviceName}</td>
                <td className={tdNum}>{formatINR(r.billPaise)}</td>
                <td className={td}>{r.hasInvoice ? <Pill tone="green">Invoiced</Pill> : '—'}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                  No visits in the last {days} days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
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
            placeholder="Search by MRNO or name…"
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
              <SortHeader label="MRNO" k="mrno" sort={sort} />
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
                    <Link to="/visits" search={{ patientId: p.id }} className="font-medium text-[var(--teal)] hover:underline">
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
    if (form.mrno.trim() !== patient.mrno && !confirm(`Change MRNO from ${patient.mrno} to ${form.mrno.trim()}? This may need to match hospital records.`)) {
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
          <Field label="MRNO">
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
