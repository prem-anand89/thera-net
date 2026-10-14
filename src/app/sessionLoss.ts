/**
 * What to do with the local store when the auth session changes.
 *
 * The outbox is the only copy of unsynced work, so it must survive an
 * *involuntary* session loss (expired or revoked refresh token, sign-out in
 * another tab, password change elsewhere). Only a deliberate sign-out — which
 * `signOutSafely` has already tried to sync and warned about — may wipe it.
 */

export const LAST_USER_META_KEY = 'lastUserId';

/** How long after "Sign out" a session loss still counts as that sign-out. */
const VOLUNTARY_WINDOW_MS = 15_000;
let voluntaryUntil = 0;
/** Called by `signOutSafely` right before `auth.signOut()`. Expires, so a failed
 *  sign-out can't make a later involuntary loss look deliberate. */
export function markVoluntarySignOut(now = Date.now()): void {
  voluntaryUntil = now + VOLUNTARY_WINDOW_MS;
}
/** Reads and resets the flag (one sign-out, one answer). */
export function consumeVoluntarySignOut(now = Date.now()): boolean {
  const was = now < voluntaryUntil;
  voluntaryUntil = 0;
  return was;
}

/** The session ended. Keep data that still has unsynced work, unless the user chose to sign out. */
export function decideOnSignedOut(input: { voluntary: boolean; outboxCount: number }): 'clear' | 'keep' {
  return input.voluntary || input.outboxCount === 0 ? 'clear' : 'keep';
}

/**
 * A session started and local data may belong to someone else.
 * - same (or no recorded) user: carry on, keep everything;
 * - another user, nothing pending: wipe the old account's cached data first;
 * - another user with unsynced work: ask before discarding, and do NOT sync
 *   (the rows would be pushed with the wrong account's credentials).
 */
export function decideOnSessionStart(input: {
  lastUserId: string | null;
  userId: string;
  outboxCount: number;
}): 'resume' | 'clear-then-resume' | 'confirm-discard' {
  if (input.lastUserId === input.userId) return 'resume';
  // No recorded owner: a device that held data from before owners were recorded.
  // With nothing pending the cache is just a cache (clear it, it re-pulls); with
  // pending work we cannot tell whose it is, so ask rather than push it blind.
  // A brand-new, empty device has no outbox, so this never prompts on first use.
  return input.outboxCount === 0 ? (input.lastUserId ? 'clear-then-resume' : 'resume') : 'confirm-discard';
}
