import { useEffect, useState } from 'react';

export const PHONE_MEDIA_QUERY = '(max-width: 46.49rem)';

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(PHONE_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(PHONE_MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent) => {
      setIsPhone(e.matches);
    };

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else if (typeof (mql as unknown as { addListener?: (h: (e: MediaQueryListEvent) => void) => void }).addListener === 'function') {
      const legacyMql = mql as unknown as {
        addListener: (h: (e: MediaQueryListEvent) => void) => void;
        removeListener: (h: (e: MediaQueryListEvent) => void) => void;
      };
      legacyMql.addListener(handler);
      return () => legacyMql.removeListener(handler);
    }
  }, []);

  return isPhone;
}
