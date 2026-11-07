import { Invoice, Payment, InvoicePayment, Visit, PaymentMethod, PatientAdvance } from './types';
import { advanceReceiptLabel } from './advanceReceipt';

export interface LedgerRow {
  date: string;
  mode: string;
  /** What lets someone trace the payment: a UTR, a cheque number, a receipt number, an advance's receipt label. */
  reference: string | null;
  amountPaise: number;
}

export interface InvoiceLedger {
  rows: LedgerRow[];
  grossPaise: number;
  paidPaise: number;
  balancePaise: number;
  /** Received beyond the bill (never negative). The balance is capped at 0, so this is the only place it shows. */
  excessPaise: number;
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  partner: 'Collected by partner',
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
  invoicePayment?: InvoicePayment,
  /** The advances any payment was drawn from, so its row can name the receipt. */
  advancesById: Map<string, Pick<PatientAdvance, 'receivedDate' | 'id'>> = new Map()
): InvoiceLedger {
  const grossPaise = invoice.totalPaise;
  let paidPaise = 0;

  // Map any explicit payment rows linked to this invoice's visits
  let rows: LedgerRow[] = payments.map((p) => {
    paidPaise += p.amountPaise;
    const advance = p.advanceId ? advancesById.get(p.advanceId) : undefined;
    return {
      date: p.receivedDate,
      mode: p.advanceId ? 'Advance' : PAYMENT_METHOD_LABELS[p.method] || p.method,
      // An advance's own note ("Applied from advance received …") is the system's wording, not a reference.
      reference: p.advanceId ? (advance ? advanceReceiptLabel(advance) : null) : p.notes?.trim() || null,
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
        reference: null,
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
    excessPaise: Math.max(0, paidPaise - grossPaise),
  };
}
