import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, paymentService, invoiceService, visitService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { type Invoice, type PaymentMode } from '@/domain/types';
import { th, td, tdNum, ErrorNote, Pill, SectionCard, btnPrimary, btnSecondary, inputCls, Field } from '@/components/ui';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { toFriendlyMessage } from '@/lib/errors';

const PAYMENT_MODES: PaymentMode[] = ['Cash', 'Card', 'UPI', 'Insurance'];

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
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    patientId: '',
    therapistId: '',
    serviceCatalogId: '',
    billPaise: '',
    paymentMode: 'Cash' as PaymentMode,
    paidNow: true,
  });

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

  async function createManualInvoice() {
    if (!formData.patientId || !formData.therapistId || !formData.serviceCatalogId || !formData.billPaise) {
      setError('Please fill in all fields');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const billPaise = Math.round(parseInt(formData.billPaise, 10));
      if (isNaN(billPaise) || billPaise <= 0) {
        throw new Error('Invalid bill amount');
      }

      // Auto-create a minimal visit
      const visit = await visitService.create({
        clinicId: clinic.id,
        patientId: formData.patientId,
        therapistId: formData.therapistId,
        visitDate: new Date().toISOString().split('T')[0],
        serviceCatalogId: formData.serviceCatalogId,
        actualBillPaise: billPaise,
        condition: 'Manual invoice',
        treatmentNotes: 'Manual invoice',
      });

      // Create invoice for the visit
      const invoice = await invoiceService.issueForVisit(visit.id, formData.paymentMode);

      // Set payment status
      try {
        await paymentService.setStatus(invoice.id, clinic.id, formData.paidNow ? 'paid' : 'outstanding');
      } catch (statusError) {
        console.error('Could not record payment status', statusError);
      }

      setShowAddModal(false);
      setFormData({
        patientId: '',
        therapistId: '',
        serviceCatalogId: '',
        billPaise: '',
        paymentMode: 'Cash',
        paidNow: true,
      });
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
          <button className={btnPrimary} onClick={() => setShowAddModal(true)}>
            + Add invoice
          </button>
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

      {showAddModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-[10px] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Add invoice</h2>

            <Field label="Patient">
              <select
                className={inputCls}
                value={formData.patientId}
                onChange={(e) => setFormData({ ...formData, patientId: e.target.value })}
              >
                <option value="">Select patient</option>
                {(patients ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.mrno})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Therapist">
              <select
                className={inputCls}
                value={formData.therapistId}
                onChange={(e) => setFormData({ ...formData, therapistId: e.target.value })}
              >
                <option value="">Select therapist</option>
                {(therapists ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Service">
              <select
                className={inputCls}
                value={formData.serviceCatalogId}
                onChange={(e) => setFormData({ ...formData, serviceCatalogId: e.target.value })}
              >
                <option value="">Select service</option>
                {(catalog ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Bill amount (₹)">
              <input
                type="number"
                className={inputCls}
                placeholder="0.00"
                step="0.01"
                value={formData.billPaise === '' ? '' : (parseInt(formData.billPaise, 10) / 100).toString()}
                onChange={(e) => setFormData({ ...formData, billPaise: Math.round((parseFloat(e.target.value || '0') * 100)).toString() })}
              />
            </Field>

            <Field label="Payment mode">
              <select
                className={inputCls}
                value={formData.paymentMode}
                onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value as PaymentMode })}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>

            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={formData.paidNow} onChange={() => setFormData({ ...formData, paidNow: true })} />
                Paid now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={!formData.paidNow} onChange={() => setFormData({ ...formData, paidNow: false })} />
                Outstanding
              </label>
            </div>

            {error && <ErrorNote message={error} />}

            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button className={btnPrimary} disabled={busy} onClick={() => void createManualInvoice()}>
                {busy ? 'Creating…' : 'Create invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
