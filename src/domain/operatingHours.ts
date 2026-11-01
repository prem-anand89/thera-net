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

export const sameShifts = (a: Shifts, b: Shifts) =>
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
  const stored = new Map<number, Shifts | null>();
  for (const day of openWeekdays) {
    stored.set(day, hours && typeof hours === 'object' ? shiftsFromIntervals((hours as Record<string, unknown>)[String(day)]) : null);
  }
  // A day with nothing stored (one just reopened) shows the hours of the first day that has some, not the bare envelope.
  const fallbackDay = openWeekdays.map((d) => stored.get(d)).find((s): s is Shifts => Boolean(s)) ?? block;
  const perDay: Record<number, Shifts> = {};
  for (const day of openWeekdays) perDay[day] = stored.get(day) ?? fallbackDay;
  const days = openWeekdays.length > 0 ? openWeekdays : [1];
  const first = perDay[days[0]] ?? block;
  const uniform = openWeekdays.every((d) => sameShifts(perDay[d], first)) ? first : null;
  return { uniform, perDay };
}

/** Open weekdays that share exactly the same hours, in the order given (the editor shows one card per group). */
export function groupDays(perDay: Record<number, Shifts>, openWeekdays: readonly number[]): { days: number[]; shifts: Shifts }[] {
  const groups: { days: number[]; shifts: Shifts }[] = [];
  for (const day of openWeekdays) {
    const shifts = perDay[day];
    if (!shifts) continue;
    const group = groups.find((g) => sameShifts(g.shifts, shifts));
    if (group) group.days.push(day);
    else groups.push({ days: [day], shifts });
  }
  return groups;
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** "Mon–Fri, Sun": runs of consecutive weekdays (Monday first) joined, the rest listed. */
export function daysLabel(days: readonly number[]): string {
  const at = MON_FIRST.filter((d) => days.includes(d)).map((d) => MON_FIRST.indexOf(d));
  const parts: string[] = [];
  for (let i = 0; i < at.length; ) {
    let j = i;
    while (j + 1 < at.length && at[j + 1] === at[j] + 1) j++;
    const first = SHORT_DAYS[MON_FIRST[at[i]]];
    const last = SHORT_DAYS[MON_FIRST[at[j]]];
    parts.push(j - i >= 2 ? `${first}–${last}` : at.slice(i, j + 1).map((k) => SHORT_DAYS[MON_FIRST[k]]).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}

/**
 * Stored hours after the open days change: a reopened day with no hours gets the first open day's, so it is never
 * saved open but empty (which would hide it from online booking). Null stays null (one plain block for every day).
 */
export function withOpenDays(hours: WorkingHours | null | undefined, closedWeekdays: readonly number[]): WorkingHours | null {
  if (!hours) return null;
  const open = [1, 2, 3, 4, 5, 6, 0].filter((d) => !closedWeekdays.includes(d));
  const has = (d: number) => shiftsFromIntervals((hours as Record<string, unknown>)[String(d)]) !== null;
  const source = open.find(has);
  if (source === undefined) return hours;
  const next: WorkingHours = { ...hours };
  for (const day of open) {
    if (!has(day)) next[String(day) as keyof WorkingHours] = (hours as Record<string, [number, number][]>)[String(source)];
  }
  return next;
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
