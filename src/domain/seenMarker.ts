import type { SeenMarkerKey } from './types';

/** How far back a device with no marker at all (brand new, nothing synced yet) looks for "new" items. */
export const SEEN_FLOOR_DAYS = 30;

/** Deterministic row id: one row per (user, clinic, marker), the same on every device. The server enforces it with a check constraint. */
export function seenMarkerId(userId: string, clinicId: string, key: SeenMarkerKey): string {
  return `${userId}:${clinicId}:${key}`;
}

/**
 * The timestamp "new" items are counted after: the newest of the synced marker and a legacy
 * per-device value (older builds kept `requestsLastViewedAt:*` in `db.meta`). With neither,
 * only the last SEEN_FLOOR_DAYS count as new, so a cold device never shows years of old
 * feedback as unread.
 */
export function effectiveSeenSince(
  markerSeenAt: string | null | undefined,
  legacySeenAt: string | null | undefined,
  now: Date = new Date()
): string {
  const known = [markerSeenAt, legacySeenAt].filter((v): v is string => Boolean(v));
  if (known.length > 0) return known.reduce((a, b) => (a >= b ? a : b));
  return new Date(now.getTime() - SEEN_FLOOR_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
