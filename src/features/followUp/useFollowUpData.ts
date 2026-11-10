import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, toLocalDateStr } from '@/domain/schedule';
import { NO_SHOW_LOOKBACK_DAYS, followUpLists, noShowsToRebook, type FollowUpRow, type NoShowRow } from '@/domain/followUp';
import { departmentOf, inDepartment, type Department } from '@/domain/departments';
import { repos } from '@/services';
import type { Patient, UUID, Visit } from '@/domain/types';

export type FollowUpData = { due: FollowUpRow[]; missed: FollowUpRow[]; noShows: NoShowRow[] };
const EMPTY: FollowUpData = { due: [], missed: [], noShows: [] };

/**
 * The department a patient's open follow-up belongs to: the department of their latest visit on or before
 * `followUpSetOn` (or latest visit overall when `followUpSetOn` is absent), defaulting to OP ('clinic').
 */
export function followUpDepartmentForPatient(patient: Patient, visits: readonly Visit[]): Department {
  const cutoff = patient.followUpSetOn;
  let latest: Visit | null = null;
  let latestAny: Visit | null = null;
  for (const v of visits) {
    if (v.deleted || v.patientId !== patient.id) continue;
    if (!latestAny || v.visitDate.localeCompare(latestAny.visitDate) >= 0) {
      latestAny = v;
    }
    if (!cutoff || v.visitDate.localeCompare(cutoff) <= 0) {
      if (!latest || v.visitDate.localeCompare(latest.visitDate) >= 0) {
        latest = v;
      }
    }
  }
  const anchor = latest ?? latestAny;
  return anchor ? departmentOf(anchor) : 'clinic';
}

/**
 * What the Workspace "Follow up → Reviews" tab lists, computed from local data: reviews due, missed ones, and recent
 * no-shows nobody has rebooked. `therapistId` limits it to one therapist's patients (a therapist's own view);
 * leave it undefined for the whole clinic. When `department` is passed, only follow-ups and no-shows from that
 * department are listed.
 */
export function useFollowUpData(clinicId: UUID, therapistId?: UUID | null, department?: Department): FollowUpData {
  return (
    useLiveQuery(async () => {
      const today = toLocalDateStr(new Date());
      const [patients, appointments] = await Promise.all([repos.patients.list(clinicId), repos.appointments.listByClinic(clinicId)]);
      const open = patients.filter((p) => p.followUpOn && !p.deletedAt);
      const earliest = [addDays(today, -NO_SHOW_LOOKBACK_DAYS), ...open.map((p) => p.followUpSetOn ?? p.followUpOn!)].sort()[0];
      const visits = await repos.visits.list({ clinicId, from: earliest });
      const scopedPatients = department
        ? patients.filter((p) => !p.followUpOn || p.deletedAt || followUpDepartmentForPatient(p, visits) === department)
        : patients;
      const scopedNoShowAppointments = department
        ? appointments.filter((a) => inDepartment(department, a) || a.status !== 'no_show')
        : appointments;
      const options = { therapistId: therapistId ?? null };
      return {
        ...followUpLists(scopedPatients, visits, appointments, today, options),
        noShows: noShowsToRebook(scopedNoShowAppointments, visits, patients, today, options),
      };
    }, [clinicId, therapistId, department]) ?? EMPTY
  );
}
