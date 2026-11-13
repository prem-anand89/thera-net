import { describe, expect, it } from 'vitest';
import { buildHoldPhases, buildRestPhases, buildTimedPhases, PT_BACK, PT_READY, PT_RELAX, totalPhaseSeconds, TIMER_PHASE_CUES } from './hepTimers';

describe('patient timers as phase lists', () => {
  it('uses the fixed lengths', () => {
    expect([PT_READY, PT_RELAX, PT_BACK]).toEqual([5, 3, 4]);
  });

  it('10 holds of 5 s: get into position, then Hold, Relax and Back for each rep (no Back after the last): 30 phases', () => {
    const p = buildHoldPhases(10, 5, false);
    expect(p).toHaveLength(30);
    expect(p[0]).toMatchObject({ kind: 'ready', seconds: 5 });
    expect(p[1]).toMatchObject({ kind: 'hold', seconds: 5, rep: 1 });
    expect(p[2]).toMatchObject({ kind: 'relax', seconds: 3, rep: 1 });
    expect(p[3]).toMatchObject({ kind: 'back', seconds: 4, rep: 2 });
    expect(p.at(-1)).toMatchObject({ kind: 'relax', rep: 10 });
    expect(p.filter((x) => x.kind === 'back')).toHaveLength(9);
    expect(p.filter((x) => x.kind === 'ready')).toHaveLength(1);
  });

  it('each side: one "Now the other side" instead of a second get-ready, rep numbers restart, 60 phases', () => {
    const p = buildHoldPhases(10, 5, true);
    expect(p).toHaveLength(60);
    expect(p.filter((x) => x.kind === 'switch')).toHaveLength(1);
    expect(p.filter((x) => x.kind === 'ready')).toHaveLength(1);
    const i = p.findIndex((x) => x.kind === 'switch');
    expect(p[i - 1]).toMatchObject({ kind: 'relax', side: 1, rep: 10 });
    expect(p[i + 1]).toMatchObject({ kind: 'hold', side: 2, rep: 1 });
    expect(p.at(-1)).toMatchObject({ kind: 'relax', side: 2, rep: 10 });
  });

  it('timed: get into position, Go, Relax; each side doubles it with a switch', () => {
    expect(buildTimedPhases(30, false).map((x) => [x.kind, x.seconds])).toEqual([['ready', 5], ['work', 30], ['relax', 3]]);
    const both = buildTimedPhases(30, true);
    expect(both.map((x) => x.kind)).toEqual(['ready', 'work', 'relax', 'switch', 'work', 'relax']);
    expect(both.map((x) => x.side)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('rest is one phase', () => {
    expect(buildRestPhases(30)).toEqual([{ kind: 'rest', label: 'Rest', seconds: 30 }]);
  });

  it('never builds an empty or zero-length phase', () => {
    expect(buildHoldPhases(0, 0, false).every((x) => x.seconds >= 1)).toBe(true);
    expect(buildTimedPhases(-5, false).every((x) => x.seconds >= 1)).toBe(true);
    expect(buildRestPhases(0)[0].seconds).toBe(1);
  });

  it('adds up the total and has a spoken cue for every kind', () => {
    expect(totalPhaseSeconds(buildTimedPhases(30, false))).toBe(38);
    expect(Object.keys(TIMER_PHASE_CUES).sort()).toEqual(['back', 'hold', 'ready', 'relax', 'rest', 'switch', 'work']);
  });
});
