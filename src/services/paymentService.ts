import type {
  Invoice,
  InvoicePayment,
  Payment,
  PaymentStatus,
  PaymentMethod,
  UUID,
} from '@/domain/types';
import type { Repos } from '@/repositories/types';
import type { Paise } from '@/domain/money';
import { formatINR } from '@/domain/money';
import { allocateAcrossVisits } from './advanceService';

/**
 * Pure repo CRUD, deliberately separate from invoiceService (which is
 * coupled to the issue_invoice Supabase RPC and has no existing tests).
 * Callers set the initial status right after issuing an invoice, and toggle
 * it later from the Invoices page.
 */
export function createPaymentService(repos: Repos) {
  async function setStatus(
    invoiceId: UUID,
    clinicId: UUID,
    status: PaymentStatus
  ): Promise<InvoicePayment> {
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
  }

  /**
   * How much of an invoice has actually been collected so far. There's no
   * amount column on invoice_payments (invoices are immutable, and that
   * table is just a paid/outstanding flag per invoice) — instead this sums
   * the same visit-scoped `payments` rows the direct-payment (no-invoice)
   * path already uses, across every visit this invoice covers. Works for
   * the common one-visit invoice and for a package invoice spanning several
   * visits alike.
   */
  async function invoiceBalance(
    clinicId: UUID,
    invoice: Invoice
  ): Promise<{ paidPaise: Paise; remainingPaise: Paise }> {
    const visits = (await repos.visits.list({ clinicId })).filter(
      (v) => v.invoiceId === invoice.id && !v.deleted
    );
    let paidPaise = 0;
    for (const v of visits) {
      const payments = await repos.payments.listByVisit(v.id);
      paidPaise += payments.reduce((sum, p) => sum + p.amountPaise, 0);
    }
    return { paidPaise, remainingPaise: Math.max(0, invoice.totalPaise - paidPaise) };
  }

  /**
   * Records a payment (partial or full) against an invoice. Reuses the
   * `payments` table rather than adding an amount column to
   * invoice_payments — see invoiceBalance above. The entered amount is
   * allocated across the invoice's constituent visits in date order (each
   * visit's own bill as the ceiling for what lands on it), so a package
   * invoice covering several visits still leaves every individual visit's
   * own payment state (computeVisitPaymentState) correct. Once the running
   * total reaches the invoice total, the invoice is marked paid the same
   * way the "Mark paid" toggle already does.
   */
  async function recordInvoicePayment(
    clinicId: UUID,
    invoice: Invoice,
    amountPaise: Paise,
    method: PaymentMethod,
    receivedDate: string,
    notes: string | null
  ): Promise<void> {
    const visits = (await repos.visits.list({ clinicId }))
      .filter((v) => v.invoiceId === invoice.id && !v.deleted)
      .sort((a, b) => a.visitDate.localeCompare(b.visitDate));
    if (visits.length === 0) {
      throw new Error('No visits found for this invoice — nothing to record the payment against.');
    }

    const paidByVisit = new Map<UUID, Paise>();
    let alreadyPaid = 0;
    for (const v of visits) {
      const payments = await repos.payments.listByVisit(v.id);
      const paid = payments.reduce((sum, p) => sum + p.amountPaise, 0);
      paidByVisit.set(v.id, paid);
      alreadyPaid += paid;
    }

    const remaining = invoice.totalPaise - alreadyPaid;
    if (amountPaise > remaining) {
      throw new Error(`Amount exceeds the outstanding balance of ${formatINR(remaining)}.`);
    }

    await allocateAcrossVisits(visits, paidByVisit, amountPaise, async (visitId, slicePaise) => {
      const payment: Payment = {
        id: crypto.randomUUID(),
        clinicId,
        visitId,
        amountPaise: slicePaise,
        method,
        receivedDate,
        notes,
        updatedAt: new Date().toISOString(),
      };
      await repos.payments.put(payment);
    });

    if (alreadyPaid + amountPaise >= invoice.totalPaise) {
      await setStatus(invoice.id, clinicId, 'paid');
    }
  }

  return { setStatus, invoiceBalance, recordInvoicePayment };
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
