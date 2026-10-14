const RELOAD_GUARD_KEY = 'theranet:chunk-reload-attempted';
const RELOAD_COOLDOWN_MS = 60_000;

/** A lazy route's JS file no longer exists — the open tab is running an older deploy.
 *  Browsers report this very differently: Chrome/Edge say "Failed to fetch
 *  dynamically imported module", Firefox "error loading dynamically imported
 *  module", and Safari/WebKit either "Importing a module script failed" or,
 *  for the plain network-level failure case, just "Load failed" — WebKit's
 *  generic fetch-rejection message, not module-import-specific wording.
 *  Matched as an exact message (anchored), not a substring, since on its own
 *  it's generic enough to otherwise risk matching an unrelated crash. */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|Failed to load module script|error loading dynamically imported module|^Load failed$/i.test(
    message
  );
}

/**
 * Reload (or hard-navigate to `target`) to pick up the current deploy, at most
 * once per minute so a genuinely broken deploy can't loop. Time-based rather
 * than a once-per-tab-session flag: a flag that's never cleared made every
 * later stale-chunk crash in the same tab fall through to the error screen.
 */
export function reloadForNewVersion(target?: string): boolean {
  // A waiting service worker still serves the OLD version on a plain reload,
  // so switch to it first; it reloads the page itself once it takes over.
  if (waitingActivator?.()) return true;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY));
    if (last && Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable — reload anyway; the browser's own navigation
    // will land on the current deploy.
  }
  if (target) location.assign(target);
  else location.reload();
  return true;
}

let waitingActivator: (() => boolean) | null = null;
/** Set by registerServiceWorker: tells a waiting worker to take over (true if it did). */
export function setWaitingActivator(fn: () => boolean): void {
  waitingActivator = fn;
}

let updateInProgress = false;
/** The banner / account menu is already switching versions and reloading. */
export function markUpdateInProgress(): void {
  updateInProgress = true;
}
/** The switch did not happen after all: other tabs' recovery handler works again. */
export function clearUpdateInProgress(): void {
  updateInProgress = false;
}

interface NavigationRouter {
  subscribe(
    event: 'onBeforeNavigate',
    fn: (e: { toLocation: { href: string } }) => void
  ): () => void;
}

/**
 * A new deploy's service worker now waits until the user accepts the update
 * banner (see registerServiceWorker.ts), so the page on screen keeps working.
 * It can still happen that ANOTHER tab accepted the update and the worker took
 * over this one too; this tab then holds chunk hashes that no longer exist
 * and its next lazy-loaded route would crash. Instead of waiting for that crash:
 *  - a failed lazy import (`vite:preloadError`) reloads once, silently;
 *  - when a new worker takes control of a page that already had one, the next
 *    in-app navigation becomes a full page load of its target (or an
 *    immediate reload if the tab is in the background), so the user never
 *    sees the error screen and no in-progress form is interrupted.
 */
export function installAppUpdateHandling(router: NavigationRouter): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewVersion()) event.preventDefault();
  });

  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  if (!hadController) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateInProgress) return;
    if (document.visibilityState === 'hidden') {
      reloadForNewVersion();
      return;
    }
    const unsubscribe = router.subscribe('onBeforeNavigate', (e) => {
      unsubscribe();
      reloadForNewVersion(e.toLocation.href);
    });
  });
}
