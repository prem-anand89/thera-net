import { useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type OutboxEntry } from '@/lib/db';
import { syncStatus } from '@/sync/status';
import { syncEngine } from '@/sync/engine';
import { toFriendlyMessage } from '@/lib/errors';

export function SyncBadge() {
  const status = useSyncExternalStore(syncStatus.subscribe, () => syncStatus.get());
  const [open, setOpen] = useState(false);
  const failed = useLiveQuery(() => db.outbox.filter((e) => !!e.error).toArray(), []) ?? [];

  const dot = !status.online
    ? 'bg-[var(--rust)]'
    : failed.length > 0 || status.error
      ? 'bg-[var(--rust)]'
      : status.pending > 0 || status.syncing
        ? 'bg-[var(--teal)] animate-pulse'
        : 'bg-[var(--moss)]';

  const label = !status.online
    ? `Offline${status.pending ? ` · ${status.pending} pending` : ''}`
    : status.syncing
      ? 'Syncing…'
      : failed.length > 0
        ? `${failed.length} sync issue${failed.length > 1 ? 's' : ''}`
        : status.pending > 0
          ? `${status.pending} pending`
          : 'Synced';

  async function discard(entry: OutboxEntry) {
    if (
      !confirm(
        "Stop trying to save this change to the server?\n\nYour local copy stays as it is, but the server (and other devices) will never receive this specific change unless you edit that record again."
      )
    )
      return;
    await syncEngine.discard(entry.table, entry.rowId);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={status.error ?? 'Sync status'}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--paper)]"
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[var(--ink)]">Sync status</span>
            <button
              className="text-xs text-[var(--teal)] hover:underline"
              onClick={() => syncEngine.schedule(0)}
            >
              Sync now
            </button>
          </div>

          {status.error && (
            <p className="mt-2 rounded-md border border-[var(--rust)] bg-[var(--rust-light)] px-2 py-1 text-xs text-[var(--rust)]">
              {toFriendlyMessage(new Error(status.error))}
            </p>
          )}

          {failed.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              {status.pending > 0
                ? `${status.pending} change${status.pending > 1 ? 's' : ''} queued, no errors — this clears automatically.`
                : 'Everything on this device has been saved to the server.'}
            </p>
          ) : (
            <>
              <p className="mt-2 text-xs text-[var(--muted)]">
                These changes keep failing to reach the server. They retry automatically, so only
                discard one if you're sure it's stuck for good (e.g. it references something that
                no longer exists).
              </p>
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                {failed.map((e) => (
                  <li key={e.seq} className="rounded-md border border-[var(--rust)] bg-[var(--rust-light)] p-2">
                    <div className="text-xs font-medium text-[var(--rust)]">
                      {e.table} · {new Date(e.ts).toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs text-[var(--rust)]">
                      {toFriendlyMessage(new Error(e.error ?? 'Unknown error'))}
                    </div>
                    <button
                      className="mt-2 text-xs text-[var(--muted)] hover:text-[var(--rust)]"
                      onClick={() => void discard(e)}
                    >
                      Discard
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
