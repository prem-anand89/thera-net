import type { PlanTier } from './types';

/**
 * Tier-gated feature flags. Deliberately excludes `partner` (data-driven —
 * whether a clinic has a partner hospital — not tier-driven, see
 * FEATURES_AND_SCHEMA.md's Settings section) and anything clinical-note- or
 * advanced-module-content-shaped (still open design work, kept out of the
 * tier plan per its Part 1 scope corrections). Writing notes is never gated;
 * only `notePrinting` (print / save-as-PDF of a note, session log or insurer
 * packet) is.
 */
export type PlanFeature = 'invoicing' | 'team' | 'revenueSplit' | 'advancedModules' | 'notePrinting';

/**
 * One row per tier, matching the Settings-page table in the tier plan:
 * Lite/Solo get invoicing (Solo+) but not team management or the hospital
 * revenue split; Clinic/Clinic+ get everything. `advancedModules` is a
 * bucket gate only — its content is a separate, still-open planning pass.
 */
const TIER_FEATURES: Record<PlanTier, Record<PlanFeature, boolean>> = {
  lite: { invoicing: false, team: false, revenueSplit: false, advancedModules: false, notePrinting: false },
  solo: { invoicing: true, team: false, revenueSplit: false, advancedModules: false, notePrinting: true },
  clinic: { invoicing: true, team: true, revenueSplit: true, advancedModules: true, notePrinting: true },
  clinic_plus: { invoicing: true, team: true, revenueSplit: true, advancedModules: true, notePrinting: true },
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
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  const from = `${year}-${pad(month + 1)}-01`;
  
  const toDate = new Date(year, month + 1, 0);
  const to = `${year}-${pad(month + 1)}-${pad(toDate.getDate())}`;
  
  return { from, to };
}

/** Share of the monthly visit cap at which the app starts warning. */
export const VISIT_CAP_WARN_AT = 0.8;

/**
 * Where a clinic stands against its monthly visit cap: 'ok' (or no cap),
 * 'near' from 80% of it, 'reached' once it is used up. Drives the heads-up
 * banner so the cap's block on saving never comes as a surprise.
 */
export function visitCapStatus(used: number, cap: number | null): 'ok' | 'near' | 'reached' {
  if (cap == null || cap <= 0) return 'ok';
  if (used >= cap) return 'reached';
  return used >= Math.ceil(cap * VISIT_CAP_WARN_AT) ? 'near' : 'ok';
}
