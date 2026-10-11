import { addDays, isClosedDay, workingIntervals } from './schedule';
import type { Visit, WorkingHours } from './types';

export type UtilisationInput = {
  visits: Pick<Visit, 'therapistId' | 'visitDate' | 'sharedTherapistId' | 'sharedPct'>[];
  therapistId: string;
  workingHours: WorkingHours | null | undefined;
  /** Inclusive yyyy-mm-dd range. */
  from: string;
  to: string;
  clinicHours: { startHour: number; endHour: number };
  closedWeekdays?: number[];
  closedDates: { closedDate: string; label: string | null }[];
  /** Each logged visit counts as one slot of this length. */
  slotMinutes: number;
  /** Today's date and minutes-since-midnight: later days are skipped and today only counts elapsed time. */
  asOf?: { date: string; minutes: number };
};

export type Utilisation = {
  workedMinutes: number;
  availableMinutes: number;
  /** workedMinutes / availableMinutes; null when nothing was available. */
  ratio: number | null;
  /** Visit time logged on days off or closed days — real work, but not counted against capacity. */
  offHoursMinutes: number;
  /** No personal hours set, so the clinic's booking hours were used as capacity. */
  usesClinicHours: boolean;
};

function visitShare(
  v: UtilisationInput['visits'][number],
  therapistId: string
): number {
  const pct = v.sharedTherapistId && v.sharedPct ? v.sharedPct / 100 : 0;
  if (v.therapistId === therapistId) return 1 - pct;
  if (v.sharedTherapistId === therapistId) return pct;
  return 0;
}

/**
 * Utilisation = work actually done / time made available, from logged visits
 * (not bookings), so walk-ins count. Each day is capped at 100% of that day's
 * available minutes so overlapping or back-to-back entries cannot overstate it.
 */
export function therapistUtilisation(input: UtilisationInput): Utilisation {
  const byDate = new Map<string, number>();
  for (const v of input.visits) {
    const share = visitShare(v, input.therapistId);
    if (share <= 0) continue;
    byDate.set(v.visitDate, (byDate.get(v.visitDate) ?? 0) + share * input.slotMinutes);
  }

  let workedMinutes = 0;
  let availableMinutes = 0;
  let offHoursMinutes = 0;

  for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
    if (input.asOf && date > input.asOf.date) break;
    const worked = byDate.get(date) ?? 0;
    const closed = isClosedDay(date, input.closedWeekdays, input.closedDates).closed;
    const intervals = closed ? [] : workingIntervals(input.workingHours, date, input.clinicHours);
    const elapsedTo = input.asOf && date === input.asOf.date ? input.asOf.minutes : Infinity;
    const available = intervals.reduce(
      (sum, w) => sum + Math.max(0, Math.min(w.end, elapsedTo) - w.start),
      0
    );
    if (available > 0) {
      availableMinutes += available;
      workedMinutes += Math.min(worked, available);
    } else {
      offHoursMinutes += worked;
    }
  }

  return {
    workedMinutes,
    availableMinutes,
    ratio: availableMinutes > 0 ? workedMinutes / availableMinutes : null,
    offHoursMinutes,
    usesClinicHours: !input.workingHours,
  };
}
