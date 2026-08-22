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

/**
 * `zero_session` (bill = ₹0) covers two situations staff read very
 * differently: a session that's part of a multi-session package whose
 * price was already billed on an earlier visit (nothing new owed — the
 * session-progress dots already show this is a package), and a standalone
 * complimentary/free visit (never meant to be charged at all — no package
 * involved). Both are "nothing to collect, nothing to invoice" so they
 * share one `VisitPaymentState`; only the label differs, chosen by the
 * caller from context (`sessionIndex`/`packageTotal`) that payment state
 * itself doesn't carry. `isPackageSession` is ignored for every other
 * state, so passing nothing is always safe there.
 */
export function paymentStatusPhrase(state: VisitPaymentState, isPackageSession = false): string {
  switch (state) {
    case 'zero_session':
      return isPackageSession ? 'package session' : 'complimentary session';
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
export function paymentStatusShortPhrase(state: VisitPaymentState, isPackageSession = false): string {
  switch (state) {
    case 'zero_session':
      return isPackageSession ? 'Package' : 'Free';
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
export function paymentStatusLine(state: VisitPaymentState, bill: string, isPackageSession = false): string {
  if (state === 'zero_session') return paymentStatusPhrase(state, isPackageSession);
  return `${bill} billed · ${paymentStatusPhrase(state)}`;
}

/**
 * Whether a zero-bill visit is a package continuation (its session was
 * already billed on an earlier visit in the same package) rather than a
 * standalone complimentary/free visit — the one signal
 * `paymentStatusPhrase`/`paymentStatusShortPhrase`/`paymentStatusLine`
 * need to label `zero_session` correctly but don't carry themselves,
 * since it comes from the visit's session/package fields, not its
 * billing fields.
 */
export function isPackageContinuation(
  sessionIndex: number | null | undefined,
  packageTotal: number | null | undefined
): boolean {
  return Boolean(sessionIndex && packageTotal);
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
