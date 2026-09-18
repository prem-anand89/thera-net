import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PaymentMethod } from '@/domain/types';
import { formatINR, paiseToRupees, rupeesToPaise } from '@/domain/money';
import type { Paise } from '@/domain/money';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { advanceService, directPaymentService, paymentService, repos } from '@/services';
import { ShowUpiQrButton } from '@/components/UpiQrModal';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

export function TakePaymentDialog({
  clinicId,
  visitId,
  invoiceId,
  amountPaise,
  visitDate,
  patientLabel,
  mrno,
  patientId,
  onClose,
}: {
  clinicId: string;
  visitId: string;
  invoiceId: string | null;
  /** The visit's full bill — the ceiling the amount field defaults to for
   *  the direct-payment (no-invoice) path. Ignored once an invoice is
   *  loaded below, in favor of the invoice's own total (which may cover
   *  more than just this one visit, for a package billed together). */
  amountPaise: Paise;
  visitDate: string;
  patientLabel: string;
  mrno: string;
  /** Optional — when given, offers "apply advance" if the patient has an
   *  open balance (Billing & Notes Rebuild Phase 1, 1.6). Omitted call
   *  sites just don't get the nudge, same as before this existed. */
  patientId?: string;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Splitting one collection across methods (e.g. part cash, part UPI) was
  // already possible by reopening this dialog once per method — each call
  // below is its own independent payments-table write. This just lets staff
  // do it in one sitting instead of three separate round trips.
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<{ method: PaymentMethod; amountRupees: string }[]>([
    { method: 'cash', amountRupees: '' },
    { method: 'upi', amountRupees: '' },
  ]);
  const openAdvances = useLiveQuery(
    () => (patientId ? advanceService.openAdvancesWithBalance(clinicId, patientId) : undefined),
    [clinicId, patientId]
  );
  const advanceBalancePaise = (openAdvances ?? []).reduce((sum, a) => sum + a.remainingPaise, 0);

  const invoice = useLiveQuery(
    () => (invoiceId ? repos.invoices.get(invoiceId) : undefined),
    [invoiceId]
  );
  const invoiceBalance = useLiveQuery(
    () => (invoiceId && invoice ? paymentService.invoiceBalance(clinicId, invoice) : undefined),
    [invoiceId, invoice, clinicId]
  );
  // Direct-payment path: how much has already been collected for this visit
  // across any prior (partial) payments, so the amount field defaults to
  // what's actually still owed instead of the full bill every time —
  // without this, a second partial payment would default right back to the
  // whole bill amount rather than the true remainder.
  const directAlreadyPaidPaise = useLiveQuery(
    () =>
      invoiceId
        ? undefined
        : repos.payments
            .listByVisit(visitId)
            .then((ps) => ps.reduce((sum, p) => sum + p.amountPaise, 0)),
    [invoiceId, visitId]
  );

  const ceilingPaise = invoiceId ? (invoice?.totalPaise ?? amountPaise) : amountPaise;
  const alreadyPaidPaise = invoiceId ? invoiceBalance?.paidPaise : directAlreadyPaidPaise;
  const stillResolving = invoiceId
    ? invoice === undefined || invoiceBalance === undefined
    : alreadyPaidPaise === undefined;
  const remainingDuePaise = Math.max(0, ceilingPaise - (alreadyPaidPaise ?? 0));

  // null = "not yet touched by the user" — the field shows blank while the
  // balance is still resolving and only then fills in the real remaining
  // balance, rather than flashing the full bill first and snapping to the
  // correct figure a moment later.
  const [amountRupeesDraft, setAmountRupeesDraft] = useState<string | null>(null);
  const amountRupees =
    amountRupeesDraft ?? (stillResolving ? '' : String(paiseToRupees(remainingDuePaise)));
  const parsedAmountPaise = rupeesToPaise(Number(amountRupees));
  const amountValid =
    amountRupees.trim() !== '' && Number.isFinite(parsedAmountPaise) && parsedAmountPaise > 0;

  const splitAmountsPaise = splits.map((s) => rupeesToPaise(Number(s.amountRupees || '0')));
  const splitTotalPaise = splitAmountsPaise.reduce((sum, p) => sum + p, 0);
  const splitRowsValid = splits.every(
    (s, i) => s.amountRupees.trim() !== '' && Number.isFinite(splitAmountsPaise[i]) && splitAmountsPaise[i] > 0
  );
  const splitMatchesTotal = amountValid && splitTotalPaise === parsedAmountPaise;
  const splitValid = splitRowsValid && splitMatchesTotal;

  function updateSplit(index: number, patch: Partial<{ method: PaymentMethod; amountRupees: string }>) {
    setSplits((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function recordOne(amount: Paise, forMethod: PaymentMethod) {
    if (invoiceId && invoice) {
      await paymentService.recordInvoicePayment(clinicId, invoice, amount, forMethod, visitDate, null);
    } else {
      await directPaymentService.logPayment(clinicId, visitId, amount, forMethod, visitDate, null);
    }
  }

  async function save() {
    if (!amountValid) {
      setError('Enter a valid amount.');
      return;
    }
    if (splitMode && !splitValid) {
      setError(
        splitRowsValid
          ? `Split amounts must add up to ${formatINR(parsedAmountPaise)}.`
          : 'Enter a valid amount for each method.'
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (splitMode) {
        // Sequential, not Promise.all — recordInvoicePayment re-reads the
        // invoice's paid-so-far total from scratch each call, so the next
        // slice needs the previous one's write to have already landed.
        for (const s of splits) {
          await recordOne(rupeesToPaise(Number(s.amountRupees)), s.method);
        }
      } else {
        await recordOne(parsedAmountPaise, method);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment');
    } finally {
      setBusy(false);
    }
  }

  async function applyAdvance() {
    if (!openAdvances || openAdvances.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const visits = invoiceId
        ? (await repos.visits.list({ clinicId })).filter(
            (v) => v.invoiceId === invoiceId && !v.deleted
          )
        : await repos.visits.get(visitId).then((v) => (v ? [v] : []));
      if (visits.length === 0) throw new Error('Visit not found');

      // Oldest advance first (FIFO), each capped at what's actually owed.
      const ordered = [...openAdvances].sort((a, b) =>
        a.advance.receivedDate.localeCompare(b.advance.receivedDate)
      );
      let toApply = Math.min(remainingDuePaise, advanceBalancePaise);
      for (const { advance, remainingPaise } of ordered) {
        if (toApply <= 0) break;
        const slice = Math.min(remainingPaise, toApply);
        await advanceService.applyAdvance(clinicId, advance, visits, slice, visitDate);
        toApply -= slice;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the advance');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-5"
      >
        <h2 className="text-sm font-semibold text-[var(--ink)]">Take payment</h2>
        <p className="text-sm text-[var(--muted)]">
          {patientLabel} · {formatINR(ceilingPaise)} billed
          {alreadyPaidPaise ? ` · ${formatINR(alreadyPaidPaise)} already collected` : ''}
        </p>
        {advanceBalancePaise > 0 && remainingDuePaise > 0 && (
          <div className="flex items-center justify-between rounded-md bg-[var(--teal-light)] px-3 py-2 text-xs text-[var(--teal-strong)]">
            <span>{formatINR(advanceBalancePaise)} advance available</span>
            <button
              type="button"
              className="font-medium underline disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => void applyAdvance()}
            >
              Apply
            </button>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Amount received
          </span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={inputCls}
            value={amountRupees}
            onChange={(e) => setAmountRupeesDraft(e.target.value)}
          />
        </label>
        {splitMode ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Split by method</span>
              <button
                type="button"
                className="text-xs font-medium text-[var(--teal)] hover:underline"
                onClick={() => setSplitMode(false)}
              >
                Use one method
              </button>
            </div>
            {splits.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Amount"
                  className={`${inputCls} w-28`}
                  value={s.amountRupees}
                  onChange={(e) => updateSplit(i, { amountRupees: e.target.value })}
                />
                <select
                  className={inputCls}
                  value={s.method}
                  onChange={(e) => updateSplit(i, { method: e.target.value as PaymentMethod })}
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {splits.length > 2 && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-[var(--rust)] hover:underline"
                    onClick={() => setSplits((rows) => rows.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="text-xs font-medium text-[var(--teal)] hover:underline"
              onClick={() => setSplits((rows) => [...rows, { method: 'cash', amountRupees: '' }])}
            >
              + Add another method
            </button>
            {amountValid && (
              <p className={`text-xs ${splitMatchesTotal ? 'text-[var(--muted)]' : 'text-[var(--rust)]'}`}>
                {formatINR(splitTotalPaise)} allocated of {formatINR(parsedAmountPaise)}
                {!splitMatchesTotal &&
                  (splitTotalPaise < parsedAmountPaise
                    ? ` — ${formatINR(parsedAmountPaise - splitTotalPaise)} left to allocate`
                    : ` — ${formatINR(splitTotalPaise - parsedAmountPaise)} over`)}
              </p>
            )}
          </div>
        ) : (
          <>
            <label className="block">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--muted)]">Method</span>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--teal)] hover:underline"
                  onClick={() => setSplitMode(true)}
                >
                  Split across methods
                </button>
              </div>
              <select
                className={inputCls}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {method === 'upi' && (
              <ShowUpiQrButton
                amountPaise={parsedAmountPaise}
                mrno={mrno}
                visitDate={visitDate}
                patientName={patientLabel}
              />
            )}
          </>
        )}
        {invoiceId && remainingDuePaise > 0 && parsedAmountPaise < remainingDuePaise && (
          <p className="text-xs text-[var(--muted)]">
            Less than the full balance — the invoice stays outstanding until the rest is collected.
          </p>
        )}
        {error && <p className="text-sm text-[var(--rust)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || !amountValid || (splitMode && !splitValid)}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
