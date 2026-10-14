import { useEffect, useRef } from 'react';

/**
 * A registry of "this screen holds input that isn't saved yet". Anything that
 * would reload or close things behind the user's back (the update system's
 * background switch) asks `hasUnsavedWork()` instead of guessing from the DOM.
 */
const probes = new Set<() => boolean>();

export function hasUnsavedWork(): boolean {
  for (const probe of probes) {
    try {
      if (probe()) return true;
    } catch {
      // a broken probe must not block the others
    }
  }
  return false;
}

/** Registers `probe` for the lifetime of the component. Pass a function so it always reads current state. */
export function useUnsavedWorkProbe(probe: () => boolean): void {
  const ref = useRef(probe);
  ref.current = probe;
  useEffect(() => {
    const fn = () => ref.current();
    probes.add(fn);
    return () => {
      probes.delete(fn);
    };
  }, []);
}
