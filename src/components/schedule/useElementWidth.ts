import { useEffect, useState } from 'react';

/**
 * Measured width (px) of an element, kept current with a ResizeObserver.
 * Returns `fallback` until measured, and when ResizeObserver is missing (jsdom).
 */
export function useElementWidth(element: HTMLElement | null, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}
