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
