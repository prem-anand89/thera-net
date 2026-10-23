import { describe, expect, it } from 'vitest';
import { collectPaymentAllowed } from './usePermissions';

const base = {
  billingEnabled: true,
  invoicingAccess: 'everyone' as const,
  isAdmin: false,
  isFrontDesk: false,
  planHasInvoicing: true,
  planLoading: false,
};

describe('collectPaymentAllowed', () => {
  it('collects by default', () => {
    expect(collectPaymentAllowed(base)).toBe(true);
  });

  it('a paid plan with the billing switch off does not collect (someone else bills)', () => {
    expect(collectPaymentAllowed({ ...base, billingEnabled: false })).toBe(false);
  });

  it('a plan without invoicing collects even with the switch off', () => {
    expect(collectPaymentAllowed({ ...base, billingEnabled: false, planHasInvoicing: false })).toBe(true);
  });

  it('does not treat a still-loading plan as one without invoicing', () => {
    expect(collectPaymentAllowed({ ...base, billingEnabled: false, planHasInvoicing: false, planLoading: true })).toBe(false);
  });

  it('billing_staff clinics keep collection to admin and front desk', () => {
    const staffOnly = { ...base, invoicingAccess: 'billing_staff' as const };
    expect(collectPaymentAllowed(staffOnly)).toBe(false);
    expect(collectPaymentAllowed({ ...staffOnly, isAdmin: true })).toBe(true);
    expect(collectPaymentAllowed({ ...staffOnly, isFrontDesk: true })).toBe(true);
  });
});
