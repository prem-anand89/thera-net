import { describe, expect, it } from 'vitest';
import { EXERCISE_PHASES, EXERCISE_TYPES, HEP_EQUIPMENT, HEP_POSITIONS, HEP_REGIONS, isPelvicFloorRegion } from './hep';
import { isDoseValid } from './hepDose';
import { STARTER_EXERCISES } from './hepStarterSet';

describe('starter set', () => {
  it('gives every exercise a position and one of the six types', () => {
    for (const s of STARTER_EXERCISES) {
      expect(s.positions.length, s.title).toBeGreaterThanOrEqual(1);
      for (const p of s.positions) expect(HEP_POSITIONS as readonly string[], `${s.title} ${p}`).toContain(p);
      expect(EXERCISE_TYPES as readonly string[], s.title).toContain(s.phase);
    }
  });
  it('every exercise is a valid dose, region, type and equipment, so saving it can never be refused for its shape', () => {
    for (const s of STARTER_EXERCISES) {
      expect(isDoseValid({ kind: s.dose.kind, sets: s.dose.sets, reps: s.dose.reps ?? null, holdSeconds: s.dose.holdSeconds ?? null, durationSeconds: s.dose.durationSeconds ?? null, restSeconds: s.dose.restSeconds, side: s.dose.side, sessionsPerDay: s.dose.perDay }), s.title).toBe(true);
      expect(HEP_REGIONS as readonly string[], s.title).toContain(s.region);
      for (const a of s.alsoRegions ?? []) expect(HEP_REGIONS as readonly string[], `${s.title} also ${a}`).toContain(a);
      expect(EXERCISE_PHASES as readonly string[], s.title).toContain(s.phase);
      for (const e of s.equipment ?? []) expect(HEP_EQUIPMENT as readonly string[], `${s.title} equipment ${e}`).toContain(e);
    }
  });
  it('has unique names, at least two steps each, and a "stop if" for each', () => {
    const titles = STARTER_EXERCISES.map((s) => s.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    for (const s of STARTER_EXERCISES) {
      expect(s.steps.length, s.title).toBeGreaterThanOrEqual(2);
      expect(s.stopIf.trim().length, s.title).toBeGreaterThan(0);
    }
  });
  it('leaves out pelvic floor exercises, and covers the main regions', () => {
    expect(STARTER_EXERCISES.some((s) => isPelvicFloorRegion(s.region) || (s.alsoRegions ?? []).some(isPelvicFloorRegion))).toBe(false);
    const regions = new Set(STARTER_EXERCISES.map((s) => s.region));
    for (const r of ['Neck', 'Shoulder', 'Spine / Back', 'Hip', 'Knee', 'Ankle / Foot']) expect(regions.has(r), r).toBe(true);
  });
  it('is marked as needing review before it ships', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/domain/hepStarterSet.ts', 'utf8')).toContain('REVIEW BEFORE SHIPPING');
  });
});
