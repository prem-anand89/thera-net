import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dashboardService, repos } from '@/services';
import { countNoShows, type PatientFlagContext } from '@/domain/patientFlags';
import type { Appointment } from '@/domain/types';

/**
 * Everything `patientFlags` / `appointmentReason` need, loaded once per
 * screen from the local (Dexie) store: visits (new patient, last condition),
 * open packages, outstanding invoices (balance due, matched by patient ID),
 * booking-request notes, and no-shows from the appointments already on
 * screen. Returns undefined until loaded, so flags simply appear.
 */
export function usePatientFlagContext(clinicId: string, appointments: Appointment[]): PatientFlagContext | undefined {
  const data = useLiveQuery(async () => {
    const [visits, patients, packages, outstanding, requests] = await Promise.all([
      repos.visits.list({ clinicId }),
      repos.patients.list(clinicId),
      dashboardService.openPackages(clinicId),
      dashboardService.outstandingInvoices(clinicId),
      repos.appointmentRequests.listByClinic(clinicId),
    ]);
    return { visits, patients, packages, outstanding, requests };
  }, [clinicId]);

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
    const idByMrno = new Map(data.patients.map((p) => [p.mrno, p.id]));
    const balanceDue = new Set<string>();
    for (const row of data.outstanding.rows) {
      const id = idByMrno.get(row.mrno);
      if (id) balanceDue.add(id);
    }
    const packages = new Map<string, { logged: number; total: number }>();
    for (const pkg of data.packages) {
      if (!packages.has(pkg.patientId)) packages.set(pkg.patientId, { logged: pkg.sessionsLogged, total: pkg.packageTotal });
    }
    const requestNotes = new Map<string, string>();
    for (const request of data.requests) if (request.notes?.trim()) requestNotes.set(request.id, request.notes.trim());
    return { patientIdsWithVisits, packages, balanceDue, noShows, conditionByPatient, requestNotes };
  }, [data, noShows]);
}
