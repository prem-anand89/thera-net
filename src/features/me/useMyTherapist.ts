import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useSession } from '@/app/useSession';
import type { Therapist } from '@/domain/types';

/** The roster row linked to the signed-in login, if any. Admins and front
 *  desk usually have none; a therapist's own settings hang off this. */
export function useMyTherapist(clinicId: string): Therapist | undefined {
  const { session } = useSession();
  const userId = session?.user?.id;
  const therapists = useLiveQuery(
    () => (userId ? repos.therapists.list(clinicId, true) : []),
    [clinicId, userId]
  );
  return therapists?.find((t) => t.userId === userId);
}
