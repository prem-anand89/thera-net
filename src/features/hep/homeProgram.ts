// What the Home program tab shows, worked out from a program's rows, logs and session checks: the 14-day strip, the
// streak, one day's timeline by session, and the pain and effort trend. Pure and tested; the clinic's day is passed in.
import { SESSION_ORDER, addDaysISO, isItemActiveOnDate, sessionsPerDayOnDate, type ProgramItem, type ProgramLog, type SkipReason } from '@/domain/hep';
import { formatDateDM } from '@/domain/fiscalYear';
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
  return [...items].sort((a, b) => SESSION_ORDER.indexOf(a.phase) - SESSION_ORDER.indexOf(b.phase) || a.sortOrder - b.sortOrder);
}

export type WeekCellState = 'done' | 'partial' | 'skipped' | 'missed' | 'to_do' | 'not_due';
export interface ItemWeek {
  /** The last 7 days, oldest first, the last being today. */
  days: Array<{ date: string; state: WeekCellState }>;
  /** Days on which every session of this exercise was ticked. */
  doneDays: number;
  /** Session checks in the week that marked this exercise as hard. */
  hard: number;
  /** Skip logs for this exercise in the week. */
  skipped: number;
  /** Session checks in the week that tied pain to this exercise. */
  pain: number;
}

/** One exercise's last 7 days for the By exercise table: a cell per day, the days done, and its flags. */
export function itemWeek(
  item: Pick<ProgramItem, 'id' | 'addedOn' | 'removedOn' | 'sessionsPerDay' | 'sessionsSchedule'>,
  logs: ProgramLog[],
  feedback: SessionFeedback[],
  today: string,
  program?: { startDate: string; durationDays: number | null },
  days = 7,
): ItemWeek {
  const first = addDaysISO(today, -(days - 1));
  const last = program ? lastDayOf(program) : null;
  const mine = logs.filter((l) => l.programItemId === item.id && l.logDate >= first && l.logDate <= today);
  const cells = Array.from({ length: days }, (_, i) => addDaysISO(first, i)).map((date) => {
    const due = isItemActiveOnDate(item, date) && (!program || date >= program.startDate) && (!last || date <= last);
    const n = sessionsPerDayOnDate(item, date);
    const dayLogs = mine.filter((l) => l.logDate === date);
    const done = new Set(dayLogs.filter((l) => !l.skipped).map((l) => l.sessionIndex)).size;
    let state: WeekCellState;
    if (!due) state = 'not_due';
    else if (done >= n) state = 'done';
    else if (done > 0) state = 'partial';
    else if (dayLogs.some((l) => l.skipped)) state = 'skipped';
    else state = date === today ? 'to_do' : 'missed';
    return { date, state };
  });
  const week = feedback.filter((f) => f.logDate >= first && f.logDate <= today);
  return {
    days: cells,
    doneDays: cells.filter((c) => c.state === 'done').length,
    hard: week.filter((f) => f.hardItemIds.includes(item.id)).length,
    skipped: mine.filter((l) => l.skipped).length,
    pain: week.filter((f) => f.painItemIds.includes(item.id)).length,
  };
}

/** "3 done, 1 skipped (Pain), 2 not done" for a day's timeline (optional ones count only when done); null when nothing was due. */
export function daySummary(timeline: TimelineSession[]): string | null {
  const entries = timeline.flatMap((s) => s.entries);
  if (entries.length === 0) return null;
  const done = entries.filter((e) => e.status === 'done').length;
  const skipped = entries.filter((e) => e.status === 'skipped');
  // An optional exercise left undone is not held against the patient.
  const notDone = entries.filter((e) => !e.optional && (e.status === 'not_done' || e.status === 'to_do')).length;
  const reasons = [...new Set(skipped.map((e) => e.reason).filter((r): r is SkipReason => r != null))].map((r) => SKIP_REASON_LABEL[r]);
  const parts = [`${done} done`];
  if (skipped.length > 0) parts.push(`${skipped.length} skipped${reasons.length > 0 ? ` (${reasons.join(', ')})` : ''}`);
  if (notDone > 0) parts.push(`${notDone} not done`);
  return parts.join(', ');
}

export interface TrendPoint { x: number; y: number }

/** The pain and effort lines for the small trend chart (0 at the bottom, 10 at the top), only through the days with a
 *  report, and a sentence for screen readers. Null when nothing was reported. */
export function trendChart(series: Array<{ date: string; pain: number | null; effort: number | null }>, box: { width: number; height: number; pad: number }): { pain: TrendPoint[]; effort: TrendPoint[]; label: string } | null {
  const step = series.length > 1 ? box.width / (series.length - 1) : 0;
  const line = (pick: (d: (typeof series)[number]) => number | null) =>
    series.flatMap((d, i) => { const v = pick(d); return v == null ? [] : [{ x: Math.round(i * step), y: Math.round(box.height - box.pad - (v / 10) * (box.height - 2 * box.pad)) }]; });
  const pain = line((d) => d.pain);
  const effort = line((d) => d.effort);
  if (pain.length === 0 && effort.length === 0) return null;
  const words = (name: string, values: number[]) => {
    if (values.length === 0) return `No ${name.toLowerCase()} reported.`;
    const [a, b] = [values[0], values[values.length - 1]];
    return values.length === 1 || a === b ? `${name} ${b}` : `${name} went from ${a} to ${b}`;
  };
  const painValues = series.flatMap((d) => (d.pain == null ? [] : [d.pain]));
  const effortValues = series.flatMap((d) => (d.effort == null ? [] : [d.effort]));
  const first = words('Pain', painValues);
  const second = words('Effort', effortValues);
  const label = `${first}${first.endsWith('.') ? '' : ` over the last ${series.length} days.`} ${second}${second.endsWith('.') ? '' : '.'}`;
  return { pain, effort, label };
}

/** "review in 7 days" / "review tomorrow" / "review today" / "review due" from the program's check-in date. */
export function reviewLabel(checkinOn: string | null, today: string): string | null {
  if (!checkinOn) return null;
  const n = Math.round((Date.parse(`${checkinOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (n < 0) return 'review due';
  if (n === 0) return 'review today';
  if (n === 1) return 'review tomorrow';
  return `review in ${n} days`;
}

/** "08/11 – 21/11", or "From 08/11" for an ongoing program. */
export function programDateRange(startDate: string, durationDays: number | null): string {
  return durationDays ? `${formatDateDM(startDate)} – ${formatDateDM(addDaysISO(startDate, durationDays - 1))}` : `From ${formatDateDM(startDate)}`;
}
