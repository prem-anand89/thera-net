import { useDialogBehavior } from '@/components/dialogBehavior';
import { useClinic } from '@/app/clinicContext';
import { BillTotals, DocFieldList, DocSpacer, PrintLetterhead, PrintSignatureFooter } from '@/features/invoices/printChrome';
import { publicLogoUrl } from '@/lib/supabase';
import type { Clinic } from '@/domain/types';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { formatAmount } from '@/domain/money';

export interface LetterheadPreviewProps {
  draft: Pick<Clinic, 'name' | 'tagline' | 'address' | 'phone' | 'email' | 'gstNo' | 'partnerHospitalName'>;
  logoUrl: string | null;
  partnerLogoUrl: string | null;
}

function InvoiceMockContent({ clinic, logoUrl, partnerLogoUrl }: { clinic: Clinic, logoUrl: string | null, partnerLogoUrl: string | null }) {
  return (
    <div className="doc-paper w-[794px] h-[1123px] bg-[var(--surface)] p-12 flex flex-col relative text-[var(--ink)]">
      <PrintLetterhead clinic={clinic} logoUrl={logoUrl} partnerLogoUrl={partnerLogoUrl} />
      <DocSpacer />

      <div className="mt-6 text-center">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-[var(--ink)]">
          BILL CUM RECEIPT
        </h2>
      </div>

      <section className="mt-3 grid grid-cols-2 gap-x-7">
        <DocFieldList
          rows={[
            { label: 'Patient Name', value: 'Jane Doe', strong: true },
            { label: 'Patient ID', value: 'P26-0001' },
            { label: 'Age / Gender', value: '34 Y / Female' },
            { label: 'Phone', value: '9876543210' },
          ]}
        />
        <DocFieldList
          rows={[
            { label: 'Bill No', value: 'INV-2026-001' },
            { label: 'Billing Date', value: '15 Aug 2026' },
            { label: 'Therapist', value: 'Dr. Smith · Reg. 12345' },
            { label: 'Status', value: 'PAID', tone: 'good' },
          ]}
        />
      </section>

      <section className="mt-2.5 border-t border-[var(--border)] pt-1.5">
        <h3 className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Clinical details</h3>
        <div className="grid grid-cols-2 gap-x-7">
          <DocFieldList rows={[{ label: 'Ref. Physician', value: 'Dr. Sarah Connor (Reg. No. 12345)' }]} />
          <DocFieldList rows={[{ label: 'Place of service', value: 'Clinic' }, { label: 'Treatment', value: 'Post-Op Care' }]} />
        </div>
      </section>

      <DocSpacer />
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[680px] print:min-w-full text-sm table-fixed border-b-2 border-[var(--border)] pb-2">
          <thead>
            <tr className="border-y-2 border-[var(--border)] bg-[var(--teal-mist)] text-left font-medium text-[var(--ink)] text-xs">
              <th className="py-2 w-[28%]">Service</th>
              <th className="py-2 w-[20%]">Dates of service</th>
              <th className="py-2 w-[11%]">Sessions</th>
              <th className="py-2 text-right w-[14%] pr-4">Unit Price</th>
              <th className="py-2 w-[13%] text-right pr-4">Adjustment</th>
              <th className="py-2 w-[14%] text-right pr-2">Amount</th>
            </tr>
          </thead>
          <tbody className="align-top border-b border-[var(--border)]">
            <tr className="border-b border-[var(--border)] align-top print:break-inside-avoid">
              <td className="py-2 font-medium text-[var(--ink)]">
                Post-Op Rehabilitation
                <div className="mt-0.5 text-xs font-normal text-[var(--muted)]">Package of 10 sessions charged in full; 3 delivered to date.</div>
              </td>
              <td className="py-2 text-xs text-[var(--muted)]">12 Aug 2026 – 15 Aug 2026 (3 sessions)</td>
              <td className="py-2 text-[var(--muted)]">3 delivered of 10 authorised</td>
              <td className="font-num py-2 text-right whitespace-nowrap pr-4">{formatAmount(80000)}</td>
              <td className="font-num py-2 text-right whitespace-nowrap pr-4">—</td>
              <td className="font-num py-2 text-right font-medium whitespace-nowrap pr-2">{formatAmount(800000)}</td>
            </tr>
            <tr className="border-b border-[var(--border)] align-top print:break-inside-avoid">
              <td className="py-2 font-medium text-[var(--ink)]">Therapeutic Ultrasound</td>
              <td className="py-2 text-xs text-[var(--muted)]">15 Aug 2026</td>
              <td className="py-2 text-[var(--muted)]">1 session</td>
              <td className="font-num py-2 text-right whitespace-nowrap pr-4">{formatAmount(30000)}</td>
              <td className="font-num py-2 text-right whitespace-nowrap pr-4">-{formatAmount(5000)}</td>
              <td className="font-num py-2 text-right font-medium whitespace-nowrap pr-2">{formatAmount(25000)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <BillTotals
        subtotalPaise={830000}
        adjustmentPaise={-5000}
        totalPaise={825000}
        ledger={{ rows: [{ date: '2026-08-15', mode: 'UPI', reference: 'UTR 4093 8821 5577', amountPaise: 825000 }], paidPaise: 825000, balancePaise: 0, excessPaise: 0, grossPaise: 825000 }}
      />

      <DocSpacer />
      <p className="text-[11px] text-[var(--muted)]">
        Received with thanks: Rupees Eight Thousand Two Hundred Fifty Only
      </p>

      <div className="mt-10">
        <PrintSignatureFooter
          left={<>
            <h4 className="mb-0.5 font-semibold text-[var(--ink)]">Terms & Conditions</h4>
            <ul className="mb-1.5 list-disc space-y-0.5 pl-3.5">
              <li>All payments are final and non-refundable.</li>
            </ul>
            <p>INV-2026-001 · issued 15 Aug 2026</p>
          </>}
          signatureUrl={clinic.signaturePath ? publicLogoUrl(clinic.signaturePath) : null}
        />
      </div>
    </div>
  );
}

export function LetterheadPreview({ draft, logoUrl, partnerLogoUrl }: LetterheadPreviewProps) {
  const realClinic = useClinic();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useDialogBehavior<HTMLDivElement>(expanded, () => setExpanded(false));

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
      
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="group relative block w-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)] rounded-xl"
      >
        <div
          ref={containerRef}
          className="pointer-events-none overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm relative w-full aspect-[210/297] transition-all group-hover:shadow-md group-hover:border-[var(--teal)]/40"
          aria-hidden="true"
        >
          <div 
            ref={contentRef}
            className="absolute top-0 left-0 origin-top-left flex flex-col"
          >
            <InvoiceMockContent clinic={previewClinic} logoUrl={logoUrl} partnerLogoUrl={partnerLogoUrl} />
          </div>
        </div>
        
        {/* Hover overlay with expand icon/text */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--ink)]/5 rounded-xl">
          <div className="bg-[var(--surface)] shadow-md rounded-full px-4 py-2 text-sm font-medium text-[var(--ink)] border border-[var(--border)] flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            Click to expand
          </div>
        </div>
      </button>

      {expanded && createPortal(
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4 sm:p-8 overflow-y-auto"
          onClick={() => setExpanded(false)}
        >
          <div 
            ref={dialogRef} role="dialog"
            aria-modal="true"
            className="relative bg-[var(--surface)] shadow-2xl rounded-sm max-w-[794px] w-full my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              type="button" 
              onClick={() => setExpanded(false)}
              className="absolute top-4 right-4 z-10 rounded-full bg-[var(--surface)]/80 p-2 hover:bg-[var(--surface)] shadow-sm border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)] backdrop-blur-sm transition-colors"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
            <div className="w-full aspect-[210/297] relative overflow-hidden" ref={el => {
              if (!el) return;
              const updateExpandedScale = () => {
                const parentWidth = el.offsetWidth;
                const innerContent = el.firstElementChild as HTMLElement;
                if (innerContent) {
                  innerContent.style.transform = `scale(${parentWidth / 794})`;
                }
              };
              updateExpandedScale();
              const observer = new ResizeObserver(updateExpandedScale);
              observer.observe(el);
              return () => observer.disconnect();
            }}>
              <div className="absolute top-0 left-0 origin-top-left flex flex-col">
                <InvoiceMockContent clinic={previewClinic} logoUrl={logoUrl} partnerLogoUrl={partnerLogoUrl} />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
