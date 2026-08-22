import type { Paise } from './money';
import type { PaymentStatus, UUID } from './types';

/**
 * A visit's payment state is three separate facts collapsed into one label
 * for display: Billed (the bill amount itself, always known), Collected
 * (has money actually been received — via a direct payment or a paid
 * invoice), and Receipted (does an invoice exist). `paid` and
 * `collected_no_receipt` are both "collected", differing only on
 * Receipted; `outstanding` and `uninvoiced` are both "not collected",
 * differing only on whether an invoice was ever issued.
 */
export type VisitPaymentState =
  | 'paid'
  | 'collected_no_receipt'
  | 'partially_collected'
  | 'outstanding'
  | 'uninvoiced'
  | 'zero_session';

/**
 * A missing invoice-payment-status row (rather than an explicit
 * 'outstanding' one) reads as paid, not outstanding — issuing an invoice
 * and recording its initial status are two separate writes, and if the
 * second one fails after the first succeeds, the invoice IS real and
 * shouldn't be hidden as if payment failed too. Correctable anytime from
 * the Invoices tab. An invoice explicitly marked paid always wins outright,
 * regardless of amounts (that path has no partial-payment concept of its
 * own — see TakePaymentDialog). Outside that, `directPaymentAmountPaise` is
 * compared against the bill: less than the bill but still more than zero
 * is a real partial payment, not "done" — treating any nonzero amount as
 * fully collected (the old behavior) hid a ₹300 payment against a ₹500
 * bill as if the whole thing had been paid.
 */
export function computeVisitPaymentState(
  actualBillPaise: Paise,
  invoiceId: UUID | null,
  directPaymentAmountPaise: Paise,
  invoiceStatus: PaymentStatus | undefined
): VisitPaymentState {
  if (actualBillPaise === 0) return 'zero_session';
  const invoiceMarkedPaid = invoiceId != null && invoiceStatus !== 'outstanding';
  if (invoiceMarkedPaid || directPaymentAmountPaise >= actualBillPaise) {
    return invoiceId ? 'paid' : 'collected_no_receipt';
  }
  if (directPaymentAmountPaise > 0) return 'partially_collected';
  return invoiceId ? 'outstanding' : 'uninvoiced';
}

/** Whether a payment state represents the bill fully settled, regardless of receipt. */
export function isCollected(state: VisitPaymentState): boolean {
  return state === 'paid' || state === 'collected_no_receipt';
}

export function paymentStatusPhrase(state: VisitPaymentState): string {
  switch (state) {
    case 'zero_session':
      return '₹0 session';
    case 'paid':
      return 'collected · invoiced';
    case 'collected_no_receipt':
      return 'collected · no invoice';
    case 'partially_collected':
      return 'partially collected';
    case 'outstanding':
      return 'not collected · invoiced';
    case 'uninvoiced':
      return 'not collected · no invoice';
  }
}

/** Shorter labels for cramped table cells — full phrase stays on cards (title attr). */
export function paymentStatusShortPhrase(state: VisitPaymentState): string {
  switch (state) {
    case 'zero_session':
      return 'No charge';
    case 'paid':
      return 'Invoiced';
    case 'collected_no_receipt':
      return 'Collected';
    case 'partially_collected':
      return 'Partial';
    case 'outstanding':
      return 'Due';
    case 'uninvoiced':
      return 'Unbilled';
  }
}

/**
 * One line for everyone: billed → collected → invoice.
 * `bill` is already formatted (e.g. ₹500). Prefer `paymentStatusPhrase`
 * next to a separate amount so the rupee figure is not repeated.
 */
export function paymentStatusLine(state: VisitPaymentState, bill: string): string {
  if (state === 'zero_session') return paymentStatusPhrase(state);
  return `${bill} billed · ${paymentStatusPhrase(state)}`;
}

export type VisitPaymentAction = 'take_payment' | 'issue_invoice';

/** Which money actions this visit still needs. */
export function paymentActions(state: VisitPaymentState): VisitPaymentAction[] {
  switch (state) {
    case 'uninvoiced':
      return ['take_payment', 'issue_invoice'];
    case 'outstanding':
    case 'partially_collected':
      return ['take_payment'];
    case 'collected_no_receipt':
      return ['issue_invoice'];
    default:
      return [];
  }
}
