import type { PlanTier } from './types';

/**
 * Tier-gated feature flags. Deliberately excludes `partner` (data-driven —
 * whether a clinic has a partner hospital — not tier-driven, see
 * FEATURES_AND_SCHEMA.md's Settings section) and anything clinical-note- or
 * advanced-module-content-shaped (still open design work, kept out of the
 * tier plan per its Part 1 scope corrections).
 */
export type PlanFeature = 'invoicing' | 'team' | 'revenueSplit' | 'advancedModules';

/**
 * One row per tier, matching the Settings-page table in the tier plan:
 * Lite/Solo get invoicing (Solo+) but not team management or the hospital
 * revenue split; Clinic/Clinic+ get everything. `advancedModules` is a
 * bucket gate only — its content is a separate, still-open planning pass.
 */
const TIER_FEATURES: Record<PlanTier, Record<PlanFeature, boolean>> = {
  lite: { invoicing: false, team: false, revenueSplit: false, advancedModules: false },
  solo: { invoicing: true, team: false, revenueSplit: false, advancedModules: false },
  clinic: { invoicing: true, team: true, revenueSplit: true, advancedModules: true },
  clinic_plus: { invoicing: true, team: true, revenueSplit: true, advancedModules: true },
};

export function tierIncludes(tier: PlanTier, feature: PlanFeature): boolean {
  return TIER_FEATURES[tier][feature];
}

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  lite: 'Lite',
  solo: 'Solo',
  clinic: 'Clinic',
  clinic_plus: 'Clinic+',
};

const TIER_ORDER: PlanTier[] = ['lite', 'solo', 'clinic', 'clinic_plus'];

/** The lowest tier that includes `feature` — for "Included in Solo and
 *  above" style locked-section copy. Every feature is included by at least
 *  one tier (clinic_plus always has everything), so this never falls through. */
export function minimumTierFor(feature: PlanFeature): PlanTier {
  return TIER_ORDER.find((tier) => tierIncludes(tier, feature))!;
}

/**
 * [from, to] bounds (YYYY-MM-DD, both inclusive) for the calendar month
 * containing `now` — matches `visitCapPerMonth`'s "per month" and the
 * planned `check_visit_cap()` SQL function (Phase 2), so the client-side
 * count and the server boundary agree on what "this month" means.
 */
export function currentMonthRange(now = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}
