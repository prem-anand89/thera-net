import { useEffect, useState } from 'react';

/** Chrome/Edge/Samsung's install event (not in the TS DOM lib). */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'thera-net:install-nudge-dismissed';
const VISITS_KEY = 'thera-net:install-nudge-visits';
/** "Not now" hides the nudge for two weeks, then it may come back once more. */
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

// Captured once at module load so an event fired before any component mounts isn't lost.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    listeners.forEach((notify) => notify());
  });
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the nudge just shows again next time.
  }
}

export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function isIos(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}

/**
 * Whether to show the "add to home screen" nudge, and how to install.
 * Phones only, not already installed, from the second visit on, until
 * dismissed on this device. Dismissal is a per-device convenience, so
 * localStorage (with try/catch) is the right place for it.
 */
export function useInstallPrompt() {
  const [canPrompt, setCanPrompt] = useState(() => deferred !== null);
  const [dismissed, setDismissed] = useState(() => {
    const at = Number(read(DISMISS_KEY) ?? '0');
    return at > 0 && Date.now() - at < SNOOZE_MS;
  });
  const [visits] = useState(() => {
    const next = Number(read(VISITS_KEY) ?? '0') + 1;
    write(VISITS_KEY, String(next));
    return next;
  });

  useEffect(() => {
    const notify = () => setCanPrompt(deferred !== null);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);

  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 743px)').matches === true;
  const show = phone && !isInstalled() && !dismissed && visits >= 2 && (canPrompt || isIos());

  return {
    show,
    /** Android/Chrome: native install dialog available. iPhone: show instructions. */
    mode: canPrompt ? ('prompt' as const) : ('ios' as const),
    async install() {
      if (!deferred) return;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      setCanPrompt(false);
      if (choice.outcome === 'accepted') setDismissed(true);
    },
    dismiss() {
      write(DISMISS_KEY, String(Date.now()));
      setDismissed(true);
    },
  };
}
