import { useSyncExternalStore } from 'react';

/** Matches the `tab:` breakpoint (46.5rem) — below it, wide tables become card lists. */
const QUERY = '(max-width: 743.98px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/** True on phone-width screens. Renders the desktop layout where matchMedia is missing (tests, SSR). */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
