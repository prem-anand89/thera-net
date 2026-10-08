const RELOAD_GUARD_KEY = 'theranet:chunk-reload-attempted';
const RELOAD_COOLDOWN_MS = 60_000;

/** A lazy route's JS file no longer exists — the open tab is running an older deploy. */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|Failed to load module script|error loading dynamically imported module/i.test(
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

interface NavigationRouter {
  subscribe(
    event: 'onBeforeNavigate',
    fn: (e: { toLocation: { href: string } }) => void
  ): () => void;
}

/**
 * The service worker takes over open tabs on every deploy (skipWaiting +
 * clients.claim) and deletes the previous precache, so the page already on
 * screen holds chunk hashes that no longer exist and the next lazy-loaded tab
 * crashes. Instead of waiting for that crash:
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
