import type { CatalogItem, UUID } from './types';

export interface ServiceUsageCountRow {
  serviceId: UUID;
  count: number;
}

/**
 * Ranks active catalog services by recent clinic usage (over the last 90 days),
 * returning the top `limit` (default 3) services for 1-tap quick selection.
 *
 * Rules:
 * - Inactive services (`!item.active`) are excluded.
 * - Most-used services appear first.
 * - For ties or when no usage counts exist yet (new clinic), falls back to alphabetical name order.
 * - Returns at most `limit` items.
 */
export function rankServicesByUsage(
  items: CatalogItem[],
  usageCounts: ServiceUsageCountRow[],
  limit = 3
): CatalogItem[] {
  const active = items.filter((it) => it.active);
  if (active.length === 0) return [];

  const countById = new Map(usageCounts.map((r) => [r.serviceId, r.count]));

  return [...active]
    .sort((a, b) => {
      const countA = countById.get(a.id) ?? 0;
      const countB = countById.get(b.id) ?? 0;
      if (countB !== countA) return countB - countA;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
