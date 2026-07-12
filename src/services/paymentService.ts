import type { InvoicePayment, Payment, PaymentStatus, PaymentMethod, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import type { Paise } from '@/domain/money';

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

/**
 * Direct payment service: log cash/UPI/etc payments independent of invoices.
 * These represent actual money received, whether or not an invoice was
 * generated. Routed through repos.payments (not raw Dexie) so writes go
 * through the same outbox/sync path as every other table.
 */
export function createDirectPaymentService(repos: Repos) {
  return {
    /** Log a payment received for a visit. */
    async logPayment(
      clinicId: UUID,
      visitId: UUID,
      amountPaise: Paise,
      method: PaymentMethod,
      receivedDate: string,
      notes: string | null = null
    ): Promise<Payment> {
      const payment: Payment = {
        id: crypto.randomUUID(),
        clinicId,
        visitId,
        amountPaise,
        method,
        receivedDate,
        notes,
        updatedAt: new Date().toISOString(),
      };
      await repos.payments.put(payment);
      return payment;
    },

    /** All payments for a clinic on a specific date. */
    paymentsOnDate(clinicId: UUID, date: string): Promise<Payment[]> {
      return repos.payments.listByDate(clinicId, date);
    },

    /** Total collected for a clinic on a specific date. */
    async collectedOnDate(clinicId: UUID, date: string): Promise<Paise> {
      const payments = await repos.payments.listByDate(clinicId, date);
      return payments.reduce((sum, p) => sum + p.amountPaise, 0);
    },

    /** Total collected for a date range. */
    async collectedInRange(clinicId: UUID, fromDate: string, toDate: string): Promise<Paise> {
      const payments = await repos.payments.list(clinicId);
      return payments
        .filter((p) => p.receivedDate >= fromDate && p.receivedDate <= toDate)
        .reduce((sum, p) => sum + p.amountPaise, 0);
    },

    /** Payments by method for a date. */
    async paymentsBreakdown(clinicId: UUID, date: string): Promise<Record<PaymentMethod, Paise>> {
      const payments = await repos.payments.listByDate(clinicId, date);
      const breakdown: Record<PaymentMethod, Paise> = {
        cash: 0,
        upi: 0,
        card: 0,
        bank_transfer: 0,
        cheque: 0,
      };
      payments.forEach((p) => {
        breakdown[p.method] += p.amountPaise;
      });
      return breakdown;
    },

    /** Delete a payment (e.g., if logged by mistake). */
    deletePayment(paymentId: UUID): Promise<void> {
      return repos.payments.delete(paymentId);
    },

    /** All payments for a visit. */
    paymentsForVisit(visitId: UUID): Promise<Payment[]> {
      return repos.payments.listByVisit(visitId);
    },

    /** Total paid for a visit across all payments. */
    async totalPaidForVisit(visitId: UUID): Promise<Paise> {
      const payments = await repos.payments.listByVisit(visitId);
      return payments.reduce((sum, p) => sum + p.amountPaise, 0);
    },
  };
}
