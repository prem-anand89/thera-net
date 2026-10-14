import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true'
  );
}

/** Where Tab/Shift+Tab should land so focus wraps inside the dialog; null = let the browser move it. */
export function wrapFocusTarget(
  items: HTMLElement[],
  active: Element | null,
  shift: boolean
): HTMLElement | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  if (shift && (active === first || !items.includes(active as HTMLElement))) return last;
  if (!shift && (active === last || !items.includes(active as HTMLElement))) return first;
  return null;
}

// Open dialogs, oldest first. A confirm opened over a sheet is on top, so
// Escape closes only that one.
const stack: symbol[] = [];

/**
 * Keyboard and focus behaviour every modal should have: Escape closes the
 * topmost one, Tab stays inside it, focus moves into it on open and returns to
 * whatever opened it on close. Attach the returned ref to the dialog panel.
 */
export function useDialogBehavior<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol('dialog');
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (panel && !panel.contains(document.activeElement)) {
      const first = focusableIn(panel)[0];
      (first ?? panel).focus({ preventScroll: true });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && ref.current) {
        const target = wrapFocusTarget(focusableIn(ref.current), document.activeElement, e.shiftKey);
        if (target) {
          e.preventDefault();
          target.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  return ref;
}
