import { describe, expect, it } from 'vitest';
import {
  computeVisitPaymentState,
  isCollected,
  isPackageContinuation,
  paymentActions,
  paymentStatusLine,
  paymentStatusPhrase,
  paymentStatusShortPhrase,
} from './paymentState';
import { rupeesToPaise as rs } from './money';

const INV = 'invoice-1';

describe('computeVisitPaymentState', () => {
  it('is zero_session when nothing was billed, regardless of anything else', () => {
    expect(computeVisitPaymentState(0, INV, rs(500), 'paid')).toBe('zero_session');
    expect(computeVisitPaymentState(0, null, 0, undefined)).toBe('zero_session');
  });

  it('is uninvoiced when nothing was collected and no invoice exists', () => {
    expect(computeVisitPaymentState(rs(500), null, 0, undefined)).toBe('uninvoiced');
  });

  it('is collected_no_receipt when a direct payment was logged but no invoice exists', () => {
    expect(computeVisitPaymentState(rs(500), null, rs(500), undefined)).toBe('collected_no_receipt');
  });

  it('is outstanding when invoiced but the invoice status is explicitly outstanding and nothing was paid directly', () => {
    expect(computeVisitPaymentState(rs(500), INV, 0, 'outstanding')).toBe('outstanding');
  });

  it('is paid when invoiced and the invoice status is paid', () => {
    expect(computeVisitPaymentState(rs(500), INV, 0, 'paid')).toBe('paid');
  });

  it('is paid when invoiced with a missing status row (not explicitly outstanding)', () => {
    expect(computeVisitPaymentState(rs(500), INV, 0, undefined)).toBe('paid');
  });

  it('is paid when invoiced-outstanding but a direct payment was logged anyway', () => {
    // e.g. cash was collected and logged separately instead of flipping the invoice's own status toggle
    expect(computeVisitPaymentState(rs(500), INV, rs(500), 'outstanding')).toBe('paid');
  });

  it('is partially_collected when a direct payment is less than the bill and no invoice covers it', () => {
    expect(computeVisitPaymentState(rs(500), null, rs(300), undefined)).toBe('partially_collected');
  });

  it('is partially_collected when invoiced-outstanding and a direct payment falls short of the bill', () => {
    expect(computeVisitPaymentState(rs(500), INV, rs(300), 'outstanding')).toBe('partially_collected');
  });

  it('is collected_no_receipt (not partial) once the direct payment reaches the bill exactly', () => {
    expect(computeVisitPaymentState(rs(500), null, rs(500), undefined)).toBe('collected_no_receipt');
  });

  it('is paid, not partially_collected, once an invoice is explicitly marked paid regardless of amount tracked', () => {
    expect(computeVisitPaymentState(rs(500), INV, rs(300), 'paid')).toBe('paid');
  });
});

describe('isCollected', () => {
  it('is true for paid and collected_no_receipt, false otherwise', () => {
    expect(isCollected('paid')).toBe(true);
    expect(isCollected('collected_no_receipt')).toBe(true);
    expect(isCollected('partially_collected')).toBe(false);
    expect(isCollected('outstanding')).toBe(false);
    expect(isCollected('uninvoiced')).toBe(false);
    expect(isCollected('zero_session')).toBe(false);
  });
});

describe('paymentStatusPhrase', () => {
  it('omits the rupee figure so a Bill column can stand alone', () => {
    expect(paymentStatusPhrase('paid')).toBe('collected · invoiced');
    expect(paymentStatusPhrase('collected_no_receipt')).toBe('collected · no invoice');
    expect(paymentStatusPhrase('partially_collected')).toBe('partially collected');
    expect(paymentStatusPhrase('outstanding')).toBe('not collected · invoiced');
    expect(paymentStatusPhrase('uninvoiced')).toBe('not collected · no invoice');
  });

  it('distinguishes a package continuation from a standalone complimentary visit', () => {
    expect(paymentStatusPhrase('zero_session', true)).toBe('package session');
    expect(paymentStatusPhrase('zero_session', false)).toBe('complimentary session');
    expect(paymentStatusPhrase('zero_session')).toBe('complimentary session'); // default: not a package
  });
});

describe('paymentStatusLine', () => {
  it('uses billed · collected · invoice for everyone', () => {
    expect(paymentStatusLine('paid', '₹500')).toBe('₹500 billed · collected · invoiced');
    expect(paymentStatusLine('collected_no_receipt', '₹500')).toBe('₹500 billed · collected · no invoice');
    expect(paymentStatusLine('outstanding', '₹500')).toBe('₹500 billed · not collected · invoiced');
    expect(paymentStatusLine('uninvoiced', '₹500')).toBe('₹500 billed · not collected · no invoice');
  });

  it('passes the package flag through for zero_session instead of restating the (always ₹0) bill', () => {
    expect(paymentStatusLine('zero_session', '₹500', true)).toBe('package session');
    expect(paymentStatusLine('zero_session', '₹500', false)).toBe('complimentary session');
  });
});

describe('isPackageContinuation', () => {
  it('is true only when both sessionIndex and packageTotal are set (and nonzero)', () => {
    expect(isPackageContinuation(2, 3)).toBe(true);
    expect(isPackageContinuation(null, 3)).toBe(false);
    expect(isPackageContinuation(2, null)).toBe(false);
    expect(isPackageContinuation(null, null)).toBe(false);
    expect(isPackageContinuation(0, 3)).toBe(false); // 0 is falsy — matches Boolean(sessionIndex && packageTotal)
  });
});

describe('paymentActions', () => {
  it('splits take payment from issue invoice', () => {
    expect(paymentActions('uninvoiced')).toEqual(['take_payment', 'issue_invoice']);
    expect(paymentActions('outstanding')).toEqual(['take_payment']);
    expect(paymentActions('partially_collected')).toEqual(['take_payment']);
    expect(paymentActions('collected_no_receipt')).toEqual(['issue_invoice']);
    expect(paymentActions('paid')).toEqual([]);
    expect(paymentActions('zero_session')).toEqual([]);
  });
});

describe('paymentStatusShortPhrase', () => {
  it('uses compact table labels', () => {
    expect(paymentStatusShortPhrase('collected_no_receipt')).toBe('Collected');
    expect(paymentStatusPhrase('collected_no_receipt')).toBe('collected · no invoice');
  });

  it('distinguishes a package continuation from a standalone complimentary visit, instead of a bare repeated ₹0', () => {
    // The table's Bill column already shows ₹0 for these rows — the Status
    // cell restating the same figure explains nothing, and collapsing both
    // situations into one word hid that they're unrelated: a package
    // continuation (already billed elsewhere, nothing new owed) vs. a
    // standalone complimentary visit (never meant to be charged at all).
    expect(paymentStatusShortPhrase('zero_session', true)).toBe('Package');
    expect(paymentStatusShortPhrase('zero_session', false)).toBe('No charge');
  });
});
