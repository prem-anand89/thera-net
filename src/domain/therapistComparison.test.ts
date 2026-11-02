import { describe, expect, it } from 'vitest';
import { showsTherapistComparison } from './therapistComparison';

describe('showsTherapistComparison', () => {
  const on = { isAdmin: true, hasRevenueSplit: true, activeTherapistCount: 2 };

  it('shows for an admin on a plan with the split and two or more active therapists, with no setting', () => {
    expect(showsTherapistComparison(on)).toBe(true);
    expect(showsTherapistComparison({ ...on, activeTherapistCount: 5 })).toBe(true);
  });

  it('each condition off hides it', () => {
    expect(showsTherapistComparison({ ...on, isAdmin: false })).toBe(false);
    expect(showsTherapistComparison({ ...on, hasRevenueSplit: false })).toBe(false);
    expect(showsTherapistComparison({ ...on, activeTherapistCount: 1 })).toBe(false);
    expect(showsTherapistComparison({ ...on, activeTherapistCount: 0 })).toBe(false);
  });
});
