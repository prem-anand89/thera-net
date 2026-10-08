import { Component, useEffect, type ReactNode } from 'react';
import { reportError } from '@/lib/errorReporting';
import { isStaleChunkError, reloadForNewVersion } from './appUpdate';
import { btnPrimary } from '@/components/ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

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
    if (isStaleChunkError(error)) reloadForNewVersion();
  }

  render() {
    if (this.state.error) {
      return <ErrorFallbackUI />;
    }
    return this.props.children;
  }
}

export function ErrorFallbackUI() {
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

export function RouterErrorFallback({ error }: { error: Error }) {
  useEffect(() => {
    reportError(error, 'router-error');
    if (isStaleChunkError(error)) reloadForNewVersion();
  }, [error]);

  return <ErrorFallbackUI />;
}
