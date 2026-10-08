/**
 * Staff "Active today" presence. Pure (no React, no Dexie) so it's testable
 * on its own — the client wiring that reads/writes `db.meta` with this key
 * lives in `src/app/Shell.tsx`.
 *
 * Namespaced by BOTH clinic and user id, not just device: a per-device-only
 * key would let one staff member's daily ping on a shared front-desk kiosk
 * silently suppress a second staff member's ping that same day, producing a
 * wrong "not active today" status for them.
 */
export function lastActivePingKey(clinicId: string, userId: string): string {
  return `lastActivePinged:${clinicId}:${userId}`;
}

/** True once‑a‑day gate: fire the ping when there's no stored date for this
 *  (clinic, user) pair, or the stored date isn't today's. */
export function shouldPingLastActive(storedDate: string | undefined, todayIso: string): boolean {
  return storedDate !== todayIso;
}
