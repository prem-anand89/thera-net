import { describe, expect, it } from 'vitest';
import type { ProgramLog, SessionsPerDay } from '@/domain/hep';
import type { SessionFeedback } from '@/services/hepService';
import { itemProgress, itemProgressLine } from './itemProgress';

const item = { id: 'a', addedOn: '2026-11-09', removedOn: null, sessionsPerDay: 2 as SessionsPerDay, sessionsSchedule: [] };
const log = (d: string, s: number, skipped = false): ProgramLog => ({ id: d + s, programItemId: 'a', logDate: d, sessionIndex: s as SessionsPerDay, skipped, completedAt: '' });
const fb = (over: Partial<SessionFeedback>): SessionFeedback => ({ id: 'f', programId: 'p', logDate: '2026-11-10', sessionIndex: 1, painScore: 5, effortScore: null, painItemIds: [], hardItemIds: [], createdAt: '', ...over });

describe('itemProgress', () => {
  it('counts what was done out of what was due on finished days only', () => {
    const logs = [log('2026-11-09', 1), log('2026-11-09', 2), log('2026-11-10', 1), log('2026-11-10', 2, true), log('2026-11-12', 1) /* today: not counted */];
    expect(itemProgress(item, { startDate: '2026-11-09' }, logs, [], '2026-11-12')).toMatchObject({ done: 3, expected: 6, skipped: 1 });
  });
  it('an exercise added later is only due from the day it was added', () => {
    expect(itemProgress({ ...item, addedOn: '2026-11-11' }, { startDate: '2026-11-09' }, [], [], '2026-11-13').expected).toBe(4);
  });
  it('uses the sessions a day in force on each day (the schedule)', () => {
    const scheduled = { ...item, sessionsPerDay: 2 as SessionsPerDay, sessionsSchedule: [{ from: '2026-11-09', sessionsPerDay: 1 as SessionsPerDay }, { from: '2026-11-11', sessionsPerDay: 2 as SessionsPerDay }] };
    expect(itemProgress(scheduled, { startDate: '2026-11-09' }, [], [], '2026-11-12').expected).toBe(1 + 1 + 2);
  });
  it('counts the session checks that named it as hurting or the hardest', () => {
    const feedback = [fb({ painItemIds: ['a'] }), fb({ id: 'g', painItemIds: ['a', 'b'], hardItemIds: ['a'] }), fb({ id: 'h', hardItemIds: ['b'] })];
    expect(itemProgress(item, { startDate: '2026-11-09' }, [], feedback, '2026-11-12')).toMatchObject({ hurt: 2, hardest: 1 });
  });
  it('words it plainly and leaves out zeros', () => {
    expect(itemProgressLine({ done: 6, expected: 8, skipped: 0, hurt: 2, hardest: 3 })).toBe('done 6 of 8 · hurt 2× · hardest 3×');
    expect(itemProgressLine({ done: 0, expected: 0, skipped: 0, hurt: 0, hardest: 0 })).toBe('no finished days yet');
    expect(itemProgressLine({ done: 3, expected: 4, skipped: 1, hurt: 0, hardest: 0 })).toBe('done 3 of 4 · skipped 1');
  });
});
