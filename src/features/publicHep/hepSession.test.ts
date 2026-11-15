import { describe, expect, it } from 'vitest';
import { TODAY, item, log } from './hepTestData';
import {
  currentSession, dayNumber, doseInWords, effortWords, itemsInSession, nextToDo, painWords, sectionLabelCount, sectionsOf, sessionComplete, sessionLabel, sessionsToday,
  shortDose, statusOf, stepsOf, timesADay, todayCounts, weekStrip,
} from './hepSession';

const a = item({ id: 'a', title: 'A', sortOrder: 0 });
const b = item({ id: 'b', title: 'B', sortOrder: 1, sessionsPerDay: 2 });
const c = item({ id: 'c', title: 'C', sortOrder: 2, phase: 'warm_up', optional: true });

describe('sessions on the patient page', () => {
  it('labels sessions by how many there are in a day', () => {
    expect([1, 2, 3].map((n) => sessionLabel(1, n)).slice(0, 1)).toEqual(['']);
    expect([sessionLabel(2, 1), sessionLabel(2, 2)]).toEqual(['Morning', 'Evening']);
    expect([sessionLabel(3, 1), sessionLabel(3, 2), sessionLabel(3, 3)]).toEqual(['Morning', 'Afternoon', 'Evening']);
  });

  it('"Today: 3 of 8 done" counts exercise sessions, not exercises, and leaves optional ones out', () => {
    const four = ['a', 'b', 'c', 'd'].map((id) => item({ id, sessionsPerDay: 2 }));
    const logs = [log('a', 1), log('b', 1), log('c', 2)];
    expect(todayCounts(four, logs, TODAY)).toEqual({ done: 3, total: 8 });
    expect(todayCounts([a, b, c], [], TODAY)).toEqual({ done: 0, total: 3 }); // a once, b twice, c optional
  });

  it('a skipped session is not counted as done but does have a status', () => {
    const logs = [log('a', 1, { skipped: true, skipReason: 'pain' })];
    expect(statusOf(a, logs, TODAY, 1)).toBe('skipped');
    expect(todayCounts([a], logs, TODAY)).toEqual({ done: 0, total: 1 });
  });

  it('an exercise has no second session when it is once a day', () => {
    expect(statusOf(a, [], TODAY, 2)).toBe('none');
    expect(statusOf(b, [], TODAY, 2)).toBe('open');
    expect(sessionsToday([a, b], TODAY)).toBe(2);
    expect(itemsInSession([a, b], [], TODAY, 2).map((i) => i.id)).toEqual(['b']);
  });

  it('an exercise added after today is not due yet', () => {
    expect(statusOf(item({ id: 'f', addedOn: '2026-11-20' }), [], TODAY, 1)).toBe('none');
  });

  it('a session is complete when every required exercise has a status, whatever it is', () => {
    expect(sessionComplete([a, c], [], TODAY, 1)).toBe(false);
    expect(sessionComplete([a, c], [log('a', 1, { skipped: true, skipReason: 'no_time' })], TODAY, 1)).toBe(true);
    expect(sessionComplete([c], [], TODAY, 1)).toBe(false); // only optional work: nothing to complete
  });

  it('"Continue" picks the next required exercise without a status, after the one just done', () => {
    const three = [a, item({ id: 'x', title: 'X', sortOrder: 1 }), item({ id: 'y', title: 'Y', sortOrder: 2 })];
    expect(nextToDo(three, [], TODAY, 1)?.id).toBe('a');
    expect(nextToDo(three, [log('a')], TODAY, 1)?.id).toBe('x');
    expect(nextToDo(three, [log('x')], TODAY, 1, 'x')?.id).toBe('y');
    expect(nextToDo(three, [log('a'), log('x'), log('y')], TODAY, 1)).toBeNull();
  });

  it('opens on the first session that still has something to do', () => {
    expect(currentSession([b], [], TODAY, 2)).toBe(1);
    expect(currentSession([b], [log('b', 1)], TODAY, 2)).toBe(2);
    expect(currentSession([b], [log('b', 1), log('b', 2)], TODAY, 2)).toBe(2);
  });

  it('groups exercises into sections by type, in the program\'s order', () => {
    const sections = sectionsOf([a, c, b]);
    expect(sections.map((s) => [s.title, s.items.map((i) => i.id)])).toEqual([['Strengthening', ['a', 'b']], ['Warm-up', ['c']]]);
    expect(sectionLabelCount(0, 0)).toBe('optional');
    expect(sectionLabelCount(4, 2)).toBe('2 of 4');
  });

  it('writes the dose short and in words, with "1 set" and "1 rep"', () => {
    expect(shortDose(item({ sets: 3, reps: 12, doseType: 'hold', holdSeconds: 5 }))).toBe('3×12·5s');
    expect(shortDose(item({ sets: 2, doseType: 'timed', durationSeconds: 20, side: 'both' }))).toBe('2×20s · each side');
    expect(doseInWords(item({ sets: 3, reps: 12, doseType: 'hold', holdSeconds: 3 }))).toBe('3 sets · 12 reps · hold 3 s');
    expect(doseInWords(item({ sets: 1, reps: 1 }))).toBe('1 set · 1 rep');
  });

  it('splits instructions into steps and drops numbering', () => {
    expect(stepsOf('1. Lie down\n2) Lift your leg\n\n- Lower it')).toEqual(['Lie down', 'Lift your leg', 'Lower it']);
  });

  it('numbers the days from the first day, never below 1', () => {
    expect(dayNumber('2026-11-10', '2026-11-14')).toBe(5);
    expect(dayNumber('2026-11-20', '2026-11-14')).toBe(1);
  });

  it('has words for the pain and effort scales', () => {
    expect([0, 2, 5, 8].map(painWords)).toEqual(['No pain', 'Mild', 'Moderate', 'Severe']);
    expect([0, 1, 3, 5, 7, 9, 10].map(effortWords)).toEqual(['Rest', 'Very easy', 'Easy', 'Somewhat hard', 'Hard', 'Very hard', 'Maximum']);
  });
});

describe('the Home tab\'s week', () => {
  it('shows Mon to Sun of this week: before the start and after today are not due, today stays open', () => {
    const logs = [log('a', 1, { logDate: '2026-11-11' }), log('b', 1, { logDate: '2026-11-12' }), log('a', 1, { logDate: '2026-11-12' })];
    const week = weekStrip([a, b], logs, TODAY, { startDate: '2026-11-10', durationDays: 14 });
    expect(week.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(week.map((d) => d.state)).toEqual(['not_due', 'missed', 'partly', 'partly', 'missed', 'open', 'not_due']);
    expect(week.map((d) => d.isToday)).toEqual([false, false, false, false, false, true, false]);
    expect(week.map((d) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('a fully done day is done, and days after the program ends are not due', () => {
    const logs = [log('a', 1, { logDate: '2026-11-10' }), log('a', 1)];
    const week = weekStrip([a], logs, TODAY, { startDate: '2026-11-09', durationDays: 3 });
    expect(week.map((d) => d.state)).toEqual(['missed', 'done', 'missed', 'not_due', 'not_due', 'not_due', 'not_due']);
  });

  it('says how often in words', () => {
    expect([1, 2, 3].map(timesADay)).toEqual(['once a day', 'twice a day', '3 times a day']);
  });
});
