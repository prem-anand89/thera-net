import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, invoiceService, paymentService, directPaymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { PaymentMethod, PaymentMode } from '@/domain/types';
import type {
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
  const [packagesOpen, setPackagesOpen] = useState(false);
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
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Workspace</h1>
        <div className="flex w-full gap-2 sm:w-auto">
          <Link to="/visits/new" search={{ newPatient: '1' }} className={`${btnSecondary} flex-1 text-center sm:flex-none`}>
            + New patient
          </Link>
          <Link to="/visits/new" className={`${btnPrimary} flex-1 text-center sm:flex-none`}>
            + New visit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:flex lg:flex-wrap">
        <StatTile label="Today's visits" value={today?.visitCount ?? 0} />
        <StatTile label="Collected today" value={formatINR(today?.collectedPaise ?? 0)} />
        <StatTile label="New patients this month" value={monthlyNew?.newPatients ?? 0} />
        <StatTile label="Packages this month" value={monthlyNew?.newPackages ?? 0} />
        {openPackages && openPackages.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setPackagesOpen(!packagesOpen)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
            >
              📦 {openPackages.length} open{' '}
              <span className="hidden xs:inline">
                {openPackages.length === 1 ? 'package' : 'packages'}
              </span>
              <span className={`ml-1 inline-block transition-transform ${packagesOpen ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>
            {packagesOpen && (
              <div className="absolute right-0 top-full mt-2 z-10 max-h-80 min-w-max overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
                <div className="p-3">
                  <ul className="space-y-2 text-xs">
                    {openPackages.map((p) => (
                      <li key={p.packageGroupId} className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border)] last:border-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[var(--ink)] truncate">{p.patientName}</p>
                          <p className="text-[var(--muted)]">{p.serviceName}</p>
                          <p className="text-[var(--muted)]">{p.sessionsLogged}/{p.packageTotal} sessions</p>
                          {p.stale && <Pill tone="amber">⚠ Stale</Pill>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-[var(--border)] px-3 py-2">
                  <Link
                    to="/archive"
                    onClick={() => setPackagesOpen(false)}
                    className="block text-center text-xs text-[var(--teal)] hover:underline"
                  >
                    View details →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <PendingWorkList items={pendingWork ?? []} clinicId={clinic.id} />

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
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
          <div className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-4 sm:p-5 max-h-[90vh] overflow-y-auto">
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
