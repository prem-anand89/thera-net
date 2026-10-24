import { useCallback, useMemo, useState } from 'react';
import { canMarkOutstanding, invoiceRowStatus } from '@/domain/invoiceStatus';
import { toLocalDateStr } from '@/domain/schedule';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, paymentService, dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDM, currentWeekRange } from '@/domain/fiscalYear';
import { type Invoice } from '@/domain/types';

const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

import { DatePresetBar, type DatePreset } from '@/components/DatePresetBar';
import { buildUpiPayUri, clinicCanShowUpiQr, clinicUpiPayeeName } from '@/domain/upiPay';
import { th, thNum, td, tdNum, btnPrimary, ErrorNote, Pill, SectionCard } from '@/components/ui';
import { Pager, usePagination } from '@/components/Pager';
import { EmptyState } from '@/components/EmptyState';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { toFriendlyMessage } from '@/lib/errors';
import { openPatientWhatsAppChat } from '@/lib/pdfShare';
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
  // No status row reads as paid, as everywhere else (see invoiceRowStatus).
  // Treating it as outstanding here alone showed "Outstanding" with Take
  // payment, and paying would record the cash twice.
  const invoiceStatus = useCallback(
    (invoiceId: string) => invoiceRowStatus(statusByInvoiceId.get(invoiceId)),
    [statusByInvoiceId]
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
    const phone = (patientId ? (phoneByPatientId.get(patientId) ?? null) : null) || inv.patientSnapshot?.phone || null;
    
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

    openPatientWhatsAppChat(text, phone);
  }

  function balanceFor(inv: Invoice): { paidPaise: number; remainingPaise: number } {
    const status = invoiceStatus(inv.id);
    if (status === 'paid') return { paidPaise: inv.totalPaise, remainingPaise: 0 };
    if (status === 'void') return { paidPaise: 0, remainingPaise: 0 };
    const paidPaise = paidByInvoiceId.get(inv.id) ?? 0;
    return { paidPaise, remainingPaise: Math.max(0, inv.totalPaise - paidPaise) };
  }

  const filteredInvoices = useMemo(() => {
    let filtered = invoices ?? [];
    if (from) filtered = filtered.filter((i) => i.issuedAt.slice(0, 10) >= from);
    if (to) filtered = filtered.filter((i) => i.issuedAt.slice(0, 10) <= to);
    return filtered;
  }, [invoices, from, to]);

  const sortedInvoices = useMemo(
    () => applySort(filteredInvoices, INVOICE_COMPARATORS, sort),
    [filteredInvoices, sort]
  );

  const invPager = usePagination(sortedInvoices, `${from}|${to}|${sort.key}|${sort.dir}`, 'invoices');
  const needsReceiptPager = usePagination(needsReceipt ?? [], 'needs-receipt', 'invoices-needs-receipt', 10);

  const supersededInvoiceIds = useMemo(
    () =>
      new Set(
        (invoices ?? [])
          .map((i) => i.supersedesInvoiceId)
          .filter((id): id is string => Boolean(id))
      ),
    [invoices]
  );

  const { totalOutstanding, totalCollected, totalInvoiced, unbilledTotal } = useMemo(() => {
    let outstanding = 0;
    let collected = 0;
    let invoiced = 0;
    for (const inv of filteredInvoices) {
      const status = invoiceStatus(inv.id);
      // A voided or superseded invoice keeps its number but doesn't contribute to active totals.
      if (status === 'void' || supersededInvoiceIds.has(inv.id)) continue;
      invoiced += inv.totalPaise;
      if (status === 'paid') {
        collected += inv.totalPaise;
      } else {
        const paidPaise = paidByInvoiceId.get(inv.id) ?? 0;
        collected += paidPaise;
        outstanding += Math.max(0, inv.totalPaise - paidPaise);
      }
    }

    let unbilled = 0;
    for (const v of visits ?? []) {
      if (v.deleted || v.invoiceId) continue;
      if (from && v.visitDate < from) continue;
      if (to && v.visitDate > to) continue;
      
      const paid = directPaymentByVisitId.get(v.id) ?? 0;
      if (v.actualBillPaise > paid) {
        unbilled += (v.actualBillPaise - paid);
      }
    }

    return { totalOutstanding: outstanding, totalCollected: collected, totalInvoiced: invoiced, unbilledTotal: unbilled };
  }, [filteredInvoices, invoiceStatus, paidByInvoiceId, visits, from, to, directPaymentByVisitId, supersededInvoiceIds]);

  // Undo for an invoice flagged paid with no payment behind it. Paying is
  // Take payment, which logs the cash.
  async function markOutstanding(invoiceId: string) {
    setError(null);
    setBusy(true);
    try {
      await paymentService.setStatus(invoiceId, clinic.id, 'outstanding');
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const noneIssued = (invoices?.length ?? 0) === 0;
  const invoicesEmpty = noneIssued ? (
    <EmptyState title="No invoices issued yet" hint="Issue one from a visit in the Visits tab." />
  ) : (
    <EmptyState
      title="No invoices in this date range"
      hint="Invoices exist outside the dates selected."
      actions={[
        ...(datePreset !== 'lastMonth' ? [{ label: 'Show last month', onClick: () => applyDatePreset('lastMonth') }] : []),
        { label: 'Show all time', onClick: () => applyDatePreset('all') },
      ]}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <DatePresetBar value={datePreset} onChange={applyDatePreset} />
          {datePreset === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <input
                type="date"
                aria-label="From date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
              />
              <span className="font-medium text-[var(--muted)]">–</span>
              <input
                type="date"
                aria-label="To date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--ink)] transition-colors hover:border-[var(--muted)] focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-48 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Invoice Collections</div>
          <div className="text-2xl font-display font-semibold text-[var(--ink)]">
            {formatINR(totalCollected)}
          </div>
        </div>
        <div className="flex-1 min-w-48 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Outstanding Invoices</div>
          <div className="text-2xl font-display font-semibold text-[var(--rust)]">
            {formatINR(totalOutstanding)}
          </div>
        </div>
        <div className="flex-1 min-w-48 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Total Invoiced</div>
          <div className="text-2xl font-display font-semibold text-[var(--ink)]">
            {formatINR(totalInvoiced)}
          </div>
        </div>
        <div className="flex-1 min-w-48 rounded-xl border border-[var(--teal-light)] bg-[var(--teal-light)] p-4">
          <div className="text-xs text-[var(--teal-strong)] mb-1">Unbilled Visits</div>
          <div className="text-2xl font-display font-semibold text-[var(--teal-strong)]">
            {formatINR(unbilledTotal)}
          </div>
        </div>
      </div>

      {needsReceipt && needsReceipt.length > 0 && clinic.invoicePolicy !== 'never_nag' && (
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
              {needsReceiptPager.visible.map((row) => (
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
                    Give bill
                  </button>
                </div>
              ))}
            </div>

            <div className="hidden tab:block overflow-x-auto">
              <table className="w-full min-w-[700px] table-fixed text-sm">
                <colgroup>
                  <col className="w-24" />
                  <col className="w-56" />
                  <col className="w-48" />
                  <col className="w-32" />
                  <col className="w-28" />
                </colgroup>
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
                  {needsReceiptPager.visible.map((row) => (
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
                          Give bill
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager list={needsReceiptPager} noun="visits" />
          </div>
        </SectionCard>
      )}

      <SectionCard title="Invoices">
        <div className="space-y-4">
          {/* Below tab: — same boxed-card treatment Today's visits, Patients,
              and Packages use, instead of forcing this 8-column table to
              scroll sideways on a phone. */}
          <div className="tab:hidden space-y-2">
            {invPager.visible.map((inv) => {
              const isSuperseded = supersededInvoiceIds.has(inv.id);
              const status = invoiceStatus(inv.id);
              const { paidPaise, remainingPaise } = balanceFor(inv);
              const isPartial = !isSuperseded && status === 'outstanding' && paidPaise > 0;
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
                      <Pill tone={isSuperseded ? 'slate' : status === 'paid' ? 'green' : status === 'void' ? 'slate' : 'amber'}>
                        {isSuperseded ? 'Superseded' : status === 'paid' ? 'Paid' : status === 'void' ? 'Void' : isPartial ? 'Partially paid' : 'Outstanding'}
                      </Pill>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isSuperseded && status === 'outstanding' && sampleVisitIdByInvoiceId.has(inv.id) && (
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--teal)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={busy}
                          onClick={() => setTakingPayment(inv)}
                        >
                          Take payment
                        </button>
                      )}
                      {!isSuperseded && status === 'outstanding' && !sampleVisitIdByInvoiceId.has(inv.id) && (
                        <span className="text-xs text-[var(--muted)]" title="Open the invoice and use Void invoice to clear it">
                          Visit removed — void to clear
                        </span>
                      )}
                      {!isSuperseded && status === 'outstanding' && (
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--teal)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => void remindToPay(inv, remainingPaise)}
                        >
                          Send WhatsApp reminder
                        </button>
                      )}
                      {/* Paying goes through Take payment (amount + method, so the
                          cash reaches the Daybook). Only an invoice flagged paid with
                          no payment behind it can be flipped back. */}
                      {canMarkOutstanding(status, paidByInvoiceId.get(inv.id) ?? 0) && (
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--teal)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void markOutstanding(inv.id)}
                        >
                          Mark outstanding
                        </button>
                      )}
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
            {sortedInvoices.length === 0 && invoicesEmpty}
          </div>

          <div className="hidden tab:block overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed text-sm">
              <colgroup>
                <col className="w-32" />
                <col className="w-24" />
                <col className="w-40" />
                <col className="w-24" />
                <col className="w-28" />
                <col className="w-24" />
                <col className="w-36" />
                <col className="w-52" />
              </colgroup>
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
                {invPager.visible.map((inv) => {
                  const isSuperseded = supersededInvoiceIds.has(inv.id);
                  const status = invoiceStatus(inv.id);
                  const { paidPaise, remainingPaise } = balanceFor(inv);
                  const isPartial = !isSuperseded && status === 'outstanding' && paidPaise > 0;
                  return (
                    <tr key={inv.id} className="hover:bg-[var(--paper)]">
                      <td className={`${td} font-medium`}>{inv.invoiceNo}</td>
                      <td className={td}>{formatDateDM(inv.issuedAt)}</td>
                      <td className={`${td} font-display truncate`} title={inv.patientSnapshot.name}>{inv.patientSnapshot.name}</td>
                      <td className={td}>{inv.patientSnapshot.mrno}</td>
                      <td className={tdNum}>{formatINR(inv.totalPaise)}</td>
                      <td className={td}>{inv.paymentMode}</td>
                      <td className={td}>
                        <Pill tone={isSuperseded ? 'slate' : status === 'paid' ? 'green' : status === 'void' ? 'slate' : 'amber'}>
                          {isSuperseded
                            ? 'Superseded'
                            : status === 'paid'
                              ? 'Paid'
                              : status === 'void'
                                ? 'Void'
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
                        {!isSuperseded && status === 'outstanding' && sampleVisitIdByInvoiceId.has(inv.id) && (
                          <button
                            type="button"
                            className="ml-2 text-xs text-[var(--teal)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => setTakingPayment(inv)}
                            disabled={busy}
                          >
                            Take payment
                          </button>
                        )}
                        {!isSuperseded && status === 'outstanding' && !sampleVisitIdByInvoiceId.has(inv.id) && (
                          <span className="ml-2 text-xs text-[var(--muted)]" title="Open the invoice and use Void invoice to clear it">
                            Visit removed — void to clear
                          </span>
                        )}
                        {!isSuperseded && status === 'outstanding' && (
                          <button
                            type="button"
                            className="ml-2 text-xs text-[var(--teal)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => void remindToPay(inv, remainingPaise)}
                          >
                            Send WhatsApp reminder
                          </button>
                        )}
                        {canMarkOutstanding(status, paidByInvoiceId.get(inv.id) ?? 0) && (
                          <button
                            type="button"
                            className="ml-2 text-xs text-[var(--teal)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => void markOutstanding(inv.id)}
                            disabled={busy}
                          >
                            Mark outstanding
                          </button>
                        )}
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
                {invoices !== undefined && sortedInvoices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-3">
                      {invoicesEmpty}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager list={invPager} noun="invoices" />
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
          visitDate={toLocalDateStr(new Date())}
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
