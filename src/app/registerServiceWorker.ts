import { syncEngine } from '@/sync/engine';
import { syncStatus } from '@/sync/status';
import { clearUpdateInProgress, markUpdateInProgress, setWaitingActivator } from './appUpdate';
import { answerTabPresence, otherTabsOpen } from './tabPresence';
import { hasUnsavedWork } from '@/lib/unsavedWork';
import {
  BACKGROUND_APPLY_MS,
  CHECK_INTERVAL_MS,
  canApplyInBackground,
  isBusyDocument,
  shouldCheckForUpdate,
  updateStore,
} from './updateStore';

const COLD_START_GUARD_KEY = 'theranet:cold-start-update';
const SYNC_TIMEOUT_MS = 8_000;
const ACTIVATE_TIMEOUT_MS = 5_000;

let registration: ServiceWorkerRegistration | null = null;
let lastCheck = Date.now();

let activating = false;

/**
 * Tells the waiting worker to take over; the page reloads once it has (see the
 * single `controllerchange` listener in `registerServiceWorker`). Idempotent.
 * `reloadIfStuck`: if the worker never takes over, reload anyway — for the
 * stale-chunk recovery path, where the page is already broken.
 */
function activateWaiting(options: { reloadIfStuck?: boolean } = {}): boolean {
  if (activating) return true;
  const waiting = registration?.waiting;
  if (!waiting || !navigator.serviceWorker.controller) return false;
  activating = true;
  updateStore.setApplying(true);
  markUpdateInProgress();
  waiting.postMessage({ type: 'SKIP_WAITING' });
  window.setTimeout(() => {
    // Still here: the worker did not take over. Stop showing "Updating…", let
    // other tabs' handlers work again, and recover a broken page with a reload.
    activating = false;
    updateStore.setApplying(false);
    clearUpdateInProgress();
    if (options.reloadIfStuck) location.reload();
  }, ACTIVATE_TIMEOUT_MS);
  return true;
}

async function syncBeforeUpdate(): Promise<void> {
  const status = syncStatus.get();
  if (!status.pending || status.online === false) return;
  try {
    await Promise.race([
      syncEngine.sync(),
      new Promise<void>((resolve) => window.setTimeout(resolve, SYNC_TIMEOUT_MS)),
    ]);
  } catch {
    // Unsynced changes stay in the local store and sync after the reload.
  }
}

/** Banner "Refresh": push pending changes first, then switch to the new version. */
export async function applyUpdateNow(): Promise<void> {
  updateStore.setApplying(true);
  await syncBeforeUpdate();
  if (!activateWaiting()) location.reload();
}

/**
 * Account-menu "check for updates": ask the host now, wait for a found update
 * to finish installing, then switch to it (or just reload when there is none).
 */
export async function checkForUpdateAndReload(): Promise<void> {
  lastCheck = Date.now();
  try {
    await registration?.update();
    const installing = registration?.installing;
    if (installing && !registration?.waiting) {
      await new Promise<void>((resolve) => {
        const done = () => {
          if (installing.state === 'installed' || installing.state === 'redundant') resolve();
        };
        installing.addEventListener('statechange', done);
        window.setTimeout(resolve, 10_000);
      });
    }
  } catch {
    // Offline or blocked — fall through to a plain reload.
  }
  await syncBeforeUpdate();
  if (!activateWaiting()) location.reload();
}

function checkNow(): void {
  if (!registration) return;
  const now = Date.now();
  if (!shouldCheckForUpdate({ now, lastCheck, visible: document.visibilityState === 'visible', online: navigator.onLine })) {
    return;
  }
  lastCheck = now;
  registration.update().catch(() => {});
}

function watchForUpdates(reg: ServiceWorkerRegistration): void {
  const noticeWaiting = (worker: ServiceWorker | null) => {
    if (worker && navigator.serviceWorker.controller) updateStore.markWaiting();
  };
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') noticeWaiting(installing);
    });
  });

  // An update already installing when this page loaded (its statechange would
  // otherwise be missed until the next load).
  const pendingInstall = reg.installing;
  if (pendingInstall) {
    pendingInstall.addEventListener('statechange', () => {
      if (pendingInstall.state === 'installed') noticeWaiting(pendingInstall);
    });
  }

  // A tab opened while an update was already waiting: nothing is in progress
  // here, so switch now (once per minute at most, so a broken worker can't
  // loop) — but only if no other tab is open, since the switch takes over every
  // tab and another one may hold unsaved input.
  if (reg.waiting && navigator.serviceWorker.controller) {
    let recent = false;
    try {
      const last = Number(sessionStorage.getItem(COLD_START_GUARD_KEY));
      recent = !!last && Date.now() - last < 60_000;
      if (!recent) sessionStorage.setItem(COLD_START_GUARD_KEY, String(Date.now()));
    } catch {
      // sessionStorage unavailable — show the banner instead of auto-applying.
      recent = true;
    }
    if (recent) {
      updateStore.markWaiting();
    } else {
      void otherTabsOpen().then((others) => {
        if (others) updateStore.markWaiting();
        else activateWaiting();
      });
    }
  }

  window.setInterval(checkNow, CHECK_INTERVAL_MS);

  let backgroundTimer: number | undefined;
  document.addEventListener('visibilitychange', () => {
    window.clearTimeout(backgroundTimer);
    if (document.visibilityState === 'visible') {
      checkNow();
      return;
    }
    if (updateStore.get().waitingSince === null) return;
    backgroundTimer = window.setTimeout(() => {
      if (
        canApplyInBackground({
          hidden: document.visibilityState === 'hidden',
          pendingSync: syncStatus.get().pending ?? 0,
          busy: isBusyDocument(document) || hasUnsavedWork(),
        })
      ) {
        // Switching takes over every tab; only do it unprompted when this is the only one.
        void otherTabsOpen().then((others) => {
          if (!others && document.visibilityState === 'hidden') activateWaiting();
        });
      }
    }, BACKGROUND_APPLY_MS);
  });
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg;
        setWaitingActivator(() => activateWaiting({ reloadIfStuck: true }));
        answerTabPresence();
        // One listener for the page's lifetime: our own switch reloads; a switch
        // made by another tab leaves this tab's banner stale, so clear it.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (activating) location.reload();
          else updateStore.reset();
        });
        watchForUpdates(reg);
      })
      .catch(() => {});
  });
}
