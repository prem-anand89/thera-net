import { btnPrimary } from '@/components/ui';
import { useInstallState } from './useInstallState';

export function InstallPrompt() {
  const { standalone, iosSafari, canPromptInstall, promptInstall } = useInstallState();
  if (standalone) return null;
  if (canPromptInstall) {
    return (
      <button type="button" className={btnPrimary} onClick={() => void promptInstall()}>
        Install app
      </button>
    );
  }
  if (iosSafari) {
    return (
      <p className="text-xs text-[var(--muted)]">
        To install: tap Share, then Add to Home Screen. You'll sign in again in the installed app, and your data will sync.
      </p>
    );
  }
  return (
    <p className="text-xs text-[var(--muted)]">
      To install: open your browser menu and look for "Install app" or "Add to Home Screen". You'll sign in again in the installed app.
    </p>
  );
}
