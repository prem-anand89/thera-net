import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { inputCls } from '@/components/ui';

export type SearchableOption = {
  value: string;
  label: string;
  group?: string;
  title?: string;
  subtitle?: string;
  price?: string;
};

/** Case-insensitive match on the option label or its group heading. */
export function filterSearchableOptions(options: SearchableOption[], query: string): SearchableOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (o) =>
      o.label.toLowerCase().includes(needle) ||
      (o.title ?? '').toLowerCase().includes(needle) ||
      (o.subtitle ?? '').toLowerCase().includes(needle) ||
      (o.group ?? '').toLowerCase().includes(needle)
  );
}

function SearchIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Type to search…',
  hideLabel = false,
  variant = 'boxed',
  inputClassName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  hideLabel?: boolean;
  variant?: 'boxed' | 'embedded';
  inputClassName?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => filterSearchableOptions(options, q), [options, q]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchableOption[]>();
    for (const item of filtered) {
      const key = item.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQ('');
  }

  const isEmbedded = variant === 'embedded';

  return (
    <div className="block" ref={rootRef}>
      {!hideLabel && label ? (
        <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      ) : null}
      <div className="relative">
        {isEmbedded && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
            <SearchIcon className="h-4 w-4" />
          </span>
        )}
        <input
          className={
            inputClassName ||
            (isEmbedded
              ? 'w-full rounded-lg border border-[var(--border)] bg-[var(--paper)] py-2 pl-9 pr-8 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] shadow-2xs transition-all focus:border-[var(--teal)] focus:bg-[var(--surface)] focus:outline-none'
              : inputCls)
          }
          role="combobox"
          aria-label={label || 'Service'}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={selected ? (selected.title ?? selected.label) : placeholder}
          value={open ? q : (selected ? (selected.title ?? selected.label) : '')}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQ('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQ('');
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const first = filtered[0];
              if (first) pick(first.value);
            }
          }}
        />
        {open && q && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]"
            onClick={() => setQ('')}
          >
            ✕
          </button>
        )}
        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg divide-y divide-[var(--border)]/30"
          >
            {filtered.length === 0 ? (
              <li className="px-3.5 py-3 text-xs text-center text-[var(--muted)]">No matching services found</li>
            ) : (
              groups.flatMap(([group, items]) => [
                group ? (
                  <li
                    key={`g-${group}`}
                    className="sticky top-0 z-10 px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] bg-[var(--paper)]/80 backdrop-blur-xs"
                  >
                    {group}
                  </li>
                ) : null,
                ...items.map((i) => {
                  const isSelected = i.value === value;
                  return (
                    <li key={i.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors ${
                          isSelected
                            ? 'bg-[var(--teal-light)] text-[var(--teal-strong)] font-medium'
                            : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pick(i.value);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-snug truncate">
                            {i.title ?? i.label}
                          </div>
                          {i.subtitle && (
                            <div className="text-xs text-[var(--muted)] truncate mt-0.5">
                              {i.subtitle}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {i.price && (
                            <span
                              className={`font-num text-xs sm:text-sm font-semibold ${
                                isSelected ? 'text-[var(--teal-strong)]' : 'text-[var(--ink)]'
                              }`}
                            >
                              {i.price}
                            </span>
                          )}
                          {isSelected && (
                            <span className="text-xs font-bold text-[var(--teal)]" aria-hidden="true">
                              ✓
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                }),
              ])
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
