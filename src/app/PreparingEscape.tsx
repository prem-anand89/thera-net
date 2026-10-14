import { useEffect, useState } from 'react';
import { syncEngine } from '@/sync/engine';
import { signOutSafely } from './signOut';
import { btnPrimary, btnSecondary } from '@/components/ui';

export const PREPARING_ESCAPE_AFTER_MS = 15_000;

/** Under the "Preparing…" screen: after a while, a way out instead of waiting forever on a flaky connection. */
export function PreparingEscape({ error }: { error?: string | null }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), PREPARING_ESCAPE_AFTER_MS);
    return () => window.clearTimeout(id);
  }, []);
  if (!slow) return null;
  return (
    <div className="mt-3 space-y-2 text-center">
      <p className="text-xs text-[var(--muted)]">
        This is taking longer than usual{error ? ` (${error})` : ''}. Check your connection.
      </p>
      <div className="flex justify-center gap-2">
        <button type="button" className={btnPrimary} onClick={() => syncEngine.schedule(0)}>
          Retry
        </button>
        <button type="button" className={btnSecondary} onClick={() => void signOutSafely()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
