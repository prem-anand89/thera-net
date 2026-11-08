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
export type PlanFeature = 'invoicing' | 'revenueSplit' | 'advancedModules' | 'notePrinting' | 'inpatient';

/**
 * One row per tier, matching the Settings-page table in the tier plan:
 * Lite has none; Solo adds invoicing and note printing; Clinic adds the
 * hospital revenue split and inpatient admissions (ward rounds, discharge bill); Clinic+ adds advanced assessment modules.
 * `advancedModules` is a bucket gate only — its content is a separate,
 * still-open planning pass. How many logins / visits / team members a tier
 * has is a number, not a feature: see `TIER_LIMITS`.
 */
const TIER_FEATURES: Record<PlanTier, Record<PlanFeature, boolean>> = {
  lite: { invoicing: false, revenueSplit: false, advancedModules: false, notePrinting: false, inpatient: false },
  solo: { invoicing: true, revenueSplit: false, advancedModules: false, notePrinting: true, inpatient: false },
  clinic: { invoicing: true, revenueSplit: true, advancedModules: false, notePrinting: true, inpatient: true },
  clinic_plus: { invoicing: true, revenueSplit: true, advancedModules: true, notePrinting: true, inpatient: true },
};

/**
 * What a tier includes in numbers. These are the DEFAULTS for a tier: a clinic's own `clinic_plans` row can differ
 * (a tuned clinic), and enforcement always reads the clinic's row, never this table. The SQL function
 * `plan_tier_defaults()` (migration 20261101100000) returns the same numbers; `planLimits.parity.test.ts` keeps the
 * two equal so the wording here and the limits on the server cannot drift apart. `null` = unlimited.
 */
export interface TierLimits {
  /** Logins (clinic_members). */
  seats: number;
  visitsPerMonth: number | null;
  /** Team members on the schedule with no login of their own, besides the owner. */
  rosterWithoutLogin: number;
}
export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  lite: { seats: 1, visitsPerMonth: 50, rosterWithoutLogin: 1 },
  solo: { seats: 1, visitsPerMonth: 200, rosterWithoutLogin: 1 },
  clinic: { seats: 5, visitsPerMonth: null, rosterWithoutLogin: 3 },
  clinic_plus: { seats: 10, visitsPerMonth: null, rosterWithoutLogin: 10 },
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

/** `Infinity` for "unlimited", so tiers compare with plain numbers. */
const asNumber = (n: number | null) => (n === null ? Infinity : n);

/**
 * The lowest tier above `tier` that includes more of `limit` (more logins, more team members without a login, more
 * visits) — for "Clinic includes 5 logins" style upgrade copy. Null when nothing above has more.
 */
export function nextTierWithMore(tier: PlanTier, limit: keyof TierLimits): PlanTier | null {
  const current = asNumber(TIER_LIMITS[tier][limit]);
  return TIER_ORDER.slice(TIER_ORDER.indexOf(tier) + 1).find((t) => asNumber(TIER_LIMITS[t][limit]) > current) ?? null;
}

/** "1 login", "5 logins" */
export function loginsLabel(n: number): string {
  return `${n} login${n === 1 ? '' : 's'}`;
}

/** The one-line summary of what a tier includes, from the numbers: "1 login · 50 visits a month · 1 team member without a login". */
export function tierLimitsSummary(tier: PlanTier): string {
  const { seats, visitsPerMonth, rosterWithoutLogin } = TIER_LIMITS[tier];
  return [
    loginsLabel(seats),
    visitsPerMonth === null ? 'unlimited visits' : `${visitsPerMonth} visits a month`,
    `${rosterWithoutLogin} team member${rosterWithoutLogin === 1 ? '' : 's'} without a login`,
  ].join(' · ');
}

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
