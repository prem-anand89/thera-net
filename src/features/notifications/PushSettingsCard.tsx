import { useEffect, useState } from 'react';
import { btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import { useSession } from '@/app/useSession';
import { InstallPrompt } from './InstallPrompt';
import { disablePushForThisDevice, enablePushForThisDevice, pushState, type PushState } from './pushSubscription';

export function PushSettingsCard() {
  const { session } = useSession();
  const userId = session?.user?.id;
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void pushState().then(setState);
  useEffect(refresh, []);

  if (state === null || state === 'unsupported') return null;

  const enable = async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await enablePushForThisDevice();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on notifications.');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await disablePushForThisDevice();
    } catch {
      setError('Could not turn off notifications on this device.');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Notifications on this device</h3>
      {state === 'needs-install' && (
        <>
          <p className="text-xs text-[var(--muted)]">Install the app first to turn on notifications.</p>
          <InstallPrompt />
        </>
      )}
      {state === 'default' && (
        <>
          <p className="text-xs text-[var(--muted)]">
            Get an alert when a new booking request or a schedule change comes in. We never include patient names.
          </p>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void enable()}>
            Turn on notifications
          </button>
        </>
      )}
      {state === 'on' && (
        <>
          <p className="text-xs text-[var(--muted)]">On for this device.</p>
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => void disable()}>
            Turn off
          </button>
        </>
      )}
      {state === 'denied' && (
        <p className="text-xs text-[var(--muted)]">
          Notifications are blocked. Re-enable them in your browser or phone settings.
        </p>
      )}
      <ErrorNote message={error} />
    </div>
  );
}
