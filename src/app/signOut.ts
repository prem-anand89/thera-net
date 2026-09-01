import { db } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';
import { syncEngine } from '@/sync/engine';

/**
 * Sign-out entry point shared by every "Sign out" button. `Shell.tsx`'s
 * cleanup effect wipes the entire outbox unconditionally the moment
 * `auth.signOut()` resolves and `session` goes null — necessary so one
 * account's cached data can't leak into the next login on a shared
 * device, but that means anything still queued (an offline-created visit,
 * a still-in-flight edit) is discarded with it, silently. This gives the
 * outbox one last chance to reach the server first, and only asks before
 * discarding real unsynced work — not on every sign-out, since the
 * common case (everything already pushed) shouldn't get a confirmation
 * dialog in the way.
 */
export async function signOutSafely(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  if ((await db.outbox.count()) > 0 && navigator.onLine) {
    // Best-effort: sync() itself no-ops offline/without a session, and any
    // rejection here (network blip mid-flush) just falls through to the
    // pending count re-check below rather than blocking sign-out on it.
    await syncEngine.sync().catch(() => {});
  }

  const stillPending = await db.outbox.count();
  if (stillPending > 0) {
    const proceed = window.confirm(
      `You have ${stillPending} unsynced change${stillPending === 1 ? '' : 's'} that ` +
        `couldn't be saved to the server (check your connection). Signing out now will ` +
        `discard ${stillPending === 1 ? 'it' : 'them'} permanently. Sign out anyway?`
    );
    if (!proceed) return;
  }

  await supabase.auth.signOut();
}
