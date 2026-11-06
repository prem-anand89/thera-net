import { formatDateDMY } from '@/domain/fiscalYear';
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

export interface BillTotalsLedger {
  rows: { date: string; mode: string; amountPaise: number }[];
  paidPaise: number;
  balancePaise: number;
}

/**
 * Everything under the service table: subtotal and adjustment, Total, then Payment details sitting against Amount paid
 * and Balance due. Figures line up with the table's Amount column (`pr-3`, the same right inset).
 */
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
  ledger?: BillTotalsLedger;
  compact?: boolean;
}) {
  const body = compact ? 'text-[10.5px]' : 'text-[11.5px]';
  const fine = compact ? 'text-[9.5px]' : 'text-[10.5px]';
  return (
    <div className="print:break-inside-avoid" data-pdf-block>
      <div className={`ml-auto mt-1.5 w-[46%] font-num ${body}`}>
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
          className={`mt-0.5 flex justify-between gap-2 bg-[var(--doc-fill-strong)] px-3 py-1.5 font-bold text-[var(--doc-head)] ${compact ? 'text-[13px]' : 'text-[15px]'}`}
        >
          <span>Total</span>
          <span>{formatAmount(totalPaise)}</span>
        </div>
      </div>
      {ledger && (
        <div className="grid grid-cols-[minmax(0,1fr)_46%] border-y border-t-[var(--doc-rule)] border-b-[var(--border)]">
          <div className="border-r border-[var(--border)] px-3 py-1.5">
            {ledger.rows.length > 0 ? (
              <>
                <p className="mb-0.5 text-[10px] font-semibold text-[var(--doc-head)]">Payment details</p>
                <table className={`w-full border-collapse text-left ${fine}`}>
                  <thead>
                    <tr className="text-[var(--muted)]">
                      <th className="py-px font-medium">Date</th>
                      <th className="py-px font-medium">Mode</th>
                      <th className="py-px text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.rows.map((row, i) => (
                      <tr key={i} className="text-[var(--ink)]">
                        <td className="py-px">{formatDateDMY(row.date)}</td>
                        <td className="py-px">{row.mode}</td>
                        <td className="font-num whitespace-nowrap py-px text-right">{formatAmount(row.amountPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className={`text-[var(--muted)] ${fine}`}>No payment recorded yet</p>
            )}
          </div>
          <div className={`px-3 py-1.5 font-num ${body}`}>
            <div className="flex justify-between gap-2 py-0.5 font-medium text-[var(--ink)]">
              <span>Amount Paid</span>
              <span>{formatAmount(ledger.paidPaise)}</span>
            </div>
            <div
              className={`flex justify-between gap-2 py-0.5 font-bold ${ledger.balancePaise > 0 ? 'text-[var(--doc-due)]' : 'text-[var(--ink)]'}`}
            >
              <span>Balance Due</span>
              <span>{formatAmount(ledger.balancePaise)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Left side is caller-supplied (invoice number/therapist vs. receipt
 *  number/advance note) — only the signature block itself is identical. */
export function PrintSignatureFooter({
  left,
  signatureUrl,
}: {
  left: React.ReactNode;
  signatureUrl: string | null;
}) {
  return (
    <footer className="mt-6 flex items-end justify-between gap-5 border-t border-[var(--border)] pt-3 text-[10px] text-[var(--muted)]">
      <div className="min-w-0">{left}</div>
      <div className="shrink-0 text-center">
        {signatureUrl ? (
          <img src={signatureUrl} alt="" className="mb-1 h-10 w-40 object-contain object-bottom" />
        ) : (
          <div className="mb-1 h-10 w-40 border-b border-[var(--border)]" />
        )}
        <p>Authorised signature</p>
      </div>
    </footer>
  );
}
