import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

/** Login-screen notice: a session ended while work was still waiting to sync, and it was kept. */
export function UnsyncedNotice() {
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  if (pending === 0) return null;
  return (
    <div role="status" className="mb-4 rounded-lg border border-[var(--amber)]/50 bg-[var(--paper)] p-3 text-sm text-[var(--ink)]">
      {pending} {pending === 1 ? 'change' : 'changes'} on this device {pending === 1 ? 'has' : 'have'} not synced yet and{' '}
      {pending === 1 ? 'is' : 'are'} still saved here. Sign in again with the same account to finish syncing.
    </div>
  );
}
