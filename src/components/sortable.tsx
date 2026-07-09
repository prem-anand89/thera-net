import { useState, type ReactNode } from 'react';
import { th, thNum } from './ui';

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
  toggle: (k: K, firstDir?: SortDir) => void;
}

/** Column-sort state for a table: clicking a new column sorts by it, clicking again flips direction. */
export function useSort<K extends string>(defaultKey: K, defaultDir: SortDir = 'asc'): SortState<K> {
  const [key, setKey] = useState<K>(defaultKey);
  const [dir, setDir] = useState<SortDir>(defaultDir);
  return {
    key,
    dir,
    toggle(k, firstDir = 'asc') {
      if (k === key) {
        setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setKey(k);
        setDir(firstDir);
      }
    },
  };
}

export function applySort<T, K extends string>(
  rows: T[],
  comparators: Record<K, (a: T, b: T) => number>,
  sort: { key: K; dir: SortDir }
): T[] {
  const out = [...rows].sort(comparators[sort.key]);
  if (sort.dir === 'desc') out.reverse();
  return out;
}

export function byString<T>(get: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => get(a).localeCompare(get(b));
}

export function byNumber<T>(get: (row: T) => number): (a: T, b: T) => number {
  return (a, b) => get(a) - get(b);
}

export function SortHeader<K extends string>({
  label,
  k,
  sort,
  numeric = false,
  firstDir,
}: {
  label: ReactNode;
  k: K;
  sort: SortState<K>;
  numeric?: boolean;
  firstDir?: SortDir;
}) {
  const active = sort.key === k;
  return (
    <th className={numeric ? thNum : th}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => sort.toggle(k, firstDir)}
      >
        {label}
        <span aria-hidden className="inline-block w-2 text-[9px]">
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}
