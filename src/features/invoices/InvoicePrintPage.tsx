import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import type { InvoicePrintBackTarget } from '@/app/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, paymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import { amountInWords } from '@/domain/amountInWords';
import { formatDateDMY } from '@/domain/fiscalYear';
import {
  isV2Line,
  lineRatePerSessionPaise,
  lineReconciles,
  normalizeAuthorizedCount,
  sessionCountLabel,
  sessionDatesDisplay,
} from '@/domain/invoiceLine';
import type { InvoiceLineItem, Therapist } from '@/domain/types';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import { AmendInvoiceDialog } from '@/components/AmendInvoiceDialog';
import { VoidInvoiceDialog } from '@/components/VoidInvoiceDialog';
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
  paper,
  isSharing,
}: {
  lineItems: InvoiceLineItem[];
  hasAdjustments: boolean;
  totalPaise: number;
  paper: 'A4' | 'A5';
  isSharing?: boolean;
}) {
  const isA5 = paper === 'A5';
  return (
    // Fixed columns squeeze/wrap unpredictably below their natural width —
    // scrolling the table on its own axis on a narrow phone keeps every
    // column readable instead of letting service names and rupee figures
    // fight each other for space.
    <div className={`mt-6 ${isSharing ? 'overflow-visible' : 'overflow-x-auto'} print:overflow-visible`}>
      <table className={`w-full ${isA5 ? 'min-w-full text-xs' : 'min-w-[560px] print:min-w-full text-sm'}`}>
        <thead>
          <tr className={`border-b border-[var(--border)] text-left font-medium text-[var(--muted)] ${isA5 ? 'text-[10px]' : 'text-xs'}`}>
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
              <tr key={i} className="border-b border-[var(--border)] align-top print:break-inside-avoid">
                <td className="py-2 font-medium text-[var(--ink)]">{li.serviceName}</td>
                <td className="py-2 text-[var(--muted)]">
                  {li.sessionCount > 1
                    ? isPartial
                      ? `${li.sessionDates.length} of ${li.sessionCount}`
                      : `${li.sessionCount} sessions`
                    : '1'}
                  <div className="text-xs text-[var(--muted)]">{sessionDatesCellText(li)}</div>
                </td>
                <td className="font-num py-2 text-right whitespace-nowrap">{formatINR(li.catalogPricePaise)}</td>
                {hasAdjustments && (
                  <td className="font-num py-2 text-right whitespace-nowrap">
                    {li.adjustmentPaise !== 0 ? (
                      <>
                        {formatINR(li.adjustmentPaise)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                <td className="font-num py-2 text-right font-medium whitespace-nowrap">{formatINR(li.totalPaise)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="print:break-inside-avoid">
          {hasAdjustments && (
            <>
              <tr>
                <td
                  colSpan={4}
                  className="pt-3 pb-1 text-right font-medium text-[var(--muted)]"
                >
                  Subtotal
                </td>
                <td className="font-num pt-3 pb-1 text-right text-[var(--muted)] whitespace-nowrap">
                  {formatINR(lineItems.reduce((acc, li) => acc + (li.totalPaise - li.adjustmentPaise), 0))}
                </td>
              </tr>
              <tr>
                <td
                  colSpan={4}
                  className="py-1 text-right font-medium text-[var(--muted)]"
                >
                  Total Adjustment
                </td>
                <td className="font-num py-1 text-right text-[var(--muted)] whitespace-nowrap">
                  {(() => {
                    const adj = lineItems.reduce((acc, li) => acc + li.adjustmentPaise, 0);
                    return adj < 0 ? `-${formatINR(Math.abs(adj))}` : formatINR(adj);
                  })()}
                </td>
              </tr>
            </>
          )}
          <tr>
            <td
              colSpan={hasAdjustments ? 4 : 3}
              className="py-3 text-right font-semibold text-[var(--ink)]"
            >
              Total
            </td>
            <td className="font-num py-3 text-right text-base font-bold text-[var(--ink)] whitespace-nowrap">
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
  paper,
  isSharing,
}: {
  lineItems: InvoiceLineItem[];
  hasAdjustments: boolean;
  totalPaise: number;
  paper: 'A4' | 'A5';
  isSharing?: boolean;
}) {
  const isA5 = paper === 'A5';
  return (
    <div className={`mt-6 ${isSharing ? 'overflow-visible' : 'overflow-x-auto'} print:overflow-visible`}>
      <table className={`w-full ${isA5 ? 'min-w-full text-xs' : 'min-w-[680px] print:min-w-full text-sm table-fixed'} border-b-2 border-[var(--border)] pb-2`}>
        <thead>
          <tr className={`border-y-2 border-[var(--border)] bg-[var(--teal-mist)] text-left font-medium text-[var(--ink)] ${isA5 ? 'text-[10px]' : 'text-xs'}`}>
            <th className="py-2 w-[30%]">Service</th>
            <th className="py-2 w-[20%]">Dates of service</th>
            <th className="py-2 w-[15%]">Sessions</th>
            <th className="py-2 w-[10%] text-right">Rate</th>
            {hasAdjustments && <th className="py-2 w-[10%] text-right">Adjustment</th>}
            <th className="py-2 w-[15%] text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="align-top border-b border-[var(--border)]">
          {lineItems.map((li, i) => {
            const caption = lineCaption(li);
            return (
              <tr key={i} className="border-b border-[var(--border)] align-top print:break-inside-avoid">
                <td className="py-2 font-medium text-[var(--ink)]">
                  {li.serviceName}
                  {caption && (
                    <div className="mt-0.5 text-xs font-normal text-[var(--muted)]">{caption}</div>
                  )}
                </td>
                <td className="py-2 text-xs text-[var(--muted)]">{sessionDatesCellText(li)}</td>
                <td className="py-2 text-[var(--muted)]">{sessionsCellText(li)}</td>
                <td className="font-num py-2 text-right whitespace-nowrap">
                  {formatINR(lineRatePerSessionPaise(li))}
                  <span className="text-xs text-[var(--muted)]">/session</span>
                </td>
                {hasAdjustments && (
                  <td className="font-num py-2 text-right whitespace-nowrap">
                    {li.adjustmentPaise !== 0 ? (
                      <>
                        {formatINR(li.adjustmentPaise)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                <td className="font-num py-2 text-right font-medium whitespace-nowrap">{formatINR(li.totalPaise)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="print:break-inside-avoid">
          {hasAdjustments && (
            <>
              <tr>
                <td
                  colSpan={5}
                  className="pt-3 pb-1 text-right font-medium text-[var(--muted)]"
                >
                  Subtotal
                </td>
                <td className="font-num pt-3 pb-1 text-right text-[var(--muted)] whitespace-nowrap">
                  {formatINR(lineItems.reduce((acc, li) => acc + (li.totalPaise - li.adjustmentPaise), 0))}
                </td>
              </tr>
              <tr>
                <td
                  colSpan={5}
                  className="py-1 text-right font-medium text-[var(--muted)]"
                >
                  Total Adjustment
                </td>
                <td className="font-num py-1 text-right text-[var(--muted)] whitespace-nowrap">
                  {(() => {
                    const adj = lineItems.reduce((acc, li) => acc + li.adjustmentPaise, 0);
                    return adj < 0 ? `-${formatINR(Math.abs(adj))}` : formatINR(adj);
                  })()}
                </td>
              </tr>
            </>
          )}
          <tr>
            <td
              colSpan={hasAdjustments ? 5 : 4}
              className="py-3 text-right font-semibold text-[var(--ink)]"
            >
              Total
            </td>
            <td className="font-num py-3 text-right text-base font-bold text-[var(--ink)] whitespace-nowrap">
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
  const { canBill, role } = usePermissions();
  // Voiding is admin / front desk only on the server (void_invoice()), whatever
  // invoicing access says; a therapist can issue and amend but not void.
  const canVoid = canBill && (role === 'admin' || role === 'front_desk');
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
  // Wrapped so "still loading" (undefined) differs from "no row" (row: null) —
  // otherwise a not-yet-loaded status read as paid and a due bill flashed PAID.
  const invoicePaymentQuery = useLiveQuery(
    async () =>
      invoice ? { row: (await repos.invoicePayments.getByInvoiceId(invoice.id)) ?? null } : undefined,
    [invoice?.id]
  );
  const invoicePayment = invoicePaymentQuery?.row ?? undefined;
  // What's been received so far, so a part-paid bill says so (and the balance).
  const balance = useLiveQuery(
    () => (invoice ? paymentService.invoiceBalance(clinic.id, invoice) : undefined),
    [clinic.id, invoice?.id]
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
  const [voiding, setVoiding] = useState(false);
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

  const statusLoaded = invoicePaymentQuery !== undefined;
  const isVoid = invoicePayment?.status === 'void';
  const isPaid = invoicePayment?.status !== 'outstanding' && !isVoid;
  const isPartial = !isPaid && !isVoid && !!balance && balance.paidPaise > 0;
  const hasAdjustments = invoice.lineItems.some((li) => li.adjustmentPaise !== 0);
  const isV2Invoice = invoice.lineItems.length > 0 && invoice.lineItems.every(isV2Line);

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
          <div className="flex space-x-1 rounded-md bg-[var(--surface)] p-1 border border-[var(--border)] mr-2">
            <button
              type="button"
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${paper === 'A4' ? 'bg-[var(--paper)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
              onClick={() => setPaper('A4')}
            >
              A4
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${paper === 'A5' ? 'bg-[var(--paper)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
              onClick={() => setPaper('A5')}
            >
              A5 (Receipt)
            </button>
          </div>
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
          {!supersededBy && !isVoid && canBill && (
            <button type="button" className={btnSecondary} onClick={() => setEditingDetails(true)}>
              Edit details
            </button>
          )}
          {!supersededBy && !isVoid && canBill && (
            <button type="button" className={btnSecondary} onClick={() => setAmending(true)}>
              Amend this invoice
            </button>
          )}
          {!supersededBy && !isVoid && canVoid && (
            <button type="button" className={`${btnSecondary} !text-[var(--rust)]`} onClick={() => setVoiding(true)}>
              Void invoice
            </button>
          )}
        </div>
      </div>

      {shareError && (
        <div className="no-print mx-auto max-w-3xl px-4">
          <ErrorNote message={shareError} />
        </div>
      )}

      {isVoid && (
        <div className="no-print mx-auto max-w-3xl px-4">
          <div className="mb-3 rounded-md border-l-4 border-[var(--rust)] bg-[var(--rust-light)] p-3 text-xs text-[var(--ink)]">
            <strong>Void.</strong> This invoice was voided
            {invoicePayment?.voidedAt ? ` on ${formatDateDMY(invoicePayment.voidedAt)}` : ''}
            {invoicePayment?.voidReason ? `: ${invoicePayment.voidReason}` : '.'} Its number stays in the series.
            The visit can be corrected and billed again.
          </div>
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

      {voiding && (
        <VoidInvoiceDialog
          invoice={invoice}
          receivedPaise={balance?.paidPaise ?? 0}
          onClose={() => setVoiding(false)}
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
        className={`relative mx-auto max-w-3xl bg-[var(--surface)] p-4 sm:p-8 print:p-0 ${paper === 'A5' ? 'print:max-w-[128mm]' : 'print:max-w-[178mm]'}`}
      >
        {isVoid && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
          >
            <span className="-rotate-[24deg] select-none text-[7rem] font-black tracking-widest text-[var(--rust)] opacity-20 print:opacity-25">
              VOID
            </span>
          </div>
        )}
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
            <p className="font-display text-lg font-bold text-[var(--ink)]">
              {isVoid ? 'BILL (VOID)' : isPaid ? 'BILL CUM RECEIPT' : 'BILL'}
            </p>
            <p className="text-[var(--ink)]">{invoice.invoiceNo}</p>
            <p className="text-[var(--muted)]">{formatDateDMY(invoice.issuedAt)}</p>
            {statusLoaded && (
              <p
                className="mt-1 inline-block rounded border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-widest"
                style={
                  isPaid
                    ? { borderColor: 'var(--moss-strong)', color: 'var(--moss-strong)' }
                    : { borderColor: 'var(--rust)', color: 'var(--rust)' }
                }
              >
                {isVoid ? 'VOID' : isPaid ? 'PAID' : isPartial ? 'PART PAID' : 'PAYMENT DUE'}
              </p>
            )}
          </div>
        </section>

        {/* Clinical details — only when set (old invoices predate the
            field; bulk-issued invoices carry no snapshot by design, see
            the Phase 1 plan's 1.4 section). */}
        {(invoice.clinicalSnapshot) && (
          <section className="mt-4 rounded-md border border-[var(--border)] p-3 text-xs text-[var(--ink)]">
            <p className="mb-1.5 font-medium text-[var(--muted)] border-b border-[var(--border)] pb-1">
              Clinical details
            </p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 mt-2">
              {invoice.clinicalSnapshot?.diagnosis && (
                <p className="sm:col-span-2">
                  <span className="text-[var(--muted)] font-medium">Diagnosis: </span>
                  {invoice.clinicalSnapshot.diagnosis}
                  {invoice.clinicalSnapshot.diagnosisIcdCode &&
                    ` (${invoice.clinicalSnapshot.diagnosisIcdCode})`}
                </p>
              )}
              {invoice.clinicalSnapshot?.referringPhysician && (
                <p>
                  <span className="text-[var(--muted)] font-medium">Referring physician: </span>
                  {invoice.clinicalSnapshot.referringPhysician}
                  {invoice.clinicalSnapshot.physicianRegistrationNo &&
                    ` (Reg. No. ${invoice.clinicalSnapshot.physicianRegistrationNo})`}
                </p>
              )}
              {invoice.clinicalSnapshot?.placeOfService && (
                <p>
                  <span className="text-[var(--muted)] font-medium">Place of service: </span>
                  {invoice.clinicalSnapshot.placeOfService === 'home'
                    ? 'Home (domiciliary)'
                    : 'Clinic'}
                </p>
              )}
              {invoice.clinicalSnapshot?.treatmentPerformed && (
                <p className="sm:col-span-2">
                  <span className="text-[var(--muted)] font-medium">Treatment performed: </span>
                  {invoice.clinicalSnapshot.treatmentPerformed}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Line items */}
        {isV2Invoice ? (
          <LineItemsTable
            lineItems={invoice.lineItems}
            hasAdjustments={hasAdjustments}
            totalPaise={invoice.totalPaise}
            paper={paper}
            isSharing={sharing}
          />
        ) : (
          <LegacyLineItemsTable
            lineItems={invoice.lineItems}
            hasAdjustments={hasAdjustments}
            totalPaise={invoice.totalPaise}
            paper={paper}
            isSharing={sharing}
          />
        )}

        <p className="mt-2 text-sm text-[var(--muted)]">
          {isPaid ? 'Received with thanks: ' : 'Amount in words: '}
          {amountInWords(invoice.totalPaise)}
        </p>

        {isPartial && balance && (
          <p className="mt-2 text-sm font-medium text-[var(--ink)]">
            Received: <span className="font-num">{formatINR(balance.paidPaise)}</span>
            {' · '}Balance due: <span className="font-num">{formatINR(balance.remainingPaise)}</span>
          </p>
        )}

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
