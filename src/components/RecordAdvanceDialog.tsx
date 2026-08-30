import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { PatientProfileBackTarget } from '@/app/router';
import type { PaymentMethod } from '@/domain/types';
import { paiseToRupees, rupeesToPaise } from '@/domain/money';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { advanceService } from '@/services';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

/** Record money received ahead of treatment (Billing & Notes Rebuild Phase
 *  1, 1.6) — not tied to a visit, so this is its own small dialog rather
 *  than a variant of TakePaymentDialog. */
export function RecordAdvanceDialog({
  clinicId,
  patientId,
  patientLabel,
  backTo,
  onClose,
}: {
  clinicId: string;
  patientId: string;
  patientLabel: string;
  backTo?: PatientProfileBackTarget;
  onClose: () => void;
}) {
  const [amountRupees, setAmountRupees] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ advanceId: string } | null>(null);

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
      const advance = await advanceService.recordAdvance(
        clinicId,
        patientId,
        parsedAmountPaise,
        method,
        receivedDate,
        notes.trim() || null
      );
      setRecorded({ advanceId: advance.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the advance');
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
        {recorded ? (
          <>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Advance recorded</h2>
            <p className="text-sm text-[var(--ink)]">
              {paiseToRupees(parsedAmountPaise).toLocaleString('en-IN')} rupees recorded for{' '}
              {patientLabel}. It's available to apply against a future bill.
            </p>
            <div className="flex justify-end gap-2">
              <Link
                to="/patients/$patientId/advances/$advanceId/print"
                params={{ patientId, advanceId: recorded.advanceId }}
                search={backTo ? { from: backTo } : undefined}
                className={btnSecondary}
              >
                Print receipt
              </Link>
              <button type="button" className={btnPrimary} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Record advance</h2>
            <p className="text-sm text-[var(--muted)]">
              {patientLabel} — money received ahead of treatment, adjustable against future bills.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Amount</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={inputCls}
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
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
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Date received
              </span>
              <input
                type="date"
                className={inputCls}
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                Notes (optional)
              </span>
              <input
                className={inputCls}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
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
          </>
        )}
      </div>
    </div>
  );
}
