import { describe, expect, it } from 'vitest';
import { clinicMembershipGrew } from '../engine';

describe('clinicMembershipGrew', () => {
  it('is false when nothing new is present', () => {
    expect(clinicMembershipGrew(['a'], ['a'])).toBe(false);
    expect(clinicMembershipGrew([], [])).toBe(false);
    expect(clinicMembershipGrew([], ['a'])).toBe(false); // shrinkage isn't growth
  });

  it('is true when a clinic id appears that was not known before', () => {
    expect(clinicMembershipGrew(['a', 'b'], ['a'])).toBe(true);
    expect(clinicMembershipGrew(['a'], [])).toBe(true);
  });
});
