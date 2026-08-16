import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from './clinicContext';
import { useSession } from './useSession';
import { useClinicRole } from './useClinicRole';

/**
 * Never a real therapist id — used to narrow a "just me" query while we
 * can't yet say (or will never be able to say) which therapist row this
 * signed-in user is. Unlike `undefined`, callers that filter on it (e.g.
 * `repos.visits.list({ therapistId })`, whose `if (filter.therapistId)`
 * check only *skips* filtering when the value is falsy) still apply the
 * filter — it's a truthy string that just never matches a real row, so the
 * result is an empty list instead of the whole clinic's data. Fixes a real
 * gap: a `therapist`-role member not yet linked to a `therapists` row via
 * Settings → Team → "Linked login" previously got `scopeTherapistId ===
 * undefined`, indistinguishable from admin/front_desk's deliberate
 * clinic-wide `undefined` — so their Workspace "Today" briefly (while role/
 * therapists were loading) or permanently (if never linked) showed every
 * other therapist's visits.
 */
const UNRESOLVED_THERAPIST_SENTINEL = '00000000-0000-0000-0000-000000000000';

export interface WorkspaceScope {
  role: 'admin' | 'therapist' | 'front_desk' | 'unknown';
  isAdmin: boolean;
  isFrontDesk: boolean;
  /** This user's own therapist row in this clinic, if their login is linked to one. */
  myTherapistId: string | undefined;
  /**
   * undefined = clinic-wide (admin or front desk). A real therapist id =
   * narrowed to just them. `UNRESOLVED_THERAPIST_SENTINEL` = narrowed but
   * we don't have (or will never have) an id to narrow to — fails closed
   * to "nothing" rather than falling back to clinic-wide.
   */
  scopeTherapistId: string | undefined;
  /**
   * True for admin and front_desk — screens branch on this (not `isAdmin`)
   * wherever the choice is "clinic-wide vs. mine", since front desk has no
   * clinical work of their own to narrow to and needs the same full-clinic
   * visibility an admin gets for that purpose. `isAdmin` stays the right
   * check for actual admin-only capabilities (editing settings, the
   * therapist comparison chart) — this field is for data scope only.
   */
  isClinicWideView: boolean;
  /**
   * True once role has resolved to 'therapist' and the therapist roster
   * has loaded, but no `therapists` row links back to this signed-in
   * user — an admin hasn't set Settings → Team → "Linked login" for them
   * yet. Screens use this to show a setup notice instead of silently
   * rendering an empty (fail-closed) worklist with no explanation.
   */
  isUnlinkedTherapist: boolean;
}

/**
 * Shared "whose data am I looking at" resolution for Workspace's stat
 * tiles and Insights — one implementation of role + own-therapist-id +
 * resulting query scope, rather than each screen re-deriving it. While
 * role hasn't resolved yet ('unknown'), scopes to the narrower therapist
 * view rather than flashing clinic-wide data before the real role loads.
 */
export function useWorkspaceScope(): WorkspaceScope {
  const clinic = useClinic();
  const { session } = useSession();
  const { role } = useClinicRole(clinic.id);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const myTherapistId = useMemo(
    () => (therapists ?? []).find((t) => t.userId === session?.user?.id)?.id,
    [therapists, session?.user?.id]
  );
  const isAdmin = role === 'admin';
  const isFrontDesk = role === 'front_desk';
  const isClinicWideView = isAdmin || isFrontDesk;
  const isUnlinkedTherapist = role === 'therapist' && therapists !== undefined && myTherapistId === undefined;

  return {
    role,
    isAdmin,
    isFrontDesk,
    myTherapistId,
    scopeTherapistId: isClinicWideView ? undefined : (myTherapistId ?? UNRESOLVED_THERAPIST_SENTINEL),
    isClinicWideView,
    isUnlinkedTherapist,
  };
}
