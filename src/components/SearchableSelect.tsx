import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { inputCls } from '@/components/ui';

export type SearchableOption = { value: string; label: string; group?: string };

/** Case-insensitive match on the option label or its group heading. */
export function filterSearchableOptions(options: SearchableOption[], query: string): SearchableOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (o) => o.label.toLowerCase().includes(needle) || (o.group ?? '').toLowerCase().includes(needle)
  );
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Type to search…',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
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

  return (
    <div className="block" ref={rootRef}>
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      <div className="relative">
        <input
          className={inputCls}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={selected ? selected.label : placeholder}
          value={open ? q : (selected?.label ?? '')}
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
        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-2)]"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-[var(--muted)]">No matches</li>
            ) : (
              groups.flatMap(([group, items]) => [
                group ? (
                  <li
                    key={`g-${group}`}
                    className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]"
                  >
                    {group}
                  </li>
                ) : null,
                ...items.map((i) => (
                  <li key={i.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i.value === value}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-[var(--teal-light)] ${
                        i.value === value ? 'bg-[var(--teal-light)] text-[var(--teal)]' : 'text-[var(--ink)]'
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(i.value);
                      }}
                    >
                      {i.label}
                    </button>
                  </li>
                )),
              ])
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
