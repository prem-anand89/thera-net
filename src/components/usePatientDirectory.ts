import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import type { Patient } from '@/domain/types';

/**
 * The clinic's patients plus each one's last visit date, from the local store, for the places that
 * need to tell patients apart (IDs beside names, "seen 12 Oct" in a duplicate check).
 * `mrnoFor` returns undefined for an unlinked appointment (no patient file yet).
 */
export function usePatientDirectory(clinicId: string, withVisits = false) {
  const data = useLiveQuery(
    async () => ({
      patients: await repos.patients.list(clinicId),
      visits: withVisits ? await repos.visits.list({ clinicId }) : [],
    }),
    [clinicId, withVisits]
  );
  return useMemo(() => {
    const patients: Patient[] = data?.patients ?? [];
    const lastVisitOn = new Map<string, string>();
    for (const visit of data?.visits ?? []) {
      const current = lastVisitOn.get(visit.patientId);
      if (!current || visit.visitDate > current) lastVisitOn.set(visit.patientId, visit.visitDate);
    }
    const byId = new Map(patients.map((p) => [p.id, p]));
    return {
      patients,
      lastVisitOn,
      mrnoFor: (patientId: string | null | undefined): string | undefined => (patientId ? byId.get(patientId)?.mrno : undefined),
    };
  }, [data]);
}
