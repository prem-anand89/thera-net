// "So far" numbers for one exercise on a live program, shown on its row when the therapist edits the program
// (amendment 73): done 6 of 8 · hurt 2× · hardest 3×. Counts finished days only, so today's half-done day never looks bad.
import { addDaysISO, isItemActiveOnDate, sessionsPerDayOnDate, type ProgramItem, type ProgramLog } from '@/domain/hep';
import type { SessionFeedback } from '@/services/hepService';

export interface ItemProgress {
  done: number;
  expected: number;
  skipped: number;
  hurt: number;
  hardest: number;
}

export function itemProgress(
  item: Pick<ProgramItem, 'id' | 'addedOn' | 'removedOn' | 'sessionsPerDay' | 'sessionsSchedule'>,
  program: { startDate: string },
  logs: ProgramLog[],
  feedback: SessionFeedback[],
  today: string,
): ItemProgress {
  const from = item.addedOn > program.startDate ? item.addedOn : program.startDate;
  let expected = 0;
  for (let d = from; d < today; d = addDaysISO(d, 1)) if (isItemActiveOnDate(item, d)) expected += sessionsPerDayOnDate(item, d);
  const mine = logs.filter((l) => l.programItemId === item.id && l.logDate < today);
  return {
    done: mine.filter((l) => !l.skipped).length,
    expected,
    skipped: mine.filter((l) => l.skipped).length,
    hurt: feedback.filter((f) => f.painItemIds.includes(item.id)).length,
    hardest: feedback.filter((f) => f.hardItemIds.includes(item.id)).length,
  };
}

/** "done 6 of 8 · hurt 2× · hardest 3×", leaving out what is zero; "no sessions yet" before the first finished day. */
export function itemProgressLine(p: ItemProgress): string {
  const parts: string[] = [];
  parts.push(p.expected > 0 ? `done ${p.done} of ${p.expected}` : 'no finished days yet');
  if (p.skipped > 0) parts.push(`skipped ${p.skipped}`);
  if (p.hurt > 0) parts.push(`hurt ${p.hurt}×`);
  if (p.hardest > 0) parts.push(`hardest ${p.hardest}×`);
  return parts.join(' · ');
}
