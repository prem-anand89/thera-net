import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from './clinicContext';
import { useSession } from './useSession';
import { useClinicRole } from './useClinicRole';

export interface WorkspaceScope {
  role: 'admin' | 'therapist' | 'front_desk' | 'unknown';
  isAdmin: boolean;
  isFrontDesk: boolean;
  /** This user's own therapist row in this clinic, if their login is linked to one. */
  myTherapistId: string | undefined;
  /** undefined = clinic-wide (admin or front desk); a therapist id = narrowed to just them (therapist, or role still resolving). */
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

  return {
    role,
    isAdmin,
    isFrontDesk,
    myTherapistId,
    scopeTherapistId: isClinicWideView ? undefined : myTherapistId,
    isClinicWideView,
  };
}
