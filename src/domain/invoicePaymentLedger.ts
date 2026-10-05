import { Invoice, Payment, InvoicePayment, Visit, PaymentMethod } from './types';

export interface LedgerRow {
  date: string;
  mode: string;
  amountPaise: number;
}

export interface InvoiceLedger {
  rows: LedgerRow[];
  grossPaise: number;
  paidPaise: number;
  balancePaise: number;
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
};

/**
 * Builds the formal payment ledger and computes the balance for an invoice printout.
 * Aggregates visit-level payments, gracefully falling back to legacy single-line
 * payment mode if no payments exist but the invoice is marked paid.
 */
export function buildInvoicePaymentLedger(
  invoice: Invoice,
  _visits: Visit[], // Provided if needed in future, currently payments are enough
  payments: Payment[],
  invoicePayment?: InvoicePayment
): InvoiceLedger {
  const grossPaise = invoice.totalPaise;
  let paidPaise = 0;

  // Map any explicit payment rows linked to this invoice's visits
  let rows: LedgerRow[] = payments.map((p) => {
    paidPaise += p.amountPaise;
    return {
      date: p.receivedDate,
      mode: PAYMENT_METHOD_LABELS[p.method] || p.method,
      amountPaise: p.amountPaise,
    };
  });

  // Fallback: If no explicit payment rows exist but the invoice was paid at issue
  // (or partially paid via legacy flows), we show a single line using the invoice's
  // legacy paymentMode field.
  if (rows.length === 0 && invoicePayment?.status && invoicePayment.status !== 'outstanding') {
    // For legacy paid invoices, the total is treated as paid.
    paidPaise = grossPaise;
    rows = [
      {
        date: invoice.issuedAt.split('T')[0] ?? '',
        mode: invoice.paymentMode,
        amountPaise: grossPaise,
      },
    ];
  }

  // Sort chronological
  rows.sort((a, b) => a.date.localeCompare(b.date));

  // Cap balance at 0 so overpayments don't show as negative balance due on the print
  const balancePaise = Math.max(0, grossPaise - paidPaise);

  return {
    rows,
    grossPaise,
    paidPaise,
    balancePaise,
  };
}
