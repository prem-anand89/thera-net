import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';
import { useSession } from './useSession';

export type ClinicRole = 'admin' | 'therapist' | 'front_desk' | 'unknown';

/** Shared with Settings → Team's member list so the two never drift. */
export const CLINIC_ROLE_LABELS: Record<Exclude<ClinicRole, 'unknown'>, string> = {
  admin: 'Admin',
  therapist: 'Therapist',
  front_desk: 'Front desk',
};

interface CachedRole {
  role: ClinicRole;
  displayName: string | null;
}

function cacheKey(clinicId: string): string {
  return `clinicRole:${clinicId}`;
}

/** db.meta's value column is a plain string (shared with unrelated keys
 *  like activeClinicId) — JSON-encode the {role, displayName} pair into it
 *  rather than widening that shared type for this one caller. */
function putCache(clinicId: string, value: CachedRole) {
  void db.meta.put({ key: cacheKey(clinicId), value: JSON.stringify(value) });
}

/**
 * The signed-in user's role (and self-chosen display name) for one clinic,
 * read from `clinic_members` (RLS already lets a member read their own row
 * — see `members_select` policy) and cached in Dexie's local `meta` table
 * so it survives offline. The role value drives UI framing only — RLS
 * enforces the real write boundary server-side (see `is_own_therapist` and
 * the `visits_update`/`therapists_*`/`catalog_*` policies) regardless of
 * what this hook returns. But without the cache, an offline admin would
 * read as `'unknown'` (the online fetch fails) and every caller treats
 * `'unknown'` the same as `'therapist'`, silently narrowing an admin down
 * to the therapist-scoped view the moment they lose connection. The cache
 * is cleared along with the rest of Dexie on sign-out (`Shell.tsx`), so it
 * can't leak a role (or a name) across accounts sharing a device.
 */
export function useClinicRole(clinicId: string): {
  role: ClinicRole;
  displayName: string | null;
  loading: boolean;
  /** Updates the signed-in user's own display_name (RLS: members_update_self
   *  — a member may only ever change their own row this way, never their
   *  role). Updates `fetched`/the Dexie cache directly from the server's
   *  own echoed value on success, rather than waiting for the fetch effect
   *  to re-run (its deps are clinicId/userId, neither of which change here). */
  setDisplayName: (name: string) => Promise<void>;
} {
  const { session } = useSession();
  const cached = useLiveQuery(() => db.meta.get(cacheKey(clinicId)), [clinicId]);
  const [fetched, setFetched] = useState<CachedRole>({ role: 'unknown', displayName: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();
    const userId = session?.user?.id;
    if (!supabase || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.resolve(
      supabase
        .from('clinic_members')
        .select('role, display_name')
        .eq('clinic_id', clinicId)
        .eq('user_id', userId)
        .maybeSingle()
    )
      .then(
        ({
          data,
        }: {
          data: { role: 'admin' | 'therapist' | 'front_desk'; display_name: string | null } | null;
        }) => {
          if (cancelled) return;
          const resolved: CachedRole = { role: data?.role ?? 'unknown', displayName: data?.display_name ?? null };
          setFetched(resolved);
          // Only cache a confirmed role — a null result can mean "genuinely
          // not a member" or an RLS read getting blocked, and overwriting a
          // good cached role on that ambiguity would be worse than leaving
          // it stale until the next successful fetch clarifies it.
          if (resolved.role !== 'unknown') {
            putCache(clinicId, resolved);
          }
        }
      )
      .catch(() => {
        if (!cancelled) setFetched({ role: 'unknown', displayName: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, session?.user?.id]);

  // A resolved online fetch always wins (freshest ground truth); otherwise
  // fall back to the cached value rather than flashing 'unknown'/blank.
  // Guards a device with a pre-upgrade cache entry too (a bare role string,
  // from before displayName was cached alongside it as JSON) — parsing that
  // as JSON throws, and a plain string that happens to parse (unlikely, but
  // not impossible) still gets shape-checked before use.
  const cachedResolved: CachedRole = (() => {
    if (!cached?.value) return { role: 'unknown', displayName: null };
    try {
      const parsed: unknown = JSON.parse(cached.value);
      if (parsed && typeof parsed === 'object' && 'role' in parsed) return parsed as CachedRole;
    } catch {
      // pre-upgrade cache entry, or corrupt — treated as absent below
    }
    return { role: 'unknown', displayName: null };
  })();
  const resolved: CachedRole = fetched.role !== 'unknown' ? fetched : cachedResolved;

  async function setDisplayName(name: string) {
    const supabase = getSupabase();
    const userId = session?.user?.id;
    if (!supabase || !userId) throw new Error('Not signed in');
    const trimmed = name.trim();
    const { error } = await supabase
      .from('clinic_members')
      .update({ display_name: trimmed || null })
      .eq('clinic_id', clinicId)
      .eq('user_id', userId);
    if (error) throw error;
    const next: CachedRole = { role: resolved.role, displayName: trimmed || null };
    setFetched(next);
    if (next.role !== 'unknown') {
      putCache(clinicId, next);
    }
  }

  return { role: resolved.role, displayName: resolved.displayName, loading, setDisplayName };
}
