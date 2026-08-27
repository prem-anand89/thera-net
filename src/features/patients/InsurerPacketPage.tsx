import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PatientProfileBackTarget } from '@/app/router';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatDateDMY } from '@/domain/fiscalYear';
import { formatINR } from '@/domain/money';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { NoteContent } from './NotePrintPage';
import { SessionLogContent, buildSessionLog } from './SessionLogPrintPage';
import type { Invoice } from '@/domain/types';

/** Compact, read-only rendering of an already-issued invoice's actual
 *  content — no recomputation, the same values `InvoicePrintPage.tsx`
 *  would show, just condensed for a packet rather than a standalone bill. */
function InvoiceSummary({ invoice }: { invoice: Invoice }) {
  return (
    <div className="mt-4 break-inside-avoid text-sm">
      <div className="flex justify-between">
        <p className="font-medium text-[var(--ink)]">{invoice.invoiceNo}</p>
        <p className="text-[var(--muted)]">{formatDateDMY(invoice.issuedAt)}</p>
      </div>
      <table className="mt-1 w-full text-xs">
        <thead>
          <tr className="text-left text-[var(--muted)]">
            <th className="py-1 font-semibold">Service</th>
            <th className="py-1 font-semibold">Sessions</th>
            <th className="py-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((li, i) => (
            <tr key={i} className="border-t border-[var(--border)]">
              <td className="py-1 text-[var(--ink)]">{li.serviceName}</td>
              <td className="py-1 text-[var(--ink)]">{li.sessionCount}</td>
              <td className="font-num py-1 text-right text-[var(--ink)]">
                {formatINR(li.totalPaise)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="py-1 text-right font-semibold text-[var(--ink)]">
              Total
            </td>
            <td className="font-num py-1 text-right font-semibold text-[var(--ink)]">
              {formatINR(invoice.totalPaise)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Insurer packet (C7) — assembles, in one print job: the enrollment's most
 * recent completed heavy assessment, the session log, and whichever
 * invoice(s) already cover the logged visits, read exactly as issued (no
 * new clinical fields on the invoice, no schema/RPC change — see the
 * Billing & Notes Rebuild Phase 2 plan for why that's in scope here while
 * writing new clinical fields onto an invoice is not). A visit with no
 * invoice yet is called out rather than silently omitted.
 */
export function InsurerPacketPage() {
  const clinic = useClinic();
  const { patientId, enrollmentId } = useParams({ strict: false }) as {
    patientId: string;
    enrollmentId: string;
  };
  const { from: backTo } = useSearch({ strict: false }) as { from?: PatientProfileBackTarget };
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const enrollmentNotes = useLiveQuery(
    () => repos.consultationNotes.listByEnrollment(enrollmentId),
    [enrollmentId]
  );
  const [paper, setPaper] = useState<'A4' | 'A5'>('A4');

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);
  const signatureUrl = useMemo(() => publicLogoUrl(clinic.signaturePath), [clinic.signaturePath]);

  useEffect(() => {
    if (!patient) return;
    const previousTitle = document.title;
    document.title = `${patient.name} - Insurer packet`;
    return () => {
      document.title = previousTitle;
    };
  }, [patient]);

  // Most recent completed heavy note in this enrollment — listByEnrollment
  // is oldest-first, so the last match is the latest.
  const heavyNote = useMemo(() => {
    const heavy = (enrollmentNotes ?? []).filter(
      (n) => n.status === 'completed' && (n.noteMode === 'initial' || n.noteMode === 'followup')
    );
    return heavy[heavy.length - 1];
  }, [enrollmentNotes]);

  const { sessions, therapistById, treatingTherapists } = useMemo(
    () => buildSessionLog(enrollmentNotes ?? [], therapists ?? []),
    [enrollmentNotes, therapists]
  );

  // The visits this episode's notes actually document — the join the
  // invoice section reads through (visitId → visits.invoiceId → invoice),
  // no new query shape.
  const visitIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of enrollmentNotes ?? []) {
      if (n.visitId) ids.add(n.visitId);
    }
    return [...ids];
  }, [enrollmentNotes]);
  const visits = useLiveQuery(() => repos.visits.listByIds(visitIds), [visitIds]);

  const invoiceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of visits ?? []) {
      if (v.invoiceId) ids.add(v.invoiceId);
    }
    return [...ids];
  }, [visits]);
  const invoices = useLiveQuery(async () => {
    const found = await Promise.all(invoiceIds.map((id) => repos.invoices.get(id)));
    return found.filter((inv): inv is Invoice => !!inv);
  }, [invoiceIds]);

  const uninvoicedVisitCount = (visits ?? []).filter((v) => !v.invoiceId).length;

  if (patient === undefined) {
    return (
      <div className="p-8 text-sm text-[var(--muted)]">Patient not found (or not yet synced).</div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: ${paper}; margin: ${paper === 'A5' ? '10mm' : '16mm'}; }`}</style>

      <div className="no-print mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <Link
          to="/patients/$patientId"
          params={{ patientId: patient.id }}
          search={backTo ? { from: backTo } : undefined}
          className={btnSecondary}
        >
          ← Back
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <select
            className={inputCls}
            value={paper}
            onChange={(e) => setPaper(e.target.value as 'A4' | 'A5')}
          >
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
          <button type="button" className={btnPrimary} onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      {heavyNote ? (
        <NoteContent
          note={heavyNote}
          patient={patient}
          therapist={therapistById.get(heavyNote.therapistId)}
          clinic={clinic}
          logoUrl={logoUrl}
          signatureUrl={signatureUrl}
        />
      ) : (
        <div className="mx-auto max-w-3xl bg-[var(--surface)] p-8 print:max-w-none print:p-0">
          <p className="text-sm text-[var(--muted)]">No completed initial assessment yet.</p>
        </div>
      )}

      <div style={{ breakBefore: 'page' }} />
      <SessionLogContent
        patient={patient}
        clinic={clinic}
        sessions={sessions}
        therapistById={therapistById}
        treatingTherapists={treatingTherapists}
        logoUrl={logoUrl}
        signatureUrl={signatureUrl}
      />

      <div style={{ breakBefore: 'page' }} />
      <div className="mx-auto max-w-3xl bg-[var(--surface)] p-8 print:max-w-none print:p-0">
        <h2 className="border-b border-[var(--border)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Billing
        </h2>
        {invoices && invoices.length > 0 ? (
          <>
            {invoices.map((inv) => (
              <InvoiceSummary key={inv.id} invoice={inv} />
            ))}
            {uninvoicedVisitCount > 0 && (
              <p className="mt-3 text-xs text-[var(--muted)]">
                {uninvoicedVisitCount} visit{uninvoicedVisitCount === 1 ? '' : 's'} in this episode
                not yet invoiced — not included above.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Invoice not included — no visit in this episode has been invoiced yet. Export it
            separately from Ledger once billed.
          </p>
        )}
      </div>
    </div>
  );
}
