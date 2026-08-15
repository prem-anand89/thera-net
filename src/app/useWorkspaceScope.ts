import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from './clinicContext';
import { useSession } from './useSession';
import { useClinicRole } from './useClinicRole';

export interface WorkspaceScope {
  role: 'admin' | 'staff' | 'unknown';
  isAdmin: boolean;
  /** This user's own therapist row in this clinic, if their login is linked to one. */
  myTherapistId: string | undefined;
  /** undefined = clinic-wide (admin); a therapist id = narrowed to just them (staff, or role still resolving). */
  scopeTherapistId: string | undefined;
}

/**
 * Shared "whose data am I looking at" resolution for Workspace's stat
 * tiles and Insights — one implementation of role + own-therapist-id +
 * resulting query scope, rather than each screen re-deriving it. While
 * role hasn't resolved yet ('unknown'), scopes to the narrower staff view
 * rather than flashing clinic-wide data before the real role loads.
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

  return {
    role,
    isAdmin,
    myTherapistId,
    scopeTherapistId: isAdmin ? undefined : myTherapistId,
  };
}
