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
}: {
  clinic: Clinic;
  logoUrl: string | null;
  partnerLogoUrl: string | null;
}) {
  return (
    // flex-wrap so the (non-shrinking) partner-hospital block below drops to
    // its own line on a narrow phone screen instead of colliding with the
    // clinic name/address — there's no room for both side-by-side under
    // roughly tablet width once a logo is involved.
    <header className="flex flex-wrap items-start justify-between gap-y-2 border-b border-[var(--border)] pb-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {logoUrl && <img src={logoUrl} alt="" className="h-14 w-auto shrink-0 object-contain" />}
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-[var(--ink)]">{clinic.name}</h1>
          {clinic.address && (
            // max-w keeps this an actual address block (wraps onto ~2
            // lines) instead of stretching the full width of the header —
            // most addresses are entered as one line (the Clinic Profile
            // textarea's own two-line placeholder is just a suggestion,
            // not enforced), so wrapping can't rely on an admin having
            // typed a real line break.
            <p className="max-w-[220px] whitespace-pre-line break-words text-xs text-[var(--muted)]">
              {clinic.address}
            </p>
          )}
          <p className="text-xs text-[var(--muted)]">
            {[clinic.phone, clinic.email].filter(Boolean).join(' · ')}
          </p>
          {clinic.gstNo && <p className="text-xs text-[var(--muted)]">GSTIN: {clinic.gstNo}</p>}
        </div>
      </div>
      {clinic.partnerHospitalName && (
        <div className="flex shrink-0 items-center gap-2 text-right">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              In partnership with
            </p>
            <p className="text-sm font-medium text-[var(--ink)]">{clinic.partnerHospitalName}</p>
          </div>
          {partnerLogoUrl && (
            <img src={partnerLogoUrl} alt="" className="h-10 w-auto object-contain" />
          )}
        </div>
      )}
    </header>
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
    <footer className="mt-12 flex items-end justify-between border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
      <div>{left}</div>
      <div className="text-center">
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
