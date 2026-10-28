import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, toLocalDateStr } from '@/domain/schedule';
import { NO_SHOW_LOOKBACK_DAYS, followUpLists, noShowsToRebook, type FollowUpRow, type NoShowRow } from '@/domain/followUp';
import { repos } from '@/services';
import type { UUID } from '@/domain/types';

export type FollowUpData = { due: FollowUpRow[]; missed: FollowUpRow[]; noShows: NoShowRow[] };
const EMPTY: FollowUpData = { due: [], missed: [], noShows: [] };

/**
 * What the Workspace "Follow up → Reviews" tab lists, computed from local data: reviews due, missed ones, and recent
 * no-shows nobody has rebooked. `therapistId` limits it to one therapist's patients (a therapist's own view);
 * leave it undefined for the whole clinic. Only visits since the earliest open follow-up / no-show are read.
 */
export function useFollowUpData(clinicId: UUID, therapistId?: UUID | null): FollowUpData {
  return (
    useLiveQuery(async () => {
      const today = toLocalDateStr(new Date());
      const [patients, appointments] = await Promise.all([repos.patients.list(clinicId), repos.appointments.listByClinic(clinicId)]);
      const open = patients.filter((p) => p.followUpOn && !p.deletedAt);
      const earliest = [addDays(today, -NO_SHOW_LOOKBACK_DAYS), ...open.map((p) => p.followUpSetOn ?? p.followUpOn!)].sort()[0];
      const visits = await repos.visits.list({ clinicId, from: earliest });
      const options = { therapistId: therapistId ?? null };
      return { ...followUpLists(patients, visits, appointments, today, options), noShows: noShowsToRebook(appointments, visits, patients, today, options) };
    }, [clinicId, therapistId]) ?? EMPTY
  );
}
