import { describe, expect, it } from 'vitest';
import { tierIncludes, PLAN_TIER_LABELS, currentMonthRange, type PlanFeature } from './plans';
import type { PlanTier } from './types';

const TIERS: PlanTier[] = ['lite', 'solo', 'clinic', 'clinic_plus'];
const FEATURES: PlanFeature[] = ['invoicing', 'team', 'revenueSplit', 'advancedModules'];

describe('tierIncludes', () => {
  it('every tier × feature cell is defined (no accidental undefined)', () => {
    for (const tier of TIERS) {
      for (const feature of FEATURES) {
        expect(typeof tierIncludes(tier, feature)).toBe('boolean');
      }
    }
  });

  it('lite has nothing above the free baseline', () => {
    for (const feature of FEATURES) {
      expect(tierIncludes('lite', feature)).toBe(false);
    }
  });

  it('solo gets invoicing but not team/revenueSplit/advancedModules', () => {
    expect(tierIncludes('solo', 'invoicing')).toBe(true);
    expect(tierIncludes('solo', 'team')).toBe(false);
    expect(tierIncludes('solo', 'revenueSplit')).toBe(false);
    expect(tierIncludes('solo', 'advancedModules')).toBe(false);
  });

  it('clinic and clinic_plus both get everything', () => {
    for (const tier of ['clinic', 'clinic_plus'] as const) {
      for (const feature of FEATURES) {
        expect(tierIncludes(tier, feature)).toBe(true);
      }
    }
  });
});

describe('PLAN_TIER_LABELS', () => {
  it('has a label for every tier', () => {
    for (const tier of TIERS) {
      expect(PLAN_TIER_LABELS[tier]).toBeTruthy();
    }
  });
});

describe('currentMonthRange', () => {
  it('spans the first to the last day of the given month', () => {
    expect(currentMonthRange(new Date(2026, 1, 15))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('handles a 31-day month', () => {
    expect(currentMonthRange(new Date(2026, 0, 1))).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('handles a leap-year February', () => {
    expect(currentMonthRange(new Date(2028, 1, 1))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
