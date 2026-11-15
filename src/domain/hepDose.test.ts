import { describe, expect, it } from 'vitest';
import { applyProgressLabel, describeDose, doseSummary, doseToExerciseFields, exerciseToDose, isDoseValid, progressDose, progressLabels, withKind, type DoseValue } from './hepDose';

const reps = (over: Partial<DoseValue> = {}): DoseValue => ({
  kind: 'reps', sets: 3, reps: 12, holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: null, ...over,
});

describe('describeDose', () => {
  it('reads like the patient will: sets, reps, hold, side, times a day, rest', () => {
    const v = reps({ kind: 'hold', holdSeconds: 10, side: 'both', sessionsPerDay: 2 });
    expect(describeDose(v)).toBe('3 sets × 12 reps · hold each for 10 s · each side · twice a day · rest 30 s');
  });
  it('uses the program\'s times a day when the exercise has none of its own', () => {
    expect(describeDose(reps(), 3)).toBe('3 sets × 12 reps · 3 times a day · rest 30 s');
    expect(describeDose(reps({ sessionsPerDay: 1 }), 3)).toBe('3 sets × 12 reps · rest 30 s');
  });
  it('reads a timed exercise and a single rep or set in the singular, and leaves out a zero rest', () => {
    expect(describeDose(reps({ kind: 'timed', reps: null, durationSeconds: 60, sets: 1, restSeconds: 0 }))).toBe('1 set × 60 s');
    expect(describeDose(reps({ sets: 1, reps: 1, side: 'left' }))).toBe('1 set × 1 rep · left side only · rest 30 s');
  });
});

describe('withKind', () => {
  it('Reps -> Reps with a hold adds a 10 s hold and keeps the reps', () => {
    expect(withKind(reps(), 'hold')).toMatchObject({ kind: 'hold', reps: 12, holdSeconds: 10, durationSeconds: null });
  });
  it('-> Timed clears reps and hold and starts at 30 s; back to Reps restores 10 reps', () => {
    const t = withKind(reps({ kind: 'hold', holdSeconds: 5 }), 'timed');
    expect(t).toMatchObject({ kind: 'timed', reps: null, holdSeconds: null, durationSeconds: 30 });
    expect(withKind(t, 'reps')).toMatchObject({ kind: 'reps', reps: 10, durationSeconds: null });
  });
  it('every switch gives a value the database accepts', () => {
    for (const from of ['reps', 'hold', 'timed'] as const) for (const to of ['reps', 'hold', 'timed'] as const) {
      expect(isDoseValid(withKind(withKind(reps(), from), to))).toBe(true);
    }
  });
});

describe('Progress', () => {
  it('adds 1 set, 2 reps, 5 s hold or 15 s by kind', () => {
    expect(progressLabels('reps')).toEqual(['+1 set', '+2 reps']);
    expect(progressLabels('hold')).toEqual(['+1 set', '+2 reps', '+5 s hold']);
    expect(progressLabels('timed')).toEqual(['+1 set', '+15 s']);
    expect(applyProgressLabel(reps(), '+1 set').sets).toBe(4);
    expect(applyProgressLabel(reps(), '+2 reps').reps).toBe(14);
    expect(applyProgressLabel(reps({ kind: 'hold', holdSeconds: 10 }), '+5 s hold').holdSeconds).toBe(15);
    expect(applyProgressLabel(reps({ kind: 'timed', reps: null, durationSeconds: 30 }), '+15 s').durationSeconds).toBe(45);
  });
  it('never goes past the database limits', () => {
    expect(progressDose(reps({ sets: 20, reps: 600 }))).toMatchObject({ sets: 20, reps: 600 });
  });
});

describe('isDoseValid', () => {
  it('refuses numbers outside the limits and a shape that does not match the kind', () => {
    expect(isDoseValid(reps())).toBe(true);
    expect(isDoseValid(reps({ sets: 0 }))).toBe(false);
    expect(isDoseValid(reps({ sets: 21 }))).toBe(false);
    expect(isDoseValid(reps({ reps: null }))).toBe(false);
    expect(isDoseValid(reps({ restSeconds: 301 }))).toBe(false);
    expect(isDoseValid(reps({ kind: 'timed', reps: 10, durationSeconds: 30 }))).toBe(false);
  });
});

describe('exercise <-> dose', () => {
  const quad = { doseType: 'hold' as const, defaultSets: 3, defaultReps: 12, defaultHoldSeconds: 10, defaultDurationSeconds: null, defaultRestSeconds: 30, side: 'none' as const, defaultSessionsPerDay: 2 as const };
  it('round-trips an exercise\'s default dose', () => {
    expect(doseToExerciseFields(exerciseToDose(quad))).toEqual(quad);
  });
  it('drops the fields the kind does not use', () => {
    expect(doseToExerciseFields({ ...reps({ kind: 'timed', durationSeconds: 45 }), reps: 12, holdSeconds: 5 })).toMatchObject({ defaultReps: null, defaultHoldSeconds: null, defaultDurationSeconds: 45 });
  });
  it('shows the list line without the rest', () => {
    expect(doseSummary(quad)).toBe('3 sets × 12 reps · hold each for 10 s · twice a day');
  });
});
