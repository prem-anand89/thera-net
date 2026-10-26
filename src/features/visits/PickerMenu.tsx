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
  searchAbove = 8,
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
  /** With more options than this the list gets a small search box at the top (a big team is hard to scan). */
  searchAbove?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Opens upward when the list would run under the fixed bottom bar (or off the screen).
  const [above, setAbove] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const searchable = options.length > searchAbove;
  const shown = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

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

  // Opening puts the focus on the search box (big teams) or on the current choice, so the arrow keys start there.
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    if (searchable) {
      searchRef.current?.focus();
      return;
    }
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
    // Home / End inside the search box move its caret; only the arrows leave it for the list.
    if (e.target === searchRef.current && (e.key === 'Home' || e.key === 'End')) return;
    e.preventDefault();
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const last = shown.length - 1;
    if (last < 0) return;
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
        onClick={() => {
          if (!open) {
            const rect = triggerRef.current?.getBoundingClientRect();
            // Rows are 36px; a search box, the caption and padding add about 80px; the bottom bar needs ~96px.
            const needed = Math.min(256, options.length * 36 + 44 + (searchable ? 40 : 0)) + 96;
            setAbove(Boolean(rect) && window.innerHeight - rect!.bottom < needed && rect!.top > needed - 96);
          }
          setOpen((v) => !v);
        }}
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
          className={`absolute left-0 z-30 max-h-64 w-max min-w-[13rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg ${
            above ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          <div className="px-3 pb-1 pt-1.5 text-xs text-[var(--muted)]">{caption}</div>
          {searchable && (
            <div className="px-1 pb-1">
              <input
                ref={searchRef}
                type="search"
                aria-label={`Search: ${caption}`}
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm focus:border-[var(--teal)] focus:outline-none"
              />
            </div>
          )}
          {shown.length === 0 && <div className="px-3 py-2 text-xs text-[var(--muted)]">No match</div>}
          {shown.map((opt, i) => {
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
