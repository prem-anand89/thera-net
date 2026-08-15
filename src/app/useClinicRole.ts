import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';
import { useSession } from './useSession';

export type ClinicRole = 'admin' | 'staff' | 'unknown';

function cacheKey(clinicId: string): string {
  return `clinicRole:${clinicId}`;
}

/**
 * The signed-in user's role for one clinic, read from `clinic_members`
 * (RLS already lets a member read their own row — see `members_select`
 * policy) and cached in Dexie's local `meta` table so it survives offline.
 * This is display scoping only — RLS remains the real access boundary
 * server-side — but without the cache, an offline admin would read as
 * `'unknown'` (the online fetch fails) and every caller treats `'unknown'`
 * the same as `'staff'`, silently narrowing an admin down to the
 * therapist-scoped view the moment they lose connection. The cache is
 * cleared along with the rest of Dexie on sign-out (`Shell.tsx`), so it
 * can't leak a role across accounts sharing a device.
 */
export function useClinicRole(clinicId: string): { role: ClinicRole; loading: boolean } {
  const { session } = useSession();
  const cached = useLiveQuery(() => db.meta.get(cacheKey(clinicId)), [clinicId]);
  const [fetchedRole, setFetchedRole] = useState<ClinicRole>('unknown');
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
        .select('role')
        .eq('clinic_id', clinicId)
        .eq('user_id', userId)
        .maybeSingle()
    )
      .then(({ data }: { data: { role: 'admin' | 'staff' } | null }) => {
        if (cancelled) return;
        const resolved: ClinicRole = data?.role ?? 'unknown';
        setFetchedRole(resolved);
        // Only cache a confirmed role — a null result can mean "genuinely
        // not a member" or an RLS read getting blocked, and overwriting a
        // good cached role on that ambiguity would be worse than leaving
        // it stale until the next successful fetch clarifies it.
        if (resolved !== 'unknown') {
          void db.meta.put({ key: cacheKey(clinicId), value: resolved });
        }
      })
      .catch(() => {
        if (!cancelled) setFetchedRole('unknown');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, session?.user?.id]);

  // A resolved online fetch always wins (freshest ground truth); otherwise
  // fall back to the cached role rather than flashing 'unknown'.
  const role: ClinicRole = fetchedRole !== 'unknown' ? fetchedRole : ((cached?.value as ClinicRole | undefined) ?? 'unknown');

  return { role, loading };
}
