import { describe, expect, it } from 'vitest';
import { HEP_BODY_ORDER, type StarterLibraryItem } from './hep';
import { coverageGrid, coverageRegion } from './hepCoverage';

const item = (over: Partial<StarterLibraryItem>): StarterLibraryItem => ({
  id: 'x', sourceClinicId: null, sourceExerciseId: null, title: 'T', otherNames: [], bodyRegion: 'Knee', alsoRegions: [],
  phase: 'strengthening', alsoPhases: [], positions: [], equipment: [], instructions: '', stopIf: '', mediaType: 'none', mediaKeys: [],
  mediaCaptions: [], thumbKey: null, doseType: 'reps', defaultSets: 3, defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null,
  defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', publishedAt: null, ...over,
});

describe('coverageGrid', () => {
  it('lists every fixed region even when empty, so a gap is visible', () => {
    const grid = coverageGrid([]);
    expect(grid.rows.map((r) => r.region)).toEqual([...HEP_BODY_ORDER]);
    expect(grid.total).toBe(0);
    expect(grid.rows.every((r) => r.total === 0)).toBe(true);
  });

  it('counts an exercise under its main type and each additional type, once in the region total', () => {
    const grid = coverageGrid([item({ phase: 'mobility', alsoPhases: ['stretching'], mediaKeys: ['k'] }), item({ phase: 'mobility' })]);
    const knee = grid.rows.find((r) => r.region === 'Knee')!;
    expect(knee.total).toBe(2);
    expect(knee.withPictures).toBe(1);
    expect(knee.cells.mobility).toEqual({ total: 2, withPictures: 1 });
    expect(knee.cells.stretching).toEqual({ total: 1, withPictures: 1 });
    expect(knee.cells.balance).toEqual({ total: 0, withPictures: 0 });
    expect(grid.columns.mobility.total).toBe(2);
    expect(grid.total).toBe(2);
    expect(grid.withPictures).toBe(1);
  });

  it('ignores warm-up, cool-down and other as columns but still counts the exercise in its region', () => {
    const grid = coverageGrid([item({ phase: 'warm_up' }), item({ phase: 'other' })]);
    const knee = grid.rows.find((r) => r.region === 'Knee')!;
    expect(knee.total).toBe(2);
    expect(Object.values(knee.cells).every((c) => c.total === 0)).toBe(true);
  });

  it('reads Pelvic floor (women) and (men) as one region and adds a custom region at the end', () => {
    expect(coverageRegion('Pelvic floor (women)')).toBe('Pelvic floor');
    const grid = coverageGrid([item({ bodyRegion: 'Pelvic floor (men)' }), item({ bodyRegion: 'Pelvic floor (women)' }), item({ bodyRegion: 'Jaw' })]);
    expect(grid.rows.find((r) => r.region === 'Pelvic floor')!.total).toBe(2);
    expect(grid.rows[grid.rows.length - 1].region).toBe('Jaw');
  });
});
