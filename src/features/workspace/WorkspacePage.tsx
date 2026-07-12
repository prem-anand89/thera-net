import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, invoiceService, paymentService, directPaymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { PaymentMethod, PaymentMode } from '@/domain/types';
import type {
  OpenPackageRow,
  PendingWorkItem,
  RecentVisitRow,
  TodayPaymentState,
  TodayVisitRow,
} from '@/services/dashboardService';
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
import { toFriendlyMessage } from '@/lib/errors';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];
type RecentWindow = 7 | 15 | 30;

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
  const monthlyNew = useLiveQuery(() => dashboardService.monthlyNewCounts(clinic.id), [clinic.id]);
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
        <StatTile label="New patients this month" value={monthlyNew?.newPatients ?? 0} />
        <StatTile label="Packages this month" value={monthlyNew?.newPackages ?? 0} />
      </div>

      <PendingWorkList items={pendingWork ?? []} clinicId={clinic.id} />

      <OpenPackagesSection rows={openPackages ?? []} />

      <SectionCard title="Today">
        {!today || today.visits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No visits logged today — log one with &ldquo;+ New visit&rdquo;.
          </p>
        ) : (
          <TodayVisitsTable
            rows={today.visits}
            openPackageGroupIds={openPackageGroupIds}
            onInvoice={(row) => {
              setError(null);
              setPaidNow(true);
              setInvoicing({
                visitId: row.visitId,
                patientLabel: row.patientName,
                serviceLabel: row.serviceName,
                isPackage: row.packageTotal != null,
              });
            }}
            onDelete={(row) => {
              if (confirm('Delete this visit?')) void repos.visits.softDelete(row.visitId);
            }}
          />
        )}
      </SectionCard>

      <RecentVisitsSection clinicId={clinic.id} />

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

function PendingWorkList({ items, clinicId }: { items: PendingWorkItem[]; clinicId: string }) {
  if (items.length === 0) return null;
  return (
    <SectionCard title={`Pending work (${items.length})`}>
      <ul className="divide-y divide-[var(--border)]">
        {items.map((item, i) => (
          <PendingWorkRow key={i} item={item} clinicId={clinicId} />
        ))}
      </ul>
    </SectionCard>
  );
}

function PendingWorkRow({ item, clinicId }: { item: PendingWorkItem; clinicId: string }) {
  const [choosingMethod, setChoosingMethod] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);

  async function markInvoicePaid() {
    if (!item.invoiceId) return;
    setBusy(true);
    try {
      await paymentService.setStatus(item.invoiceId, clinicId, 'paid');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDirectPayment() {
    if (!item.visitId || item.amountPaise == null) return;
    setBusy(true);
    try {
      await directPaymentService.logPayment(
        clinicId,
        item.visitId,
        item.amountPaise,
        method,
        new Date().toISOString().slice(0, 10),
        null
      );
      setChoosingMethod(false);
    } finally {
      setBusy(false);
    }
  }

  const canMarkPaid = item.kind === 'outstanding_payment' && (item.invoiceId != null || item.visitId != null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
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
        {canMarkPaid && !choosingMethod && (
          <button
            type="button"
            className="text-xs font-medium text-[var(--moss)] hover:underline"
            disabled={busy}
            onClick={() => (item.invoiceId ? void markInvoicePaid() : setChoosingMethod(true))}
          >
            Mark paid
          </button>
        )}
        {choosingMethod && (
          <span className="flex items-center gap-1.5">
            <select
              className={`${inputCls} py-1 text-xs`}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-xs font-medium text-[var(--moss)] hover:underline"
              disabled={busy}
              onClick={() => void confirmDirectPayment()}
            >
              Confirm
            </button>
            <button
              type="button"
              className="text-xs text-[var(--muted)] hover:underline"
              onClick={() => setChoosingMethod(false)}
            >
              Cancel
            </button>
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
  );
}

const PAYMENT_CHIP: Record<TodayPaymentState, { tone: 'green' | 'amber' | 'slate'; label: (bill: string) => string }> = {
  paid: { tone: 'green', label: () => 'Paid' },
  outstanding: { tone: 'amber', label: (bill) => `Outstanding ${bill}` },
  uninvoiced: { tone: 'amber', label: (bill) => `Collect ${bill}` },
  zero_session: { tone: 'slate', label: () => '₹0 session' },
};

function TodayVisitsTable({
  rows,
  openPackageGroupIds,
  onInvoice,
  onDelete,
}: {
  rows: TodayVisitRow[];
  openPackageGroupIds: Set<string>;
  onInvoice: (row: TodayVisitRow) => void;
  onDelete: (row: TodayVisitRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-[var(--border)] text-sm">
        <thead>
          <tr>
            <th className={th}>Patient</th>
            <th className={th}>Condition</th>
            <th className={th}>Therapist</th>
            <th className={th}>Service</th>
            <th className={th}>Treatment</th>
            <th className={thNum}>Bill</th>
            <th className={th}>Phone</th>
            <th className={th}>Payment</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => {
            const chip = PAYMENT_CHIP[row.paymentState];
            const canRepeat = Boolean(row.packageGroupId && openPackageGroupIds.has(row.packageGroupId));
            return (
              <tr key={row.visitId} className="hover:bg-[var(--paper)]">
                <td className={td}>
                  <Link to="/patients/$patientId" params={{ patientId: row.patientId }} className="font-display hover:underline">
                    {row.patientName}
                  </Link>{' '}
                  <span className="text-xs text-[var(--muted)]">{row.mrno}</span>
                </td>
                <td className={td}>{row.condition ?? '—'}</td>
                <td className={td}>{row.therapistName}</td>
                <td className={td}>
                  {row.serviceName}
                  {row.sessionIndex && row.packageTotal && (
                    <span className="ml-1.5">
                      <PackageThread sessionIndex={row.sessionIndex} packageTotal={row.packageTotal} />
                    </span>
                  )}
                </td>
                <td className={td}>{row.treatmentNotes ?? '—'}</td>
                <td className={tdNum}>{formatINR(row.billPaise)}</td>
                <td className={td}>{row.phone ?? '—'}</td>
                <td className={td}>
                  {row.paymentState === 'uninvoiced' ? (
                    <button
                      type="button"
                      className="rounded-full bg-[var(--rust-light)] px-2.5 py-1 text-xs font-medium text-[var(--rust)] hover:opacity-80"
                      onClick={() => onInvoice(row)}
                    >
                      {chip.label(formatINR(row.billPaise))}
                    </button>
                  ) : row.invoiceId ? (
                    <Link to="/invoices/$invoiceId/print" params={{ invoiceId: row.invoiceId }} className="hover:opacity-80">
                      <Pill tone={chip.tone}>{chip.label(formatINR(row.billPaise))}</Pill>
                    </Link>
                  ) : (
                    <Pill tone={chip.tone}>{chip.label(formatINR(row.billPaise))}</Pill>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <div className="flex gap-3">
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
                        onClick={() => onDelete(row)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OpenPackagesSection({ rows }: { rows: OpenPackageRow[] }) {
  const sort = useSort<'days' | 'patient' | 'progress' | 'started'>('days', 'desc');
  const sorted = applySort(
    rows,
    {
      days: byNumber<OpenPackageRow>((p) => p.daysSinceLastVisit),
      patient: byString<OpenPackageRow>((p) => p.patientName),
      progress: byNumber<OpenPackageRow>((p) => p.sessionsLogged / p.packageTotal),
      started: byString<OpenPackageRow>((p) => p.startedOn),
    },
    sort
  );

  if (rows.length === 0) return null;

  return (
    <SectionCard title="Open packages">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Packages still short of their session count, most-quiet first. A patient not seen in over
        14 days is flagged stale.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)] text-sm">
          <thead>
            <tr>
              <SortHeader label="Patient" k="patient" sort={sort} />
              <th className={th}>Service</th>
              <SortHeader label="Progress" k="progress" sort={sort} numeric />
              <SortHeader label="Started" k="started" sort={sort} />
              <th className={th}>Last visit</th>
              <SortHeader label="Days since" k="days" sort={sort} numeric firstDir="desc" />
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sorted.map((p) => (
              <tr key={p.packageGroupId} className="hover:bg-[var(--paper)]">
                <td className={td}>
                  <Link to="/patients/$patientId" params={{ patientId: p.patientId }} className="font-display hover:underline">
                    {p.patientName}
                  </Link>{' '}
                  <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                </td>
                <td className={td}>{p.serviceName}</td>
                <td className={tdNum}>
                  {p.sessionsLogged} of {p.packageTotal}
                </td>
                <td className={td}>{formatDateDMY(p.startedOn)}</td>
                <td className={td}>{formatDateDMY(p.lastVisitOn)}</td>
                <td className={tdNum}>{p.daysSinceLastVisit}</td>
                <td className={td}>{p.stale && <Pill tone="amber">⚠ Stale</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
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
              <th className={th}>Condition</th>
              <SortHeader label="Therapist" k="therapist" sort={sort} />
              <th className={th}>Service</th>
              <th className={th}>Treatment</th>
              <SortHeader label="Bill" k="bill" sort={sort} numeric firstDir="desc" />
              <th className={th}>Phone</th>
              <th className={th}>Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sorted.map((r) => (
              <tr key={r.visitId} className="hover:bg-[var(--paper)]">
                <td className={td}>{formatDateDMY(r.visitDate)}</td>
                <td className={td}>
                  <Link to="/patients/$patientId" params={{ patientId: r.patientId }} className="font-display hover:underline">
                    {r.patientName}
                  </Link>{' '}
                  <span className="text-xs text-[var(--muted)]">{r.mrno}</span>
                </td>
                <td className={td}>{r.condition ?? '—'}</td>
                <td className={td}>{r.therapistName}</td>
                <td className={td}>
                  {r.serviceName}
                  {r.sessionIndex && r.packageTotal && (
                    <span className="ml-1.5">
                      <PackageThread sessionIndex={r.sessionIndex} packageTotal={r.packageTotal} />
                    </span>
                  )}
                </td>
                <td className={td}>{r.treatmentNotes ?? '—'}</td>
                <td className={tdNum}>{formatINR(r.billPaise)}</td>
                <td className={td}>{r.phone ?? '—'}</td>
                <td className={td}>{r.hasInvoice ? <Pill tone="green">Invoiced</Pill> : '—'}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
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
