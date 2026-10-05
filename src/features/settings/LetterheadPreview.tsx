import { useClinic } from '@/app/clinicContext';
import { PrintLetterhead, PrintSignatureFooter } from '@/features/invoices/printChrome';
import { publicLogoUrl } from '@/lib/supabase';
import type { Clinic } from '@/domain/types';

import { useEffect, useRef } from 'react';

export interface LetterheadPreviewProps {
  draft: Pick<Clinic, 'name' | 'address' | 'phone' | 'email' | 'gstNo' | 'partnerHospitalName'>;
  logoUrl: string | null;
  partnerLogoUrl: string | null;
}

export function LetterheadPreview({ draft, logoUrl, partnerLogoUrl }: LetterheadPreviewProps) {
  const realClinic = useClinic();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !contentRef.current) return;
    const updateScale = () => {
      const parentWidth = containerRef.current!.offsetWidth;
      contentRef.current!.style.transform = `scale(${parentWidth / 794})`;
    };
    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);
    updateScale();
    return () => observer.disconnect();
  }, []);

  // Spread the real clinic to get all required fields, then override with the draft fields
  const previewClinic: Clinic = {
    ...realClinic,
    ...draft,
    name: draft.name || 'Your clinic name',
  };

  return (
    <div className="flex flex-col">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        Invoice preview
      </div>
      <div
        ref={containerRef}
        className="pointer-events-none overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm relative w-full aspect-[210/297]"
        aria-hidden="true"
      >
        <div 
          ref={contentRef}
          className="absolute top-0 left-0 origin-top-left w-[794px] h-[1123px] bg-white p-12 flex flex-col"
        >
        <PrintLetterhead
          clinic={previewClinic}
          logoUrl={logoUrl}
          partnerLogoUrl={partnerLogoUrl}
        />
        
        {/* Realistic static dummy data imitating an invoice */}
        <section className="mt-4 flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm opacity-80">
          <div>
            <p className="font-display font-semibold text-[var(--ink)]">
              Jane Doe
            </p>
            <p className="text-[var(--muted)]">Patient ID: P26-0001</p>
            <p className="text-[var(--muted)]">34y / Female</p>
          </div>
          <div className="text-right">
            <p className="font-display text-lg font-bold text-[var(--ink)]">
              BILL
            </p>
            <p className="text-[var(--ink)]">INV-2026-001</p>
            <p className="text-[var(--muted)]">15 Aug 2026</p>
            <p className="mt-1 inline-block rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-widest bg-[var(--moss-light)] border-[var(--moss-strong)] text-[var(--moss-strong)]">
              PAID
            </p>
          </div>
        </section>

        <div className="mt-6 overflow-x-auto print:overflow-visible opacity-80">
          <table className="w-full min-w-[680px] print:min-w-full text-sm table-fixed border-b-2 border-[var(--border)] pb-2">
            <thead>
              <tr className="border-y-2 border-[var(--border)] bg-[var(--teal-mist)] text-left font-medium text-[var(--ink)] text-xs">
                <th className="py-2 w-[30%]">Service</th>
                <th className="py-2 w-[20%]">Dates of service</th>
                <th className="py-2 w-[15%]">Sessions</th>
                <th className="py-2 w-[10%] text-right">Rate</th>
                <th className="py-2 w-[15%] text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="align-top border-b border-[var(--border)]">
              <tr className="border-b border-[var(--border)] align-top print:break-inside-avoid">
                <td className="py-2 font-medium text-[var(--ink)]">
                  Physical Therapy Session
                </td>
                <td className="py-2 text-xs text-[var(--muted)]">15 Aug 2026</td>
                <td className="py-2 text-[var(--muted)]">1 session</td>
                <td className="font-num py-2 text-right whitespace-nowrap">
                  ₹800
                  <span className="text-xs text-[var(--muted)]">/session</span>
                </td>
                <td className="font-num py-2 text-right font-medium whitespace-nowrap">₹800</td>
              </tr>
            </tbody>
            <tfoot className="print:break-inside-avoid">
              <tr>
                <td
                  colSpan={4}
                  className="py-3 text-right font-semibold text-[var(--ink)]"
                >
                  Total
                </td>
                <td className="font-num py-3 text-right text-base font-bold text-[var(--ink)] whitespace-nowrap">
                  ₹800
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="opacity-80 mt-auto">
          <PrintSignatureFooter left={<>Prepared by {realClinic.name}</>} signatureUrl={realClinic.signaturePath ? publicLogoUrl(realClinic.signaturePath) : null} />
        </div>
        </div>
      </div>
    </div>
  );
}
