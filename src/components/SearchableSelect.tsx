import { useMemo, useState } from 'react';
import { Field, inputCls } from '@/components/ui';

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; group?: string }[];
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    const selected = options.filter((o) => o.value === value);
    const hits = options.filter((o) => o.label.toLowerCase().includes(needle));
    const seen = new Set(hits.map((o) => o.value));
    return [...hits, ...selected.filter((o) => !seen.has(o.value))];
  }, [options, q, value]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const key = item.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <Field label={label}>
      {options.length > 8 && (
        <input
          className={`${inputCls} mb-1.5`}
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={`Search ${label}`}
        />
      )}
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{placeholder}</option>
        {groups.map(([group, items]) =>
          group ? (
            <optgroup key={group} label={group}>
              {items.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ) : (
            items.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))
          )
        )}
      </select>
    </Field>
  );
}
