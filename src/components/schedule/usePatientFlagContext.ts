import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, repos } from '@/services';
import { useDepartment } from '@/app/DepartmentContext';
import { inDepartment } from '@/domain/departments';
import { countNoShows, type PatientFlagContext } from '@/domain/patientFlags';
import type { Appointment } from '@/domain/types';

/**
 * Everything `patientFlags` / `appointmentReason` need, loaded once per
 * screen from the local (Dexie) store: visits (new patient, last condition),
 * open packages, patients with money still owed (balance due, the same per-visit rule as the Workspace Dues tile),
 * booking-request notes, and no-shows from the appointments already on
 * screen. Returns undefined until loaded, so flags simply appear.
 */
export function usePatientFlagContext(clinicId: string, appointments: Appointment[]): PatientFlagContext | undefined {
  const { department } = useDepartment();
  const data = useLiveQuery(async () => {
    const [allVisits, patients, packages, patientIdsWithDues, requests] = await Promise.all([
      repos.visits.list({ clinicId }),
      repos.patients.list(clinicId),
      dashboardService.openPackages(clinicId, department),
      dashboardService.patientIdsWithDues(clinicId, department),
      repos.appointmentRequests.listByClinic(clinicId),
    ]);
    const visits = allVisits.filter((v) => inDepartment(department, v));
    return { visits, patients, packages, patientIdsWithDues, requests };
  }, [clinicId, department]);

  const noShows = useMemo(() => countNoShows(appointments), [appointments]);

  return useMemo(() => {
    if (!data) return undefined;
    const patientIdsWithVisits = new Set<string>();
    const latestCondition = new Map<string, string>();
    // visits.list returns newest first, so the first condition seen is the latest.
    for (const visit of data.visits) {
      patientIdsWithVisits.add(visit.patientId);
      if (visit.condition?.trim() && !latestCondition.has(visit.patientId)) latestCondition.set(visit.patientId, visit.condition.trim());
    }
    const conditionByPatient = new Map<string, string>();
    for (const patient of data.patients) {
      const condition = patient.primaryCondition?.trim() || latestCondition.get(patient.id);
      if (condition) conditionByPatient.set(patient.id, condition);
    }
    const balanceDue = data.patientIdsWithDues;
    const packages = new Map<string, { logged: number; total: number }>();
    for (const pkg of data.packages) {
      if (!packages.has(pkg.patientId)) packages.set(pkg.patientId, { logged: pkg.sessionsLogged, total: pkg.packageTotal });
    }
    const requestNotes = new Map<string, string>();
    for (const request of data.requests) if (request.notes?.trim()) requestNotes.set(request.id, request.notes.trim());
    return { patientIdsWithVisits, packages, balanceDue, noShows, conditionByPatient, requestNotes };
  }, [data, noShows]);
}
