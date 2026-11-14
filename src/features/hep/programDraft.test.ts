import { describe, expect, it } from 'vitest';
import type { ExerciseTemplate, ExerciseTemplateItem, Program, ProgramItem, SessionsPerDay } from '@/domain/hep';
import type { HepItemInput, ProgramBundle } from '@/services/hepService';
import {
  blankDraft, changeSessionsPerDay, changesFor, commonSessionsPerDay, createSettings, draftFromBundle, draftFromTemplate, draftProblem, estimateLabel, isPinOk, isSectionOptional, latestEarlierProgram, sameDraft, setSectionOptional, updateSettings,
} from './programDraft';

const hi = (title: string, over: Partial<HepItemInput> = {}): HepItemInput => ({
  title, bodyRegion: 'Knee', phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], equipment: [], doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null,
  restSeconds: 30, sessionsPerDay: 1, side: 'none', optional: false, stopIf: '', ...over,
});
const pi = (id: string, over: Partial<ProgramItem> = {}): ProgramItem => ({ ...hi(`Item ${id}`), id, programId: 'p', sessionsSchedule: [], specialInstructions: '', sortOrder: 0, addedOn: '2026-11-09', removedOn: null, ...over } as ProgramItem);
const program = (over: Partial<Program> = {}): Program => ({ id: 'p1', clinicId: 'c', patientId: 'pt', therapistId: 't1', title: 'Knee week 1', status: 'active', startDate: '2026-11-01', durationDays: 7, targetPct: 90, checkinOn: '2026-11-08', feedbackDefault: 'effort', sessionsPerDay: 2, firstOpenedAt: null, items: [pi('a'), pi('b', { removedOn: '2026-11-03' })], createdAt: '2026-11-01', updatedAt: '', ...over });
const bundle = (over: Partial<Program> = {}): ProgramBundle => ({ program: program(over), patientName: 'Ravi', therapistName: 'Meera', logs: [], sessionFeedback: [], access: null });

describe('starting points', () => {
  it('a template starts a program named like the template, with copies of its rows and the usual times a day', () => {
    const t = { id: 't', clinicId: 'c', title: 'Knee week 1', note: null, deleted: false, createdAt: '', updatedAt: '', items: [hi('A', { sessionsPerDay: 2 }), hi('B', { sessionsPerDay: 2 }), hi('C')].map((i, n) => ({ ...i, sortOrder: n })) as unknown as ExerciseTemplateItem[] } as ExerciseTemplate;
    const d = draftFromTemplate(t, 't1');
    expect(d).toMatchObject({ title: 'Knee week 1', sessionsPerDay: 2, therapistId: 't1', durationDays: 7, checkinDays: 7, feedbackDefault: 'pain', targetPct: 70 });
    expect(d.items.map((i) => i.title)).toEqual(['A', 'B', 'C']);
  });
  it('editing keeps the row ids and leaves out removed rows; copying drops the ids and resets the check-in', () => {
    const edit = draftFromBundle(bundle(), 'edit');
    expect(edit.items.map((i) => i.id)).toEqual(['a']);
    expect(edit).toMatchObject({ sessionsPerDay: 2, targetPct: 90, feedbackDefault: 'effort', checkinOn: '2026-11-08', checkinDays: null, durationDays: 7 });
    const copy = draftFromBundle(bundle(), 'copy');
    expect(copy.items[0].id).toBeUndefined();
    expect(copy).toMatchObject({ checkinOn: null, checkinDays: 7, targetPct: 90, title: 'Knee week 1' });
  });
  it('"Same as last time" is the most recent completed program, or an active one past its last day', () => {
    const old = bundle({ id: 'old', status: 'completed', startDate: '2026-09-01' });
    const recent = bundle({ id: 'recent', status: 'completed', startDate: '2026-10-10' });
    const ended = bundle({ id: 'ended', status: 'active', startDate: '2026-10-20', durationDays: 7 });
    const running = bundle({ id: 'running', status: 'active', startDate: '2026-11-12', durationDays: 14 });
    expect(latestEarlierProgram([old, recent, running], '2026-11-14')?.program.id).toBe('recent');
    expect(latestEarlierProgram([old, recent, ended, running], '2026-11-14')?.program.id).toBe('ended');
    expect(latestEarlierProgram([running], '2026-11-14')).toBeNull();
  });
});

describe('times a day', () => {
  it('the program value is the commonest row value, so only odd rows are overrides', () => {
    expect(commonSessionsPerDay([hi('a', { sessionsPerDay: 2 }), hi('b', { sessionsPerDay: 2 }), hi('c')])).toBe(2);
    expect(commonSessionsPerDay([])).toBe(1);
  });
  it('changing the program moves the rows that matched the old value and keeps overrides', () => {
    const rows = [hi('a', { sessionsPerDay: 2 }), hi('b', { sessionsPerDay: 1 }), hi('c', { sessionsPerDay: 2 })];
    expect(changeSessionsPerDay(rows, 2, 3).map((r) => r.sessionsPerDay)).toEqual([3, 1, 3]);
  });
});

describe('estimate', () => {
  it('reads "About N min a session" when every session is alike', () => {
    expect(estimateLabel([hi('a'), hi('b')], 1)).toMatch(/^About \d+ min a session$/);
    expect(estimateLabel([hi('a', { sessionsPerDay: 2 })], 2)).toMatch(/^About \d+ min a session$/);
    expect(estimateLabel([], 1)).toBe('');
  });
  it('names the sessions when they differ, and never warns at any length', () => {
    const rows = [hi('a', { sessionsPerDay: 2 }), hi('b', { sessionsPerDay: 1 })];
    expect(estimateLabel(rows, 2)).toMatch(/^\d+ min morning · \d+ min evening$/);
    expect(estimateLabel(rows.map((r) => ({ ...r, sets: 20, reps: 600 })), 2)).not.toMatch(/warn|long|too/i);
    expect(estimateLabel([hi('a'), hi('b', { sessionsPerDay: 2 }), hi('c', { sessionsPerDay: 3 })], 3)).toMatch(/morning · \d+ min afternoon · \d+ min evening/);
  });
});

describe('optional sections', () => {
  it('a whole section can be made optional and shows as optional only when every row is', () => {
    const rows = [hi('a', { phase: 'warm_up' }), hi('b', { phase: 'warm_up' }), hi('c')];
    const next = setSectionOptional(rows, 'warm_up', true);
    expect(next.map((r) => r.optional)).toEqual([true, true, false]);
    expect(isSectionOptional(next, 'warm_up')).toBe(true);
    expect(isSectionOptional([{ ...rows[0], optional: true }, rows[1]], 'warm_up')).toBe(false);
    expect(isSectionOptional(next, 'balance')).toBe(false);
  });
});

describe('settings sent to the database', () => {
  const d = { ...blankDraft('t1'), durationDays: null, targetPct: 90, feedbackDefault: 'effort' as const, sessionsPerDay: 2 as SessionsPerDay, checkinDays: 14, checkinOn: '2026-11-20' };
  it('a new program sends the length (null = ongoing), the minimum, days to check-in, Pain or Effort first and times a day', () => {
    expect(createSettings(d)).toEqual({ durationDays: null, targetPct: 90, checkinDays: 14, feedbackDefault: 'effort', sessionsPerDay: 2 });
  });
  it('an edit sends the check-in date instead', () => {
    expect(updateSettings(d)).toEqual({ durationDays: null, targetPct: 90, checkinOn: '2026-11-20', feedbackDefault: 'effort', sessionsPerDay: 2 });
  });
});

describe('Save', () => {
  const ok = { ...blankDraft(), title: 'Right knee, week 2', items: [hi('a')] };
  it('is allowed with a name, an exercise and valid numbers', () => {
    expect(draftProblem(ok, false, true)).toBeNull();
  });
  it('says what is missing', () => {
    expect(draftProblem(ok, true, false)).toBe('Choose the patient.');
    expect(draftProblem({ ...ok, title: '  ' }, false, true)).toBe('Give the program a name.');
    expect(draftProblem({ ...ok, items: [] }, false, true)).toBe('Add at least one exercise.');
    expect(draftProblem({ ...ok, items: [hi('a', { sets: 0 })] }, false, true)).toBe('Check the numbers on the exercises.');
    expect(draftProblem({ ...ok, customPin: '12' }, false, true)).toBe('The PIN must be exactly 4 digits.');
  });
  it('accepts no PIN or exactly 4 digits', () => {
    expect([isPinOk(''), isPinOk('0042'), isPinOk('42'), isPinOk('12345'), isPinOk('12a4')]).toEqual([true, true, false, false, false]);
  });
  it('knows when nothing was changed', () => {
    expect(sameDraft(ok, { ...ok })).toBe(true);
    expect(sameDraft(ok, { ...ok, title: 'x' })).toBe(false);
  });
});

describe('changes', () => {
  it('lists only the rows that changed, with the new numbers', () => {
    const before = [{ ...hi('Wall Slides'), id: 'a' }, { ...hi('Squat'), id: 'b' }, { ...hi('Lunge'), id: 'c' }];
    const after = [{ ...hi('Wall Slides', { sets: 2 }), id: 'a' }, { ...hi('Squat'), id: 'b' }, hi('Bird dog')];
    expect(changesFor(before, after)).toEqual([
      { title: 'Wall Slides', change: 'changed', detail: 'sets 3 to 2' },
      { title: 'Bird dog', change: 'added' },
      { title: 'Lunge', change: 'removed' },
    ]);
  });
});
