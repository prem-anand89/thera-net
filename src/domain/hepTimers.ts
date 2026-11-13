// The patient page's helper timers as pure phase lists (amendments 41 and 56). The screen only walks the list.
// Fixed lengths, not editable by the therapist or the patient.

/** Seconds to get into position at the start (and after "Now the other side"). */
export const PT_READY = 5;
/** Seconds to let go after each hold or timed effort. */
export const PT_RELAX = 3;
/** Seconds to get back into position between holds. */
export const PT_BACK = 4;

export type TimerPhaseKind = 'ready' | 'hold' | 'work' | 'relax' | 'back' | 'switch' | 'rest';

export interface TimerPhase {
  kind: TimerPhaseKind;
  label: string;
  seconds: number;
  /** 1-based rep number, for hold exercises. */
  rep?: number;
  /** 1 or 2 when the exercise is done on each side. */
  side?: 1 | 2;
}

/** What the phone says when a phase starts (Sound: Voice). */
export const TIMER_PHASE_CUES: Record<TimerPhaseKind, string> = {
  ready: 'Get into position',
  hold: 'Hold',
  work: 'Go',
  relax: 'Relax',
  back: 'Back to position',
  switch: 'Now the other side',
  rest: 'Rest',
};

const LABELS: Record<TimerPhaseKind, string> = {
  ready: 'Get into position',
  hold: 'Hold',
  work: 'Go',
  relax: 'Relax',
  back: 'Back to position',
  switch: 'Now the other side',
  rest: 'Rest',
};

const phase = (kind: TimerPhaseKind, seconds: number, extra: Partial<TimerPhase> = {}): TimerPhase => ({ kind, label: LABELS[kind], seconds, ...extra });
const whole = (n: number) => Math.max(1, Math.floor(n));

function holdSide(reps: number, holdSeconds: number, first: boolean, side?: 1 | 2): TimerPhase[] {
  const out: TimerPhase[] = [first ? phase('ready', PT_READY, { side }) : phase('switch', PT_READY, { side })];
  for (let rep = 1; rep <= reps; rep++) {
    out.push(phase('hold', holdSeconds, { rep, side }));
    out.push(phase('relax', PT_RELAX, { rep, side }));
    if (rep < reps) out.push(phase('back', PT_BACK, { rep: rep + 1, side }));
  }
  return out;
}

/** Reps each held: get into position, then Hold, Relax and Back to position for each rep (no Back after the last). */
export function buildHoldPhases(reps: number, holdSeconds: number, eachSide: boolean): TimerPhase[] {
  const r = whole(reps);
  const h = whole(holdSeconds);
  return eachSide ? [...holdSide(r, h, true, 1), ...holdSide(r, h, false, 2)] : holdSide(r, h, true);
}

function timedSide(seconds: number, first: boolean, side?: 1 | 2): TimerPhase[] {
  return [first ? phase('ready', PT_READY, { side }) : phase('switch', PT_READY, { side }), phase('work', seconds, { side }), phase('relax', PT_RELAX, { side })];
}

/** Continuous for a time: get into position, Go for the time, Relax. */
export function buildTimedPhases(seconds: number, eachSide: boolean): TimerPhase[] {
  const s = whole(seconds);
  return eachSide ? [...timedSide(s, true, 1), ...timedSide(s, false, 2)] : timedSide(s, true);
}

/** Rest between sets: a single phase, started by the patient and skippable. */
export function buildRestPhases(seconds: number): TimerPhase[] {
  return [phase('rest', whole(seconds))];
}

export const totalPhaseSeconds = (phases: TimerPhase[]): number => phases.reduce((sum, p) => sum + p.seconds, 0);
