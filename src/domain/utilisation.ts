import { addDays, isClosedDay, workingIntervals } from './schedule';
import type { Visit, VisitItem, WorkingHours } from './types';
import { therapistMinutes, treatedTherapists } from './visitLines';

/**
 * A visit as utilisation sees it. Visits with live service lines (`items`) count each therapist's
 * minutes from those lines; visits without keep the legacy "one slot x share" rule.
 */
export type UtilisationVisit = Pick<Visit, 'therapistId' | 'visitDate' | 'sharedTherapistId' | 'sharedPct'> & {
  /** The visit's service lines (soft-deleted ones are ignored). */
  items?: VisitItem[];
  /** The sitting's length: the linked appointment's, else the clinic slot. Defaults to `slotMinutes`. */
  sittingMinutes?: number;
};

export type UtilisationInput = {
  visits: UtilisationVisit[];
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

function liveItems(v: UtilisationVisit): VisitItem[] {
  return (v.items ?? []).filter((i) => !i.deleted);
}

/**
 * How a visit counts for one therapist in "patients treated" terms: `treated` = they delivered at least
 * one live line (visits without lines: they are the primary); `assisted` = treated but not the primary.
 */
export function visitInvolvement(v: UtilisationVisit, therapistId: string): { treated: boolean; assisted: boolean } {
  const treated = treatedTherapists(v.items ?? [], v.therapistId).has(therapistId);
  return { treated, assisted: treated && v.therapistId !== therapistId };
}

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
    const items = liveItems(v);
    const minutes =
      items.length > 0
        ? therapistMinutes(items, v.therapistId, input.therapistId, v.sittingMinutes ?? input.slotMinutes)
        : visitShare(v, input.therapistId) * input.slotMinutes;
    if (minutes <= 0) continue;
    byDate.set(v.visitDate, (byDate.get(v.visitDate) ?? 0) + minutes);
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
