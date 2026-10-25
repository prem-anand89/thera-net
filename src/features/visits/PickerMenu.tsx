import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface PickerOption {
  value: string;
  label: string;
  /** A small colour dot before the name (a therapist's schedule colour). */
  dotColor?: string;
}

/**
 * A small pick-one list under a button, in the app's own style: a caption saying what is being chosen, one row per
 * person (colour dot, name, a tick on the current one), arrow keys / Enter / Escape, closes on a click outside.
 * It replaces the browser's own dropdown list, which looks different on every device and can't be styled.
 */
export function PickerMenu({
  value,
  options,
  onChange,
  ariaLabel,
  caption,
  triggerClassName,
  renderTrigger,
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  /** Names the button for screen readers: "Done by: Dr Sneha". */
  ariaLabel: string;
  /** The small heading inside the open list ("Who did this service"). */
  caption: string;
  triggerClassName: string;
  /** What the button shows (icon, label, name, arrow). */
  renderTrigger: (selected: PickerOption | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  // Opening puts the focus on the current choice, so the arrow keys start from it.
  useEffect(() => {
    if (!open) return;
    const at = Math.max(0, options.findIndex((o) => o.value === value));
    itemRefs.current[at]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      // Inside a dialog (Edit visit) Escape closes this list only, not the whole dialog.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const last = options.length - 1;
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowDown' ? Math.min(last, current + 1) : Math.max(0, current - 1);
    itemRefs.current[next]?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${ariaLabel}: ${selected?.label ?? 'none'}`}
        className={triggerClassName}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {renderTrigger(selected)}
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={caption}
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-full z-30 mt-1.5 max-h-64 w-max min-w-[13rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
        >
          <div className="px-3 pb-1 pt-1.5 text-xs text-[var(--muted)]">{caption}</div>
          {options.map((opt, i) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(opt.value)}
                className={`flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm focus:outline-none focus-visible:bg-[var(--paper)] ${
                  active ? 'bg-[var(--teal-light)] font-medium text-[var(--teal)]' : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                }`}
              >
                {opt.dotColor && (
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: opt.dotColor }} />
                )}
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {active && (
                  <span aria-hidden="true" className="shrink-0 text-xs">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
