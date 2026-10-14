/**
 * Walk-in patient IDs look like `{prefix}{YY}-{NNNN}` (e.g. `W26-0001`) and are
 * minted from the local patient list, so two devices that are offline or not
 * yet synced can mint the same one. The server's unique (clinic_id, mrno) then
 * rejects the second; `reissueWalkInMrno` picks the next free number for it.
 */

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highest {prefix}{YY}-NNNN sequence already used among `mrnos`, or 0 if none. */
export function maxWalkInSeq(mrnos: string[], prefix: string, yy: string): number {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}${yy}-(\\d+)$`);
  let max = 0;
  for (const mrno of mrnos) {
    const match = pattern.exec(mrno);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function formatWalkInMrno(prefix: string, yy: string, seq: number): string {
  return `${prefix}${yy}-${String(seq).padStart(4, '0')}`;
}

/**
 * A fresh walk-in ID to replace a colliding one: same prefix and year, the next
 * number after everything in `takenMrnos` (local + what the server already
 * has). Null when `current` isn't a walk-in style ID, which must not be rewritten.
 */
export function reissueWalkInMrno(current: string, takenMrnos: string[]): string | null {
  const match = /^(.*?)(\d{2})-(\d+)$/.exec(current);
  if (!match) return null;
  const [, prefix, yy] = match;
  return formatWalkInMrno(prefix, yy, maxWalkInSeq([...takenMrnos, current], prefix, yy) + 1);
}

/** True for the unique-violation the server raises on (clinic_id, mrno). */
export function isMrnoCollision(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === '23505' && /mrno/i.test(error.message ?? '');
}
