import { describe, expect, it } from 'vitest';
import { computeVisitPaymentState, isCollected } from './paymentState';
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
});

describe('isCollected', () => {
  it('is true for paid and collected_no_receipt, false otherwise', () => {
    expect(isCollected('paid')).toBe(true);
    expect(isCollected('collected_no_receipt')).toBe(true);
    expect(isCollected('outstanding')).toBe(false);
    expect(isCollected('uninvoiced')).toBe(false);
    expect(isCollected('zero_session')).toBe(false);
  });
});
