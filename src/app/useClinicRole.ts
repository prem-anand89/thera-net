import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useSession } from './useSession';

export type ClinicRole = 'admin' | 'staff' | 'unknown';

/**
 * The signed-in user's role for one clinic, read directly from
 * `clinic_members` (RLS already lets a member read their own row — see
 * `members_select` policy). Best-effort, online-only, same shape as
 * `NoteEditorPage.tsx`'s `useTreatmentConsentStatus` — never blocks
 * rendering. Defaults to `'unknown'` while loading/offline; callers should
 * treat `'unknown'` the same as `'staff'` (the more restrictive, narrower
 * view) rather than flashing clinic-wide data before the real role loads.
 */
export function useClinicRole(clinicId: string): { role: ClinicRole; loading: boolean } {
  const { session } = useSession();
  const [role, setRole] = useState<ClinicRole>('unknown');
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
        if (!cancelled) setRole(data?.role ?? 'unknown');
      })
      .catch(() => {
        if (!cancelled) setRole('unknown');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, session?.user?.id]);

  return { role, loading };
}
