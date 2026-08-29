import { formatINR, type Paise } from './money';
import type { PaymentStatus, UUID } from './types';
import { daysSince } from './packageTracking';

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
 * regardless of amounts. Outside that, `directPaymentAmountPaise` is
 * compared against the bill: less than the bill but still more than zero
 * is a real partial payment, not "done" — treating any nonzero amount as
 * fully collected (the old behavior) hid a ₹300 payment against a ₹500
 * bill as if the whole thing had been paid. This applies identically
 * whether or not there's an invoice — an invoiced visit's partial payments
 * are `payments` rows too (see paymentService.recordInvoicePayment), not a
 * separate mechanism, so a partially-paid invoice reads the same way a
 * partially-paid direct visit always has.
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
export function paymentStatusShortPhrase(
  state: VisitPaymentState,
  isPackageSession = false
): string {
  switch (state) {
    case 'zero_session':
      return isPackageSession ? 'Package' : 'No charge';
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
export function paymentStatusLine(
  state: VisitPaymentState,
  bill: string,
  isPackageSession = false
): string {
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

/** How many days an unpaid balance sits before it reads as Overdue rather
 *  than just Due. Exported so it's changeable in one place later. */
export const OVERDUE_AFTER_DAYS = 30;

export type PaymentBadgeKind = 'paid' | 'partial' | 'due' | 'overdue' | 'none';

/**
 * The 4-state collapse of `VisitPaymentState` for display (Billing & Notes
 * Rebuild Phase 1, D2): `paid`/`collected_no_receipt` → paid;
 * `partially_collected` → partial (or overdue tone, see below);
 * `outstanding`/`uninvoiced` → due or overdue depending on age;
 * `zero_session` → none. `paymentStatusPhrase`/`paymentStatusShortPhrase`
 * are unchanged and still used directly by callers that only need a label,
 * not a badge — this is additive, not a replacement.
 */
export function paymentBadge(input: {
  state: VisitPaymentState;
  billPaise: Paise;
  collectedPaise: Paise;
  visitDate: string;
  /** This visit's invoice's issuedAt, when one exists — anchors the
   *  Overdue clock at max(visitDate, issuedAt) instead of visitDate alone,
   *  so a package invoiced weeks after the visit gets a fresh window
   *  rather than reading Overdue the instant it's issued. */
  issuedAt?: string | null;
  isPackageSession?: boolean;
  asOf?: Date;
}): { kind: PaymentBadgeKind; label: string; shortLabel: string; title: string } {
  const { state, billPaise, collectedPaise, visitDate, issuedAt, isPackageSession, asOf } = input;
  const fullLabel = paymentStatusPhrase(state, isPackageSession);

  if (state === 'zero_session') {
    const label = paymentStatusShortPhrase(state, isPackageSession);
    return { kind: 'none', label, shortLabel: label, title: fullLabel };
  }
  if (state === 'paid' || state === 'collected_no_receipt') {
    return { kind: 'paid', label: 'Paid', shortLabel: 'Paid', title: fullLabel };
  }

  const anchor = issuedAt && issuedAt.slice(0, 10) > visitDate ? issuedAt.slice(0, 10) : visitDate;
  const overdue = daysSince(anchor, asOf) > OVERDUE_AFTER_DAYS;

  if (state === 'partially_collected') {
    const label =
      collectedPaise > 0 && collectedPaise < billPaise
        ? `${formatINR(collectedPaise)} of ${formatINR(billPaise)}`
        : 'Partial';
    // Tone escalates to overdue past the threshold; the label keeps saying
    // Partial — the partial-payment fact is more informative than a
    // generic "Overdue" and losing it on a still-informative row would be
    // a regression, not an improvement.
    return { kind: overdue ? 'overdue' : 'partial', label, shortLabel: label, title: fullLabel };
  }

  // outstanding / uninvoiced
  const label = overdue ? 'Overdue' : 'Due';
  return { kind: overdue ? 'overdue' : 'due', label, shortLabel: label, title: fullLabel };
}
