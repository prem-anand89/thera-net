import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { useEntitlements } from '@/app/useEntitlements';
import { showsTherapistComparison } from '@/domain/therapistComparison';

/** {@link showsTherapistComparison} for the signed-in user and active clinic. False while the therapist list loads. */
export function useShowTherapistComparison(): boolean {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const entitlements = useEntitlements(clinic.id);
  const activeTherapistCount = useLiveQuery(
    async () => (await repos.therapists.list(clinic.id, true)).filter((t) => t.active).length,
    [clinic.id]
  );
  return showsTherapistComparison({
    isAdmin: scope.isAdmin,
    hasRevenueSplit: entitlements.can('revenueSplit'),
    activeTherapistCount: activeTherapistCount ?? 0,
  });
}
