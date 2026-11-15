// What the Library and the exercise picker show: filtering by region, type, equipment and search, and grouping the
// result by region, then by type in session order. Pure functions so both screens behave the same way.
import {
  EXERCISE_PHASES,
  EXERCISE_PHASE_LABELS,
  HEP_BODY_ORDER,
  HEP_PELVIC_FLOOR_MEN,
  HEP_PELVIC_FLOOR_WOMEN,
  canonicalEquipment,
  canonicalRegion,
  matchesExerciseSearch,
  positionsOf,
  type Exercise,
  type ExercisePhase,
} from '@/domain/hep';

/** 'All' = no region filter; 'Fav' = favourites; 'Used' = prescribed this week; anything else is a region name. */
export type LibraryRegion = 'All' | 'Fav' | 'Used' | (string & {});

export interface LibraryFilter {
  region: LibraryRegion;
  phase: ExercisePhase | 'All';
  /** 'All' = no position filter. */
  position: string;
  /** OR inside the list: an exercise needing any of these. */
  equipment: string[];
  query: string;
}

export const EMPTY_LIBRARY_FILTER: LibraryFilter = { region: 'All', phase: 'All', position: 'All', equipment: [], query: '' };

export type LibraryExercise = Pick<Exercise, 'id' | 'title' | 'otherNames' | 'bodyRegion' | 'alsoRegions' | 'phase' | 'positions' | 'equipment' | 'isFavorite' | 'active' | 'deleted' | 'createdAt'>;

const PELVIC_FLOOR = 'Pelvic floor';

/** True when the exercise sits under this region (as its main region or in "also under"). 'Pelvic floor' means Women or Men. */
export function exerciseInRegion(ex: Pick<Exercise, 'bodyRegion' | 'alsoRegions'>, region: string): boolean {
  const mine = new Set([canonicalRegion(ex.bodyRegion), ...ex.alsoRegions.map(canonicalRegion)]);
  if (region === PELVIC_FLOOR) return mine.has(HEP_PELVIC_FLOOR_WOMEN) || mine.has(HEP_PELVIC_FLOOR_MEN);
  return mine.has(canonicalRegion(region));
}

/**
 * Applies the filter. Equipment is OR inside and AND across (amendment 77): an exercise needing a towel OR a band,
 * AND of the chosen type, AND under the chosen region, AND matching the search. "None" matches an exercise that needs
 * no equipment.
 */
export function filterLibrary<T extends LibraryExercise>(
  exercises: T[],
  filter: LibraryFilter,
  opts: { usedIds?: ReadonlySet<string>; includeArchived?: boolean } = {},
): T[] {
  const wanted = filter.equipment.map(canonicalEquipment);
  return exercises.filter((ex) => {
    if (ex.deleted || (!ex.active && !opts.includeArchived)) return false;
    if (filter.region === 'Fav' && !ex.isFavorite) return false;
    if (filter.region === 'Used' && !opts.usedIds?.has(ex.id)) return false;
    if (filter.region !== 'All' && filter.region !== 'Fav' && filter.region !== 'Used' && !exerciseInRegion(ex, filter.region)) return false;
    if (filter.phase !== 'All' && ex.phase !== filter.phase) return false;
    if (filter.position !== 'All' && !positionsOf(ex).includes(filter.position)) return false;
    if (wanted.length > 0) {
      const have = ex.equipment.map(canonicalEquipment);
      const ok = wanted.some((w) => (w === 'None' ? have.length === 0 || have.includes('None') : have.includes(w)));
      if (!ok) return false;
    }
    return matchesExerciseSearch(ex, filter.query);
  });
}

export type LibrarySort = 'used' | 'az' | 'recent';

/** Most used first (ties A to Z), A to Z, or newest first. Returns a new list. */
export function sortLibrary<T extends LibraryExercise>(list: T[], sort: LibrarySort, useCounts: Record<string, number>): T[] {
  const az = (a: T, b: T) => a.title.localeCompare(b.title);
  const out = [...list];
  if (sort === 'az') return out.sort(az);
  if (sort === 'recent') return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out.sort((a, b) => (useCounts[b.id] ?? 0) - (useCounts[a.id] ?? 0) || az(a, b));
}

export interface LibraryTypeGroup<T> {
  phase: ExercisePhase;
  exercises: T[];
}
export interface LibraryRegionGroup<T> {
  region: string;
  types: LibraryTypeGroup<T>[];
}

const regionRank = (region: string): number => {
  const key = region.startsWith(PELVIC_FLOOR) ? PELVIC_FLOOR : region;
  const i = (HEP_BODY_ORDER as readonly string[]).indexOf(key);
  return i === -1 ? HEP_BODY_ORDER.length : i; // clinic-added regions go after the fixed ones
};

/**
 * Groups by region head to toe, then by type in session order, each A to Z. Under a chosen region (not All, Fav, Used)
 * everything is grouped under that region, so a Knee exercise that is also under Hip shows in Hip's own list under Hip.
 */
export function groupLibrary<T extends LibraryExercise>(exercises: T[], region: LibraryRegion): LibraryRegionGroup<T>[] {
  const fixed = region !== 'All' && region !== 'Fav' && region !== 'Used';
  const byRegion = new Map<string, T[]>();
  for (const ex of exercises) {
    const key = fixed ? region : canonicalRegion(ex.bodyRegion);
    byRegion.set(key, [...(byRegion.get(key) ?? []), ex]);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => regionRank(a) - regionRank(b) || a.localeCompare(b))
    .map(([r, list]) => ({
      region: r,
      types: EXERCISE_PHASES.map((phase) => ({
        phase,
        exercises: list.filter((e) => e.phase === phase).sort((a, b) => a.title.localeCompare(b.title)),
      })).filter((t) => t.exercises.length > 0),
    }));
}

/** "Pelvic floor: Women" shows as "Pelvic floor · Women". */
export const regionLabel = (region: string): string => region.replace('Pelvic floor: ', 'Pelvic floor · ');

/** Every equipment name in use across the exercises, A to Z (the Equipment filter's list). */
export function equipmentInUse(exercises: Pick<Exercise, 'equipment' | 'active' | 'deleted'>[]): string[] {
  return [...new Set(exercises.filter((e) => !e.deleted && e.active).flatMap((e) => e.equipment.map(canonicalEquipment)).filter((e) => e && e !== 'None'))].sort((a, b) => a.localeCompare(b));
}

/** Library filters currently narrowing the list, as the removable chips ("Shoulder ✕", "Wall ✕"). */
export function activeFilterChips(f: LibraryFilter): Array<{ key: string; label: string }> {
  const chips: Array<{ key: string; label: string }> = [];
  if (f.region !== 'All') chips.push({ key: 'region', label: f.region === 'Fav' ? '★ Favourites' : f.region === 'Used' ? 'Used this week' : regionLabel(f.region) });
  if (f.phase !== 'All') chips.push({ key: 'phase', label: EXERCISE_PHASE_LABELS[f.phase] });
  if (f.position !== 'All') chips.push({ key: 'position', label: f.position });
  for (const e of f.equipment) chips.push({ key: `equip:${e}`, label: e });
  return chips;
}

const squashTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');

/**
 * An existing exercise that looks like this title ("Clamshell" vs "Clamshells", "Push-up" vs "Pushup", or one name
 * starting with the other): a warning on the Edit form, never a block. Archived and deleted ones do not count.
 */
export function similarExercise<T extends Pick<Exercise, 'id' | 'title' | 'bodyRegion' | 'active' | 'deleted'>>(title: string, others: T[], selfId?: string): T | null {
  const mine = squashTitle(title);
  if (mine.length < 4) return null;
  return (
    others.find((o) => {
      if (o.id === selfId || o.deleted || !o.active) return false;
      const theirs = squashTitle(o.title);
      return theirs === mine || (Math.min(theirs.length, mine.length) >= 5 && (theirs.startsWith(mine) || mine.startsWith(theirs)));
    }) ?? null
  );
}
