import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import type { InvoicePrintBackTarget } from '@/app/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import { amountInWords } from '@/domain/amountInWords';
import { formatDateDMY } from '@/domain/fiscalYear';
import {
  invoicePeriod,
  isV2Line,
  lineRatePerSessionPaise,
  lineReconciles,
  normalizeAuthorizedCount,
  sessionCountLabel,
  sessionDatesDisplay,
} from '@/domain/invoiceLine';
import type { InvoiceLineItem, Therapist } from '@/domain/types';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary, inputCls, ErrorNote } from '@/components/ui';
import { AmendInvoiceDialog } from '@/components/AmendInvoiceDialog';
import { EditInvoiceDetailsDialog } from '@/components/EditInvoiceDetailsDialog';
import { renderElementToPdf, shareFileToWhatsApp } from '@/lib/pdfShare';
import { toFriendlyMessage } from '@/lib/errors';
import { PrintLetterhead, PrintSignatureFooter } from './printChrome';

/** Page-specific wording, not a general-purpose helper — the "delivered of
 *  … authorised" framing and the two distinct non-reconciling explanations
 *  only make sense on a printed bill, not in InsurerPacketPage's summary
 *  (which uses plain `sessionCountLabel` instead). */
function lineCaption(li: InvoiceLineItem): string | null {
  if (!isV2Line(li) || lineReconciles(li)) return null;
  const authorized = normalizeAuthorizedCount(li.authorizedSessionCount ?? null);
  const billed = li.billedSessionCount ?? li.sessionCount;
  if (authorized != null && billed < authorized) {
    return `Package of ${authorized} sessions charged in full; ${billed} delivered to date.`;
  }
  // Fully billed/delivered but the rate still doesn't multiply out exactly
  // (rounding) — a real, if rarer, way a line can fail to reconcile.
  return 'Amount reflects rounding to the nearest paisa and may not multiply exactly.';
}

/** Sessions-column text — only diverges from the plain "N of M sessions"
 *  label when the row genuinely can't be multiplied back to the amount, so
 *  the reader isn't invited to multiply Rate × the smaller number. */
/** Every date for a short run; a "from – to (N sessions)" range once the
 *  list would otherwise wrap a wall of dates into one cell — the common
 *  case for a 20-30 session post-op package (TKR/THR rehab). */
function sessionDatesCellText(li: InvoiceLineItem): string {
  const display = sessionDatesDisplay(li);
  if (display.mode === 'list') return display.dates.map(formatDateDMY).join(', ');
  return `${formatDateDMY(display.from)} – ${formatDateDMY(display.to)} (${display.count} sessions)`;
}

function sessionsCellText(li: InvoiceLineItem): string {
  if (!lineReconciles(li)) {
    const authorized = normalizeAuthorizedCount(li.authorizedSessionCount ?? null);
    const billed = li.billedSessionCount ?? li.sessionCount;
    if (authorized != null && billed < authorized) {
      return `${billed} delivered of ${authorized} authorised`;
    }
  }
  return sessionCountLabel(li);
}

function LegacyLineItemsTable({
  lineItems,
  hasAdjustments,
  totalPaise,
}: {
  lineItems: InvoiceLineItem[];
  hasAdjustments: boolean;
  totalPaise: number;
}) {
  return (
    // Fixed columns squeeze/wrap unpredictably below their natural width —
    // scrolling the table on its own axis on a narrow phone keeps every
    // column readable instead of letting service names and rupee figures
    // fight each other for space.
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
            <th className="py-2">Service</th>
            <th className="py-2">Sessions</th>
            <th className="py-2 text-right">Catalog price</th>
            {hasAdjustments && <th className="py-2 text-right">Adjustment</th>}
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((li, i) => {
            // A fully-billed package ("3 of 3") reads as meaningless on a
            // finalized bill — just say "3 sessions". The fraction still
            // communicates something true for the genuinely rare partial
            // package invoice (fewer session dates than the package size).
            const isPartial = li.sessionDates.length < li.sessionCount;
            return (
              <tr key={i} className="border-b border-[var(--border)] align-top">
                <td className="py-2 font-medium text-[var(--ink)]">{li.serviceName}</td>
                <td className="py-2 text-[var(--muted)]">
                  {li.sessionCount > 1
                    ? isPartial
                      ? `${li.sessionDates.length} of ${li.sessionCount}`
                      : `${li.sessionCount} sessions`
                    : '1'}
                  <div className="text-xs text-[var(--muted)]">{sessionDatesCellText(li)}</div>
                </td>
                <td className="font-num py-2 text-right">{formatINR(li.catalogPricePaise)}</td>
                {hasAdjustments && (
                  <td className="font-num py-2 text-right">
                    {li.adjustmentPaise !== 0 ? (
                      <>
                        {formatINR(li.adjustmentPaise)}
                        {li.adjustmentReason && (
                          <div className="text-xs text-[var(--muted)]">{li.adjustmentReason}</div>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                <td className="font-num py-2 text-right font-medium">{formatINR(li.totalPaise)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={hasAdjustments ? 4 : 3}
              className="py-3 text-right font-semibold text-[var(--ink)]"
            >
              Total
            </td>
            <td className="font-num py-3 text-right text-base font-bold text-[var(--ink)]">
              {formatINR(totalPaise)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function LineItemsTable({
  lineItems,
  hasAdjustments,
  totalPaise,
}: {
  lineItems: InvoiceLineItem[];
  hasAdjustments: boolean;
  totalPaise: number;
}) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
            <th className="py-2">Service</th>
            <th className="py-2">Dates of service</th>
            <th className="py-2">Sessions</th>
            <th className="py-2 text-right">Rate</th>
            {hasAdjustments && <th className="py-2 text-right">Adjustment</th>}
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((li, i) => {
            const caption = lineCaption(li);
            const reasons =
              li.adjustmentReasons ?? (li.adjustmentReason ? [li.adjustmentReason] : []);
            return (
              <tr key={i} className="border-b border-[var(--border)] align-top">
                <td className="py-2 font-medium text-[var(--ink)]">
                  {li.serviceName}
                  {caption && (
                    <div className="mt-0.5 text-xs font-normal text-[var(--muted)]">{caption}</div>
                  )}
                </td>
                <td className="py-2 text-xs text-[var(--muted)]">{sessionDatesCellText(li)}</td>
                <td className="py-2 text-[var(--muted)]">{sessionsCellText(li)}</td>
                <td className="font-num py-2 text-right">
                  {formatINR(lineRatePerSessionPaise(li))}
                  <span className="text-xs text-[var(--muted)]">/session</span>
                </td>
                {hasAdjustments && (
                  <td className="font-num py-2 text-right">
                    {li.adjustmentPaise !== 0 ? (
                      <>
                        {formatINR(li.adjustmentPaise)}
                        {reasons.length > 0 && (
                          <div className="text-xs text-[var(--muted)]">{reasons.join(', ')}</div>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                <td className="font-num py-2 text-right font-medium">{formatINR(li.totalPaise)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={hasAdjustments ? 5 : 4}
              className="py-3 text-right font-semibold text-[var(--ink)]"
            >
              Total
            </td>
            <td className="font-num py-3 text-right text-base font-bold text-[var(--ink)]">
              {formatINR(totalPaise)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function InvoicePrintPage() {
  const clinic = useClinic();
  const { canBill } = usePermissions();
  const { invoiceId } = useParams({ strict: false }) as { invoiceId: string };
  const { from: backTo, tab: backTab } = useSearch({ strict: false }) as {
    from?: InvoicePrintBackTarget;
    tab?: 'invoices';
  };
  const invoice = useLiveQuery(() => repos.invoices.get(invoiceId), [invoiceId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  // Missing row reads as paid, matching computeVisitPaymentState's convention
  // (issuing an invoice and recording its initial payment status are two
  // separate writes — the invoice is still real if the second one lags).
  const invoicePayment = useLiveQuery(
    () => (invoice ? repos.invoicePayments.getByInvoiceId(invoice.id) : undefined),
    [invoice?.id]
  );
  const allInvoices = useLiveQuery(() => repos.invoices.list(clinic.id), [clinic.id]);
  const supersededBy = (allInvoices ?? []).find((inv) => inv.supersedesInvoiceId === invoice?.id);
  const supersedes = useLiveQuery(
    () =>
      invoice?.supersedesInvoiceId ? repos.invoices.get(invoice.supersedesInvoiceId) : undefined,
    [invoice?.supersedesInvoiceId]
  );

  const [paper, setPaper] = useState<'A4' | 'A5'>('A4');
  const [amending, setAmending] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);
  const partnerLogoUrl = useMemo(
    () => publicLogoUrl(clinic.partnerHospitalLogoPath),
    [clinic.partnerHospitalLogoPath]
  );
  const signatureUrl = useMemo(() => publicLogoUrl(clinic.signaturePath), [clinic.signaturePath]);

  // "Save as PDF" in the browser's print dialog names the file after
  // document.title, which is otherwise stuck on the app-wide "Thera.Net —
  // Patient Visit Ledger" — useless for a document staff hand to a patient
  // or file with a claim. Restored on unmount so navigating away doesn't
  // leave the browser tab mistitled.
  useEffect(() => {
    if (!invoice) return;
    const previousTitle = document.title;
    document.title = `${invoice.patientSnapshot.name} - ${invoice.patientSnapshot.mrno}`;
    return () => {
      document.title = previousTitle;
    };
  }, [invoice]);

  if (!invoice) {
    return (
      <div className="p-8 text-sm text-[var(--muted)]">Invoice not found (or not yet synced).</div>
    );
  }

  const isPaid = invoicePayment?.status !== 'outstanding';
  const hasAdjustments = invoice.lineItems.some((li) => li.adjustmentPaise !== 0);
  const isV2Invoice = invoice.lineItems.length > 0 && invoice.lineItems.every(isV2Line);
  const period = invoicePeriod(invoice.lineItems);

  // v2: every distinct therapist across every line (a merged group can span
  // more than one) — fixes a pre-existing bug where a multi-line invoice's
  // single `therapistId` column was arbitrarily whichever group was
  // processed last. Legacy: unchanged, the one `invoice.therapistId`.
  const footerTherapists: Therapist[] = isV2Invoice
    ? Array.from(new Set(invoice.lineItems.flatMap((li) => li.therapistIds ?? [])))
        .map((id) => therapists?.find((t) => t.id === id))
        .filter((t): t is Therapist => t !== undefined)
    : [therapists?.find((t) => t.id === invoice.therapistId)].filter(
        (t): t is Therapist => t !== undefined
      );

  // Renders the same content node "Print / Save PDF" shows into a PDF
  // on-device (renderElementToPdf), then hands it to the OS share sheet so
  // WhatsApp (or any other installed app) can receive the actual file —
  // falling back to a text-only wa.me link on a browser without Web Share
  // API file support (desktop, mainly). See src/lib/pdfShare.ts.
  async function shareViaWhatsApp() {
    // TS can't carry the module-level `if (!invoice) return` guard's
    // narrowing into this closure, so it's re-checked here — also a real
    // (if practically unreachable) safety net since this function is
    // defined fresh every render alongside that guard.
    if (!contentRef.current || !invoice) return;
    setSharing(true);
    setShareError(null);
    try {
      const file = await renderElementToPdf(
        contentRef.current,
        `${invoice.invoiceNo.replace(/\//g, '-')}.pdf`,
        paper
      );
      const summary = `Invoice ${invoice.invoiceNo} for ${invoice.patientSnapshot.name} — ${formatINR(invoice.totalPaise)}. From ${clinic.name}.`;
      await shareFileToWhatsApp(file, `Invoice ${invoice.invoiceNo}`, summary);
    } catch (e) {
      setShareError(toFriendlyMessage(e));
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: ${paper}; margin: ${paper === 'A5' ? '10mm' : '16mm'}; }`}</style>

      <div className="no-print mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-3">
        <Link
          to={backTo ?? '/ledger'}
          search={backTab ? { tab: backTab } : undefined}
          className={btnSecondary}
        >
          ← Back
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            className={inputCls}
            value={paper}
            onChange={(e) => setPaper(e.target.value as 'A4' | 'A5')}
          >
            <option value="A4">A4</option>
            <option value="A5">A5 (receipt)</option>
          </select>
          <button type="button" className={btnPrimary} onClick={() => window.print()}>
            Print / Save PDF
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={sharing}
            onClick={() => void shareViaWhatsApp()}
          >
            {sharing ? 'Preparing…' : 'Share via WhatsApp'}
          </button>
          {/* update_invoice_clinical_details()/amend_invoice() both reject a
              plain therapist when invoicingAccess is 'billing_staff' — canBill
              mirrors that exact rule (see usePermissions.ts). Without this
              gate, the buttons rendered fully clickable for every role and
              only failed with an opaque RPC error once submitted. */}
          {!supersededBy && canBill && (
            <button type="button" className={btnSecondary} onClick={() => setEditingDetails(true)}>
              Edit details
            </button>
          )}
          {!supersededBy && canBill && (
            <button type="button" className={btnSecondary} onClick={() => setAmending(true)}>
              Amend this invoice
            </button>
          )}
        </div>
      </div>

      {shareError && (
        <div className="no-print mx-auto max-w-3xl px-4">
          <ErrorNote message={shareError} />
        </div>
      )}

      {(supersededBy || supersedes) && (
        <div className="no-print mx-auto max-w-3xl px-4">
          {supersededBy && (
            <div className="mb-3 rounded-md border-l-4 border-[var(--rust)] bg-[var(--rust-light)] p-3 text-xs text-[var(--ink)]">
              Superseded by{' '}
              <Link
                to="/invoices/$invoiceId/print"
                params={{ invoiceId: supersededBy.id }}
                search={{ from: backTo, tab: backTab }}
                className="font-medium underline"
              >
                {supersededBy.invoiceNo}
              </Link>{' '}
              — that invoice is the current version of this bill.
            </div>
          )}
          {supersedes && (
            <div className="mb-3 rounded-md border-l-4 border-[var(--teal)] bg-[var(--teal-light)] p-3 text-xs text-[var(--ink)]">
              Amendment to{' '}
              <Link
                to="/invoices/$invoiceId/print"
                params={{ invoiceId: supersedes.id }}
                search={{ from: backTo, tab: backTab }}
                className="font-medium underline"
              >
                {supersedes.invoiceNo}
              </Link>
            </div>
          )}
        </div>
      )}

      {amending && (
        <AmendInvoiceDialog
          clinicId={clinic.id}
          invoice={invoice}
          onClose={() => setAmending(false)}
          returnTo={backTo ?? '/ledger'}
          returnTab={backTab}
        />
      )}

      {editingDetails && (
        <EditInvoiceDetailsDialog
          clinicId={clinic.id}
          invoice={invoice}
          onClose={() => setEditingDetails(false)}
        />
      )}

      <div
        ref={contentRef}
        className={`mx-auto max-w-3xl bg-[var(--surface)] p-4 sm:p-8 print:p-0 ${paper === 'A5' ? 'print:max-w-[128mm]' : 'print:max-w-[178mm]'}`}
      >
        <PrintLetterhead clinic={clinic} logoUrl={logoUrl} partnerLogoUrl={partnerLogoUrl} />

        {/* Invoice meta + patient */}
        <section className="mt-4 flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="font-display font-semibold text-[var(--ink)]">
              {invoice.patientSnapshot.name}
            </p>
            <p className="text-[var(--muted)]">Patient ID: {invoice.patientSnapshot.mrno}</p>
            {(invoice.patientSnapshot.age != null || invoice.patientSnapshot.sex) && (
              <p className="text-[var(--muted)]">
                {[
                  invoice.patientSnapshot.age != null ? `${invoice.patientSnapshot.age}y` : null,
                  invoice.patientSnapshot.sex,
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-[var(--ink)]">
              {isPaid ? 'BILL CUM RECEIPT' : 'BILL'}
            </p>
            <p className="text-[var(--ink)]">{invoice.invoiceNo}</p>
            <p className="text-[var(--muted)]">{formatDateDMY(invoice.issuedAt)}</p>
            <p
              className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
              style={
                isPaid
                  ? { background: 'var(--moss-light)', color: 'var(--moss-strong)' }
                  : { background: 'var(--rust-light)', color: 'var(--rust)' }
              }
            >
              {isPaid ? 'PAID' : 'PAYMENT DUE'}
            </p>
          </div>
        </section>

        {/* Clinical details — only when set (old invoices predate the
            field; bulk-issued invoices carry no snapshot by design, see
            the Phase 1 plan's 1.4 section). */}
        {invoice.clinicalSnapshot && (
          <section className="mt-4 rounded-md border border-[var(--border)] bg-[var(--paper)] p-3 text-xs text-[var(--ink)]">
            <p className="mb-1.5 font-semibold uppercase tracking-wide text-[var(--muted)]">
              Clinical details
            </p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {invoice.clinicalSnapshot.diagnosis && (
                <p className="sm:col-span-2">
                  <span className="text-[var(--muted)]">Diagnosis: </span>
                  {invoice.clinicalSnapshot.diagnosis}
                  {invoice.clinicalSnapshot.diagnosisIcdCode &&
                    ` (${invoice.clinicalSnapshot.diagnosisIcdCode})`}
                </p>
              )}
              {invoice.clinicalSnapshot.referringPhysician && (
                <p>
                  <span className="text-[var(--muted)]">Referring physician: </span>
                  {invoice.clinicalSnapshot.referringPhysician}
                  {invoice.clinicalSnapshot.physicianRegistrationNo &&
                    ` (Reg. No. ${invoice.clinicalSnapshot.physicianRegistrationNo})`}
                </p>
              )}
              {invoice.clinicalSnapshot.placeOfService && (
                <p>
                  <span className="text-[var(--muted)]">Place of service: </span>
                  {invoice.clinicalSnapshot.placeOfService === 'home'
                    ? 'Home (domiciliary)'
                    : 'Clinic'}
                </p>
              )}
              {invoice.clinicalSnapshot.treatmentPerformed && (
                <p className="sm:col-span-2">
                  <span className="text-[var(--muted)]">Treatment performed: </span>
                  {invoice.clinicalSnapshot.treatmentPerformed}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Treatment period — works off sessionDates for either line-item
            shape, so it ships for legacy invoices too, not just v2. */}
        {period && (
          <p className="mt-4 text-xs text-[var(--muted)]">
            Treatment period: {formatDateDMY(period.from)} – {formatDateDMY(period.to)}
          </p>
        )}

        {/* Line items */}
        {isV2Invoice ? (
          <LineItemsTable
            lineItems={invoice.lineItems}
            hasAdjustments={hasAdjustments}
            totalPaise={invoice.totalPaise}
          />
        ) : (
          <LegacyLineItemsTable
            lineItems={invoice.lineItems}
            hasAdjustments={hasAdjustments}
            totalPaise={invoice.totalPaise}
          />
        )}

        <p className="mt-2 text-sm text-[var(--muted)]">
          {isPaid ? 'Received with thanks: ' : 'Amount in words: '}
          {amountInWords(invoice.totalPaise)}
        </p>

        <p className="mt-3 text-sm text-[var(--muted)]">Payment mode: {invoice.paymentMode}</p>

        <PrintSignatureFooter
          signatureUrl={signatureUrl}
          left={
            <>
              <p>
                {invoice.invoiceNo} · issued {formatDateDMY(invoice.issuedAt)}
              </p>
              {footerTherapists.length > 0 && (
                <p>
                  {footerTherapists.length === 1 ? 'Therapist: ' : 'Therapists: '}
                  {footerTherapists
                    .map(
                      (t) => `${t.name}${t.registrationNo ? ` (Reg. No. ${t.registrationNo})` : ''}`
                    )
                    .join(', ')}
                </p>
              )}
            </>
          }
        />
      </div>
    </div>
  );
}
