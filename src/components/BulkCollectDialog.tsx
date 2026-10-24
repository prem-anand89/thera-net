import { useState } from 'react';
import { useDialogBehavior } from '@/components/dialogBehavior';
import type { PaymentMethod } from '@/domain/types';
import { formatINR } from '@/domain/money';
import type { Paise } from '@/domain/money';
import { toLocalDateStr } from '@/domain/schedule';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';
import { directPaymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { defaultPaymentMethod, paymentMethodOptions, readLastPaymentMethod, rememberPaymentMethod } from '@/domain/paymentMethods';
import { toFriendlyMessage } from '@/lib/errors';

export interface BulkCollectRow {
  visitId: string;
  /** What is still owed on this visit. */
  duePaise: Paise;
}

/**
 * Collects the full balance of several visits in one go, as one direct payment
 * per visit (the no-invoice path — a plan without invoicing, or visits not
 * being billed). Visits are paid oldest-first as given; if one fails, the
 * ones before it stay recorded and the message says how many.
 */
export function BulkCollectDialog({
  clinicId,
  patientLabel,
  rows,
  onClose,
}: {
  clinicId: string;
  patientLabel: string;
  rows: BulkCollectRow[];
  onClose: () => void;
}) {
  const clinic = useClinic();
  const methods = paymentMethodOptions(clinic);
  const [method, setMethod] = useState<PaymentMethod>(() => defaultPaymentMethod(clinic, readLastPaymentMethod(clinic.id)));
  const [receivedDate, setReceivedDate] = useState(toLocalDateStr(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogBehavior<HTMLDivElement>(true, onClose, () => !busy);

  const payable = rows.filter((r) => r.duePaise > 0);
  const total = payable.reduce((sum, r) => sum + r.duePaise, 0);

  async function save() {
    setBusy(true);
    setError(null);
    let done = 0;
    try {
      for (const row of payable) {
        await directPaymentService.logPayment(clinicId, row.visitId, row.duePaise, method, receivedDate, null);
        done += 1;
      }
      rememberPaymentMethod(clinic.id, method);
      onClose();
    } catch (e) {
      setError(
        `${done} of ${payable.length} visits recorded. ${toFriendlyMessage(e)}${done > 0 ? ' The recorded ones are saved; select the rest and try again.' : ''}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-collect-title"
        className="w-full max-w-sm space-y-4 rounded-2xl bg-[var(--surface)] p-5"
      >
        <h2 id="bulk-collect-title" className="text-sm font-semibold text-[var(--ink)]">
          Collect {formatINR(total)}
        </h2>
        <p className="text-sm text-[var(--muted)]">
          {patientLabel} — {payable.length} visit{payable.length === 1 ? '' : 's'}, each paid in full.
        </p>
        <Field label="Method">
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {methods.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Received on">
          <input type="date" className={inputCls} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || total <= 0 || !receivedDate} onClick={() => void save()}>
            {busy ? 'Recording…' : `Collect ${formatINR(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
