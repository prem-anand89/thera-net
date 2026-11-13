import { describe, expect, it } from 'vitest';
import type { Exercise } from './hep';
import { EMPTY_LIBRARY_FILTER, activeFilterChips, equipmentInUse, exerciseInRegion, filterLibrary, groupLibrary, regionLabel, similarExercise, type LibraryExercise } from './hepLibrary';

const ex = (id: string, title: string, over: Partial<Exercise> = {}): LibraryExercise =>
  ({ id, title, otherNames: [], bodyRegion: 'Knee', alsoRegions: [], phase: 'strengthening', equipment: [], isFavorite: false, active: true, deleted: false, ...over });

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

describe('groupLibrary', () => {
  it('groups head to toe, then by type in session order, each A to Z; clinic regions go last', () => {
    const list = filterLibrary([...LIB, ex('11', 'Custom', { bodyRegion: 'Jaw' })], EMPTY_LIBRARY_FILTER);
    const g = groupLibrary(list, 'All');
    expect(g.map((r) => r.region)).toEqual(['Face', 'Hip', 'Knee', 'Pelvic floor: Men', 'Jaw']);
    const knee = g.find((r) => r.region === 'Knee')!;
    expect(knee.types.map((t) => t.phase)).toEqual(['stretching', 'activation']);
  });
  it('under a chosen region everything is grouped under that region', () => {
    const g = groupLibrary(filterLibrary(LIB, { ...EMPTY_LIBRARY_FILTER, region: 'Hip' }), 'Hip');
    expect(g.map((r) => r.region)).toEqual(['Hip']);
    expect(g[0].types.flatMap((t) => t.exercises.map((e) => e.id))).toEqual(['2', '3', '4']);
  });
});

describe('helpers', () => {
  it('lists equipment in use A to Z without None or archived', () => {
    expect(equipmentInUse(LIB as Exercise[])).toEqual(['Mat', 'Theraband / resistance band', 'Towel']);
  });
  it('shows removable chips for the active filters', () => {
    expect(activeFilterChips({ region: 'Pelvic floor: Men', phase: 'activation', equipment: ['Wall'], query: 'x' }).map((c) => c.label)).toEqual(['Pelvic floor · Men', 'Activation', 'Wall']);
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
