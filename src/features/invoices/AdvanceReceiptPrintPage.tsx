import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import type { PatientProfileBackTarget } from '@/app/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { amountInWords } from '@/domain/amountInWords';
import { formatDateDMY } from '@/domain/fiscalYear';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary } from '@/components/ui';
import { PrintLetterhead, PrintSignatureFooter } from './printChrome';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

export function AdvanceReceiptPrintPage() {
  const clinic = useClinic();
  const { patientId, advanceId } = useParams({ strict: false }) as {
    patientId: string;
    advanceId: string;
  };
  const { from: backTo } = useSearch({ strict: false }) as { from?: PatientProfileBackTarget };
  const advance = useLiveQuery(() => repos.patientAdvances.get(advanceId), [advanceId]);
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);
  const partnerLogoUrl = useMemo(
    () => publicLogoUrl(clinic.partnerHospitalLogoPath),
    [clinic.partnerHospitalLogoPath]
  );
  const signatureUrl = useMemo(() => publicLogoUrl(clinic.signaturePath), [clinic.signaturePath]);

  useEffect(() => {
    if (!advance || !patient) return;
    const previousTitle = document.title;
    document.title = `Advance receipt - ${patient.name}`;
    return () => {
      document.title = previousTitle;
    };
  }, [advance, patient]);

  if (advance === undefined || patient === undefined) {
    return <div className="p-8 text-sm text-[var(--muted)]">Loading…</div>;
  }
  if (!advance || !patient) {
    return (
      <div className="p-8 text-sm text-[var(--muted)]">Advance not found (or not yet synced).</div>
    );
  }

  // D4: no gap-free numbered series for advances yet — identified by date +
  // a short slice of the id, same as any other non-invoice record.
  const receiptLabel = `ADV-${advance.receivedDate.replace(/-/g, '')}-${advance.id.slice(0, 6).toUpperCase()}`;

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: A5; margin: 10mm; }`}</style>

      <div className="no-print mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <Link
          to="/patients/$patientId"
          params={{ patientId }}
          search={backTo ? { from: backTo } : undefined}
          className={btnSecondary}
        >
          ← Back
        </Link>
        <button type="button" className={`ml-auto ${btnPrimary}`} onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      <div className="mx-auto max-w-3xl bg-[var(--surface)] p-8 print:max-w-[128mm] print:p-0">
        <PrintLetterhead clinic={clinic} logoUrl={logoUrl} partnerLogoUrl={partnerLogoUrl} />

        <section className="mt-4 flex justify-between text-sm">
          <div>
            <p className="font-display font-semibold text-[var(--ink)]">{patient.name}</p>
            <p className="text-[var(--muted)]">Patient ID: {patient.mrno}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-[var(--ink)]">ADVANCE RECEIPT</p>
            <p className="text-[var(--ink)]">{receiptLabel}</p>
            <p className="text-[var(--muted)]">{formatDateDMY(advance.receivedDate)}</p>
          </div>
        </section>

        <div className="mt-6 rounded-md border border-[var(--border)] p-4">
          <p className="font-num text-2xl font-bold text-[var(--ink)]">
            {formatINR(advance.amountPaise)}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">{amountInWords(advance.amountPaise)}</p>
          <p className="mt-3 text-sm text-[var(--ink)]">
            Received via {METHOD_LABEL[advance.method] ?? advance.method}
          </p>
          {advance.notes && <p className="mt-1 text-sm text-[var(--muted)]">{advance.notes}</p>}
        </div>

        <p className="mt-4 text-sm text-[var(--muted)]">
          Adjustable against future treatment. This is not a bill for services rendered — a dated,
          itemised invoice is issued separately as sessions are delivered.
        </p>

        <PrintSignatureFooter
          signatureUrl={signatureUrl}
          left={
            <p>
              {receiptLabel} · issued {formatDateDMY(advance.receivedDate)}
            </p>
          }
        />
      </div>
    </div>
  );
}
