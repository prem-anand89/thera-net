import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { PaymentMode } from '@/domain/types';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';
import { invoiceService, paymentService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];

export interface IssueInvoiceTarget {
  visitId: string;
  patientLabel: string;
  serviceLabel: string;
  isPackage: boolean;
}

export function IssueInvoiceDialog({
  clinicId,
  target,
  onClose,
}: {
  clinicId: string;
  target: IssueInvoiceTarget;
  onClose: () => void;
}) {
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [collectedNow, setCollectedNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ invoiceId: string; invoiceNo: string } | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const invoice = await invoiceService.issueForVisit(target.visitId, paymentMode);
      try {
        await paymentService.setStatus(invoice.id, clinicId, collectedNow ? 'paid' : 'outstanding');
      } catch (statusError) {
        console.error('Could not record payment status', statusError);
      }
      setIssued({ invoiceId: invoice.id, invoiceNo: invoice.invoiceNo });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl bg-[var(--surface)] p-4 sm:p-5">
        {issued ? (
          <>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Invoice issued</h2>
            <p className="text-sm text-[var(--ink)]">
              Invoice {issued.invoiceNo} issued for {target.patientLabel}.
            </p>
            <div className="flex justify-end gap-2">
              <Link
                to="/invoices/$invoiceId/print"
                params={{ invoiceId: issued.invoiceId }}
                className={btnSecondary}
              >
                Print
              </Link>
              <button type="button" className={btnPrimary} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Issue invoice</h2>
            <p className="text-sm text-[var(--muted)]">
              {target.patientLabel} — {target.serviceLabel}
              {target.isPackage && ', all sessions of this package'}
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
                <input type="radio" checked={collectedNow} onChange={() => setCollectedNow(true)} />
                Collected now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={!collectedNow} onChange={() => setCollectedNow(false)} />
                Not collected — pay later
              </label>
            </div>
            <ErrorNote message={error} />
            <p className="text-xs text-[var(--muted)]">
              The invoice number is issued by the server and the bill becomes immutable — this
              needs a connection and cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void issue()}>
                {busy ? 'Issuing…' : 'Issue invoice'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
