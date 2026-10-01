import { useState } from 'react';
import type { Invoice } from '@/domain/types';
import { invoiceService } from '@/services';
import { formatINR } from '@/domain/money';
import { toFriendlyMessage } from '@/lib/errors';
import { btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';

/**
 * Voids an issued invoice — for a wrong price, patient or date, which an
 * amendment can't fix (it never changes a billed amount). The invoice keeps
 * its number, marked void; its visits are released to be corrected and
 * billed again. A reason is required and stays on the record.
 */
export function VoidInvoiceDialog({
  invoice,
  receivedPaise,
  onClose,
}: {
  invoice: Invoice;
  /** Money already recorded against this invoice's visits (stays recorded). */
  receivedPaise: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await invoiceService.voidInvoice(invoice.id, reason);
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="void-invoice-title"
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-[var(--surface)] p-4 sm:p-5"
      >
        <h2 id="void-invoice-title" className="text-sm font-semibold text-[var(--ink)]">
          Void invoice {invoice.invoiceNo}?
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--ink)]">
          <li>The invoice stays in the numbered series, marked VOID. It can't be undone.</li>
          <li>Its visit{invoice.lineItems.length > 1 ? 's become' : ' becomes'} editable again, so you can fix the price, patient or date and give a new bill.</li>
          {receivedPaise > 0 && (
            <li>
              The {formatINR(receivedPaise)} already received stays recorded against the visit — nothing is refunded or lost.
            </li>
          )}
        </ul>
        <Field label="Reason (kept on the record)">
          <textarea
            className={inputCls}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Wrong amount entered"
            autoFocus
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Keep invoice
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg bg-[var(--rust)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            disabled={busy || !reason.trim()}
            onClick={() => void confirm()}
          >
            {busy ? 'Voiding…' : 'Void invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
