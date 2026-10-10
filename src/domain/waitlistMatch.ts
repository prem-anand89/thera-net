import type { AppointmentRequest } from './types';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

/** A slot that just became free — from a cancellation or reschedule. */
export interface WaitlistOpening {
  date: string;
  therapistId: string | null;
  timeOfDay: TimeOfDay;
}

/**
 * Which pending requests now fit a newly-freed slot. Matches any pending
 * request, not just ones explicitly joined as a waitlist entry
 * (`isWaitlist`) — a plain "day is full, please consider me" request
 * deserves the same surfacing once a slot opens up for it.
 */
/** Buckets a minutes-after-midnight value into the same Morning/Afternoon/
 *  Evening thresholds `BookingFormPage` already groups slots by. */
export function timeOfDayFor(minutes: number): TimeOfDay {
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 17 * 60) return 'afternoon';
  return 'evening';
}

export function matchingWaitlistEntries(requests: AppointmentRequest[], opening: WaitlistOpening): AppointmentRequest[] {
  return requests.filter(
    (r) =>
      r.status === 'pending' &&
      r.preferredDate === opening.date &&
      (r.preferredTherapistId === null || r.preferredTherapistId === opening.therapistId) &&
      (r.preferredTimeOfDay === 'any' || !r.preferredTimeOfDay || r.preferredTimeOfDay === opening.timeOfDay)
  );
}
