import type { PaymentStatus } from './types';

/**
 * An invoice's status for display. No status row reads as paid — the same
 * rule as `computeVisitPaymentState`, Dues and the printed bill (an invoice
 * issued before status tracking, or whose status write failed).
 */
export function invoiceRowStatus(status: PaymentStatus | undefined): PaymentStatus {
  return status ?? 'paid';
}

/**
 * "Mark outstanding" undoes a paid flag that has no money behind it. Once a
 * payment is recorded against the invoice's visits, the flag is backed by
 * real cash and stays.
 */
export function canMarkOutstanding(status: PaymentStatus, recordedPaise: number): boolean {
  return status === 'paid' && recordedPaise === 0;
}

export type InvoiceDisplay = {
  label: 'Superseded' | 'Void' | 'Paid' | 'Partially paid' | 'Outstanding';
  tone: 'slate' | 'green' | 'amber';
  isPartial: boolean;
};

/**
 * The label and colour an invoice shows on every list. A superseded bill (replaced by an amended one) wins over its own
 * status; an outstanding bill with money already collected reads as partially paid.
 */
export function invoiceDisplayStatus(args: {
  isSuperseded: boolean;
  status: PaymentStatus;
  paidPaise: number;
}): InvoiceDisplay {
  const { isSuperseded, status, paidPaise } = args;
  if (isSuperseded) return { label: 'Superseded', tone: 'slate', isPartial: false };
  if (status === 'paid') return { label: 'Paid', tone: 'green', isPartial: false };
  if (status === 'void') return { label: 'Void', tone: 'slate', isPartial: false };
  if (paidPaise > 0) return { label: 'Partially paid', tone: 'amber', isPartial: true };
  return { label: 'Outstanding', tone: 'amber', isPartial: false };
}

/**
 * What has been collected and what is still due on an invoice. A paid bill is fully collected whatever the payment rows
 * say, a void one has nothing due, and an outstanding one owes its total less the money recorded against its visits.
 */
export function invoiceBalance(args: {
  status: PaymentStatus;
  totalPaise: number;
  recordedPaise: number;
}): { paidPaise: number; remainingPaise: number } {
  const { status, totalPaise, recordedPaise } = args;
  if (status === 'paid') return { paidPaise: totalPaise, remainingPaise: 0 };
  if (status === 'void') return { paidPaise: 0, remainingPaise: 0 };
  return { paidPaise: recordedPaise, remainingPaise: Math.max(0, totalPaise - recordedPaise) };
}
