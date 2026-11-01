import { minutesLabel } from './schedule';
import type { WorkingHours } from './types';

/**
 * Clinic operating hours for a clinic that closes in the middle of the day (a lunch break): one or two sessions a day,
 * stored per weekday as `clinics.operating_hours` in the same shape as a therapist's `WorkingHours`. The grid's outer
 * envelope (`booking_start_hour` / `booking_end_hour`) is always derived from these (`envelopeOf`), by the editor and by a
 * database trigger, so the two never drift apart. Pure, so the editor's rules are tested without a screen.
 */
export type Shifts = { s1: [number, number]; s2: [number, number] | null };

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function intervalsOf(shifts: Shifts): [number, number][] {
  return shifts.s2 ? [shifts.s1, shifts.s2] : [shifts.s1];
}

/** One pattern on every weekday (closed weekdays are handled by `closed_weekdays`, so writing them too is harmless). */
export function operatingFromShifts(shifts: Shifts): WorkingHours {
  const hours: WorkingHours = {};
  for (const day of WEEKDAYS) hours[String(day) as keyof WorkingHours] = intervalsOf(shifts);
  return hours;
}

/** Per-weekday patterns, for the open weekdays only. */
export function operatingFromDays(perDay: Record<number, Shifts>, openWeekdays: readonly number[]): WorkingHours {
  const hours: WorkingHours = {};
  for (const day of openWeekdays) {
    const shifts = perDay[day];
    if (shifts) hours[String(day) as keyof WorkingHours] = intervalsOf(shifts);
  }
  return hours;
}

/** A weekday's intervals as one or two sessions; null when there are none or more than two (not editable here). */
export function shiftsFromIntervals(day: unknown): Shifts | null {
  if (!Array.isArray(day)) return null;
  const pairs = day.filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number');
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 1) return { s1: sorted[0], s2: null };
  if (sorted.length === 2) return { s1: sorted[0], s2: sorted[1] };
  return null;
}

const sameShifts = (a: Shifts, b: Shifts) =>
  a.s1[0] === b.s1[0] && a.s1[1] === b.s1[1] && (a.s2 === null ? b.s2 === null : b.s2 !== null && a.s2[0] === b.s2[0] && a.s2[1] === b.s2[1]);

/**
 * What the editor shows for stored hours: the one pattern shared by every open weekday (`uniform`, null when days
 * differ) and each open weekday's own (`perDay`). With nothing stored the clinic is one block `fallback`, every day.
 */
export function shiftsFromOperating(
  hours: WorkingHours | null | undefined,
  openWeekdays: readonly number[],
  fallback: { startHour: number; endHour: number }
): { uniform: Shifts | null; perDay: Record<number, Shifts> } {
  const block: Shifts = { s1: [fallback.startHour * 60, fallback.endHour * 60], s2: null };
  const perDay: Record<number, Shifts> = {};
  for (const day of openWeekdays) {
    const stored = hours && typeof hours === 'object' ? shiftsFromIntervals((hours as Record<string, unknown>)[String(day)]) : null;
    perDay[day] = stored ?? block;
  }
  const days = openWeekdays.length > 0 ? openWeekdays : [1];
  const first = perDay[days[0]] ?? block;
  const uniform = openWeekdays.every((d) => sameShifts(perDay[d], first)) ? first : null;
  return { uniform, perDay };
}

/** The outer envelope of stored hours (earliest start rounded down, latest end rounded up, in whole hours). */
export function envelopeOf(hours: WorkingHours): { startHour: number; endHour: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const day of Object.values(hours)) {
    if (!Array.isArray(day)) continue;
    for (const [start, end] of day) {
      min = Math.min(min, start);
      max = Math.max(max, end);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { startHour: Math.max(0, Math.floor(min / 60)), endHour: Math.min(24, Math.ceil(max / 60)) };
}

/** What is wrong with the editor's value, in plain words (null = fine). Mirrors the server's check. */
export function shiftsProblem(shifts: Shifts, label = ''): string | null {
  const prefix = label ? `${label}: ` : '';
  const [a, b] = shifts.s1;
  if (a < 0 || b > 1440 || a >= b) return `${prefix}the first session must end after it starts.`;
  if (shifts.s2) {
    const [c, d] = shifts.s2;
    if (c < 0 || d > 1440 || c >= d) return `${prefix}the second session must end after it starts.`;
    if (c <= b) return `${prefix}the second session must start after the first one ends (that gap is when the clinic is closed).`;
  }
  return null;
}

/** "Closed 1:00 PM – 4:00 PM", or null for a single session. */
export function closedGapLabel(shifts: Shifts): string | null {
  return shifts.s2 ? `Closed ${minutesLabel(shifts.s1[1])} – ${minutesLabel(shifts.s2[0])}` : null;
}

/** "9:00 AM – 1:00 PM, 4:00 PM – 8:00 PM" */
export function describeShifts(shifts: Shifts): string {
  return intervalsOf(shifts)
    .map(([start, end]) => `${minutesLabel(start)} – ${minutesLabel(end)}`)
    .join(', ');
}

const round15 = (minutes: number) => Math.round(minutes / 15) * 15;

/**
 * What "closed in the middle of the day" starts as: the single session cut in two with a gap in the middle
 * (a 9 AM–8 PM day becomes 9:00–1:30 PM and 3:30–8 PM), for the person to adjust. Always a valid pair.
 */
export function splitSession([start, end]: [number, number]): Shifts {
  const firstEnd = round15(start + (end - start) * 0.4);
  const secondStart = Math.max(firstEnd + 15, round15(start + (end - start) * 0.6));
  if (firstEnd <= start || secondStart >= end) return { s1: [start, end], s2: null };
  return { s1: [start, firstEnd], s2: [secondStart, end] };
}
