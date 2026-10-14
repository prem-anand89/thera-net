/**
 * State and policy for "a new version is ready" prompts.
 *
 * The service worker no longer takes over open tabs on its own (see sw.ts):
 * a new deploy installs and *waits*, the tab keeps running the version it
 * loaded, and the user (or a safe moment) decides when to switch. This file
 * holds the pure pieces — timings, banner rules, the "is it safe to reload
 * now" heuristic — so they can be unit-tested without a service worker.
 */

/** "Later" hides the banner this long, then it comes back. */
export const SNOOZE_MS = 4 * 60 * 60 * 1000;
/** After this long waiting, "Later" is no longer offered. */
export const STICKY_AFTER_MS = 8 * 60 * 60 * 1000;
/** A tab hidden this long, with nothing unsaved, is reloaded onto the new version. */
export const BACKGROUND_APPLY_MS = 2 * 60 * 1000;
/** How often a visible tab asks the host whether sw.js changed. */
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Never check more often than this (focus/visibility checks included). */
export const MIN_CHECK_GAP_MS = 15 * 60 * 1000;

export interface UpdateState {
  /** When this tab first learned a new version was waiting; null = up to date. */
  waitingSince: number | null;
  snoozedUntil: number | null;
  applying: boolean;
}

const INITIAL: UpdateState = { waitingSince: null, snoozedUntil: null, applying: false };
let state: UpdateState = { ...INITIAL };
const subscribers = new Set<() => void>();

function set(next: Partial<UpdateState>) {
  state = { ...state, ...next };
  subscribers.forEach((fn) => fn());
}

export const updateStore = {
  get: () => state,
  subscribe(fn: () => void) {
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  },
  markWaiting(now = Date.now()) {
    if (state.waitingSince === null) set({ waitingSince: now });
  },
  snooze(now = Date.now()) {
    set({ snoozedUntil: now + SNOOZE_MS });
  },
  setApplying(applying: boolean) {
    set({ applying });
  },
  reset() {
    set({ ...INITIAL });
  },
};

export function isSticky(s: UpdateState, now: number): boolean {
  return s.waitingSince !== null && now - s.waitingSince >= STICKY_AFTER_MS;
}

export function bannerVisible(s: UpdateState, now: number): boolean {
  if (s.waitingSince === null) return false;
  if (isSticky(s, now)) return true;
  return s.snoozedUntil === null || now >= s.snoozedUntil;
}

export function shouldCheckForUpdate(input: {
  now: number;
  lastCheck: number;
  visible: boolean;
  online: boolean;
}): boolean {
  return input.visible && input.online && input.now - input.lastCheck >= MIN_CHECK_GAP_MS;
}

/**
 * Heuristic for "the user may have unsaved work on screen": an open dialog or
 * sheet, or a text field with something typed in it. The app has no global
 * dirty-form registry, so this errs on the side of *not* reloading.
 */
export function isBusyDocument(doc: Document): boolean {
  if (doc.querySelector('[role="dialog"], [aria-modal="true"]')) return true;
  const el = doc.activeElement;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return 'value' in el && String(el.value).length > 0;
  }
  return false;
}

/** Safe to switch versions without asking: hidden for a while, all synced, nothing open. */
export function canApplyInBackground(input: {
  hidden: boolean;
  pendingSync: number;
  busy: boolean;
}): boolean {
  return input.hidden && input.pendingSync === 0 && !input.busy;
}
