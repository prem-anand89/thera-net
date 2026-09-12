import { Component, type ReactNode } from 'react';
import { reportError } from '@/lib/errorReporting';
import { btnPrimary } from '@/components/ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** A lazy route's chunk no longer exists on the CDN — the classic symptom
 *  is a device that had the app open (or a stale cache) across a new
 *  deploy: every route but Workspace is React.lazy()-loaded (see
 *  router.tsx), so navigating to one fetches a JS file by content hash,
 *  and a new deploy removes the old hashes. The fix is just a reload —
 *  it re-fetches the current index.html with the right chunk references —
 *  not the generic "something went wrong" treatment below, which reads to
 *  a non-technical user like the app itself is broken. */
function isStaleChunkError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically imported module/i.test(
    error.message
  );
}

// One auto-reload attempt per page load — a session flag, not persisted,
// so it can't loop forever if the deployed chunk is somehow never fixed
// (falls through to the normal error screen on the second occurrence).
const RELOAD_GUARD_KEY = 'theranet:chunk-reload-attempted';

/**
 * Last-resort catch for render-time crashes. Without this, a bug in any
 * component turns the whole app into a blank white screen — the single
 * worst outcome for a non-technical user with no console to check.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportError(error, 'react-render');
    if (isStaleChunkError(error) && !sessionStorage.getItem(RELOAD_GUARD_KEY)) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
      location.reload();
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto mt-24 max-w-md space-y-3 rounded-[10px] border border-[var(--rust)] bg-[var(--rust-light)] p-6 text-center text-sm text-[var(--rust)]">
          <p className="text-base font-medium">Something went wrong.</p>
          <p>
            Try reloading the page. If it keeps happening, tell your admin — nothing you've saved
            has been lost.
          </p>
          <button type="button" className={`${btnPrimary} w-full`} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
