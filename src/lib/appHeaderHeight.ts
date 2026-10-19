/**
 * Publishes the sticky app header's height (safe-area padding included) as
 * `--app-header-h` on <html>, so page-scrolling grids can stick their column
 * headers right under it instead of relying on a hard-coded number.
 */
let observer: ResizeObserver | null = null;

/** Callback ref for the app header. */
export function trackAppHeaderHeight(element: HTMLElement | null) {
  observer?.disconnect();
  observer = null;
  if (!element || typeof ResizeObserver === 'undefined') return;
  const publish = () => document.documentElement.style.setProperty('--app-header-h', `${element.offsetHeight}px`);
  publish();
  observer = new ResizeObserver(publish);
  observer.observe(element);
}

/** The measured header height in px, or `fallback` before it has been measured. */
export function appHeaderHeight(fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-h'));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
