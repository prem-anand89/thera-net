// How well the TheraNet Library covers each body region and exercise type, for curators: counts per cell, so gaps show.
import { EXERCISE_TYPES, HEP_BODY_ORDER, canonicalRegion, isMainType, isPelvicFloorRegion, type ExerciseType, type StarterLibraryItem } from './hep';

export interface CoverageCell { total: number; withPictures: number }
export interface CoverageRow extends CoverageCell { region: string; cells: Record<ExerciseType, CoverageCell> }
export interface CoverageGrid {
  rows: CoverageRow[];
  /** Per type, across all regions. */
  columns: Record<ExerciseType, CoverageCell>;
  /** Distinct exercises (one with two types counts once here, and in each type's own column). */
  total: number;
  withPictures: number;
}

/** Pelvic floor (women) and (men) read as one region here, as in the library list. */
export const coverageRegion = (raw: string): string => (isPelvicFloorRegion(raw) ? 'Pelvic floor' : canonicalRegion(raw));

const emptyCell = (): CoverageCell => ({ total: 0, withPictures: 0 });
const emptyCells = (): Record<ExerciseType, CoverageCell> =>
  Object.fromEntries(EXERCISE_TYPES.map((t) => [t, emptyCell()])) as Record<ExerciseType, CoverageCell>;

/**
 * Rows are the fixed body regions (always shown, so an empty one is a visible gap) followed by any other region in use.
 * An exercise counts under its main type and each additional type; warm-up, cool-down and other are not columns.
 */
export function coverageGrid(items: StarterLibraryItem[]): CoverageGrid {
  const fixed = [...HEP_BODY_ORDER] as string[];
  const extra = [...new Set(items.map((i) => coverageRegion(i.bodyRegion)).filter((r) => r !== '' && !fixed.includes(r)))].sort((a, b) => a.localeCompare(b));
  const rows = new Map<string, CoverageRow>([...fixed, ...extra].map((region) => [region, { region, total: 0, withPictures: 0, cells: emptyCells() }]));
  const columns = emptyCells();
  let total = 0;
  let withPictures = 0;
  for (const item of items) {
    const row = rows.get(coverageRegion(item.bodyRegion));
    if (!row) continue;
    const pictured = item.mediaKeys.length > 0;
    row.total += 1;
    total += 1;
    if (pictured) { row.withPictures += 1; withPictures += 1; }
    for (const type of new Set([item.phase, ...item.alsoPhases])) {
      if (!isMainType(type)) continue;
      row.cells[type].total += 1;
      columns[type].total += 1;
      if (pictured) { row.cells[type].withPictures += 1; columns[type].withPictures += 1; }
    }
  }
  return { rows: [...rows.values()], columns, total, withPictures };
}
