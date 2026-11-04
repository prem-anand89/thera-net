import { formatINR, type Paise } from './money';
import type { CatalogItem } from './types';

/**
 * How services read on screen, in one place, so the Settings list, the desktop table and the visit picker never
 * disagree.
 */

/** A package's price per session, rounded to whole rupees for display (₹5,000 for 3 → ₹1,667). The exact
 *  `effectivePricePerSession` stays for anything that does maths. */
export function perSessionRupeesPaise(item: Pick<CatalogItem, 'basePricePaise' | 'sessionCount'>): Paise {
  const sessions = Math.max(1, item.sessionCount);
  return Math.round(item.basePricePaise / sessions / 100) * 100;
}

/** "₹1,667 each". */
export function perSessionLabel(item: Pick<CatalogItem, 'basePricePaise' | 'sessionCount'>): string {
  return `${formatINR(perSessionRupeesPaise(item))} each`;
}

/** "412 visits" / "1 visit" / "Not used yet". */
export function usageLabel(count: number): string {
  if (count <= 0) return 'Not used yet';
  return `Used in ${count} visit${count === 1 ? '' : 's'}`;
}

/**
 * The line under a service's name: "10 sessions · ₹1,000 each · 45 min". What the service is, never how
 * much it is used (`usageLabel` shows that apart). Parts that don't apply are left out; it can be an empty string.
 */
export function serviceSubline(
  item: Pick<CatalogItem, 'basePricePaise' | 'sessionCount' | 'durationMinutes'>
): string {
  const parts: string[] = [];
  if (item.sessionCount > 1) parts.push(`${item.sessionCount} sessions`, perSessionLabel(item));
  if (item.durationMinutes != null) parts.push(`${item.durationMinutes} min`);
  return parts.join(' · ');
}

/** The heading for services with no group, used only when the clinic also has named groups. */
export const OTHER_GROUP = 'Other';

export type GroupedServices<T extends Pick<CatalogItem, 'name' | 'category'>> =
  | { kind: 'flat'; items: T[] }
  | { kind: 'grouped'; groups: [string, T[]][]; other: T[] };

/**
 * The one ordering rule for services (Settings and the visit picker): a clinic with no named groups gets one flat list
 * with no headings; otherwise named groups come first, alphabetically, then the ungrouped ones under "Other". Inside
 * each, services are alphabetical. Never "Uncategorized".
 */
export function groupServices<T extends Pick<CatalogItem, 'name' | 'category'>>(items: readonly T[]): GroupedServices<T> {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const named = new Map<string, T[]>();
  const other: T[] = [];
  for (const item of items) {
    // `category` can be missing on an old cached row: treat it as no group.
    const group = (item.category ?? '').trim();
    if (!group) {
      other.push(item);
      continue;
    }
    if (!named.has(group)) named.set(group, []);
    named.get(group)!.push(item);
  }
  if (named.size === 0) return { kind: 'flat', items: [...other].sort(byName) };
  const groups = [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, list]) => [g, [...list].sort(byName)] as [string, T[]]);
  return { kind: 'grouped', groups, other: other.sort(byName) };
}

/** The list in display order, each with the heading it sits under ('' = no heading). */
export function orderedServices<T extends Pick<CatalogItem, 'name' | 'category'>>(
  items: readonly T[]
): { item: T; heading: string }[] {
  const g = groupServices(items);
  if (g.kind === 'flat') return g.items.map((item) => ({ item, heading: '' }));
  return [
    ...g.groups.flatMap(([heading, list]) => list.map((item) => ({ item, heading }))),
    ...g.other.map((item) => ({ item, heading: OTHER_GROUP })),
  ];
}
