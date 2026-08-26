import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PaymentMethod } from '@/domain/types';
import { formatINR, paiseToRupees, rupeesToPaise } from '@/domain/money';
import type { Paise } from '@/domain/money';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { directPaymentService, paymentService, repos } from '@/services';
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
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function save() {
    if (!amountValid) {
      setError('Enter a valid amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (invoiceId && invoice) {
        await paymentService.recordInvoicePayment(
          clinicId,
          invoice,
          parsedAmountPaise,
          method,
          visitDate,
          null
        );
      } else {
        await directPaymentService.logPayment(
          clinicId,
          visitId,
          parsedAmountPaise,
          method,
          visitDate,
          null
        );
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment');
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
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Method</span>
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
            disabled={busy || !amountValid}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
