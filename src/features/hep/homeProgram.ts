// What the Home program tab shows, worked out from a program's rows, logs and session checks: the 14-day strip, the
// streak, one day's timeline by session, and the pain and effort trend. Pure and tested; the clinic's day is passed in.
import { EXERCISE_PHASES, addDaysISO, isItemActiveOnDate, sessionsPerDayOnDate, type ProgramItem, type ProgramLog, type SkipReason } from '@/domain/hep';
import type { SessionFeedback } from '@/services/hepService';

type RowItem = Pick<ProgramItem, 'id' | 'title' | 'phase' | 'optional' | 'addedOn' | 'removedOn' | 'sessionsPerDay' | 'sessionsSchedule'>;

export type DayState = 'all' | 'partial' | 'missed' | 'today' | 'outside';
export interface DayCell { date: string; state: DayState; completed: number; expected: number }

export const SKIP_REASON_LABEL: Record<SkipReason, string> = { pain: 'Pain', no_time: 'No time', too_hard: 'Too hard', forgot: 'Forgot', didnt_understand: "Didn't understand", other: 'Other' };

/** Sessions due and done on a date, counting required exercises only (optional ones never count against the patient). */
function dayCounts(items: RowItem[], logs: ProgramLog[], date: string) {
  const done = new Set(logs.filter((l) => !l.skipped && l.logDate === date).map((l) => `${l.programItemId}:${l.sessionIndex}`));
  let expected = 0;
  let completed = 0;
  for (const item of items) {
    if (item.optional || !isItemActiveOnDate(item, date)) continue;
    const n = sessionsPerDayOnDate(item, date);
    expected += n;
    for (let s = 1; s <= n; s++) if (done.has(`${item.id}:${s}`)) completed += 1;
  }
  return { expected, completed };
}

const lastDayOf = (p: { startDate: string; durationDays: number | null }) => (p.durationDays ? addDaysISO(p.startDate, p.durationDays - 1) : null);

/** One cell per day for the last `days` days, oldest first, the last being today. */
export function dayStrip(program: { startDate: string; durationDays: number | null }, items: RowItem[], logs: ProgramLog[], today: string, days = 14): DayCell[] {
  const last = lastDayOf(program);
  return Array.from({ length: days }, (_, i) => addDaysISO(today, i - (days - 1))).map((date) => {
    const c = dayCounts(items, logs, date);
    if (date < program.startDate || (last && date > last) || c.expected === 0) return { date, state: 'outside' as const, ...c };
    if (date === today) return { date, state: 'today' as const, ...c };
    return { date, state: c.completed === c.expected ? ('all' as const) : c.completed > 0 ? ('partial' as const) : ('missed' as const), ...c };
  });
}

/** Days in a row, ending yesterday, on which every required session was done. */
export function currentStreak(program: { startDate: string; durationDays: number | null }, items: RowItem[], logs: ProgramLog[], today: string): number {
  const last = lastDayOf(program);
  let day = addDaysISO(today, -1);
  if (last && day > last) day = last;
  let n = 0;
  for (; day >= program.startDate; day = addDaysISO(day, -1)) {
    const c = dayCounts(items, logs, day);
    if (c.expected === 0 || c.completed < c.expected) break;
    n += 1;
  }
  return n;
}

export function sessionLabel(index: number, total: number): string {
  if (total === 2) return index === 1 ? 'Morning' : 'Evening';
  if (total === 3) return ['Morning', 'Afternoon', 'Evening'][index - 1];
  return 'Today\'s session';
}

export interface TimelineEntry {
  itemId: string;
  title: string;
  optional: boolean;
  status: 'done' | 'skipped' | 'not_done' | 'to_do';
  /** When it was ticked (ISO), for the time shown. */
  at: string | null;
  reason: SkipReason | null;
}
export interface TimelineSession {
  index: number;
  label: string;
  entries: TimelineEntry[];
  pain: number | null;
  effort: number | null;
  hurt: string[];
  hardest: string[];
}

/** The day as the patient lived it: each session with its exercises (done, skipped with the reason, not done) and the Pain / Effort check. */
export function dayTimeline(items: RowItem[], logs: ProgramLog[], feedback: SessionFeedback[], date: string, today: string): TimelineSession[] {
  const active = items.filter((i) => isItemActiveOnDate(i, date));
  const total = active.reduce((m, i) => Math.max(m, sessionsPerDayOnDate(i, date)), 0);
  const titleOf = new Map(items.map((i) => [i.id, i.title]));
  return Array.from({ length: total }, (_, k) => k + 1).map((index) => {
    const entries: TimelineEntry[] = active
      .filter((i) => sessionsPerDayOnDate(i, date) >= index)
      .map((i) => {
        const log = logs.find((l) => l.programItemId === i.id && l.logDate === date && l.sessionIndex === index);
        const status: TimelineEntry['status'] = log ? (log.skipped ? 'skipped' : 'done') : date < today ? 'not_done' : 'to_do';
        return { itemId: i.id, title: i.title, optional: i.optional, status, at: log?.completedAt ?? null, reason: log?.skipped ? (log.skipReason ?? null) : null };
      });
    const fb = feedback.find((f) => f.logDate === date && f.sessionIndex === index);
    const names = (ids: string[]) => ids.map((id) => titleOf.get(id)).filter((t): t is string => !!t);
    return { index, label: sessionLabel(index, total), entries, pain: fb?.painScore ?? null, effort: fb?.effortScore ?? null, hurt: names(fb?.painItemIds ?? []), hardest: names(fb?.hardItemIds ?? []) };
  });
}

/** Per day, the highest session pain and effort reported, for the last `days` days (oldest first); null where nothing was reported. */
export function trendSeries(feedback: SessionFeedback[], today: string, days = 7): Array<{ date: string; pain: number | null; effort: number | null }> {
  return Array.from({ length: days }, (_, i) => addDaysISO(today, i - (days - 1))).map((date) => {
    const day = feedback.filter((f) => f.logDate === date);
    const max = (pick: (f: SessionFeedback) => number | null) => day.reduce<number | null>((m, f) => { const v = pick(f); return v == null ? m : m == null || v > m ? v : m; }, null);
    return { date, pain: max((f) => f.painScore), effort: max((f) => f.effortScore) };
  });
}

/** The rows in session order, for the By exercise list. */
export function itemsInSessionOrder<T extends Pick<ProgramItem, 'phase' | 'sortOrder'>>(items: T[]): T[] {
  return [...items].sort((a, b) => EXERCISE_PHASES.indexOf(a.phase) - EXERCISE_PHASES.indexOf(b.phase) || a.sortOrder - b.sortOrder);
}
