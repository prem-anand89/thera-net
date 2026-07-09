import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, paymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { Invoice, PaymentStatus } from '@/domain/types';
import { Pill, th, td, tdNum } from '@/components/ui';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';

export function InvoicesPage() {
  const clinic = useClinic();
  const invoices = useLiveQuery(() => repos.invoices.list(clinic.id), [clinic.id]);
  const payments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);

  // No invoice_payments row means the invoice predates this feature — every
  // invoice issued before now implied immediate payment, so default to Paid
  // rather than incorrectly flagging existing invoices as outstanding.
  const statusByInvoiceId = useMemo(
    () => new Map((payments ?? []).map((p) => [p.invoiceId, p.status])),
    [payments]
  );

  async function toggle(invoiceId: string, current: PaymentStatus) {
    await paymentService.setStatus(invoiceId, clinic.id, current === 'paid' ? 'outstanding' : 'paid');
  }

  const sort = useSort<'no' | 'date' | 'patient' | 'total' | 'status'>('date', 'desc');
  const sortedInvoices = applySort(
    invoices ?? [],
    {
      no: byNumber<Invoice>((inv) => inv.seq),
      date: byString<Invoice>((inv) => inv.issuedAt),
      patient: byString<Invoice>((inv) => inv.patientSnapshot.name),
      total: byNumber<Invoice>((inv) => inv.totalPaise),
      // 'outstanding' sorts before 'paid', so ascending surfaces unpaid first
      status: byString<Invoice>((inv) => statusByInvoiceId.get(inv.id) ?? 'paid'),
    },
    sort
  );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Invoices</h1>
      <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <SortHeader label="Invoice №" k="no" sort={sort} firstDir="desc" />
              <SortHeader label="Date" k="date" sort={sort} firstDir="desc" />
              <SortHeader label="Patient" k="patient" sort={sort} />
              <th className={th}>MRNO</th>
              <SortHeader label="Total" k="total" sort={sort} numeric firstDir="desc" />
              <th className={th}>Mode</th>
              <SortHeader label="Status" k="status" sort={sort} />
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sortedInvoices.map((inv) => {
              const status = statusByInvoiceId.get(inv.id) ?? 'paid';
              return (
                <tr key={inv.id} className="hover:bg-[var(--paper)]">
                  <td className={`${td} font-medium`}>{inv.invoiceNo}</td>
                  <td className={td}>{formatDateDMY(inv.issuedAt)}</td>
                  <td className={`${td} font-display`}>{inv.patientSnapshot.name}</td>
                  <td className={td}>{inv.patientSnapshot.mrno}</td>
                  <td className={tdNum}>{formatINR(inv.totalPaise)}</td>
                  <td className={td}>{inv.paymentMode}</td>
                  <td className={td}>
                    <Pill tone={status === 'paid' ? 'green' : 'amber'}>
                      {status === 'paid' ? 'Paid' : 'Outstanding'}
                    </Pill>
                    <button
                      className="ml-2 text-xs text-[var(--teal)] hover:underline"
                      onClick={() => void toggle(inv.id, status)}
                    >
                      Mark {status === 'paid' ? 'outstanding' : 'paid'}
                    </button>
                  </td>
                  <td className={td}>
                    <Link
                      to="/invoices/$invoiceId/print"
                      params={{ invoiceId: inv.id }}
                      className="font-medium text-[var(--teal)] hover:underline"
                    >
                      Print
                    </Link>
                  </td>
                </tr>
              );
            })}
            {invoices?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                  No invoices issued yet — issue one from the Visits table.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Issued invoices are immutable; numbering is sequential per fiscal year and gap-free.
        Payment status is tracked separately and doesn't affect the invoice itself.
      </p>
    </div>
  );
}
