import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, invoiceService, paymentService, directPaymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import type { PaymentMethod, PaymentMode } from '@/domain/types';
import type { PendingWorkItem, RecentVisitRow, TodayVisitRow } from '@/services/dashboardService';
import {
  btnPrimary,
  btnSecondary,
  inputCls,
  ErrorNote,
  Field,
  Pill,
  SectionCard,
  StatTile,
  SummaryBar,
  Panel,
} from '@/components/ui';
import { SharedVisitCard, type VisitCardData } from '@/components/VisitCard';
import { toFriendlyMessage } from '@/lib/errors';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

/** What the invoice-issuance modal needs, independent of which card opened it. */
interface InvoicingTarget {
  visitId: string;
  patientLabel: string;
  serviceLabel: string;
  isPackage: boolean;
}

function todayRowToCardData(row: TodayVisitRow, openPackageGroupIds: Set<string>): VisitCardData {
  return {
    visitId: row.visitId,
    visitDate: new Date().toISOString().slice(0, 10),
    patientId: row.patientId,
    patientName: row.patientName,
    mrno: row.mrno,
    condition: row.condition,
    serviceName: row.serviceName,
    sessionIndex: row.sessionIndex,
    packageTotal: row.packageTotal,
    therapistName: row.therapistName,
    treatmentNotes: row.treatmentNotes,
    billPaise: row.billPaise,
    paymentState: row.paymentState,
    invoiceId: row.invoiceId,
    canRepeat: Boolean(row.packageGroupId && openPackageGroupIds.has(row.packageGroupId)),
    canDelete: !row.invoiceId,
  };
}

function recentRowToCardData(row: RecentVisitRow): VisitCardData {
  return {
    visitId: row.visitId,
    visitDate: row.visitDate,
    patientId: row.patientId,
    patientName: row.patientName,
    mrno: row.mrno,
    condition: row.condition,
    serviceName: row.serviceName,
    sessionIndex: row.sessionIndex,
    packageTotal: row.packageTotal,
    therapistName: row.therapistName,
    treatmentNotes: row.treatmentNotes,
    billPaise: row.billPaise,
    paymentState: row.outstandingPaise === 0 ? (row.hasInvoice ? 'paid' : 'zero_session') : row.hasInvoice ? 'outstanding' : 'uninvoiced',
    invoiceId: row.invoiceId,
    canRepeat: false,
    canDelete: false,
  };
}

export function WorkspacePage() {
  const clinic = useClinic();
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [paidNow, setPaidNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const navigate = useNavigate();

  const today = useLiveQuery(() => dashboardService.todayWorklist(clinic.id), [clinic.id]);
  const pendingWork = useLiveQuery(() => dashboardService.pendingWork(clinic.id), [clinic.id]);
  const monthlyNew = useLiveQuery(() => dashboardService.monthlyNewCounts(clinic.id), [clinic.id]);
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const recentVisits = useLiveQuery(
    () => (recentOpen ? dashboardService.recentVisits(clinic.id, 8) : undefined),
    [clinic.id, recentOpen]
  );
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

  function openInvoiceFor(data: VisitCardData) {
    setError(null);
    setPaidNow(true);
    setInvoicing({
      visitId: data.visitId,
      patientLabel: data.patientName,
      serviceLabel: data.serviceName,
      isPackage: data.packageTotal != null,
    });
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

      {pendingWork && pendingWork.length > 0 && (
        <SummaryBar tone="rust" label="need attention" count={pendingWork.length} onClick={() => setAttentionOpen(true)} />
      )}
      <SummaryBar tone="neutral" label="Recently seen ›" onClick={() => setRecentOpen(true)} />

      <SectionCard title="Seen today">
        {!today || today.visits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No visits logged today — log one with &ldquo;+ New visit&rdquo;.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {today.visits.map((row) => (
              <SharedVisitCard
                key={row.visitId}
                data={todayRowToCardData(row, openPackageGroupIds)}
                showDate={false}
                showPatient={true}
                onInvoice={() => openInvoiceFor(todayRowToCardData(row, openPackageGroupIds))}
                onDelete={() => {
                  if (confirm('Delete this visit?')) void repos.visits.softDelete(row.visitId);
                }}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <Panel open={attentionOpen} onClose={() => setAttentionOpen(false)} title="Needs attention">
        <ul className="divide-y divide-[var(--border)]">
          {(pendingWork ?? []).map((item, i) => (
            <PendingWorkRow key={i} item={item} clinicId={clinic.id} />
          ))}
        </ul>
      </Panel>

      <Panel open={recentOpen} onClose={() => setRecentOpen(false)} title="Recently seen">
        {!recentVisits ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : recentVisits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No visits yet.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {recentVisits.map((row) => (
              <SharedVisitCard
                key={row.visitId}
                data={recentRowToCardData(row)}
                showDate={true}
                showPatient={true}
                onInvoice={() => openInvoiceFor(recentRowToCardData(row))}
                onDelete={() => {}}
              />
            ))}
          </div>
        )}
      </Panel>

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

const PENDING_KIND: Record<PendingWorkItem['kind'], { bg: string; fg: string; label: (item: PendingWorkItem) => string }> = {
  outstanding_payment: { bg: 'var(--rust-light)', fg: 'var(--rust)', label: (item) => `Pending · ${item.daysSince}d` },
  stale_package: { bg: 'var(--amber-light)', fg: 'var(--amber)', label: (item) => `${item.daysSince}d since last visit` },
  incomplete_note: { bg: 'var(--paper)', fg: 'var(--muted)', label: () => 'Note not finished' },
};

function PendingWorkRow({ item, clinicId }: { item: PendingWorkItem; clinicId: string }) {
  const [choosingMethod, setChoosingMethod] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const badge = PENDING_KIND[item.kind];

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
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {badge.label(item)}
        </span>
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
