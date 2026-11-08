import { describe, expect, it } from 'vitest';
import { visitCapStatus, tierIncludes, PLAN_TIER_LABELS, currentMonthRange, minimumTierFor, nextTierWithMore, tierLimitsSummary, TIER_LIMITS, type PlanFeature } from './plans';
import type { PlanTier } from './types';

const TIERS: PlanTier[] = ['lite', 'solo', 'clinic', 'clinic_plus'];
const FEATURES: PlanFeature[] = ['invoicing', 'revenueSplit', 'advancedModules', 'notePrinting', 'inpatient'];

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

  it('solo gets invoicing and note printing but not revenueSplit/advancedModules', () => {
    expect(tierIncludes('solo', 'invoicing')).toBe(true);
    expect(tierIncludes('solo', 'notePrinting')).toBe(true);
    expect(tierIncludes('solo', 'revenueSplit')).toBe(false);
    expect(tierIncludes('solo', 'advancedModules')).toBe(false);
  });

  it('clinic adds the revenue split; only clinic_plus has advanced modules', () => {
    expect(tierIncludes('clinic', 'revenueSplit')).toBe(true);
    expect(tierIncludes('clinic', 'advancedModules')).toBe(false);
    for (const feature of FEATURES) expect(tierIncludes('clinic_plus', feature)).toBe(true);
  });
});

describe('PLAN_TIER_LABELS', () => {
  it('has a label for every tier', () => {
    for (const tier of TIERS) {
      expect(PLAN_TIER_LABELS[tier]).toBeTruthy();
    }
  });
});

describe('minimumTierFor', () => {
  it('note printing is included from Solo', () => {
    expect(minimumTierFor('notePrinting')).toBe('solo');
  });

  it('invoicing is included from Solo', () => {
    expect(minimumTierFor('invoicing')).toBe('solo');
  });

  it('inpatient admissions are included from Clinic, not Lite or Solo', () => {
    expect(minimumTierFor('inpatient')).toBe('clinic');
    expect(tierIncludes('solo', 'inpatient')).toBe(false);
    expect(tierIncludes('clinic', 'inpatient')).toBe(true);
  });

  it('revenueSplit is included from Clinic, advancedModules from Clinic+', () => {
    expect(minimumTierFor('revenueSplit')).toBe('clinic');
    expect(minimumTierFor('advancedModules')).toBe('clinic_plus');
  });
});

describe('currentMonthRange', () => {
  it('spans the first to the last day of the given month', () => {
    expect(currentMonthRange(new Date('2026-02-15T12:00:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('handles a 31-day month', () => {
    expect(currentMonthRange(new Date('2026-01-01T12:00:00Z'))).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('handles a leap-year February', () => {
    expect(currentMonthRange(new Date('2028-02-01T12:00:00Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('visitCapStatus', () => {
  it('is ok with no cap or well under it', () => {
    expect(visitCapStatus(500, null)).toBe('ok');
    expect(visitCapStatus(39, 50)).toBe('ok');
  });
  it('warns from 80% and reports reached at the cap', () => {
    expect(visitCapStatus(40, 50)).toBe('near');
    expect(visitCapStatus(49, 50)).toBe('near');
    expect(visitCapStatus(50, 50)).toBe('reached');
    expect(visitCapStatus(61, 50)).toBe('reached');
  });
});

describe('TIER_LIMITS and its helpers', () => {
  it('summarises a tier from the numbers', () => {
    expect(tierLimitsSummary('lite')).toBe('1 login · 50 visits a month · 1 team member without a login');
    expect(tierLimitsSummary('clinic')).toBe('5 logins · unlimited visits · 3 team members without a login');
  });

  it('finds the next tier that includes more of something', () => {
    expect(nextTierWithMore('lite', 'seats')).toBe('clinic'); // Solo has the same 1 login
    expect(nextTierWithMore('lite', 'visitsPerMonth')).toBe('solo');
    expect(nextTierWithMore('solo', 'visitsPerMonth')).toBe('clinic'); // unlimited
    expect(nextTierWithMore('clinic', 'seats')).toBe('clinic_plus');
    expect(nextTierWithMore('clinic', 'visitsPerMonth')).toBeNull(); // already unlimited
    expect(nextTierWithMore('clinic_plus', 'seats')).toBeNull();
  });

  it('never has fewer of anything on a higher tier', () => {
    const order: PlanTier[] = ['lite', 'solo', 'clinic', 'clinic_plus'];
    for (let i = 1; i < order.length; i++) {
      const lower = TIER_LIMITS[order[i - 1]];
      const higher = TIER_LIMITS[order[i]];
      expect(higher.seats).toBeGreaterThanOrEqual(lower.seats);
      expect(higher.rosterWithoutLogin).toBeGreaterThanOrEqual(lower.rosterWithoutLogin);
      expect(higher.visitsPerMonth === null || (lower.visitsPerMonth !== null && higher.visitsPerMonth >= lower.visitsPerMonth)).toBe(true);
    }
  });
});
