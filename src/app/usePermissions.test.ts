import { describe, expect, it } from 'vitest';
import { collectPaymentAllowed } from './usePermissions';

const base = { invoicingAccess: 'everyone' as const, isAdmin: false, isFrontDesk: false };

describe('collectPaymentAllowed', () => {
  it('collects by default, on any plan', () => {
    expect(collectPaymentAllowed(base)).toBe(true);
  });

  it('billing_staff clinics keep collection to admin and front desk', () => {
    const staffOnly = { ...base, invoicingAccess: 'billing_staff' as const };
    expect(collectPaymentAllowed(staffOnly)).toBe(false);
    expect(collectPaymentAllowed({ ...staffOnly, isAdmin: true })).toBe(true);
    expect(collectPaymentAllowed({ ...staffOnly, isFrontDesk: true })).toBe(true);
  });
});
