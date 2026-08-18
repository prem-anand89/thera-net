import { useState } from 'react';
import type { PaymentMethod } from '@/domain/types';
import { formatINR } from '@/domain/money';
import type { Paise } from '@/domain/money';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { directPaymentService, paymentService } from '@/services';

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
  onClose,
}: {
  clinicId: string;
  visitId: string;
  invoiceId: string | null;
  amountPaise: Paise;
  visitDate: string;
  patientLabel: string;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (invoiceId) {
        await paymentService.setStatus(invoiceId, clinicId, 'paid');
      } else {
        await directPaymentService.logPayment(clinicId, visitId, amountPaise, method, visitDate, null);
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
      <div role="dialog" aria-modal="true" className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Take payment</h2>
        <p className="text-sm text-[var(--muted)]">
          {patientLabel} · {formatINR(amountPaise)}
        </p>
        {!invoiceId && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Method</span>
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {invoiceId && (
          <p className="text-xs text-[var(--muted)]">Marks this invoice collected. No extra receipt is created.</p>
        )}
        {error && <p className="text-sm text-[var(--rust)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
