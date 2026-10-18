import { useEffect, useState } from 'react';

/** Tailwind `tab` breakpoint is 46.5rem; phone is strictly below that */
export const PHONE_MEDIA_QUERY = '(max-width: 46.49rem)';

function getInitialIsPhone(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(PHONE_MEDIA_QUERY).matches;
}

/**
 * Hook to detect if the current viewport is a phone (< 46.5rem).
 * Matches Tailwind's `tab:` breakpoint exactly.
 * Evaluates matchMedia synchronously on initial state to prevent UI flash.
 */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(getInitialIsPhone);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(PHONE_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      setIsPhone(e.matches);
    };

    setIsPhone(mql.matches);

    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, []);

  return isPhone;
}
