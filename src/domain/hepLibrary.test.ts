import { describe, expect, it } from 'vitest';
import type { Exercise } from './hep';
import { EMPTY_LIBRARY_FILTER, activeFilterChips, equipmentInUse, exerciseInPhase, exerciseInRegion, facetCounts, filterLibrary, regionLabel, similarExercise, sortLibrary, type LibraryExercise } from './hepLibrary';

const ex = (id: string, title: string, over: Partial<Exercise> = {}): LibraryExercise =>
  ({ id, title, otherNames: [], bodyRegion: 'Knee', alsoRegions: [], phase: 'strengthening', equipment: [], isFavorite: false, active: true, deleted: false, positions: [], createdAt: '2026-01-01T00:00:00Z', ...over });

const LIB = [
  ex('1', 'Quad Sets', { phase: 'activation', equipment: ['Towel'], isFavorite: true }),
  ex('2', 'Hamstring Stretch', { phase: 'stretching', alsoRegions: ['Hip'], equipment: ['Towel'] }),
  ex('3', 'Banded Side Steps', { bodyRegion: 'Hip', alsoRegions: ['Knee'], equipment: ['Theraband / resistance band'] }),
  ex('4', 'Glute Bridge', { bodyRegion: 'Hip', alsoRegions: ['Core', 'Pelvic floor: Women'], equipment: ['Mat'] }),
  ex('5', 'Pelvic Floor Squeeze', { bodyRegion: 'Pelvic floor: Men', phase: 'activation' }),
  ex('6', 'Cheek Puffs', { bodyRegion: 'Face', phase: 'activation' }),
  ex('7', 'Old exercise', { active: false }),
  ex('8', 'Deleted one', { deleted: true }),
];
const ids = (list: LibraryExercise[]) => list.map((e) => e.id);

describe('filterLibrary', () => {
  it('leaves out archived and deleted exercises unless archived are asked for', () => {
    expect(ids(filterLibrary(LIB, EMPTY_LIBRARY_FILTER))).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(ids(filterLibrary(LIB, EMPTY_LIBRARY_FILTER, { includeArchived: true }))).toContain('7');
    expect(ids(filterLibrary(LIB, EMPTY_LIBRARY_FILTER, { includeArchived: true }))).not.toContain('8');
  });
  it('counts an exercise under its also-regions, and Pelvic floor means Women or Men', () => {
    expect(ids(filterLibrary(LIB, { ...EMPTY_LIBRARY_FILTER, region: 'Hip' }))).toEqual(['2', '3', '4']);
    expect(ids(filterLibrary(LIB, { ...EMPTY_LIBRARY_FILTER, region: 'Pelvic floor' }))).toEqual(['4', '5']);
    expect(ids(filterLibrary(LIB, { ...EMPTY_LIBRARY_FILTER, region: 'Pelvic floor: Women' }))).toEqual(['4']);
    expect(exerciseInRegion(LIB[3] as Exercise, 'Core')).toBe(true);
  });
  it('Equipment is OR inside and AND across with Type and Region', () => {
    const f = { ...EMPTY_LIBRARY_FILTER, equipment: ['Towel', 'Mat'] };
    expect(ids(filterLibrary(LIB, f))).toEqual(['1', '2', '4']);
    expect(ids(filterLibrary(LIB, { ...f, phase: 'activation' }))).toEqual(['1']);
    expect(ids(filterLibrary(LIB, { ...f, region: 'Hip' }))).toEqual(['2', '4']);
  });
  it('"None" finds exercises that need no equipment', () => {
    expect(ids(filterLibrary(LIB, { ...EMPTY_LIBRARY_FILTER, equipment: ['None'] }))).toEqual(['5', '6']);
  });
  it('Favourites and Used this week use the lists they are given', () => {
    expect(ids(filterLibrary(LIB, { ...EMPTY_LIBRARY_FILTER, region: 'Fav' }))).toEqual(['1']);
    expect(ids(filterLibrary(LIB, { ...EMPTY_LIBRARY_FILTER, region: 'Used' }, { usedIds: new Set(['3', '6']) }))).toEqual(['3', '6']);
    expect(ids(filterLibrary(LIB, { ...EMPTY_LIBRARY_FILTER, region: 'Used' }))).toEqual([]);
  });
  it('search finds by other name and with one typo', () => {
    const withNames = [ex('9', 'Straight Leg Raise', { otherNames: ['SLR'], bodyRegion: 'Hip' }), ex('10', 'Hamstring Curl')];
    expect(ids(filterLibrary(withNames, { ...EMPTY_LIBRARY_FILTER, query: 'slr' }))).toEqual(['9']);
    expect(ids(filterLibrary(withNames, { ...EMPTY_LIBRARY_FILTER, query: 'hamstrig' }))).toEqual(['10']);
  });
});

describe('helpers', () => {
  it('lists equipment in use A to Z without None or archived', () => {
    expect(equipmentInUse(LIB as Exercise[])).toEqual(['Mat', 'Theraband / resistance band', 'Towel']);
  });
  it('shows removable chips for the active filters', () => {
    expect(activeFilterChips({ region: 'Pelvic floor: Men', phase: 'activation', position: 'All', equipment: ['Wall'], query: 'x' }).map((c) => c.label)).toEqual(['Pelvic floor · Men', 'Activation', 'Wall']);
    expect(activeFilterChips(EMPTY_LIBRARY_FILTER)).toEqual([]);
    expect(regionLabel('Pelvic floor: Women')).toBe('Pelvic floor · Women');
  });
});

describe('similarExercise', () => {
  const others = [ex('a', 'Clamshells', { bodyRegion: 'Hip' }), ex('b', 'Old clam', { active: false }), ex('c', 'Wall Push-up', { bodyRegion: 'Shoulder' })] as Exercise[];
  it('warns about the same name with a different plural or hyphen, and a name that starts with another', () => {
    expect(similarExercise('Clamshell', others)?.title).toBe('Clamshells');
    expect(similarExercise('clam shells', others)?.title).toBe('Clamshells');
    expect(similarExercise('Wall pushup variation', others)?.title).toBe('Wall Push-up');
    expect(similarExercise('Wall slides', others)).toBeNull();
    expect(similarExercise('Wall Pushups', others)?.title).toBe('Wall Push-up');
  });
  it('ignores itself, archived exercises, and very short names', () => {
    expect(similarExercise('Clamshells', others, 'a')).toBeNull();
    expect(similarExercise('Old clam', others)).toBeNull();
    expect(similarExercise('Row', others)).toBeNull();
  });
});

describe('position filter and sort', () => {
  const L = [
    ex('a', 'Bridge', { positions: ['Supine'], createdAt: '2026-03-01T00:00:00Z' }),
    ex('b', 'Plank', { positions: ['Prone'], createdAt: '2026-05-01T00:00:00Z' }),
    ex('c', 'Alpha', { createdAt: '2026-04-01T00:00:00Z' }),
  ];
  it('keeps only the chosen position', () => {
    expect(ids(filterLibrary(L, { ...EMPTY_LIBRARY_FILTER, position: 'Prone' }))).toEqual(['b']);
    expect(ids(filterLibrary(L, EMPTY_LIBRARY_FILTER))).toEqual(['a', 'b', 'c']);
  });
  it('copes with an exercise that has no positions property', () => {
    const old = { ...ex('o', 'Old'), positions: undefined } as unknown as LibraryExercise;
    delete (old as { positions?: unknown }).positions;
    expect(ids(filterLibrary([old], EMPTY_LIBRARY_FILTER))).toEqual(['o']);
    expect(filterLibrary([old], { ...EMPTY_LIBRARY_FILTER, position: 'Prone' })).toEqual([]);
  });
  it('shows a position chip', () => {
    expect(activeFilterChips({ ...EMPTY_LIBRARY_FILTER, position: 'Prone' })).toContainEqual({ key: 'position', label: 'Prone' });
    expect(activeFilterChips(EMPTY_LIBRARY_FILTER).some((c) => c.key === 'position')).toBe(false);
  });
  it('sorts by most used, A to Z, and newest', () => {
    const counts = { a: 2, b: 9 };
    expect(ids(sortLibrary(L, 'used', counts))).toEqual(['b', 'a', 'c']);
    expect(ids(sortLibrary(L, 'az', counts))).toEqual(['c', 'a', 'b']);
    expect(ids(sortLibrary(L, 'recent', counts))).toEqual(['b', 'c', 'a']);
    expect(ids(L)).toEqual(['a', 'b', 'c']);
  });
  it('breaks newest-first ties A to Z', () => {
    const T = [ex('x', 'Zed', { createdAt: '2026-06-01T00:00:00Z' }), ex('y', 'Abe', { createdAt: '2026-06-01T00:00:00Z' }), ex('z', 'Mid', { createdAt: '2026-07-01T00:00:00Z' })];
    expect(ids(sortLibrary(T, 'recent', {}))).toEqual(['z', 'y', 'x']);
  });
  it('breaks used ties A to Z', () => {
    expect(ids(sortLibrary(L, 'used', {}))).toEqual(['c', 'a', 'b']);
  });
});

describe('multi-type (alsoPhases) filtering and facet counts', () => {
  const multi = [
    ex('m1', 'Glute Bridge', { phase: 'strengthening', alsoPhases: ['activation', 'mobility'] }),
    ex('m2', 'Quad Sets', { phase: 'activation' }),
    ex('m3', 'Dead Bug', { phase: 'activation' }), // no alsoPhases property -> defensive default
  ];
  it('matches an exercise under both its primary phase and any alsoPhases', () => {
    expect(exerciseInPhase(multi[0], 'strengthening')).toBe(true);
    expect(exerciseInPhase(multi[0], 'activation')).toBe(true);
    expect(exerciseInPhase(multi[0], 'stretching')).toBe(false);
    expect(ids(filterLibrary(multi, { ...EMPTY_LIBRARY_FILTER, phase: 'activation' }))).toEqual(['m1', 'm2', 'm3']);
    expect(ids(filterLibrary(multi, { ...EMPTY_LIBRARY_FILTER, phase: 'mobility' }))).toEqual(['m1']);
  });
  it('includes alsoPhases in Type facetCounts', () => {
    const counts = facetCounts(multi, EMPTY_LIBRARY_FILTER);
    expect(counts.types.find((t) => t.phase === 'activation')?.n).toBe(3);
    expect(counts.types.find((t) => t.phase === 'strengthening')?.n).toBe(1);
    expect(counts.types.find((t) => t.phase === 'mobility')?.n).toBe(1);
  });
});
