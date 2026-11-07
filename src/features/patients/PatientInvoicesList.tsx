import { Link } from '@tanstack/react-router';
import { formatAmount } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import { invoiceBalance, invoiceDisplayStatus, invoiceRowStatus } from '@/domain/invoiceStatus';
import type { Invoice, PaymentStatus } from '@/domain/types';
import { Pill } from '@/components/ui';

const actionCls = 'text-xs font-medium text-[var(--teal)] hover:underline';

/**
 * One patient's bills, newest first: number, date, total, status, and what the viewer may do next (print, take payment,
 * remind on WhatsApp). Cards below the `tab` breakpoint, a table from there up.
 */
export function PatientInvoicesList({
  invoices,
  statusByInvoiceId,
  recordedByInvoiceId,
  supersededInvoiceIds,
  visitIdByInvoiceId,
  patientId,
  canCollect,
  onTakePayment,
  onRemind,
}: {
  invoices: Invoice[];
  statusByInvoiceId: Map<string, PaymentStatus>;
  /** Money recorded against each invoice's visits so far. */
  recordedByInvoiceId: Map<string, number>;
  supersededInvoiceIds: Set<string>;
  /** One visit per invoice; an invoice whose visits were removed cannot take a payment. */
  visitIdByInvoiceId: Map<string, string>;
  patientId: string;
  canCollect: boolean;
  onTakePayment: (invoice: Invoice) => void;
  onRemind: (invoice: Invoice, remainingPaise: number) => void;
}) {
  if (invoices.length === 0) {
    return <p className="p-6 text-center text-sm text-[var(--muted)]">No bills for this patient yet.</p>;
  }

  const rows = invoices.map((inv) => {
    const isSuperseded = supersededInvoiceIds.has(inv.id);
    const status = invoiceRowStatus(statusByInvoiceId.get(inv.id));
    const { paidPaise, remainingPaise } = invoiceBalance({
      status,
      totalPaise: inv.totalPaise,
      recordedPaise: recordedByInvoiceId.get(inv.id) ?? 0,
    });
    const display = invoiceDisplayStatus({ isSuperseded, status, paidPaise });
    const open = !isSuperseded && status === 'outstanding';
    return {
      inv,
      isSuperseded,
      display,
      paidPaise,
      remainingPaise,
      canPay: open && canCollect && visitIdByInvoiceId.has(inv.id),
      canRemind: open && canCollect,
    };
  });

  const actions = (r: (typeof rows)[number]) => (
    <div className="flex flex-wrap items-center gap-3">
      {r.canPay && (
        <button type="button" className={actionCls} onClick={() => onTakePayment(r.inv)}>
          Take payment
        </button>
      )}
      {r.canRemind && (
        <button type="button" className={actionCls} onClick={() => onRemind(r.inv, r.remainingPaise)}>
          Send WhatsApp reminder
        </button>
      )}
      <Link
        to="/invoices/$invoiceId/print"
        params={{ invoiceId: r.inv.id }}
        search={{ from: '/patients', patient: patientId }}
        className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
      >
        Print
      </Link>
    </div>
  );

  const partial = (r: (typeof rows)[number]) =>
    r.display.isPartial ? (
      <p className="mt-1 text-xs text-[var(--muted)]">
        {formatAmount(r.paidPaise)} collected · {formatAmount(r.remainingPaise)} due
      </p>
    ) : null;

  return (
    <div>
      <div className="space-y-2 p-3 tab:hidden">
        {rows.map((r) => (
          <div
            key={r.inv.id}
            className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm ${r.isSuperseded ? 'opacity-60' : ''}`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="slate">{r.inv.invoiceNo}</Pill>
              <Pill tone="slate">{formatDateDM(r.inv.issuedAt)}</Pill>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-num text-sm font-medium text-[var(--ink)]">{formatAmount(r.inv.totalPaise)}</span>
              <Pill tone={r.display.tone}>{r.display.label}</Pill>
            </div>
            {partial(r)}
            <div className="mt-3">{actions(r)}</div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto tab:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-4 py-2 font-medium">Bill</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((r) => (
              <tr key={r.inv.id} className={r.isSuperseded ? 'opacity-60' : ''}>
                <td className="px-4 py-3 font-num">{r.inv.invoiceNo}</td>
                <td className="px-4 py-3 font-num">{formatDateDM(r.inv.issuedAt)}</td>
                <td className="px-4 py-3 text-right font-num">{formatAmount(r.inv.totalPaise)}</td>
                <td className="px-4 py-3">
                  <Pill tone={r.display.tone}>{r.display.label}</Pill>
                  {partial(r)}
                </td>
                <td className="px-4 py-3">{actions(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
