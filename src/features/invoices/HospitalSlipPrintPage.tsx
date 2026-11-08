import { useMemo } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import type { InvoicePrintBackTarget } from '@/app/router';
import { formatAmount } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { buildHospitalSlip } from '@/domain/hospitalSlip';
import { btnPrimary, btnSecondary } from '@/components/ui';

/**
 * Hospital billing slip: one compact page for the hospital counter (date, IPD no, patient, ward/bed, service, therapist,
 * charge, and a signature line for each therapist). Built only from the issued bill, so it always matches it.
 */
export function HospitalSlipPrintPage() {
  const clinic = useClinic();
  const { invoiceId } = useParams({ strict: false }) as { invoiceId: string };
  const { from: backTo, patient: backPatient } = useSearch({ strict: false }) as { from?: InvoicePrintBackTarget; patient?: string };
  const invoice = useLiveQuery(() => repos.invoices.get(invoiceId), [invoiceId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const slip = useMemo(() => (invoice && therapists ? buildHospitalSlip(invoice, therapists) : null), [invoice, therapists]);

  if (!invoice || !slip) {
    return <div className="p-8 text-sm text-[var(--muted)]">{invoice === undefined ? 'Loading…' : 'Bill not found (or not yet synced).'}</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: A5; margin: 10mm; }`}</style>
      <div className="no-print mx-auto flex max-w-2xl flex-wrap items-center gap-2 px-4 py-3">
        <Link
          to="/invoices/$invoiceId/print"
          params={{ invoiceId }}
          search={{ ...(backTo ? { from: backTo } : {}), ...(backPatient ? { patient: backPatient } : {}) }}
          className={btnSecondary}
        >
          ← Back to bill
        </Link>
        <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      <div className="mx-auto max-w-2xl bg-[var(--surface)] p-6 text-[13px] text-[var(--ink)] print:max-w-none print:p-0">
        <div className="flex items-baseline justify-between border-b border-[var(--ink)] pb-2">
          <div>
            <h1 className="font-display text-base font-semibold">{clinic.name}</h1>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Hospital billing slip</p>
          </div>
          <div className="text-right text-xs">
            <p>Bill {slip.invoiceNo}</p>
            <p>{formatDateDMY(invoice.issuedAt)}</p>
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1">
          <div className="flex gap-2">
            <dt className="text-[var(--muted)]">Patient</dt>
            <dd className="font-medium">
              {slip.patientName} <span className="font-normal text-[var(--muted)]">({slip.mrno})</span>
            </dd>
          </div>
          {slip.stayRows.map((r) => (
            <div key={r.label} className="flex gap-2">
              <dt className="text-[var(--muted)]">{r.label}</dt>
              <dd className="font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>

        <table className="mt-4 w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[var(--ink)] text-left">
              <th className="py-1 pr-2 font-semibold">Date</th>
              <th className="py-1 pr-2 font-semibold">Service</th>
              <th className="py-1 pr-2 font-semibold">Therapist</th>
              <th className="py-1 text-right font-semibold">Charge</th>
            </tr>
          </thead>
          <tbody>
            {slip.rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--border)] align-top print:break-inside-avoid">
                <td className="py-1.5 pr-2 whitespace-nowrap">{r.dates}</td>
                <td className="py-1.5 pr-2">
                  {r.service}
                  {r.sessions > 1 ? ` × ${r.sessions}` : ''}
                </td>
                <td className="py-1.5 pr-2">{r.therapist}</td>
                <td className="py-1.5 text-right tabular-nums">{formatAmount(r.chargePaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--ink)] font-semibold">
              <td colSpan={3} className="py-1.5 text-right">
                Total
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatAmount(slip.totalPaise)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-10 grid grid-cols-2 gap-8 text-xs">
          <div>
            {(slip.therapists.length > 0 ? slip.therapists : ['Therapist']).map((name) => (
              <div key={name} className="mb-6 border-t border-[var(--ink)] pt-1">
                {name}, therapist
              </div>
            ))}
          </div>
          <div>
            <div className="border-t border-[var(--ink)] pt-1">Hospital counter: received by</div>
          </div>
        </div>
      </div>
    </div>
  );
}
