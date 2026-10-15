import { useState } from 'react';
import { chipSelect, chipSelectChevron } from '@/components/ui';

export const PAGE_SIZES = [10, 25] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

function readSize(storageKey: string, fallback: PageSize): PageSize {
  try {
    const n = Number(localStorage.getItem(`pageSize:${storageKey}`));
    return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Page-by-page view of a long list. `resetKey` identifies the current filter/sort/search:
 * when it changes the list returns to page 1, derived at render (no effect, no flash of a
 * stale page). The page is also clamped so a shrinking list never shows an empty page.
 * The chosen page size is remembered per list (`storageKey`) on this device.
 */
export function usePagination<T>(
  items: readonly T[],
  resetKey: unknown,
  storageKey: string,
  defaultSize: PageSize = 25
) {
  const [size, setSizeState] = useState<PageSize>(() => readSize(storageKey, defaultSize));
  const [state, setState] = useState({ key: resetKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const requested = Object.is(state.key, resetKey) ? state.page : 1;
  const page = Math.min(requested, pageCount);
  const start = (page - 1) * size;
  return {
    visible: items.slice(start, start + size),
    total: items.length,
    page,
    pageCount,
    size,
    from: items.length === 0 ? 0 : start + 1,
    to: Math.min(start + size, items.length),
    setPage: (p: number) => setState({ key: resetKey, page: Math.max(1, Math.min(p, pageCount)) }),
    setSize: (s: PageSize) => {
      setSizeState(s);
      setState({ key: resetKey, page: 1 });
      try {
        localStorage.setItem(`pageSize:${storageKey}`, String(s));
      } catch {
        /* storage unavailable — the choice just isn't remembered */
      }
    },
  };
}

export type PaginationState = ReturnType<typeof usePagination>;

/** "1–25 of 143 patients · Rows 25 ▾ · ‹ Prev  Page 1 of 6  Next ›". Hidden for a list that fits the smallest page. */
export function Pager({ list, noun }: { list: PaginationState; noun: string }) {
  if (list.total <= PAGE_SIZES[0]) return null;
  const nav =
    'inline-flex min-h-8 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--surface)]';
  return (
    <nav
      aria-label={`${noun} pages`}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-[var(--muted)]"
    >
      <span>
        <span className="font-num text-[var(--ink)]">
          {list.from}–{list.to}
        </span>{' '}
        of <span className="font-num">{list.total}</span> {noun}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          Rows
          <select
            aria-label="Rows per page"
            className={chipSelect}
            style={chipSelectChevron}
            value={list.size}
            onChange={(e) => list.setSize(Number(e.target.value) as PageSize)}
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={nav} disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)}>
          ‹ Prev
        </button>
        <span aria-live="polite">
          Page <span className="font-num text-[var(--ink)]">{list.page}</span> of{' '}
          <span className="font-num">{list.pageCount}</span>
        </span>
        <button
          type="button"
          className={nav}
          disabled={list.page >= list.pageCount}
          onClick={() => list.setPage(list.page + 1)}
        >
          Next ›
        </button>
      </div>
    </nav>
  );
}
