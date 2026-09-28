import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, paymentService, dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDM, currentWeekRange } from '@/domain/fiscalYear';
import { type Invoice } from '@/domain/types';

const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type DatePreset = 'week' | 'month' | 'lastMonth' | 'all' | 'custom';
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom range…' },
];
import { buildUpiPayUri, clinicCanShowUpiQr, clinicUpiPayeeName } from '@/domain/upiPay';
import { th, thNum, td, tdNum, btnPrimary, ErrorNote, Pill, SectionCard } from '@/components/ui';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { toFriendlyMessage } from '@/lib/errors';
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';

type InvoiceSortKey = 'no' | 'date' | 'patient' | 'total' | 'status';
const INVOICE_COMPARATORS = {
  no: byString<Invoice>((inv) => inv.invoiceNo),
  date: byString<Invoice>((inv) => inv.issuedAt),
  patient: byString<Invoice>((inv) => inv.patientSnapshot.name),
  total: byNumber<Invoice>((inv) => inv.totalPaise),
  status: byString<Invoice>(() => ''),
};

export function InvoicesPage() {
  const clinic = useClinic();
  const invoices = useLiveQuery(() => repos.invoices.list(clinic.id), [clinic.id]);
  const payments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);
  // 1.7's needs-receipt queue — same live-query mechanism every other
  // count in the app uses, so it re-runs on any local write or sync pull.
  const needsReceipt = useLiveQuery(() => dashboardService.needsReceipt(clinic.id), [clinic.id]);
  const [invoicingNeedsReceipt, setInvoicingNeedsReceipt] = useState<IssueInvoiceTarget | null>(
    null
  );
  // Needed to compute each invoice's actual collected-so-far amount — there's
  // no amount column on invoice_payments (see paymentService.invoiceBalance);
  // it's derived by summing the visit-scoped `payments` rows for whichever
  // visit(s) this invoice covers.
  const visits = useLiveQuery(() => repos.visits.list({ clinicId: clinic.id }), [clinic.id]);
  const directPayments = useLiveQuery(() => repos.payments.list(clinic.id), [clinic.id]);
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [takingPayment, setTakingPayment] = useState<Invoice | null>(null);
  const [from, setFrom] = useState(toIsoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(toIsoDate(new Date()));
  const [datePreset, setDatePreset] = useState<DatePreset>('month');
  const [statusFilter, setStatusFilter] = useState<'all' | 'outstanding'>('all');

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
    }
  }

  const sort = useSort<InvoiceSortKey>('date', 'desc');

  const statusByInvoiceId = useMemo(
    () => new Map((payments ?? []).map((p) => [p.invoiceId, p.status])),
    [payments]
  );

  const directPaymentByVisitId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of directPayments ?? []) {
      map.set(p.visitId, (map.get(p.visitId) ?? 0) + p.amountPaise);
    }
    return map;
  }, [directPayments]);

  // Sum of collected `payments` rows across every visit each invoice covers,
  // plus a lookup of one representative visit per invoice (any one will do —
  // TakePaymentDialog's invoice-aware path allocates across all of them, the
  // passed visitId only anchors the dialog to a concrete row).
  const { paidByInvoiceId, sampleVisitIdByInvoiceId, patientIdByInvoiceId } = useMemo(() => {
    const paid = new Map<string, number>();
    const sampleVisit = new Map<string, string>();
    const patientId = new Map<string, string>();
    for (const v of visits ?? []) {
      if (v.deleted || !v.invoiceId) continue;
      paid.set(v.invoiceId, (paid.get(v.invoiceId) ?? 0) + (directPaymentByVisitId.get(v.id) ?? 0));
      if (!sampleVisit.has(v.invoiceId)) sampleVisit.set(v.invoiceId, v.id);
      if (!patientId.has(v.invoiceId)) patientId.set(v.invoiceId, v.patientId);
    }
    return { paidByInvoiceId: paid, sampleVisitIdByInvoiceId: sampleVisit, patientIdByInvoiceId: patientId };
  }, [visits, directPaymentByVisitId]);

  const phoneByPatientId = useMemo(
    () => new Map((patients ?? []).map((p) => [p.id, p.phone])),
    [patients]
  );

  async function remindToPay(inv: Invoice, remainingPaise: number) {
    const patientId = patientIdByInvoiceId.get(inv.id);
    const phone = patientId ? (phoneByPatientId.get(patientId) ?? null) : null;
    
    if (!phone) {
      setError('Patient has no phone number on file');
      return;
    }

    const upiPayUri = clinicCanShowUpiQr(clinic)
      ? buildUpiPayUri({
          vpa: clinic.upiVpa ?? '',
          payeeName: clinicUpiPayeeName(clinic),
          amountPaise: remainingPaise,
          note: inv.invoiceNo,
        })
      : null;

    let text = `Hi ${inv.patientSnapshot.name},\n\nThis is a reminder from ${clinic.name} regarding your pending bill (${inv.invoiceNo}) of ${formatINR(remainingPaise)}.`;
    
    if (upiPayUri) {
      text += `\n\nYou can pay directly via UPI using this link:\n${upiPayUri}`;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    
    const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }

  function balanceFor(inv: Invoice): { paidPaise: number; remainingPaise: number } {
    const status = statusByInvoiceId.get(inv.id) ?? 'outstanding';
    if (status === 'paid') return { paidPaise: inv.totalPaise, remainingPaise: 0 };
    const paidPaise = paidByInvoiceId.get(inv.id) ?? 0;
    return { paidPaise, remainingPaise: Math.max(0, inv.totalPaise - paidPaise) };
  }

  const filteredInvoices = useMemo(() => {
    let filtered = invoices ?? [];
    if (from) filtered = filtered.filter((i) => i.issuedAt.slice(0, 10) >= from);
    if (to) filtered = filtered.filter((i) => i.issuedAt.slice(0, 10) <= to);
    if (statusFilter === 'outstanding') {
      filtered = filtered.filter((i) => {
        const status = statusByInvoiceId.get(i.id) ?? 'outstanding';
        if (status === 'paid') return false;
        const paidPaise = paidByInvoiceId.get(i.id) ?? 0;
        return i.totalPaise > paidPaise;
      });
    }
    return filtered;
  }, [invoices, from, to, statusFilter, statusByInvoiceId, paidByInvoiceId]);

  const sortedInvoices = useMemo(
    () => applySort(filteredInvoices, INVOICE_COMPARATORS, sort),
    [filteredInvoices, sort]
  );

  const { totalOutstanding, totalCollected } = useMemo(() => {
    let outstanding = 0;
    let collected = 0;
    for (const inv of filteredInvoices) {
      const status = statusByInvoiceId.get(inv.id) ?? 'outstanding';
      if (status === 'paid') {
        collected += inv.totalPaise;
      } else {
        const paidPaise = paidByInvoiceId.get(inv.id) ?? 0;
        collected += paidPaise;
        outstanding += Math.max(0, inv.totalPaise - paidPaise);
      }
    }
    return { totalOutstanding: outstanding, totalCollected: collected };
  }, [filteredInvoices, statusByInvoiceId, paidByInvoiceId]);

  async function toggleInvoiceStatus(invoiceId: string, currentStatus: string) {
    setError(null);
    setBusy(true);
    try {
      const newStatus = currentStatus === 'paid' ? 'outstanding' : 'paid';
      await paymentService.setStatus(invoiceId, clinic.id, newStatus);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex max-w-full flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
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
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
              />
              <span className="text-[var(--muted)]">to</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
              />
            </div>
          )}
        </div>
        <div className="flex max-w-full flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              statusFilter === 'all'
                ? 'bg-[var(--teal)] text-white'
                : 'text-[var(--muted)] hover:bg-[var(--surface)]'
            }`}
            onClick={() => setStatusFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              statusFilter === 'outstanding'
                ? 'bg-[var(--teal)] text-white'
                : 'text-[var(--muted)] hover:bg-[var(--surface)]'
            }`}
            onClick={() => setStatusFilter('outstanding')}
          >
            Outstanding
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Total Collected</div>
          <div className="text-2xl font-display font-semibold text-[var(--ink)]">
            {formatINR(totalCollected)}
          </div>
        </div>
        <div className="flex-1 min-w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Outstanding</div>
          <div className="text-2xl font-display font-semibold text-[var(--rust)]">
            {formatINR(totalOutstanding)}
          </div>
        </div>
        <div className="flex-1 min-w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Total Invoiced</div>
          <div className="text-2xl font-display font-semibold text-[var(--ink)]">
            {formatINR(totalCollected + totalOutstanding)}
          </div>
        </div>
      </div>

      {needsReceipt && needsReceipt.length > 0 && (
        <SectionCard title={`Needs receipt (${needsReceipt.length})`}>
          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)]">
              Collected but never invoiced — these visits are settled with the patient but have no
              receipt on file.
            </p>
            {/* Below tab: — same boxed-card treatment the Invoices table below
                uses, instead of forcing this 5-column table (including the
                primary "Issue invoice" button) to scroll sideways on a
                phone. */}
            <div className="tab:hidden space-y-2">
              {needsReceipt.map((row) => (
                <div
                  key={row.visitId}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display text-sm font-medium text-[var(--ink)]">
                        {row.patientName}{' '}
                        <span className="text-xs font-normal text-[var(--muted)]">{row.mrno}</span>
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        {row.serviceName} · {formatDateDM(row.visitDate)}
                      </div>
                    </div>
                    <span className="font-num shrink-0 text-sm font-medium text-[var(--ink)]">
                      {formatINR(row.collectedPaise)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`${btnPrimary} mt-3 w-full`}
                    onClick={() =>
                      setInvoicingNeedsReceipt({
                        visitId: row.visitId,
                        patientId: row.patientId,
                        patientLabel: row.patientName,
                        serviceLabel: row.serviceName,
                        isPackage: false,
                        alreadyCollected: true,
                      })
                    }
                  >
                    Issue invoice
                  </button>
                </div>
              ))}
            </div>

            <div className="hidden tab:block overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className={th}>Date</th>
                    <th className={th}>Patient</th>
                    <th className={th}>Service</th>
                    <th className={thNum}>Collected</th>
                    <th className={`${th} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {needsReceipt.map((row) => (
                    <tr key={row.visitId} className="hover:bg-[var(--paper)]">
                      <td className={td}>{formatDateDM(row.visitDate)}</td>
                      <td className={`${td} font-display`}>
                        {row.patientName}{' '}
                        <span className="text-xs text-[var(--muted)]">{row.mrno}</span>
                      </td>
                      <td className={td}>{row.serviceName}</td>
                      <td className={tdNum}>{formatINR(row.collectedPaise)}</td>
                      <td className={`${td} text-right`}>
                        <button
                          type="button"
                          className={`${btnPrimary} py-1.5 min-h-0 text-xs`}
                          onClick={() =>
                            setInvoicingNeedsReceipt({
                              visitId: row.visitId,
                              patientId: row.patientId,
                              patientLabel: row.patientName,
                              serviceLabel: row.serviceName,
                              isPackage: false,
                              alreadyCollected: true,
                            })
                          }
                        >
                          Issue invoice
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Invoices">
        <div className="space-y-4">
          {/* Below tab: — same boxed-card treatment Today's visits, Patients,
              and Packages use, instead of forcing this 8-column table to
              scroll sideways on a phone. */}
          <div className="tab:hidden space-y-2">
            {sortedInvoices.map((inv) => {
              const status = statusByInvoiceId.get(inv.id) ?? 'paid';
              const { paidPaise, remainingPaise } = balanceFor(inv);
              const isPartial = status === 'outstanding' && paidPaise > 0;
              const initials = inv.patientSnapshot.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() ?? '')
                .join('');
              return (
                <div
                  key={inv.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--teal-light)] font-display text-xs font-semibold text-[var(--teal)]">
                      {initials || '?'}
                    </div>
                    <div className="min-w-0">
                      <div className="font-display text-sm font-medium text-[var(--ink)]">
                        {inv.patientSnapshot.name}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{inv.patientSnapshot.mrno}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Pill tone="slate">{inv.invoiceNo}</Pill>
                    <Pill tone="slate">{formatDateDM(inv.issuedAt)}</Pill>
                    <Pill tone="slate">{inv.paymentMode}</Pill>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-num text-sm font-medium text-[var(--ink)]">
                        {formatINR(inv.totalPaise)}
                      </span>
                      <Pill tone={status === 'paid' ? 'green' : 'amber'}>
                        {status === 'paid' ? 'Paid' : isPartial ? 'Partially paid' : 'Outstanding'}
                      </Pill>
                    </div>
                    <div className="flex items-center gap-2">
                      {status === 'outstanding' && (
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--teal)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={busy}
                          onClick={() => setTakingPayment(inv)}
                        >
                          Record payment
                        </button>
                      )}
                      {status === 'outstanding' && (
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--teal)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => void remindToPay(inv, remainingPaise)}
                        >
                          Send WhatsApp reminder
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--teal)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void toggleInvoiceStatus(inv.id, status)}
                      >
                        Mark {status === 'paid' ? 'outstanding' : 'paid'}
                      </button>
                      <Link
                        to="/invoices/$invoiceId/print"
                        params={{ invoiceId: inv.id }}
                        search={{ from: '/ledger', tab: 'invoices' }}
                        className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
                      >
                        Print
                      </Link>
                    </div>
                  </div>
                  {isPartial && (
                    <p className="mt-1.5 text-xs text-[var(--muted)]">
                      {formatINR(paidPaise)} collected · {formatINR(remainingPaise)} due
                    </p>
                  )}
                </div>
              );
            })}
            {sortedInvoices.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--muted)]">
                No invoices issued yet — issue one from the Visits table.
              </p>
            )}
          </div>

          <div className="hidden tab:block overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <SortHeader label="Invoice No" k="no" sort={sort} firstDir="desc" />
                  <SortHeader label="Date" k="date" sort={sort} firstDir="desc" />
                  <SortHeader label="Patient" k="patient" sort={sort} />
                  <th className={th}>Patient ID</th>
                  <SortHeader label="Total" k="total" sort={sort} numeric firstDir="desc" />
                  <th className={th}>Mode</th>
                  <SortHeader label="Status" k="status" sort={sort} />
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedInvoices.map((inv) => {
                  const status = statusByInvoiceId.get(inv.id) ?? 'paid';
                  const { paidPaise, remainingPaise } = balanceFor(inv);
                  const isPartial = status === 'outstanding' && paidPaise > 0;
                  return (
                    <tr key={inv.id} className="hover:bg-[var(--paper)]">
                      <td className={`${td} font-medium`}>{inv.invoiceNo}</td>
                      <td className={td}>{formatDateDM(inv.issuedAt)}</td>
                      <td className={`${td} font-display`}>{inv.patientSnapshot.name}</td>
                      <td className={td}>{inv.patientSnapshot.mrno}</td>
                      <td className={tdNum}>{formatINR(inv.totalPaise)}</td>
                      <td className={td}>{inv.paymentMode}</td>
                      <td className={td}>
                        <Pill tone={status === 'paid' ? 'green' : 'amber'}>
                          {status === 'paid'
                            ? 'Paid'
                            : isPartial
                              ? 'Partially paid'
                              : 'Outstanding'}
                        </Pill>
                        {isPartial && (
                          <div className="mt-1 text-xs text-[var(--muted)]">
                            {formatINR(paidPaise)} of {formatINR(inv.totalPaise)} ·{' '}
                            {formatINR(remainingPaise)} due
                          </div>
                        )}
                        {status === 'outstanding' && (
                          <button
                            type="button"
                            className="ml-2 text-xs text-[var(--teal)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => setTakingPayment(inv)}
                            disabled={busy}
                          >
                            Record payment
                          </button>
                        )}
                        {status === 'outstanding' && (
                          <button
                            type="button"
                            className="ml-2 text-xs text-[var(--teal)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => void remindToPay(inv, remainingPaise)}
                          >
                            Send WhatsApp reminder
                          </button>
                        )}
                        <button
                          type="button"
                          className="ml-2 text-xs text-[var(--teal)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => void toggleInvoiceStatus(inv.id, status)}
                          disabled={busy}
                        >
                          Mark {status === 'paid' ? 'outstanding' : 'paid'}
                        </button>
                      </td>
                      <td className={`${td} text-right`}>
                        <Link
                          to="/invoices/$invoiceId/print"
                          params={{ invoiceId: inv.id }}
                          search={{ from: '/ledger', tab: 'invoices' }}
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
          {error && <ErrorNote message={error} />}
          <p className="text-xs text-[var(--muted)]">
            Issued invoices are immutable; numbering is sequential per fiscal year and gap-free.
            Payment status is tracked separately and doesn't affect the invoice itself.
          </p>
        </div>
      </SectionCard>
      {takingPayment && (
        <TakePaymentDialog
          clinicId={clinic.id}
          visitId={sampleVisitIdByInvoiceId.get(takingPayment.id) ?? ''}
          invoiceId={takingPayment.id}
          amountPaise={takingPayment.totalPaise}
          visitDate={new Date().toISOString().slice(0, 10)}
          patientLabel={takingPayment.patientSnapshot.name}
          mrno={takingPayment.patientSnapshot.mrno}
          onClose={() => setTakingPayment(null)}
        />
      )}
      {invoicingNeedsReceipt && (
        <IssueInvoiceDialog
          clinicId={clinic.id}
          target={invoicingNeedsReceipt}
          onClose={() => setInvoicingNeedsReceipt(null)}
          returnTo="/ledger"
        />
      )}
    </div>
  );
}
