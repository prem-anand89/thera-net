import { useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type OutboxEntry } from '@/lib/db';
import { syncStatus, isPermanentFailure } from '@/sync/status';
import { syncEngine } from '@/sync/engine';
import { toFriendlyMessage } from '@/lib/errors';
import { syncFailureHeadline, syncRecordLabel } from '@/domain/syncCopy';
import { btnPrimary, btnSecondary } from '@/components/ui';

export function SyncStatusBanners() {
  const status = useSyncExternalStore(syncStatus.subscribe, () => syncStatus.get());
  const failed = useLiveQuery(() => db.outbox.filter((e) => !!e.error).toArray(), []) ?? [];
  const headline = failed.length > 0 ? syncFailureHeadline(failed.map((e) => e.table)) : null;

  if (status.online && !headline) return null;

  return (
    <div className="space-y-1 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      {!status.online && (
        <p className="text-sm text-[var(--ink)]">
          You're offline. Visits still save on this device.
        </p>
      )}
      {headline && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--rust)]">{headline}</p>
          <button
            type="button"
            className="min-h-11 text-sm font-medium text-[var(--teal)] hover:underline"
            onClick={() => syncEngine.schedule(0)}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function SyncBadge() {
  const status = useSyncExternalStore(syncStatus.subscribe, () => syncStatus.get());
  const pending = status.pending ?? 0;
  const [open, setOpen] = useState(false);
  const [discarding, setDiscarding] = useState<OutboxEntry | null>(null);
  const failed = useLiveQuery(() => db.outbox.filter((e) => !!e.error).toArray(), []) ?? [];

  const dot = !status.online
    ? 'bg-[var(--rust)]'
    : failed.length > 0 || status.error
      ? 'bg-[var(--rust)]'
      : pending > 0 || status.syncing
        ? 'bg-[var(--teal)] animate-pulse'
        : 'bg-[var(--moss)]';

  const label = !status.online
    ? `Offline${pending ? ` · ${pending} pending` : ''}`
    : status.syncing
      ? 'Syncing…'
      : failed.length > 0
        ? syncFailureHeadline(failed.map((e) => e.table))
        : pending > 0
          ? `${pending} pending`
          : 'Synced';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={status.error ?? 'Sync status'}
        aria-label={`Sync: ${label}`}
        className="flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--paper)] tab:px-3"
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {/* Text collapses only below tab: (744px) — there's actually room
            for the full pill everywhere the header nav shows its own
            labels (tab:-and-up); collapsing it there too, as an earlier
            pass did, was overly conservative. Below tab: is genuinely
            tight (phone width, nav gone entirely) and the dot's color
            already carries the state, with the panel this button opens
            holding the rest. */}
        <span className="hidden tab:inline">{label}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--ink)]">Sync</span>
              <button
                type="button"
                className="text-xs text-[var(--teal)] hover:underline"
                onClick={() => syncEngine.schedule(0)}
              >
                Try again
              </button>
            </div>

            {status.error && (
              <p className="mt-2 rounded-lg border border-[var(--rust)] bg-[var(--rust-light)] px-2 py-1 text-xs text-[var(--rust)]">
                {toFriendlyMessage(new Error(status.error))}
              </p>
            )}

            {failed.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                {pending > 0
                  ? `${pending} change${pending > 1 ? 's' : ''} queued — this clears automatically.`
                  : 'Everything on this device has been saved.'}
              </p>
            ) : (
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                {failed.map((e) => {
                  const permanent = isPermanentFailure(e.errorCode ?? null, e.error ?? '');
                  return (
                    <li
                      key={e.seq}
                      className="rounded-lg border border-[var(--rust)] bg-[var(--rust-light)] p-2"
                    >
                      <div className="text-xs font-medium text-[var(--rust)]">
                        {syncRecordLabel(e.table)}
                        {permanent && " · won't succeed by retrying"}
                      </div>
                      <div className="mt-1 text-xs text-[var(--rust)]">
                        {toFriendlyMessage({
                          message: e.error ?? 'Unknown error',
                          code: e.errorCode,
                        })}
                      </div>
                      <button
                        type="button"
                        className="mt-2 min-h-11 text-xs text-[var(--muted)] hover:text-[var(--rust)]"
                        onClick={() => setDiscarding(e)}
                      >
                        Discard this change
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {discarding && <DiscardChangeDialog entry={discarding} onClose={() => setDiscarding(null)} />}
    </div>
  );
}

function DiscardChangeDialog({ entry, onClose }: { entry: OutboxEntry; onClose: () => void }) {
  const permanent = isPermanentFailure(entry.errorCode ?? null, entry.error ?? '');
  const label = syncRecordLabel(entry.table);

  async function confirmDiscard() {
    await syncEngine.discard(entry.table, entry.rowId);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">
          {permanent ? `Dismiss this ${label}?` : `Discard this ${label}?`}
        </h2>
        <p className="text-sm text-[var(--muted)]">
          {permanent
            ? 'This device already matches the server for this record. Dismissing just clears the notice — it does not change any data.'
            : 'This device will stop trying to save this change. Your local copy stays as it is, but other devices will not receive it unless you edit that record again.'}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Keep trying
          </button>
          <button type="button" className={btnPrimary} onClick={() => void confirmDiscard()}>
            {permanent ? 'Dismiss notice' : 'Discard change'}
          </button>
        </div>
      </div>
    </div>
  );
}
