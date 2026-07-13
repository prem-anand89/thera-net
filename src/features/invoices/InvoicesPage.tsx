import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, paymentService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { type Invoice } from '@/domain/types';
import { th, td, tdNum, ErrorNote, Pill, SectionCard } from '@/components/ui';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { toFriendlyMessage } from '@/lib/errors';

type InvoiceSortKey = 'no' | 'date' | 'patient' | 'total' | 'status';
const INVOICE_COMPARATORS = {
  no: byString<Invoice>((inv) => inv.invoiceNo),
  date: byString<Invoice>((inv) => inv.issuedAt),
  patient: byString<Invoice>((inv) => inv.patientSnapshot.name),
  total: byNumber<Invoice>((inv) => inv.totalPaise),
  status: byString<Invoice>(() => ''),
};

export function InvoicesPage() {
  const clinic = useClinic();
  const invoices = useLiveQuery(() => repos.invoices.list(clinic.id), [clinic.id]);
  const payments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sort = useSort<InvoiceSortKey>('date', 'desc');

  const statusByInvoiceId = useMemo(
    () => new Map((payments ?? []).map((p) => [p.invoiceId, p.status])),
    [payments]
  );

  const sortedInvoices = useMemo(
    () =>
      applySort(
        invoices ?? [],
        INVOICE_COMPARATORS,
        sort
      ),
    [invoices, sort]
  );

  const totalOutstanding = useMemo(
    () =>
      (invoices ?? [])
        .filter((inv) => statusByInvoiceId.get(inv.id) === 'outstanding')
        .reduce((sum, inv) => sum + inv.totalPaise, 0),
    [invoices, statusByInvoiceId]
  );

  const totalCollected = useMemo(
    () =>
      (invoices ?? [])
        .filter((inv) => statusByInvoiceId.get(inv.id) !== 'outstanding')
        .reduce((sum, inv) => sum + inv.totalPaise, 0),
    [invoices, statusByInvoiceId]
  );

  async function toggleInvoiceStatus(invoiceId: string, currentStatus: string) {
    setError(null);
    setBusy(true);
    try {
      const newStatus = currentStatus === 'paid' ? 'outstanding' : 'paid';
      await paymentService.setStatus(invoiceId, clinic.id, newStatus);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Invoices & Billing</h1>

      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Total Collected</div>
          <div className="text-2xl font-display font-semibold text-[var(--ink)]">{formatINR(totalCollected)}</div>
        </div>
        <div className="flex-1 min-w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Outstanding</div>
          <div className="text-2xl font-display font-semibold text-[var(--rust)]">{formatINR(totalOutstanding)}</div>
        </div>
        <div className="flex-1 min-w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-1">Total Invoiced</div>
          <div className="text-2xl font-display font-semibold text-[var(--ink)]">
            {formatINR(totalCollected + totalOutstanding)}
          </div>
        </div>
      </div>

      <SectionCard title="Invoices">
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-[var(--paper)]">
                <tr>
                  <SortHeader label="Invoice No" k="no" sort={sort} firstDir="desc" />
                  <SortHeader label="Date" k="date" sort={sort} firstDir="desc" />
                  <SortHeader label="Patient" k="patient" sort={sort} />
                  <th className={th}>Patient ID</th>
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
                          className="ml-2 text-xs text-[var(--teal)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => void toggleInvoiceStatus(inv.id, status)}
                          disabled={busy}
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
          {error && <ErrorNote message={error} />}
          <p className="text-xs text-[var(--muted)]">
            Issued invoices are immutable; numbering is sequential per fiscal year and gap-free.
            Payment status is tracked separately and doesn't affect the invoice itself.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
