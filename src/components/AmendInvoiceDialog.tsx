import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Invoice, PaymentMode } from '@/domain/types';
import { repos, invoiceService } from '@/services';
import { formatINR } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import { toFriendlyMessage } from '@/lib/errors';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';
import type { InvoicePrintBackTarget } from '@/app/router';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];

/**
 * Reissues a corrected bill-cum-receipt for an already-issued invoice (e.g.
 * a TPA asks for added visit dates). The original invoice is never edited —
 * a new invoice is issued that supersedes it, carrying forward the
 * original's own visits plus whichever additional uninvoiced visits for the
 * same patient are picked here.
 */
export function AmendInvoiceDialog({
  clinicId,
  invoice,
  onClose,
  returnTo,
}: {
  clinicId: string;
  invoice: Invoice;
  onClose: () => void;
  returnTo: InvoicePrintBackTarget;
}) {
  const allVisits = useLiveQuery(() => repos.visits.list({ clinicId }), [clinicId]);
  const catalog = useLiveQuery(() => repos.catalog.list(clinicId, true), [clinicId]);
  const catalogName = new Map((catalog ?? []).map((c) => [c.id, c.name]));

  const originalVisits = (allVisits ?? []).filter((v) => v.invoiceId === invoice.id);
  const patientId = originalVisits[0]?.patientId;
  const addableVisits = (allVisits ?? []).filter(
    (v) => v.patientId === patientId && !v.invoiceId && !v.deleted
  );

  const [selectedExtra, setSelectedExtra] = useState<Set<string>>(new Set());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(invoice.paymentMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amended, setAmended] = useState<{ invoiceId: string; invoiceNo: string } | null>(null);

  function toggle(visitId: string) {
    setSelectedExtra((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) next.delete(visitId);
      else next.add(visitId);
      return next;
    });
  }

  async function amend() {
    setBusy(true);
    setError(null);
    try {
      if (!invoice) {
        setError('Invoice data unavailable');
        setBusy(false);
        return;
      }
      const visitIds = [...originalVisits.map((v) => v.id), ...selectedExtra];
      const newInvoice = await invoiceService.amendInvoice(invoice.id, visitIds, paymentMode);
      setAmended({ invoiceId: newInvoice.id, invoiceNo: newInvoice.invoiceNo });
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
        aria-labelledby="amend-invoice-title"
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-[var(--surface)] p-4 sm:p-5"
      >
        {amended ? (
          <>
            <h2 id="amend-invoice-title" className="text-sm font-semibold text-[var(--ink)]">
              Amendment issued
            </h2>
            <p className="text-sm text-[var(--ink)]">
              Invoice {amended.invoiceNo} issued, superseding {invoice.invoiceNo}.
            </p>
            <div className="flex justify-end gap-2">
              <Link
                to="/invoices/$invoiceId/print"
                params={{ invoiceId: amended.invoiceId }}
                search={{ from: returnTo }}
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
            <h2 id="amend-invoice-title" className="text-sm font-semibold text-[var(--ink)]">
              Amend invoice {invoice.invoiceNo}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Issues a new invoice that supersedes this one — {invoice.invoiceNo} stays on record
              unchanged. Pick any additional visits to add (e.g. missing dates a TPA flagged).
            </p>

            <div>
              <p className="mb-1 text-xs font-medium text-[var(--muted)]">
                Carried over from {invoice.invoiceNo}
              </p>
              <ul className="space-y-1 text-sm text-[var(--ink)]">
                {originalVisits.map((v) => (
                  <li key={v.id} className="flex justify-between">
                    <span>
                      {formatDateDM(v.visitDate)} — {catalogName.get(v.serviceCatalogId) ?? 'Service'}
                    </span>
                    <span className="font-num">{formatINR(v.actualBillPaise)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {addableVisits.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">
                  Add uninvoiced visits for this patient
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {addableVisits.map((v) => (
                    <li key={v.id}>
                      <label className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedExtra.has(v.id)}
                            onChange={() => toggle(v.id)}
                          />
                          {formatDateDM(v.visitDate)} — {catalogName.get(v.serviceCatalogId) ?? 'Service'}
                        </span>
                        <span className="font-num text-[var(--muted)]">
                          {formatINR(v.actualBillPaise)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

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

            <ErrorNote message={error} />
            <p className="text-xs text-[var(--muted)]">
              The amendment gets its own invoice number and needs a connection — it cannot be
              undone once issued.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || originalVisits.length === 0}
                onClick={() => void amend()}
              >
                {busy ? 'Issuing…' : 'Issue amendment'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
