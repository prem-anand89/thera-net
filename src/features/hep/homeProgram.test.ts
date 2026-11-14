import { describe, expect, it } from 'vitest';
import type { ProgramLog, SessionsPerDay, SkipReason } from '@/domain/hep';
import type { SessionFeedback } from '@/services/hepService';
import { currentStreak, dayStrip, dayTimeline, sessionLabel, trendSeries } from './homeProgram';

const TODAY = '2026-11-14';
const item = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Item ${id}`, phase: 'strengthening' as const, optional: false, addedOn: '2026-11-08', removedOn: null, sessionsPerDay: 1 as SessionsPerDay, sessionsSchedule: [], ...over });
const log = (id: string, date: string, s = 1, over: Partial<ProgramLog> = {}): ProgramLog => ({ id: id + date + s, programItemId: id, logDate: date, sessionIndex: s as SessionsPerDay, skipped: false, completedAt: `${date}T08:00:00Z`, ...over });
const fb = (over: Partial<SessionFeedback>): SessionFeedback => ({ id: 'f', programId: 'p', logDate: '2026-11-12', sessionIndex: 1, painScore: 3, effortScore: null, painItemIds: [], hardItemIds: [], createdAt: '', ...over });
const program = { startDate: '2026-11-08', durationDays: 14 as number | null };
const items = [item('a'), item('b')];
const allDone = (dates: string[]) => dates.flatMap((d) => [log('a', d), log('b', d)]);

describe('dayStrip', () => {
  it('has 14 cells ending today: all done, partly done, missed, today, and days outside the program', () => {
    const logs = [...allDone(['2026-11-09', '2026-11-10']), log('a', '2026-11-11'), log('a', TODAY)];
    const strip = dayStrip(program, items, logs, TODAY);
    expect(strip).toHaveLength(14);
    expect(strip[13]).toMatchObject({ date: TODAY, state: 'today', completed: 1, expected: 2 });
    const by = Object.fromEntries(strip.map((c) => [c.date, c.state]));
    expect(by['2026-11-08']).toBe('missed');
    expect(by['2026-11-09']).toBe('all');
    expect(by['2026-11-11']).toBe('partial');
    expect(by['2026-11-12']).toBe('missed');
    expect(by['2026-11-07']).toBe('outside'); // before it started
    expect(strip[0].date).toBe('2026-11-01');
  });
  it('days after the program\'s last day are outside it', () => {
    const strip = dayStrip({ startDate: '2026-11-01', durationDays: 7 }, items.map((i) => ({ ...i, addedOn: '2026-11-01' })), [], TODAY);
    expect(strip.find((c) => c.date === '2026-11-08')?.state).toBe('outside');
    expect(strip.find((c) => c.date === '2026-11-07')?.state).toBe('missed');
  });
  it('optional exercises never make a day partial or missed', () => {
    const only = [item('a'), item('o', { optional: true })];
    const strip = dayStrip(program, only, [log('a', '2026-11-12')], TODAY);
    expect(strip.find((c) => c.date === '2026-11-12')).toMatchObject({ state: 'all', expected: 1 });
  });
});

describe('currentStreak', () => {
  it('counts the days in a row, ending yesterday, with every required session done; today does not count yet', () => {
    expect(currentStreak(program, items, allDone(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', TODAY]), TODAY)).toBe(4);
  });
  it('a partly done day breaks it', () => {
    expect(currentStreak(program, items, [...allDone(['2026-11-10', '2026-11-12', '2026-11-13']), log('a', '2026-11-11')], TODAY)).toBe(2);
    expect(currentStreak(program, items, allDone([]), TODAY)).toBe(0);
  });
  it('does not run past the program\'s last day', () => {
    const p = { startDate: '2026-11-01', durationDays: 7 };
    const rows = items.map((i) => ({ ...i, addedOn: '2026-11-01' }));
    expect(currentStreak(p, rows, allDone(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-12', '2026-11-13']), TODAY)).toBe(7);
  });
});

describe('dayTimeline', () => {
  const twice = [item('a', { title: 'Squat', sessionsPerDay: 2 }), item('b', { title: 'Marching', sessionsPerDay: 1 })];
  it('lists each session with its exercises: done with the time, skipped with the reason, not done once the day has finished', () => {
    const logs = [log('a', '2026-11-12', 1), log('b', '2026-11-12', 1, { skipped: true, skipReason: 'pain' as SkipReason })];
    const t = dayTimeline(twice, logs, [], '2026-11-12', TODAY);
    expect(t.map((s) => s.label)).toEqual(['Morning', 'Evening']);
    expect(t[0].entries.map((e) => [e.title, e.status, e.reason])).toEqual([['Squat', 'done', null], ['Marching', 'skipped', 'pain']]);
    expect(t[0].entries[0].at).toBe('2026-11-12T08:00:00Z');
    expect(t[1].entries.map((e) => [e.title, e.status])).toEqual([['Squat', 'not_done']]); // Marching is once a day: not in the evening
  });
  it('today\'s unfinished sessions are "to do", never "not done"', () => {
    expect(dayTimeline(twice, [], [], TODAY, TODAY)[1].entries[0].status).toBe('to_do');
  });
  it('carries each session\'s Pain and Effort check and the exercises that were marked', () => {
    const feedback = [fb({ logDate: '2026-11-12', sessionIndex: 1, painScore: 8, effortScore: 6, painItemIds: ['a'], hardItemIds: ['a', 'b'] }), fb({ id: 'g', logDate: '2026-11-12', sessionIndex: 2, painScore: 2, effortScore: null })];
    const t = dayTimeline(twice, [], feedback, '2026-11-12', TODAY);
    expect(t[0]).toMatchObject({ pain: 8, effort: 6, hurt: ['Squat'], hardest: ['Squat', 'Marching'] });
    expect(t[1]).toMatchObject({ pain: 2, effort: null, hurt: [], hardest: [] });
  });
  it('a day before an exercise was added does not list it, and a single session is just "Today\'s session"', () => {
    const t = dayTimeline([item('a', { addedOn: '2026-11-12' })], [], [], '2026-11-10', TODAY);
    expect(t).toEqual([]);
    expect(sessionLabel(1, 1)).toBe("Today's session");
    expect(sessionLabel(2, 3)).toBe('Afternoon');
  });
});

describe('trendSeries', () => {
  it('gives the highest pain and effort per day for the last 7 days, and null where nothing was reported', () => {
    const feedback = [fb({ logDate: '2026-11-13', painScore: 2, effortScore: 5 }), fb({ id: 'g', logDate: '2026-11-13', sessionIndex: 2, painScore: 7, effortScore: null }), fb({ id: 'h', logDate: '2026-11-10', painScore: 4 })];
    const t = trendSeries(feedback, TODAY);
    expect(t).toHaveLength(7);
    expect(t.at(-1)).toEqual({ date: TODAY, pain: null, effort: null });
    expect(t.find((d) => d.date === '2026-11-13')).toEqual({ date: '2026-11-13', pain: 7, effort: 5 });
    expect(t.find((d) => d.date === '2026-11-10')).toEqual({ date: '2026-11-10', pain: 4, effort: null });
  });
});
