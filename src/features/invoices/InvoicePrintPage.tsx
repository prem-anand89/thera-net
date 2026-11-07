import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import type { InvoicePrintBackTarget } from '@/app/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, paymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { formatAmount } from '@/domain/money';
import { amountInWords } from '@/domain/amountInWords';
import { formatDateDMY } from '@/domain/fiscalYear';
import { buildInvoicePaymentLedger } from '@/domain/invoicePaymentLedger';
import { placeOfServiceLabel } from '@/domain/invoiceClinical';
import {
  isV2Line,
  lineRatePerSessionPaise,
  lineReconciles,
  normalizeAuthorizedCount,
  sessionCountLabel,
  sessionDatesDisplay,
  hasCondensedSessionDates,
  treatmentPeriodOf,
} from '@/domain/invoiceLine';
import { CARE_LOCATION_LABELS, locationOf } from '@/domain/careLocations';
import type { InvoiceLineItem, Therapist } from '@/domain/types';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary } from '@/components/ui';
import { AmendInvoiceDialog } from '@/components/AmendInvoiceDialog';
import { VoidInvoiceDialog } from '@/components/VoidInvoiceDialog';
import { EditInvoiceDetailsDialog } from '@/components/EditInvoiceDetailsDialog';
import { openWhatsAppWithText } from '@/lib/pdfShare';
import { BillTotals, DocFieldList, DocSpacer, PrintLetterhead, PrintSignatureFooter } from './printChrome';
import { ShareBillDialog } from './ShareBillDialog';
import { useBillShare } from './useBillShare';

/** Page-specific wording, not a general-purpose helper — the "delivered of
 *  … authorised" framing and the two distinct non-reconciling explanations
 *  only make sense on a printed bill, not in InsurerPacketPage's summary
 *  (which uses plain `sessionCountLabel` instead). */
/** Where a line's sessions were, shown under its service name only when the bill mixes places (clinic and home). */
function lineLocationLabel(li: InvoiceLineItem, mixed: boolean): string | null {
  return mixed ? CARE_LOCATION_LABELS[locationOf(li)] : null;
}

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
  paper,
}: {
  lineItems: InvoiceLineItem[];
  hasAdjustments: boolean;
  paper: 'A4' | 'A5';
}) {
  const isA5 = paper === 'A5';
  return (
    // Fixed columns squeeze/wrap unpredictably below their natural width —
    // scrolling the table on its own axis on a narrow phone keeps every
    // column readable instead of letting service names and rupee figures
    // fight each other for space.
    <div className="mt-3.5 overflow-x-auto print:overflow-visible">
      <table className={`w-full ${isA5 ? 'min-w-full text-xs' : 'min-w-[560px] print:min-w-full text-sm'}`}>
        <thead>
          <tr className={`border-b border-[var(--border)] text-left font-medium text-[var(--muted)] ${isA5 ? 'text-[10px]' : 'text-xs'}`}>
            <th className="py-2">Service</th>
            <th className="py-2">Sessions</th>
            <th className="py-2 text-right">Catalog price</th>
            {hasAdjustments && <th className="py-2 text-right">Adjustment</th>}
            <th className="py-2 pr-3 text-right">Amount</th>
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
                <td className="font-num py-2 text-right whitespace-nowrap">{formatAmount(li.catalogPricePaise)}</td>
                {hasAdjustments && (
                  <td className="font-num py-2 text-right whitespace-nowrap">
                    {li.adjustmentPaise !== 0 ? (
                      <>
                        {formatAmount(li.adjustmentPaise)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                <td className="font-num py-2 pr-3 text-right font-medium whitespace-nowrap">{formatAmount(li.totalPaise)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LineItemsTable({
  lineItems,
  hasAdjustments,
  paper,
}: {
  lineItems: InvoiceLineItem[];
  hasAdjustments: boolean;
  paper: 'A4' | 'A5';
}) {
  const isA5 = paper === 'A5';
  const longSessionsText = lineItems.some((li) => sessionsCellText(li).length > 12);
  const mixedPlaces = new Set(lineItems.map((li) => locationOf(li))).size > 1;
  return (
    <div className="mt-3.5 overflow-x-auto print:overflow-visible">
      <table className={`w-full table-fixed border-collapse ${isA5 ? 'text-[10.5px]' : 'min-w-[680px] text-[12px] print:min-w-full'}`}>
        <thead>
          <tr className={`border-y border-[var(--doc-rule)] bg-[var(--doc-fill)] text-left font-semibold text-[var(--doc-head)] ${isA5 ? 'text-[9.5px]' : 'text-[10.5px]'}`}>
            <th className={`py-1.5 pl-3 pr-2 ${hasAdjustments ? 'w-[26%]' : isA5 ? 'w-[30%]' : 'w-[32%]'}`}>Service</th>
            <th className={`py-1.5 pr-2 ${hasAdjustments ? 'w-[20%]' : isA5 ? 'w-[23%]' : 'w-[26%]'}`}>Dates of service</th>
            <th className={`py-1.5 pr-2 ${longSessionsText ? 'w-[15%]' : isA5 ? 'w-[14%]' : 'w-[11%]'}`}>Sessions</th>
            <th className="py-1.5 pr-3 text-right">Unit Price</th>
            {hasAdjustments && <th className="py-1.5 pr-3 text-right">Adjustment</th>}
            <th className="py-1.5 pr-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {lineItems.map((li, i) => {
            const caption = lineCaption(li);
            const where = lineLocationLabel(li, mixedPlaces);
            return (
              <tr key={i} className="border-b border-[var(--border)] align-top print:break-inside-avoid">
                <td className="py-2 pl-3 pr-2 font-medium text-[var(--ink)]">
                  {li.serviceName}
                  {where && (
                    <div className={`mt-0.5 font-normal text-[var(--muted)] ${isA5 ? 'text-[9.5px]' : 'text-[10.5px]'}`}>{where}</div>
                  )}
                  {caption && (
                    <div className={`mt-0.5 font-normal text-[var(--muted)] ${isA5 ? 'text-[9.5px]' : 'text-[10.5px]'}`}>{caption}</div>
                  )}
                </td>
                <td className={`py-2 pr-2 text-[var(--muted)] ${isA5 ? 'text-[9.5px]' : 'text-[10.5px]'}`}>{sessionDatesCellText(li)}</td>
                <td className="py-2 pr-2 text-[var(--muted)]">{sessionsCellText(li)}</td>
                <td className="font-num whitespace-nowrap py-2 pr-3 text-right">
                  {formatAmount(lineRatePerSessionPaise(li))}
                </td>
                {hasAdjustments && (
                  <td className="font-num whitespace-nowrap py-2 pr-3 text-right">
                    {li.adjustmentPaise !== 0 ? formatAmount(li.adjustmentPaise) : '—'}
                  </td>
                )}
                <td className="font-num whitespace-nowrap py-2 pr-3 text-right font-medium">{formatAmount(li.totalPaise)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InvoicePrintPage() {
  const clinic = useClinic();
  const { canBill, invoicingOnPlan, entitlementsLoading, role } = usePermissions();
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

  const paymentLedger = useLiveQuery(async () => {
    if (!invoice) return undefined;
    const visits = await repos.visits.listByInvoiceId(invoice.id);
    const payments = (await Promise.all(visits.map((v) => repos.payments.listByVisit(v.id)))).flat();
    const ip = await repos.invoicePayments.getByInvoiceId(invoice.id);
    const advanceIds = Array.from(new Set(payments.map((p) => p.advanceId).filter((id): id is string => Boolean(id))));
    const advances = (await Promise.all(advanceIds.map((id) => repos.patientAdvances.get(id)))).filter(
      (a): a is NonNullable<typeof a> => a !== undefined
    );
    return buildInvoicePaymentLedger(invoice, visits, payments, ip ?? undefined, new Map(advances.map((a) => [a.id, a])));
  }, [invoice?.id, invoice?.totalPaise, invoice?.issuedAt, invoice?.paymentMode]);

  const [paper, setPaper] = useState<'A4' | 'A5'>('A4');
  const [amending, setAmending] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
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

  // Anything printed on the bill is in this key, so a PDF prepared earlier is never sent after one of them changes.
  const billShare = useBillShare({
    contentRef,
    fileName: `${(invoice?.invoiceNo ?? 'bill').replace(/\//g, '-')}.pdf`,
    title: `Bill ${invoice?.invoiceNo ?? ''}`,
    paper,
    ready: Boolean(invoice) && invoicePaymentQuery !== undefined && paymentLedger !== undefined && therapists !== undefined,
    freshnessKey: JSON.stringify([
      invoice,
      paymentLedger,
      invoicePayment?.status,
      supersededBy?.id,
      paper,
      therapists?.map((t) => [t.id, t.name, t.registrationNo]),
      clinic.name,
      clinic.tagline,
      clinic.address,
      clinic.phone,
      clinic.email,
      clinic.gstNo,
      clinic.partnerHospitalName,
      logoUrl,
      partnerLogoUrl,
      signatureUrl,
    ]),
  });

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
  const snap = invoice.clinicalSnapshot;
  const placeLabel = placeOfServiceLabel(snap);
  const period = treatmentPeriodOf(invoice.lineItems);
  // Left column: where and what was done (on every bill); right column: what was found and who referred (only some bills
  // have these). With the common ones on the left, a bill with no diagnosis or referral reads without a gap.
  const clinicalLeft = [
    ...(placeLabel ? [{ label: 'Place of service', value: placeLabel }] : []),
    ...(snap?.treatmentPerformed ? [{ label: 'Treatment', value: snap.treatmentPerformed }] : []),
    // A bill covering several days says which: first to last session.
    ...(period ? [{ label: 'Treatment period', value: `${formatDateDMY(period.from)} – ${formatDateDMY(period.to)}` }] : []),
  ];
  const clinicalRight = [
    ...(snap?.diagnosis ? [{ label: 'Diagnosis', value: `${snap.diagnosis}${snap.diagnosisIcdCode ? ` (${snap.diagnosisIcdCode})` : ''}` }] : []),
    ...(snap?.referringPhysician
      ? [{ label: 'Ref. Physician', value: `${snap.referringPhysician}${snap.physicianRegistrationNo ? ` (Reg. No. ${snap.physicianRegistrationNo})` : ''}` }]
      : []),
  ];

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

  const shareSummary = `Bill ${invoice.invoiceNo} for ${invoice.patientSnapshot.name} — ${formatAmount(invoice.totalPaise)}. From ${clinic.name}.`;

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: ${paper}; margin: ${paper === 'A5' ? '10mm' : '12mm'}; }`}</style>

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
            onClick={() => void billShare.send()}
          >
            Share via WhatsApp
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

      {billShare.phase !== 'closed' && (
        <ShareBillDialog
          phase={billShare.phase}
          patientName={invoice.patientSnapshot.name}
          patientPhone={invoice.patientSnapshot.phone ?? null}
          onSend={() => void billShare.send()}
          onDownload={billShare.download}
          onOpenChat={() => openWhatsAppWithText(shareSummary, invoice.patientSnapshot.phone)}
          onSendTextOnly={() => {
            openWhatsAppWithText(shareSummary, invoice.patientSnapshot.phone);
            billShare.close();
          }}
          onClose={billShare.close}
        />
      )}

      {!entitlementsLoading && !invoicingOnPlan && (
        <div className="no-print mx-auto max-w-3xl px-4" data-testid="no-invoicing-note">
          <p className="mb-3 rounded-md bg-[var(--paper)] p-3 text-xs text-[var(--muted)]">
            Your plan doesn&apos;t issue new invoices. Invoices you already issued stay here to print or share.
          </p>
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
        className={`doc-paper relative mx-auto flex flex-col max-w-3xl min-h-[calc(100vh-80px)] bg-[var(--surface)] p-4 sm:p-8 print:p-0 ${paper === 'A5' ? 'print:min-h-[184mm] print:max-w-[128mm]' : 'print:min-h-[262mm] print:max-w-[186mm]'}`}
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
        <PrintLetterhead clinic={clinic} logoUrl={logoUrl} partnerLogoUrl={partnerLogoUrl} compact={paper === 'A5'} />
        <DocSpacer />

        {/* Document Title */}
        <div className="mt-4 text-center">
          <h2 className="font-display text-sm font-bold uppercase tracking-widest text-[var(--doc-head)]">
            {isVoid ? 'BILL (VOID)' : supersededBy ? 'BILL (SUPERSEDED)' : isPaid ? 'BILL CUM RECEIPT' : 'BILL'}
          </h2>
        </div>

        {/* Invoice meta + patient grid */}
        <section className={`mt-3 grid grid-cols-2 ${paper === 'A5' ? 'gap-x-4' : 'gap-x-7'}`}>
          <DocFieldList
            compact={paper === 'A5'}
            rows={[
              { label: 'Patient Name', value: invoice.patientSnapshot.name, strong: true },
              { label: 'Patient ID', value: invoice.patientSnapshot.mrno },
              ...(invoice.patientSnapshot.age != null || invoice.patientSnapshot.sex
                ? [
                    {
                      label: 'Age / Gender',
                      value: [invoice.patientSnapshot.age != null ? `${invoice.patientSnapshot.age} Y` : null, invoice.patientSnapshot.sex]
                        .filter(Boolean)
                        .join(' / '),
                    },
                  ]
                : []),
              ...(invoice.patientSnapshot.phone ? [{ label: 'Phone', value: invoice.patientSnapshot.phone }] : []),
            ]}
          />
          <DocFieldList
            compact={paper === 'A5'}
            rows={[
              { label: 'Bill No', value: invoice.invoiceNo },
              { label: 'Billing Date', value: formatDateDMY(invoice.issuedAt) },
              ...(footerTherapists.length > 0
                ? [
                    {
                      label: footerTherapists.length === 1 ? 'Therapist' : 'Therapists',
                      value: footerTherapists.map((t) => `${t.name}${t.registrationNo ? ` · Reg. ${t.registrationNo}` : ''}`).join(', '),
                    },
                  ]
                : []),
              ...(statusLoaded
                ? [
                    {
                      label: 'Status',
                      value: isVoid ? 'VOID' : supersededBy ? 'SUPERSEDED' : isPaid ? 'PAID' : isPartial ? 'PART PAID' : 'PAYMENT DUE',
                      tone: (supersededBy ? 'muted' : isPaid ? 'good' : 'due') as 'good' | 'due' | 'muted',
                    },
                  ]
                : []),
            ]}
          />
        </section>

        {/* Clinical details: row by row, only what is filled (old invoices predate the field; bulk-issued invoices
            carry no snapshot by design). Two columns so it stays short. */}
        {(clinicalLeft.length > 0 || clinicalRight.length > 0) && (
          <section className="mt-2.5 border-t border-[var(--border)] pt-1.5">
            <h3 className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Clinical details</h3>
            <div className={`grid grid-cols-2 ${paper === 'A5' ? 'gap-x-4' : 'gap-x-7'}`}>
              <DocFieldList compact={paper === 'A5'} rows={clinicalLeft} />
              <DocFieldList compact={paper === 'A5'} rows={clinicalRight} />
            </div>
          </section>
        )}

        <DocSpacer />

        {/* Line items */}
        {isV2Invoice ? (
          <LineItemsTable lineItems={invoice.lineItems} hasAdjustments={hasAdjustments} paper={paper} />
        ) : (
          <LegacyLineItemsTable lineItems={invoice.lineItems} hasAdjustments={hasAdjustments} paper={paper} />
        )}

        {hasCondensedSessionDates(invoice.lineItems) && (
          <p className="mt-1.5 pl-3 text-[10px] italic text-[var(--muted)]">Full session dates are in the session log.</p>
        )}

        <BillTotals
          subtotalPaise={invoice.lineItems.reduce((acc, li) => acc + (li.totalPaise - li.adjustmentPaise), 0)}
          adjustmentPaise={invoice.lineItems.reduce((acc, li) => acc + li.adjustmentPaise, 0)}
          totalPaise={invoice.totalPaise}
          ledger={paymentLedger}
          compact={paper === 'A5'}
        />

        <DocSpacer />
        <p className="pl-3 text-[11px] text-[var(--muted)]">
          {paymentLedger && paymentLedger.balancePaise === 0 ? 'Received with thanks: ' : 'Amount in words: '}
          {amountInWords(paymentLedger ? (paymentLedger.balancePaise === 0 ? paymentLedger.paidPaise : paymentLedger.grossPaise) : invoice.totalPaise)}
        </p>

        {/* Terms and signature stay together as one block. They follow the content, with clear space above so the
            footer reads as separate from the bill (the free height goes to the gaps above and to the page's end). */}
        <div className={`${paper === 'A5' ? 'mt-7' : 'mt-10'} print:break-inside-avoid`} data-pdf-block>
          <PrintSignatureFooter
            signatureUrl={signatureUrl}
            signerName={
              footerTherapists.length === 1
                ? `${footerTherapists[0].name}${footerTherapists[0].registrationNo ? ` · Reg. ${footerTherapists[0].registrationNo}` : ''}`
                : null
            }
            left={
              <>
                <h4 className="mb-0.5 font-semibold text-[var(--ink)]">Terms & Conditions</h4>
                <ul className="mb-1.5 list-disc space-y-0.5 pl-3.5">
                  <li>All payments are final and non-refundable.</li>
                </ul>
                <p>
                  {invoice.invoiceNo} · issued {formatDateDMY(invoice.issuedAt)}
                </p>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
