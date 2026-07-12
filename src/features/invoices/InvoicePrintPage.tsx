import { useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';

export function InvoicePrintPage() {
  const clinic = useClinic();
  const { invoiceId } = useParams({ strict: false }) as { invoiceId: string };
  const invoice = useLiveQuery(() => repos.invoices.get(invoiceId), [invoiceId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const [paper, setPaper] = useState<'A4' | 'A5'>('A4');

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);
  const partnerLogoUrl = useMemo(
    () => publicLogoUrl(clinic.partnerHospitalLogoPath),
    [clinic.partnerHospitalLogoPath]
  );

  if (!invoice) {
    return <div className="p-8 text-sm text-[var(--muted)]">Invoice not found (or not yet synced).</div>;
  }

  const therapistName = therapists?.find((t) => t.id === invoice.therapistId)?.name;

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: ${paper}; margin: ${paper === 'A5' ? '10mm' : '16mm'}; }`}</style>

      <div className="no-print mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <Link to="/archive" className={btnSecondary}>
          ← Back
        </Link>
        <div className="ml-auto flex items-center gap-2">
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
          <div className="flex items-center gap-3">
            {logoUrl && <img src={logoUrl} alt="" className="h-14 w-auto object-contain" />}
            <div>
              <h1 className="font-display text-xl font-bold text-[var(--ink)]">{clinic.name}</h1>
              {clinic.address && <p className="text-xs text-[var(--muted)]">{clinic.address}</p>}
              <p className="text-xs text-[var(--muted)]">
                {[clinic.phone, clinic.email].filter(Boolean).join(' · ')}
              </p>
              {clinic.gstNo && <p className="text-xs text-[var(--muted)]">GSTIN: {clinic.gstNo}</p>}
            </div>
          </div>
          {clinic.partnerHospitalName && (
            <div className="flex items-center gap-2 text-right">
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
            <p className="text-[var(--muted)]">MRNO: {invoice.patientSnapshot.mrno}</p>
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
            <p className="text-lg font-bold text-[var(--ink)]">INVOICE</p>
            <p className="text-[var(--ink)]">{invoice.invoiceNo}</p>
            <p className="text-[var(--muted)]">{formatDateDMY(invoice.issuedAt)}</p>
          </div>
        </section>

        {/* Line items */}
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="py-2">Service</th>
              <th className="py-2">Sessions</th>
              <th className="py-2 text-right">Catalog price</th>
              <th className="py-2 text-right">Adjustment</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((li, i) => (
              <tr key={i} className="border-b border-[var(--border)] align-top">
                <td className="py-2 font-medium text-[var(--ink)]">{li.serviceName}</td>
                <td className="py-2 text-[var(--muted)]">
                  {li.sessionCount > 1 ? `${li.sessionDates.length} of ${li.sessionCount}` : '1'}
                  <div className="text-xs text-[var(--muted)]">
                    {li.sessionDates.map(formatDateDMY).join(', ')}
                  </div>
                </td>
                <td className="font-num py-2 text-right">{formatINR(li.catalogPricePaise)}</td>
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
                <td className="font-num py-2 text-right font-medium">
                  {formatINR(li.totalPaise)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-3 text-right font-semibold text-[var(--ink)]">
                Total
              </td>
              <td className="font-num py-3 text-right text-base font-bold text-[var(--ink)]">
                {formatINR(invoice.totalPaise)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="text-sm text-[var(--muted)]">Payment mode: {invoice.paymentMode}</p>

        {/* Footer */}
        <footer className="mt-12 flex items-end justify-between border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
          <div>
            <p>
              {invoice.invoiceNo} · issued {formatDateDMY(invoice.issuedAt)}
            </p>
            {therapistName && <p>Therapist: {therapistName}</p>}
          </div>
          <div className="text-center">
            <div className="mb-1 h-10 w-40 border-b border-[var(--border)]" />
            <p>Authorised signature</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
