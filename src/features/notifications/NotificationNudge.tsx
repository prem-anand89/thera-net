import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSession } from '@/app/useSession';
import { btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import { enablePushForThisDevice, pushState, type PushState } from './pushSubscription';

export const PUSH_NUDGE_KEY = 'pushNudgeDismissedAt';
const RE_ASK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A quiet Workspace reminder to turn on notifications on this device. Shown
 * only when this device hasn't decided yet, and hidden for 30 days after
 * "Not now". The browser prompt is asked from the button tap, which iOS
 * requires.
 */
export function NotificationNudge() {
  const { session } = useSession();
  const userId = session?.user?.id;
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dismissedAt = useLiveQuery(async () => (await db.meta.get(PUSH_NUDGE_KEY))?.value ?? null, []);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  if (state !== 'default' || !userId || dismissedAt === undefined) return null;
  if (dismissedAt && Date.now() - new Date(dismissedAt).getTime() < RE_ASK_AFTER_MS) return null;

  async function turnOn() {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await enablePushForThisDevice();
      setState(await pushState());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function notNow() {
    await db.meta.put({ key: PUSH_NUDGE_KEY, value: new Date().toISOString() });
  }

  return (
    <section
      aria-label="Turn on notifications"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--teal-light)] bg-[var(--teal-mist)] px-4 py-3"
    >
      <p className="min-w-[14rem] flex-1 text-sm text-[var(--ink)]">
        <span className="font-medium">Get alerts on this device.</span>{' '}
        <span className="text-[var(--muted)]">
          We’ll tell you about new booking requests and schedule changes, with no patient names.
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void turnOn()}>
          {busy ? 'Turning on…' : 'Turn on'}
        </button>
        <button type="button" className={btnSecondary} onClick={() => void notNow()}>
          Not now
        </button>
      </div>
      {error && (
        <div className="w-full">
          <ErrorNote message={error} />
        </div>
      )}
    </section>
  );
}
