import { describe, expect, it } from 'vitest';
import { therapistStatus } from './therapistStatus';

type Input = Parameters<typeof therapistStatus>[0];
const base: Input = { utilisation: 0.75, clinicUtilisation: 0.65, previousUtilisation: 0.7, visitCount: 40 };
const status = (over: Partial<Input> = {}) => therapistStatus({ ...base, ...over }).status;

describe('therapistStatus', () => {
  it('strong: high utilisation at or above the clinic', () => {
    expect(status()).toBe('strong');
  });
  it('steady: decent but not standout', () => {
    expect(status({ utilisation: 0.6, clinicUtilisation: 0.62, previousUtilisation: 0.62 })).toBe('steady');
  });
  it('attention: below the absolute floor', () => {
    expect(status({ utilisation: 0.4, clinicUtilisation: 0.42 })).toBe('attention');
  });
  it('attention: well under the clinic even if above the floor', () => {
    expect(status({ utilisation: 0.55, clinicUtilisation: 0.8 })).toBe('attention');
  });
  it('attention: a sharp drop while under the clinic', () => {
    expect(status({ utilisation: 0.58, clinicUtilisation: 0.62, previousUtilisation: 0.72 })).toBe('attention');
  });
  it('does not flag a drop that is still above the clinic', () => {
    expect(status({ utilisation: 0.72, clinicUtilisation: 0.6, previousUtilisation: 0.9 })).toBe('strong');
  });
  it('insufficient: too few visits or no available time', () => {
    expect(status({ visitCount: 5 })).toBe('insufficient');
    expect(status({ utilisation: null })).toBe('insufficient');
  });
  it('works with no previous period or clinic figure', () => {
    expect(therapistStatus({ utilisation: 0.8, clinicUtilisation: null, previousUtilisation: null, visitCount: 30 }).status).toBe('strong');
  });
});
