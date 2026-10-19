import { useEffect, useRef, useState } from 'react';

/**
 * Phone "book an appointment" round button, floating above the bottom nav.
 * It slides away while the user scrolls down (so it never sits on the time of
 * the last card) and comes back on scroll up or at the top.
 */
export function BookFab({ onClick }: { onClick: () => void }) {
  const [hidden, setHidden] = useState(false);
  const last = useRef(new WeakMap<object, number>());

  useEffect(() => {
    const onScroll = (event: Event) => {
      const target = event.target;
      const y = target instanceof HTMLElement ? target.scrollTop : window.scrollY;
      const key = target instanceof HTMLElement ? target : window;
      const previous = last.current.get(key) ?? y;
      if (y > previous + 8 && y > 80) setHidden(true);
      else if (y < previous - 8 || y <= 80) setHidden(false);
      last.current.set(key, y);
    };
    // Capture: the schedule grid scrolls inside its own box, and scroll events do not bubble.
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  return (
    <button
      type="button"
      aria-label="Book appointment"
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      data-hidden={hidden || undefined}
      onClick={onClick}
      className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom)+0.75rem)] right-4 z-[9] flex h-14 w-14 items-center justify-center rounded-full bg-[var(--teal)] text-white shadow-lg transition duration-200 active:bg-[var(--teal-strong)] ${
        hidden ? 'pointer-events-none translate-y-24 opacity-0' : ''
      }`}
    >
      <svg aria-hidden className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}
