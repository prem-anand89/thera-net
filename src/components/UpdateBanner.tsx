import { useEffect, useState, useSyncExternalStore } from 'react';
import { applyUpdateNow } from '@/app/registerServiceWorker';
import { bannerVisible, isSticky, updateStore } from '@/app/updateStore';
import { syncStatus } from '@/sync/status';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * "A new version is ready." The tab keeps working on the version it loaded
 * until the user taps Refresh (pending changes sync first). "Later" snoozes it
 * for a few hours; once an update has waited long enough the banner stays.
 */
export function UpdateBanner() {
  const state = useSyncExternalStore(updateStore.subscribe, updateStore.get, updateStore.get);
  const now = useNow(60_000);
  const [pending, setPending] = useState(() => syncStatus.get().pending ?? 0);
  useEffect(() => {
    const unsubscribe = syncStatus.subscribe((s) => setPending(s.pending ?? 0));
    return () => {
      unsubscribe();
    };
  }, []);

  if (!bannerVisible(state, now)) return null;
  const sticky = isSticky(state, now);

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-lg sm:bottom-4 sm:left-auto sm:right-4 sm:mx-0"
    >
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-semibold text-[var(--ink)]">A new version is available</p>
        <p className="text-xs text-[var(--muted)]">
          {sticky ? 'Please refresh soon to stay up to date. ' : 'Finish what you are doing, then refresh. '}
          You are on v{__APP_VERSION__} · {__APP_BUILD__}.
          {pending > 0 ? ` ${pending} unsynced ${pending === 1 ? 'change' : 'changes'} will sync first.` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!sticky && (
          <button
            type="button"
            className="min-h-9 rounded-lg px-3 text-sm font-medium text-[var(--muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
            onClick={() => updateStore.snooze()}
          >
            Later
          </button>
        )}
        <button
          type="button"
          disabled={state.applying}
          className="min-h-9 rounded-lg bg-[var(--teal)] px-4 text-sm font-medium text-white hover:bg-[var(--teal-strong)] disabled:opacity-60"
          onClick={() => void applyUpdateNow()}
        >
          {state.applying ? 'Updating…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
