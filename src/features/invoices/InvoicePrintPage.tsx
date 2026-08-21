import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import type { InvoicePrintBackTarget } from '@/app/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { amountInWords } from '@/domain/amountInWords';
import { formatDateDMY } from '@/domain/fiscalYear';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';

export function InvoicePrintPage() {
  const clinic = useClinic();
  const { invoiceId } = useParams({ strict: false }) as { invoiceId: string };
  const { from: backTo } = useSearch({ strict: false }) as { from?: InvoicePrintBackTarget };
  const invoice = useLiveQuery(() => repos.invoices.get(invoiceId), [invoiceId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  // Missing row reads as paid, matching computeVisitPaymentState's convention
  // (issuing an invoice and recording its initial payment status are two
  // separate writes — the invoice is still real if the second one lags).
  const invoicePayment = useLiveQuery(
    () => (invoice ? repos.invoicePayments.getByInvoiceId(invoice.id) : undefined),
    [invoice?.id]
  );
  const [paper, setPaper] = useState<'A4' | 'A5'>('A4');
  const [showVisitDates, setShowVisitDates] = useState(true);

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
    return <div className="p-8 text-sm text-[var(--muted)]">Invoice not found (or not yet synced).</div>;
  }

  const therapist = therapists?.find((t) => t.id === invoice.therapistId);
  const isPaid = invoicePayment?.status !== 'outstanding';
  const hasAdjustments = invoice.lineItems.some((li) => li.adjustmentPaise !== 0);

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: ${paper}; margin: ${paper === 'A5' ? '10mm' : '16mm'}; }`}</style>

      <div className="no-print mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <Link to={backTo ?? '/ledger'} className={btnSecondary}>
          ← Back
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={showVisitDates}
              onChange={(e) => setShowVisitDates(e.target.checked)}
            />
            Show visit dates
          </label>
          <select
            className={inputCls}
            value={paper}
            onChange={(e) => setPaper(e.target.value as 'A4' | 'A5')}
          >
            <option value="A4">A4</option>
            <option value="A5">A5 (receipt)</option>
          </select>
          <button className={btnPrimary} onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl bg-[var(--surface)] p-8 print:max-w-none print:p-0">
        {/* Letterhead */}
        <header className="flex items-start justify-between border-b border-[var(--border)] pb-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {logoUrl && <img src={logoUrl} alt="" className="h-14 w-auto shrink-0 object-contain" />}
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-[var(--ink)]">{clinic.name}</h1>
              {clinic.address && (
                <p className="whitespace-pre-line text-xs text-[var(--muted)]">{clinic.address}</p>
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
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">In partnership with</p>
                <p className="text-sm font-medium text-[var(--ink)]">{clinic.partnerHospitalName}</p>
              </div>
              {partnerLogoUrl && (
                <img src={partnerLogoUrl} alt="" className="h-10 w-auto object-contain" />
              )}
            </div>
          )}
        </header>

        {/* Invoice meta + patient */}
        <section className="mt-4 flex justify-between text-sm">
          <div>
            <p className="font-display font-semibold text-[var(--ink)]">{invoice.patientSnapshot.name}</p>
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

        {/* Line items */}
        <table className="mt-6 w-full text-sm">
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
            {invoice.lineItems.map((li, i) => {
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
                    {showVisitDates && (
                      <div className="text-xs text-[var(--muted)]">
                        {li.sessionDates.map(formatDateDMY).join(', ')}
                      </div>
                    )}
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
                  <td className="font-num py-2 text-right font-medium">
                    {formatINR(li.totalPaise)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={hasAdjustments ? 4 : 3} className="py-3 text-right font-semibold text-[var(--ink)]">
                Total
              </td>
              <td className="font-num py-3 text-right text-base font-bold text-[var(--ink)]">
                {formatINR(invoice.totalPaise)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-2 text-sm text-[var(--muted)]">
          {isPaid ? 'Received with thanks: ' : 'Amount in words: '}
          {amountInWords(invoice.totalPaise)}
        </p>

        <p className="mt-3 text-sm text-[var(--muted)]">Payment mode: {invoice.paymentMode}</p>

        {/* Footer */}
        <footer className="mt-12 flex items-end justify-between border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
          <div>
            <p>
              {invoice.invoiceNo} · issued {formatDateDMY(invoice.issuedAt)}
            </p>
            {therapist && (
              <p>
                Therapist: {therapist.name}
                {therapist.registrationNo && ` · Reg. No. ${therapist.registrationNo}`}
              </p>
            )}
          </div>
          <div className="text-center">
            {signatureUrl ? (
              <img src={signatureUrl} alt="" className="mb-1 h-10 w-40 object-contain object-bottom" />
            ) : (
              <div className="mb-1 h-10 w-40 border-b border-[var(--border)]" />
            )}
            <p>Authorised signature</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
