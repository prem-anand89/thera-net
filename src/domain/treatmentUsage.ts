import type { TreatmentItem, UUID } from './types';

export interface RankedTreatments {
  /** Ranked by recent usage, most-used first — empty when grouping isn't
   *  worth it (see thresholds below). */
  frequent: TreatmentItem[];
  /** Alphabetical. The full list when `frequent` is empty; otherwise
   *  everything not already shown in `frequent`. */
  rest: TreatmentItem[];
}

/**
 * Splits active treatments into a short "frequently used" group (ranked by
 * recent usage, see dashboardService.treatmentUsageCounts) and an
 * alphabetical remainder, so the visit-entry picker reads as a short
 * frequently-used row plus a full reference list below, rather than one
 * flat alphabetical scroll every time — the point of this for a clinic
 * with only a handful of treatments to begin with, so `rest` alone (no
 * split) is returned when there isn't enough list to justify it, or no
 * usage data exists yet to rank by.
 */
export function rankTreatmentsByUsage(
  items: TreatmentItem[],
  usageCounts: { treatmentId: UUID; count: number }[],
  options: { minTotalForGrouping?: number; maxFrequent?: number } = {}
): RankedTreatments {
  const { minTotalForGrouping = 8, maxFrequent = 6 } = options;
  const sortedAlpha = [...items].sort((a, b) => a.name.localeCompare(b.name));
  if (items.length < minTotalForGrouping || usageCounts.length === 0) {
    return { frequent: [], rest: sortedAlpha };
  }

  const countById = new Map(usageCounts.map((r) => [r.treatmentId, r.count]));
  const used = sortedAlpha
    .filter((i) => (countById.get(i.id) ?? 0) > 0)
    .sort((a, b) => (countById.get(b.id) ?? 0) - (countById.get(a.id) ?? 0));

  const frequent = used.slice(0, maxFrequent);
  const frequentIds = new Set(frequent.map((i) => i.id));
  return { frequent, rest: sortedAlpha.filter((i) => !frequentIds.has(i.id)) };
}
