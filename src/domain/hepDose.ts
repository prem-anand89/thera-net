// The dose of one exercise as the editors hold it, and the plain-English line the patient reads.
// Shared by the Edit exercise form, the template editor and the program sheet (amendment 67).
import type { DoseType, Exercise, ExerciseSide, SessionsPerDay } from '@/domain/hep';

export interface DoseValue {
  kind: DoseType;
  sets: number;
  /** reps and hold kinds. */
  reps: number | null;
  /** hold kind: seconds for each rep. */
  holdSeconds: number | null;
  /** timed kind: total seconds for one set. */
  durationSeconds: number | null;
  restSeconds: number;
  side: ExerciseSide;
  /** null = the same as the program's times a day. */
  sessionsPerDay: SessionsPerDay | null;
  /** The patient may skip it without it counting against them. Absent where the editor has no such switch. */
  optional?: boolean;
}

export const DOSE_CHIPS = {
  sets: [1, 2, 3],
  reps: [5, 8, 10, 12, 15],
  hold: [5, 10, 30],
  time: [15, 30, 45, 60],
  rest: [0, 15, 30, 60],
} as const;

export const DOSE_LIMITS = { sets: [1, 20], reps: [1, 600], hold: [1, 600], time: [1, 3600], rest: [0, 300] } as const;

export const DOSE_KIND_LABELS: Record<DoseType, string> = { reps: 'Repetitions', hold: 'Repetitions with hold', timed: 'Timed' };

export const SIDE_LABELS: Record<ExerciseSide, string> = {
  none: 'Not applicable',
  left: 'Left side only',
  right: 'Right side only',
  both: 'Each side',
};

/** Switching the kind keeps what still applies and fills what is newly needed, so the numbers stay valid. */
export function withKind(v: DoseValue, kind: DoseType): DoseValue {
  if (kind === v.kind) return v;
  if (kind === 'timed') return { ...v, kind, reps: null, holdSeconds: null, durationSeconds: v.durationSeconds ?? 30 };
  if (kind === 'hold') return { ...v, kind, reps: v.reps ?? 10, holdSeconds: v.holdSeconds ?? 10, durationSeconds: null };
  return { ...v, kind, reps: v.reps ?? 10, holdSeconds: null, durationSeconds: null };
}

const clamp = (n: number, [lo, hi]: readonly [number, number] | readonly number[]) => Math.min(hi, Math.max(lo, n));

/** The "Progress" step (amendment 69): one more set, two more reps, 5 s more hold, or 15 s more, by kind. */
export function progressDose(v: DoseValue): DoseValue {
  const sets = clamp(v.sets + 1, DOSE_LIMITS.sets);
  if (v.kind === 'timed') return { ...v, sets, durationSeconds: clamp((v.durationSeconds ?? 30) + 15, DOSE_LIMITS.time) };
  const reps = clamp((v.reps ?? 10) + 2, DOSE_LIMITS.reps);
  if (v.kind === 'hold') return { ...v, reps, holdSeconds: clamp((v.holdSeconds ?? 10) + 5, DOSE_LIMITS.hold) };
  return { ...v, reps };
}

/** What each Progress chip does, so the button can say it ("+1 set", "+2 reps"). */
export function progressLabels(kind: DoseType): string[] {
  if (kind === 'timed') return ['+1 set', '+15 s'];
  if (kind === 'hold') return ['+1 set', '+2 reps', '+5 s hold'];
  return ['+1 set', '+2 reps'];
}

/** Applies one chip of `progressLabels`. */
export function applyProgressLabel(v: DoseValue, label: string): DoseValue {
  switch (label) {
    case '+1 set': return { ...v, sets: clamp(v.sets + 1, DOSE_LIMITS.sets) };
    case '+2 reps': return { ...v, reps: clamp((v.reps ?? 10) + 2, DOSE_LIMITS.reps) };
    case '+5 s hold': return { ...v, holdSeconds: clamp((v.holdSeconds ?? 10) + 5, DOSE_LIMITS.hold) };
    case '+15 s': return { ...v, durationSeconds: clamp((v.durationSeconds ?? 30) + 15, DOSE_LIMITS.time) };
    default: return v;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 sets × 12 reps · hold each for 10 s · each side · twice a day · rest 30 s" */
export function describeDose(v: DoseValue, programSessionsPerDay: SessionsPerDay = 1): string {
  const parts: string[] = [];
  if (v.kind === 'timed') {
    parts.push(`${plural(v.sets, 'set', 'sets')} × ${v.durationSeconds ?? 0} s`);
  } else {
    parts.push(`${plural(v.sets, 'set', 'sets')} × ${plural(v.reps ?? 0, 'rep', 'reps')}`);
    if (v.kind === 'hold') parts.push(`hold each for ${v.holdSeconds ?? 0} s`);
  }
  if (v.side === 'both') parts.push('each side');
  if (v.side === 'left') parts.push('left side only');
  if (v.side === 'right') parts.push('right side only');
  const perDay = v.sessionsPerDay ?? programSessionsPerDay;
  if (perDay === 2) parts.push('twice a day');
  if (perDay === 3) parts.push('3 times a day');
  if (v.restSeconds > 0) parts.push(`rest ${v.restSeconds} s`);
  return parts.join(' · ');
}

/** True when every number is inside what the database accepts (the form disables Save otherwise). */
export function isDoseValid(v: DoseValue): boolean {
  const within = (n: number | null, [lo, hi]: readonly [number, number]) => n != null && Number.isInteger(n) && n >= lo && n <= hi;
  if (!within(v.sets, DOSE_LIMITS.sets) || !within(v.restSeconds, DOSE_LIMITS.rest)) return false;
  if (v.kind === 'timed') return within(v.durationSeconds, DOSE_LIMITS.time) && v.reps == null && v.holdSeconds == null;
  if (v.kind === 'hold') return within(v.reps, DOSE_LIMITS.reps) && within(v.holdSeconds, DOSE_LIMITS.hold) && v.durationSeconds == null;
  return within(v.reps, DOSE_LIMITS.reps) && v.holdSeconds == null && v.durationSeconds == null;
}

type ExerciseDoseFields = Pick<Exercise, 'doseType' | 'defaultSets' | 'defaultReps' | 'defaultHoldSeconds' | 'defaultDurationSeconds' | 'defaultRestSeconds' | 'side' | 'defaultSessionsPerDay'>;

/** An exercise's default dose, as the editors hold it. */
export function exerciseToDose(ex: ExerciseDoseFields): DoseValue {
  return {
    kind: ex.doseType,
    sets: ex.defaultSets,
    reps: ex.doseType === 'timed' ? null : ex.defaultReps,
    holdSeconds: ex.doseType === 'hold' ? ex.defaultHoldSeconds : null,
    durationSeconds: ex.doseType === 'timed' ? ex.defaultDurationSeconds : null,
    restSeconds: ex.defaultRestSeconds,
    side: ex.side,
    sessionsPerDay: ex.defaultSessionsPerDay,
  };
}

/** The dose back into the exercise's default_* fields (what save_exercise takes). */
export function doseToExerciseFields(v: DoseValue): Pick<ExerciseDoseFields, 'doseType' | 'defaultSets' | 'defaultReps' | 'defaultHoldSeconds' | 'defaultDurationSeconds' | 'defaultRestSeconds' | 'side'> & { defaultSessionsPerDay: SessionsPerDay } {
  return {
    doseType: v.kind,
    defaultSets: v.sets,
    defaultReps: v.kind === 'timed' ? null : v.reps,
    defaultHoldSeconds: v.kind === 'hold' ? v.holdSeconds : null,
    defaultDurationSeconds: v.kind === 'timed' ? v.durationSeconds : null,
    defaultRestSeconds: v.restSeconds,
    side: v.side,
    defaultSessionsPerDay: v.sessionsPerDay ?? 1,
  };
}

/** The short line under an exercise in a list: "3 sets × 12 reps · hold each for 10 s · twice a day". Rest is left out. */
export function doseSummary(ex: ExerciseDoseFields): string {
  return describeDose({ ...exerciseToDose(ex), restSeconds: 0 });
}
