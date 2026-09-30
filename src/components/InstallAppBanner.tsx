import { useInstallPrompt } from '@/app/useInstallPrompt';

/** Gentle, dismissible "add to home screen" nudge for phone users. */
export function InstallAppBanner({ message = 'Open your schedule in one tap — add Thera.Net to your home screen.' }: { message?: string }) {
  const { show, mode, install, dismiss } = useInstallPrompt();
  if (!show) return null;
  return (
    <div role="region" aria-label="Install app" className="flex items-start gap-3 rounded-xl border border-[var(--teal)]/30 bg-[var(--teal-light)] p-3">
      <span className="text-xl" aria-hidden>📲</span>
      <div className="min-w-0 flex-1 text-sm text-[var(--ink)]">
        <p>{message}</p>
        {mode === 'ios' && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            In Safari, tap <strong>Share</strong> <span aria-hidden>⬆︎</span>, then <strong>Add to Home Screen</strong>.
          </p>
        )}
        <div className="mt-2 flex gap-3">
          {mode === 'prompt' && (
            <button type="button" className="min-h-9 rounded-lg bg-[var(--teal)] px-3 text-xs font-medium text-white" onClick={() => void install()}>
              Install app
            </button>
          )}
          <button type="button" className="min-h-9 text-xs font-medium text-[var(--muted)]" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
