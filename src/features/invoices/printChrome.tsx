import { formatDateDMY } from '@/domain/fiscalYear';
import type { InvoiceLedger } from '@/domain/invoicePaymentLedger';
import { useState } from 'react';
import { formatAmount } from '@/domain/money';
import type { Clinic } from '@/domain/types';

/**
 * Letterhead + signature footer shared between `InvoicePrintPage.tsx` and
 * `AdvanceReceiptPrintPage.tsx` (Billing & Notes Rebuild Phase 1, 1.6) —
 * extracted so the two documents can't drift apart the way independently
 * edited copies would, the same reasoning `invoiceLine.ts` already applies
 * to build/print rate math. Everything document-specific (title, line
 * items, totals, footer-left text) stays in each page's own component.
 */
export function PrintLetterhead({
  clinic,
  logoUrl,
  partnerLogoUrl,
  compact = false,
}: {
  clinic: Pick<Clinic, 'name' | 'tagline' | 'address' | 'phone' | 'email' | 'gstNo' | 'hasPartner' | 'partnerHospitalName'>;
  logoUrl: string | null;
  partnerLogoUrl: string | null;
  /** A5: smaller type, and the partner keeps its name but not its logo. */
  compact?: boolean;
}) {
  const small = compact ? 'text-[9.5px]' : 'text-[10.5px]';
  // Turning partner mode off keeps the hospital's name in Settings (so turning it back on needs no retyping), so the
  // name alone doesn't mean there is a partner: only a clinic with partner mode on prints it.
  const partnerName = clinic.hasPartner ? clinic.partnerHospitalName : null;
  return (
    <header className="doc-paper grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b-[1.5px] border-[var(--doc-rule)] pb-3">
      <div className="flex min-w-0 items-center gap-3.5">
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            className={`w-auto shrink-0 object-contain ${compact ? 'h-11 max-w-[88px]' : 'h-14 max-w-[120px]'}`}
          />
        )}
        <div className="min-w-0">
          <h1 className={`font-display font-bold leading-tight text-[var(--doc-name)] ${compact ? 'text-xl' : 'text-[26px]'}`}>
            {clinic.name}
          </h1>
          {clinic.tagline && (
            <p className={`mt-0.5 leading-snug text-[var(--muted)] ${compact ? 'text-[9.5px]' : 'text-[11px]'}`}>{clinic.tagline}</p>
          )}
          {partnerName && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="text-[7.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                In partnership with
              </span>
              {partnerLogoUrl && !compact && (
                <img src={partnerLogoUrl} alt="" className="h-4 w-auto max-w-[48px] object-contain" />
              )}
              <span className={`font-medium text-[var(--ink)] ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
                {partnerName}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className={`${compact ? 'max-w-[170px]' : 'max-w-[240px]'} text-right leading-relaxed text-[var(--muted)] ${small}`}>
        {clinic.address && <p className="whitespace-pre-line break-words">{clinic.address}</p>}
        {clinic.phone && <p>{clinic.phone}</p>}
        {clinic.email && <p className="break-words">{clinic.email}</p>}
        {clinic.gstNo && <p>GSTIN: {clinic.gstNo}</p>}
      </div>
    </header>
  );
}

/**
 * Everything under the service table. Subtotal, adjustment and Total share one right-hand column (`COL`), and Payment
 * details is one table under its own heading: the payments on the left, Amount paid and Balance due on the right in that
 * same column, so Total sits directly above Amount paid. No fill on Total: it is set apart by weight, size and colour alone, no rules, so
 * the page reads the same in colour and on a black-and-white printer. Only the headings carry a very light tint.
 */
const COL = 'w-[42%]';
export function BillTotals({
  subtotalPaise,
  adjustmentPaise,
  totalPaise,
  ledger,
  compact = false,
}: {
  subtotalPaise: number;
  adjustmentPaise: number;
  totalPaise: number;
  /** Undefined while payments are still loading. */
  ledger?: InvoiceLedger;
  compact?: boolean;
}) {
  const body = compact ? 'text-[10.5px]' : 'text-[11.5px]';
  const fine = compact ? 'text-[9.5px]' : 'text-[10.5px]';
  return (
    <div className="print:break-inside-avoid" data-pdf-block>
      <div className={`ml-auto mt-1.5 ${COL} font-num ${body}`}>
        {adjustmentPaise !== 0 && (
          <div className="text-[var(--muted)]">
            <div className="flex justify-between gap-2 px-3 py-0.5">
              <span>Subtotal</span>
              <span>{formatAmount(subtotalPaise)}</span>
            </div>
            <div className="flex justify-between gap-2 px-3 py-0.5">
              <span>Total Adjustment</span>
              <span>{adjustmentPaise < 0 ? `-${formatAmount(Math.abs(adjustmentPaise))}` : formatAmount(adjustmentPaise)}</span>
            </div>
          </div>
        )}
        <div
          className={`mt-1 flex justify-between gap-2 px-3 py-1 font-bold text-[var(--doc-head)] ${compact ? 'text-[13px]' : 'text-[15px]'}`}
        >
          <span>Total</span>
          <span>{formatAmount(totalPaise)}</span>
        </div>
      </div>
      {ledger && (
        <section className={`border border-[var(--border)] ${compact ? 'mt-2.5' : 'mt-4'}`} aria-label="Payment details">
          <h4
            className={`border-b border-[var(--doc-rule)] bg-[var(--doc-fill)] px-3 py-1 font-semibold tracking-wide text-[var(--doc-head)] ${compact ? 'text-[9.5px]' : 'text-[10.5px]'}`}
          >
            Payment details
          </h4>
          <div className="flex">
            <div className="min-w-0 flex-1 border-r border-[var(--border)] px-3 py-1.5">
              {ledger.rows.length > 0 ? (
                <table className={`w-full border-collapse text-left ${fine}`}>
                  <thead>
                    <tr className="text-[var(--muted)]">
                      <th className="w-[22%] py-px font-medium">Date</th>
                      <th className="py-px font-medium">Mode and reference</th>
                      <th className="py-px text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.rows.map((row, i) => (
                      <tr key={i} className="align-top text-[var(--ink)]">
                        <td className="py-px">{formatDateDMY(row.date)}</td>
                        <td className="py-px pr-2">
                          {row.mode}
                          {row.reference && (
                            <div className={`break-words font-mono text-[var(--muted)] ${compact ? 'text-[8.5px]' : 'text-[9.5px]'}`}>
                              {row.reference}
                            </div>
                          )}
                        </td>
                        <td className="font-num whitespace-nowrap py-px text-right">{formatAmount(row.amountPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className={`text-[var(--muted)] ${fine}`}>No payment recorded yet</p>
              )}
            </div>
            <div className={`${COL} shrink-0 px-3 py-1.5 font-num ${body}`}>
              <div className="flex justify-between gap-2 py-0.5 font-medium text-[var(--ink)]">
                <span>Amount Paid</span>
                <span>{formatAmount(ledger.paidPaise)}</span>
              </div>
              {ledger.excessPaise > 0 && (
                <div className="flex justify-between gap-2 py-0.5 text-[var(--muted)]">
                  <span>Excess received</span>
                  <span>{formatAmount(ledger.excessPaise)}</span>
                </div>
              )}
              <div
                className={`mt-0.5 flex justify-between gap-2 border-t border-[var(--border)] pt-1 font-bold ${ledger.balancePaise > 0 ? 'text-[var(--doc-due)]' : 'text-[var(--ink)]'} ${compact ? 'text-[12px]' : 'text-[13px]'}`}
              >
                <span>Balance Due</span>
                <span>{formatAmount(ledger.balancePaise)}</span>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Breathing room between the blocks of a document. It grows to share whatever free height the page has (up to a limit) and
 * shrinks to a sliver when the content is long, so a one-line bill is not crammed at the top and a long one still fits.
 */
export function DocSpacer() {
  return <div aria-hidden="true" className="min-h-1.5 max-h-8 flex-1" />;
}

/** Label / value rows for the top of a document (patient, bill, clinical details), in the app's "Label : value" style. */
export function DocFieldList({
  rows,
  compact = false,
  labelWidth = '34%',
}: {
  rows: { label: string; value: React.ReactNode; strong?: boolean; tone?: 'good' | 'due' | 'muted' }[];
  compact?: boolean;
  labelWidth?: string;
}) {
  return (
    <dl
      className={`m-0 grid content-start gap-y-0.5 ${compact ? 'text-[10px]' : 'text-[11px]'}`}
      style={{ gridTemplateColumns: `${labelWidth} minmax(0, 1fr)` }}
    >
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="font-medium text-[var(--muted)]">{r.label}</dt>
          <dd
            className={`m-0 break-words ${r.strong ? 'font-semibold' : ''} ${
              r.tone === 'good' ? 'font-bold text-[var(--doc-good)]' : r.tone === 'due' ? 'font-bold text-[var(--doc-due)]' : r.tone === 'muted' ? 'font-bold text-[var(--muted)]' : 'text-[var(--ink)]'
            }`}
          >
            : {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Left side is caller-supplied (invoice number/therapist vs. receipt
 *  number/advance note) — only the signature block itself is identical. */
export function PrintSignatureFooter({
  left,
  signatureUrl,
  signerName,
}: {
  left: React.ReactNode;
  signatureUrl: string | null;
  /** Printed under the line, never above it, so it can't be mistaken for a signature. */
  signerName?: string | null;
}) {
  // A signature file that can't be loaded (deleted, or offline) prints as a blank line to sign by hand, not a broken-image icon.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(signatureUrl) && failedUrl !== signatureUrl;
  return (
    <footer className="mt-6 flex items-end justify-between gap-5 border-t border-[var(--border)] pt-3 text-[10px] text-[var(--muted)]">
      <div className="min-w-0">{left}</div>
      <div className="min-w-[170px] shrink-0 text-center">
        <div className="flex h-10 items-end justify-center">
          {showImage && (
            <img
              src={signatureUrl ?? undefined}
              alt=""
              className="max-h-10 w-40 object-contain object-bottom"
              onError={() => setFailedUrl(signatureUrl)}
            />
          )}
        </div>
        <div className="mt-0.5 border-t border-[var(--muted)] pt-0.5">
          <p>Authorised signature</p>
          {signerName && <p className="font-semibold text-[var(--ink)]">{signerName}</p>}
        </div>
      </div>
    </footer>
  );
}
