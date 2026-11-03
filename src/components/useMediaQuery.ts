import { useEffect, useState } from 'react';

/** The `desktop:` breakpoint (62.5rem), as a media query. */
export const DESKTOP_MEDIA_QUERY = '(min-width: 62.5rem)';

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** True while `query` matches. False where `matchMedia` is missing (tests, old browsers), so phone layout is the default. */
export function useMediaQuery(query: string): boolean {
  const [hit, setHit] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setHit(e.matches);
    setHit(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return hit;
}

/** From the `desktop:` width up. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_MEDIA_QUERY);
}
