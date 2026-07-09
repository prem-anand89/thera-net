import type { InvoicePayment, PaymentStatus, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';

/**
 * Pure repo CRUD, deliberately separate from invoiceService (which is
 * coupled to the issue_invoice Supabase RPC and has no existing tests).
 * Callers set the initial status right after issuing an invoice, and toggle
 * it later from the Invoices page.
 */
export function createPaymentService(repos: Repos) {
  return {
    async setStatus(invoiceId: UUID, clinicId: UUID, status: PaymentStatus): Promise<InvoicePayment> {
      const existing = await repos.invoicePayments.getByInvoiceId(invoiceId);
      const payment: InvoicePayment = {
        id: existing?.id ?? crypto.randomUUID(),
        clinicId,
        invoiceId,
        status,
        paidAt: status === 'paid' ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      };
      await repos.invoicePayments.put(payment);
      return payment;
    },
  };
}
