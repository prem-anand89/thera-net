import type { Appointment } from '@/domain/types';

export interface TodayAppointmentPartition {
  inProgress: Appointment[];
  upcoming: Appointment[];
  logged: Appointment[];
  noShows: Appointment[];
  cancelled: Appointment[];
  pendingCount: number;
  doneCount: number;
}

/**
 * Pure partition helper separating today's appointments into actionable
 * queues (in progress, upcoming) and concluded categories (logged, no-show,
 * cancelled), with summary counts.
 */
export function partitionTodayAppointments(
  appointments: readonly Appointment[]
): TodayAppointmentPartition {
  const inProgress: Appointment[] = [];
  const upcoming: Appointment[] = [];
  const logged: Appointment[] = [];
  const noShows: Appointment[] = [];
  const cancelled: Appointment[] = [];

  for (const a of appointments) {
    if (a.visitId) {
      logged.push(a);
    } else if (a.status === 'arrived') {
      inProgress.push(a);
    } else if (a.status === 'confirmed' || a.status === 'rescheduled') {
      upcoming.push(a);
    } else if (a.status === 'no_show') {
      noShows.push(a);
    } else if (a.status === 'cancelled') {
      cancelled.push(a);
    }
  }

  return {
    inProgress,
    upcoming,
    logged,
    noShows,
    cancelled,
    pendingCount: inProgress.length + upcoming.length,
    doneCount: logged.length + noShows.length + cancelled.length,
  };
}
