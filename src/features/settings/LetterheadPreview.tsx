import { useClinic } from '@/app/clinicContext';
import { PrintLetterhead, PrintSignatureFooter } from '@/features/invoices/printChrome';
import { publicLogoUrl } from '@/lib/supabase';
import type { Clinic } from '@/domain/types';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';

export interface LetterheadPreviewProps {
  draft: Pick<Clinic, 'name' | 'address' | 'phone' | 'email' | 'gstNo' | 'partnerHospitalName'>;
  logoUrl: string | null;
  partnerLogoUrl: string | null;
}

function InvoiceMockContent({ clinic, logoUrl, partnerLogoUrl }: { clinic: Clinic, logoUrl: string | null, partnerLogoUrl: string | null }) {
  return (
    <div className="w-[794px] h-[1123px] bg-white p-12 flex flex-col relative text-[var(--ink)]">
      <PrintLetterhead clinic={clinic} logoUrl={logoUrl} partnerLogoUrl={partnerLogoUrl} />

      <div className="mt-6 text-center">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-[var(--ink)]">
          BILL CUM RECEIPT
        </h2>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-x-8 gap-y-1 text-[11px]">
        <div>
          <table className="w-full text-left table-fixed">
            <tbody>
              <tr>
                <th className="w-1/3 py-0.5 font-medium text-[var(--muted)] align-top">Patient Name</th>
                <td className="py-0.5 text-[var(--ink)] align-top font-semibold truncate">: Jane Doe</td>
              </tr>
              <tr>
                <th className="w-1/3 py-0.5 font-medium text-[var(--muted)] align-top">Patient ID</th>
                <td className="py-0.5 text-[var(--ink)] align-top">: P26-0001</td>
              </tr>
              <tr>
                <th className="w-1/3 py-0.5 font-medium text-[var(--muted)] align-top">Age / Gender</th>
                <td className="py-0.5 text-[var(--ink)] align-top">: 34 Y / Female</td>
              </tr>
              <tr>
                <th className="w-1/3 py-0.5 font-medium text-[var(--muted)] align-top">Phone</th>
                <td className="py-0.5 text-[var(--ink)] align-top">: 9876543210</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <table className="w-full text-left table-fixed">
            <tbody>
              <tr>
                <th className="w-1/3 py-0.5 font-medium text-[var(--muted)] align-top">Bill No</th>
                <td className="py-0.5 text-[var(--ink)] align-top">: INV-2026-001</td>
              </tr>
              <tr>
                <th className="w-1/3 py-0.5 font-medium text-[var(--muted)] align-top">Billing Date</th>
                <td className="py-0.5 text-[var(--ink)] align-top">: 15 Aug 2026</td>
              </tr>
              <tr>
                <th className="w-1/3 py-0.5 font-medium text-[var(--muted)] align-top">Consultant</th>
                <td className="py-0.5 text-[var(--ink)] align-top truncate">: Dr. Smith</td>
              </tr>
              <tr>
                <th className="w-1/3 py-0.5 font-medium text-[var(--muted)] align-top">Status</th>
                <td className="py-0.5 font-semibold align-top text-[var(--teal)]">: PAID</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6 overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[680px] print:min-w-full text-sm table-fixed border-b-2 border-[var(--border)] pb-2">
          <thead>
            <tr className="border-y-2 border-[var(--border)] bg-[var(--teal-mist)] text-left font-medium text-[var(--ink)] text-xs">
              <th className="py-2 w-[25%]">Service</th>
              <th className="py-2 w-[20%]">Dates of service</th>
              <th className="py-2 w-[15%]">Sessions</th>
              <th className="py-2 text-right w-[15%] pr-4">Unit Price</th>
              <th className="py-2 w-[10%] text-right pr-4">Adjustment</th>
              <th className="py-2 w-[15%] text-right pr-2">Amount</th>
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
              <td className="font-num py-2 text-right whitespace-nowrap pr-4">₹800</td>
              <td className="font-num py-2 text-right whitespace-nowrap pr-4">—</td>
              <td className="font-num py-2 text-right font-medium whitespace-nowrap pr-2">₹8,000</td>
            </tr>
            <tr className="border-b border-[var(--border)] align-top print:break-inside-avoid">
              <td className="py-2 font-medium text-[var(--ink)]">Therapeutic Ultrasound</td>
              <td className="py-2 text-xs text-[var(--muted)]">15 Aug 2026</td>
              <td className="py-2 text-[var(--muted)]">1 session</td>
              <td className="font-num py-2 text-right whitespace-nowrap pr-4">₹300</td>
              <td className="font-num py-2 text-right whitespace-nowrap pr-4">-₹50</td>
              <td className="font-num py-2 text-right font-medium whitespace-nowrap pr-2">₹250</td>
            </tr>
          </tbody>
          <tfoot className="print:break-inside-avoid">
            <tr>
              <td colSpan={5} className="pt-3 pb-1 text-right font-medium text-[var(--muted)]">Subtotal</td>
              <td className="font-num pt-3 pb-1 text-right text-[var(--muted)] whitespace-nowrap pr-2">₹8,300</td>
            </tr>
            <tr>
              <td colSpan={5} className="py-1 text-right font-medium text-[var(--muted)]">Total Adjustment</td>
              <td className="font-num py-1 text-right text-[var(--muted)] whitespace-nowrap pr-2">-₹50</td>
            </tr>
            <tr>
              <td colSpan={5} className="py-3 text-right font-semibold text-[var(--ink)] border-b border-[var(--border)] border-dashed">Total</td>
              <td className="font-num py-3 text-right text-base font-bold text-[var(--ink)] whitespace-nowrap border-b border-[var(--border)] border-dashed">₹8,250</td>
            </tr>
            <tr>
              <td colSpan={5} className="py-2 text-right font-medium text-[var(--muted)]">Amount Paid</td>
              <td className="font-num py-2 text-right text-[var(--ink)] whitespace-nowrap">₹8,250</td>
            </tr>
            <tr>
              <td colSpan={5} className="py-2 text-right font-medium text-[var(--ink)]">Balance Due</td>
              <td className="font-num py-2 text-right text-[var(--ink)] whitespace-nowrap">₹0</td>
            </tr>
          </tfoot>
        </table>
      </div>
      
      <div className="mt-8 flex justify-between items-start">
        <div className="w-[55%] pr-8">
          <p className="mb-2 font-medium text-[var(--muted)] border-b border-[var(--border)] pb-1 text-xs">Payment Details</p>
          <table className="w-full text-left text-[11px] mb-4">
            <thead>
              <tr className="text-[var(--muted)]">
                <th className="py-1 w-[30%] font-medium">Date</th>
                <th className="py-1 w-[40%] font-medium">Mode</th>
                <th className="py-1 w-[30%] font-medium text-right pr-2">Amount</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-[var(--border)] border-dashed last:border-0">
                <td className="py-1.5 text-[var(--ink)]">15 Aug 2026</td>
                <td className="py-1.5 text-[var(--ink)]">UPI</td>
                <td className="py-1.5 font-num text-right text-[var(--ink)] whitespace-nowrap pr-2">₹8,250</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-[var(--muted)]">
        Received with thanks: Rupees Eight Thousand Two Hundred Fifty Only
      </p>

      <div className="mt-auto pt-12">
        <div className="mb-8 border-t border-[var(--border)] pt-4 text-[10px] text-[var(--muted)]">
          <h4 className="font-semibold text-[var(--ink)] mb-1">Terms & Conditions</h4>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>All payments are final and non-refundable.</li>
            <li>Please retain this bill for your records and future reference.</li>
            <li>For any queries regarding this bill, please contact the clinic administration.</li>
          </ul>
        </div>
        <PrintSignatureFooter 
          left={<>
            <p>INV-2026-001 · issued 15 Aug 2026</p>
            <p>Therapist: Dr. Smith</p>
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
        className="group relative block w-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] rounded-xl"
      >
        <div
          ref={containerRef}
          className="pointer-events-none overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm relative w-full aspect-[210/297] transition-all group-hover:shadow-md group-hover:border-[var(--brand-muted)]"
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
            role="dialog"
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
