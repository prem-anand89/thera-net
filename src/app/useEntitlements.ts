import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';
import { repos } from '@/repositories/local';
import { rowToDomain } from '@/repositories/rowMapping';
import { tierIncludes, currentMonthRange, type PlanFeature } from '@/domain/plans';
import type { ClinicPlan, PlanStatus, PlanTier } from '@/domain/types';
import { planCacheKey } from '@/sync/planCache';
import { useSession } from './useSession';

// Not clinic-scoped (platform_config is a global singleton row) — same
// db.meta table, fixed key.
const PLATFORM_CONFIG_CACHE_KEY = 'platformConfig';

// Fail-closed default: the most restrictive tier, used only until the first
// successful fetch (or a cached value) resolves — an unreachable server or a
// slow first paint must never read as a free upgrade (see the tier plan's
// "fail open is backwards for monetization" finding).
const DEFAULT_PLAN: Pick<ClinicPlan, 'planTier' | 'status' | 'maxMembers' | 'visitCapPerMonth'> = {
  planTier: 'lite',
  status: 'active',
  maxMembers: 1,
  visitCapPerMonth: 50,
};

// Same fail-closed instinct as DEFAULT_PLAN: an unresolved fetch reads as
// "enforcement is on," never as a free pass.
const DEFAULT_ENFORCEMENT_ENABLED = true;

export interface Entitlements {
  tier: PlanTier;
  status: PlanStatus;
  maxMembers: number;
  /** null = unlimited */
  visitCapPerMonth: number | null;
  /**
   * Team members with no login the plan includes (besides the owner). null = no client limit: unlimited, not
   * loaded yet, or the column has not been added to the database. Deliberately NOT fail-closed like `maxMembers`: a
   * limit of 1 here would lock live Clinic+ clinics out of adding staff until the migration is applied; the server
   * trigger is the authority.
   */
  maxRosterTherapists: number | null;
  /** Active clinic_members count. null while unknown (offline, or not yet fetched). */
  seatsUsed: number | null;
  /** Non-deleted visits logged this calendar month, from local Dexie — available offline. */
  visitsThisMonth: number;
  /**
   * Global pilot kill switch (`platform_config.tier_enforcement_enabled`,
   * Phase 4) — `false` while pilot clinics are meant to run with no tier
   * limits at all, ahead of payment integration. `can()` already folds this
   * in; callers that read `maxMembers`/`visitCapPerMonth` directly instead
   * of going through `can()` (seat-cap and visit-cap UI) need to check this
   * themselves too.
   */
  enforcementEnabled: boolean;
  loading: boolean;
  /**
   * True only while the plan is genuinely unknown: still fetching AND nothing cached on
   * this device. A returning device reads its cached plan at once, so this stays false
   * for it. While true `can()` reports the fail-closed lite default — show a placeholder,
   * not a "not in your plan" lock that flips a moment later.
   */
  planPending: boolean;
  can(feature: PlanFeature): boolean;
}

/**
 * Reads the signed-in clinic's plan (`clinic_plans`, Phase 0 of the
 * tier-subscriptions plan) plus enough usage data to render seat/visit-cap
 * UI. Mirrors `useClinicRole`'s shape: a direct Supabase fetch, cached in
 * Dexie's `meta` table so the tier survives offline, with the same
 * discipline — a fresh online fetch always wins, a confirmed cache is the
 * offline fallback, and an unresolved fetch never flashes the
 * least-restrictive state.
 *
 * `clinic_plans` has no client sync path (see its doc comment on
 * `ClinicPlan` in `domain/types.ts`) — it's fetched directly here rather
 * than through the sync engine's generic per-table pull, which assumes an
 * `id` primary key this table doesn't have (it's keyed by `clinicId`).
 *
 * `platform_config` (Phase 4's global pilot kill switch) is fetched
 * alongside it, same offline-cache discipline. When it's off, `can()`
 * always returns `true` — that alone unlocks every `SettingsPage.tsx`
 * section and `usePermissions()` flag derived from `can()`, since Phase 3
 * built all of those to read through this hook. The few call sites that
 * read `maxMembers`/`visitCapPerMonth` directly check `enforcementEnabled`
 * themselves.
 */
/**
 * The more recent of the cached plan (kept current by the sync engine's realtime event) and the plan just fetched,
 * by `updatedAt`. A tie, or no timestamp to compare, goes to the fetched plan (read from the server a moment ago).
 * Neither side wins by default: a stale cache must not hide a newer fetch, and a failed cache write must not freeze
 * an old plan on screen.
 */
export function newestPlan(cached: ClinicPlan | null, fetched: ClinicPlan | null): ClinicPlan | null {
  if (!cached) return fetched;
  if (!fetched) return cached;
  const cachedAt = Date.parse(cached.updatedAt ?? '');
  const fetchedAt = Date.parse(fetched.updatedAt ?? '');
  if (Number.isNaN(cachedAt) || Number.isNaN(fetchedAt)) return fetched;
  return cachedAt > fetchedAt ? cached : fetched;
}

export function useEntitlements(clinicId: string): Entitlements {
  const { session } = useSession();
  const cached = useLiveQuery(() => db.meta.get(planCacheKey(clinicId)), [clinicId]);
  const cachedPlatformConfig = useLiveQuery(() => db.meta.get(PLATFORM_CONFIG_CACHE_KEY), []);
  const [fetched, setFetched] = useState<ClinicPlan | null>(null);
  const [fetchedEnforcementEnabled, setFetchedEnforcementEnabled] = useState<boolean | null>(null);
  const [seatsUsed, setSeatsUsed] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();
    const userId = session?.user?.id;
    // clinicId arrives as '' for one render while Shell resolves which
    // clinic is active — querying with an empty clinic_id isn't just
    // wasted, it 400s (not a valid uuid). Same guard as useClinicRole.
    if (!supabase || !userId || !clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const [{ data: planRow }, { count }, { data: platformConfigRow }] = await Promise.all([
        supabase.from('clinic_plans').select('*').eq('clinic_id', clinicId).maybeSingle(),
        supabase.from('clinic_members').select('*', { count: 'exact', head: true }).eq('clinic_id', clinicId),
        supabase.from('platform_config').select('tier_enforcement_enabled').maybeSingle(),
      ]);
      if (cancelled) return;
      if (planRow) {
        const plan = rowToDomain<ClinicPlan>(planRow);
        setFetched(plan);
        void db.meta.put({ key: planCacheKey(clinicId), value: JSON.stringify(plan) });
      }
      if (platformConfigRow) {
        setFetchedEnforcementEnabled(platformConfigRow.tier_enforcement_enabled as boolean);
        void db.meta.put({
          key: PLATFORM_CONFIG_CACHE_KEY,
          value: JSON.stringify(platformConfigRow.tier_enforcement_enabled),
        });
      }
      setSeatsUsed(count ?? null);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clinicId, session?.user?.id]);

  const cachedPlan: ClinicPlan | null = (() => {
    if (!cached?.value) return null;
    try {
      const parsed: unknown = JSON.parse(cached.value);
      if (parsed && typeof parsed === 'object' && 'planTier' in parsed) return parsed as ClinicPlan;
    } catch {
      // corrupt or pre-upgrade cache entry — treated as absent below
    }
    return null;
  })();

  const cachedEnforcementEnabled: boolean | null = (() => {
    if (!cachedPlatformConfig?.value) return null;
    try {
      const parsed: unknown = JSON.parse(cachedPlatformConfig.value);
      if (typeof parsed === 'boolean') return parsed;
    } catch {
      // corrupt cache entry — treated as absent below
    }
    return null;
  })();

  const resolved = newestPlan(cachedPlan, fetched);
  const enforcementEnabled = fetchedEnforcementEnabled ?? cachedEnforcementEnabled ?? DEFAULT_ENFORCEMENT_ENABLED;

  const { from, to } = currentMonthRange();
  const visitsThisMonth =
    useLiveQuery(
      () => (clinicId ? repos.visits.list({ clinicId, from, to }).then((v) => v.length) : Promise.resolve(0)),
      [clinicId, from, to]
    ) ?? 0;

  return {
    tier: resolved?.planTier ?? DEFAULT_PLAN.planTier,
    status: resolved?.status ?? DEFAULT_PLAN.status,
    maxMembers: resolved?.maxMembers ?? DEFAULT_PLAN.maxMembers,
    visitCapPerMonth: resolved ? resolved.visitCapPerMonth : DEFAULT_PLAN.visitCapPerMonth,
    maxRosterTherapists: resolved?.maxRosterTherapists ?? null,
    seatsUsed,
    visitsThisMonth,
    enforcementEnabled,
    loading,
    planPending: loading && resolved === null,
    can: (feature) => !enforcementEnabled || tierIncludes(resolved?.planTier ?? DEFAULT_PLAN.planTier, feature),
  };
}
