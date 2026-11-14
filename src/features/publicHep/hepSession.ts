// The patient page's rules about sessions, rows and wording, kept pure so they are tested without a screen.
// "Today: X of Y" counts sessions (an exercise done twice a day is two), the same unit as the therapist's adherence.
import { EXERCISE_PHASE_LABELS, isItemActiveOnDate, sessionsPerDayOnDate, type ExercisePhase, type ProgramLog, type SessionsPerDay, type SkipReason } from '@/domain/hep';
import type { PublicHepItem, PublicHepPayload } from '@/services/publicHepService';

export type PublicLog = PublicHepPayload['logs'][number];

export const toProgramLogs = (logs: PublicLog[]): ProgramLog[] =>
  logs.map((l) => ({ id: `${l.programItemId}:${l.logDate}:${l.sessionIndex}`, programItemId: l.programItemId, logDate: l.logDate, sessionIndex: l.sessionIndex, skipped: l.skipped, skipReason: l.skipReason, completedAt: l.completedAt }));

/** 1 a day has no label; 2 a day is Morning and Evening; 3 a day adds Afternoon. */
export function sessionLabel(count: number, session: number): string {
  if (count <= 1) return '';
  if (count === 2) return session === 1 ? 'Morning' : 'Evening';
  return ['Morning', 'Afternoon', 'Evening'][session - 1] ?? '';
}

/** The exercises that are due on a day: added by then. (The server already leaves out removed ones.) */
export const itemsDueOn = (items: PublicHepItem[], date: string): PublicHepItem[] => items.filter((i) => isItemActiveOnDate({ addedOn: i.addedOn, removedOn: null }, date));

/** How many sessions a day the page shows a switch for: the most any exercise has today. */
export function sessionsToday(items: PublicHepItem[], today: string): SessionsPerDay {
  let most: SessionsPerDay = 1;
  for (const i of itemsDueOn(items, today)) {
    const n = sessionsPerDayOnDate(i, today);
    if (n > most) most = n;
  }
  return most;
}

export type SessionStatus = 'done' | 'skipped' | 'open' | 'none';

/** One exercise in one session today. `none` means the exercise has no such session today. */
export function statusOf(item: PublicHepItem, logs: PublicLog[], today: string, session: number): SessionStatus {
  if (!isItemActiveOnDate({ addedOn: item.addedOn, removedOn: null }, today)) return 'none';
  if (session > sessionsPerDayOnDate(item, today)) return 'none';
  const log = logs.find((l) => l.programItemId === item.id && l.logDate === today && l.sessionIndex === session);
  if (!log) return 'open';
  return log.skipped ? 'skipped' : 'done';
}

/** The exercises that belong to a session today, in program order. */
export const itemsInSession = (items: PublicHepItem[], logs: PublicLog[], today: string, session: number): PublicHepItem[] =>
  items.filter((i) => statusOf(i, logs, today, session) !== 'none');

export function todayCounts(items: PublicHepItem[], logs: PublicLog[], today: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const item of items) {
    if (item.optional) continue;
    const target = isItemActiveOnDate({ addedOn: item.addedOn, removedOn: null }, today) ? sessionsPerDayOnDate(item, today) : 0;
    for (let s = 1; s <= target; s++) {
      total += 1;
      if (statusOf(item, logs, today, s) === 'done') done += 1;
    }
  }
  return { done, total };
}

/** Required exercises of a session that still have no status (optional ones never hold a session open). */
export const openRequired = (items: PublicHepItem[], logs: PublicLog[], today: string, session: number): PublicHepItem[] =>
  itemsInSession(items, logs, today, session).filter((i) => !i.optional && statusOf(i, logs, today, session) === 'open');

/** Every required exercise of the session has a status (done or skipped), and there was something to do. */
export function sessionComplete(items: PublicHepItem[], logs: PublicLog[], today: string, session: number): boolean {
  const mine = itemsInSession(items, logs, today, session).filter((i) => !i.optional);
  return mine.length > 0 && mine.every((i) => statusOf(i, logs, today, session) !== 'open');
}

/** "Start where I left off": the first required exercise of the session with no status, optionally after a given one. */
export function nextToDo(items: PublicHepItem[], logs: PublicLog[], today: string, session: number, afterId?: string): PublicHepItem | null {
  const open = openRequired(items, logs, today, session);
  if (afterId) {
    const at = items.findIndex((i) => i.id === afterId);
    const later = open.find((i) => items.findIndex((x) => x.id === i.id) > at);
    if (later) return later;
  }
  return open.find((i) => i.id !== afterId) ?? null;
}

/** The first session (1..n) that still has something to do, else the last one. */
export function currentSession(items: PublicHepItem[], logs: PublicLog[], today: string, count: number): number {
  for (let s = 1; s <= count; s++) if (openRequired(items, logs, today, s).length > 0) return s;
  return count;
}

export interface Section { phase: ExercisePhase; title: string; items: PublicHepItem[] }

/** The exercise type is the section; sections keep the program's order (the first exercise of each decides). */
export function sectionsOf(items: PublicHepItem[]): Section[] {
  const out: Section[] = [];
  for (const item of items) {
    let s = out.find((x) => x.phase === item.phase);
    if (!s) {
      s = { phase: item.phase, title: EXERCISE_PHASE_LABELS[item.phase], items: [] };
      out.push(s);
    }
    s.items.push(item);
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a section header shows beside its name: "2 of 4", or "optional" when nothing in it is required. */
export const sectionLabelCount = (required: number, done: number): string => (required === 0 ? 'optional' : `${done} of ${required}`);

/** Whole days from the program's first day to today, as "Day N" (never below 1). */
export function dayNumber(startDate: string, today: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(1, Math.round((ms(today) - ms(startDate)) / 86_400_000) + 1);
}

/** A short dose for a checklist row: "3×12·5s", "2×20s · each side". */
export function shortDose(item: Pick<PublicHepItem, 'doseType' | 'sets' | 'reps' | 'holdSeconds' | 'durationSeconds' | 'side'>): string {
  let core: string;
  if (item.doseType === 'timed') core = `${item.sets}×${item.durationSeconds ?? 0}s`;
  else if (item.doseType === 'hold') core = `${item.sets}×${item.reps ?? 0}·${item.holdSeconds ?? 0}s`;
  else core = `${item.sets}×${item.reps ?? 0}`;
  return item.side === 'both' ? `${core} · each side` : core;
}

/** The dose as one line in words: "3 sets · 12 reps · hold 3 s". */
export function doseInWords(item: Pick<PublicHepItem, 'doseType' | 'sets' | 'reps' | 'holdSeconds' | 'durationSeconds'>): string {
  const parts = [plural(item.sets, 'set', 'sets')];
  if (item.doseType === 'timed') parts.push(`${item.durationSeconds ?? 0} s`);
  else {
    parts.push(plural(item.reps ?? 0, 'rep', 'reps'));
    if (item.doseType === 'hold') parts.push(`hold ${item.holdSeconds ?? 0} s`);
  }
  return parts.join(' · ');
}

/** The muted line under the dose: "each side · needs a light band · morning session". */
export function doseNotes(item: Pick<PublicHepItem, 'side' | 'equipment' | 'optional'>, sessionCount: number, session: number): string {
  const parts: string[] = [];
  if (item.side === 'both') parts.push('each side');
  if (item.side === 'left') parts.push('left side only');
  if (item.side === 'right') parts.push('right side only');
  if (item.equipment.length > 0) parts.push(`needs ${item.equipment.join(', ').toLowerCase()}`);
  const label = sessionLabel(sessionCount, session);
  if (label) parts.push(`${label.toLowerCase()} session`);
  return parts.join(' · ');
}

/** The numbered steps of an exercise's instructions (one per line; a leading "1." is removed). */
export function stepsOf(instructions: string): string[] {
  return instructions
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean);
}

export const SKIP_REASONS: Array<{ value: SkipReason; label: string }> = [
  { value: 'pain', label: 'Pain' },
  { value: 'no_time', label: 'No time' },
  { value: 'too_hard', label: 'Too hard' },
  { value: 'forgot', label: 'Forgot' },
  { value: 'didnt_understand', label: 'Did not understand' },
  { value: 'other', label: 'Other' },
];

export function painWords(n: number): string {
  if (n === 0) return 'No pain';
  if (n <= 3) return 'Mild';
  if (n <= 6) return 'Moderate';
  return 'Severe';
}

export function effortWords(n: number): string {
  if (n === 0) return 'Rest';
  if (n <= 2) return 'Very easy';
  if (n <= 4) return 'Easy';
  if (n <= 6) return 'Somewhat hard';
  if (n <= 8) return 'Hard';
  return n === 9 ? 'Very hard' : 'Maximum';
}

/** The clinic's calendar day on this phone, from the clinic's own time zone. */
export function clinicDay(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
