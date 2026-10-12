import { useState } from 'react';

/** Rows a Reports list shows before "Show more" — long lists scroll the whole page otherwise. */
export const REPORT_LIST_PAGE = 10;

/**
 * Progressive disclosure for a long list. `resetKey` identifies *which* list this is
 * (a filter, a selected source): when it changes the list collapses back to the first
 * page, derived at render rather than via an effect so there's no flash of the old length.
 */
export function useShowMore<T>(items: readonly T[], resetKey: unknown, pageSize = REPORT_LIST_PAGE) {
  const [state, setState] = useState({ key: resetKey, count: pageSize });
  const count = Object.is(state.key, resetKey) ? state.count : pageSize;
  const visible = items.slice(0, count);
  return {
    visible,
    total: items.length,
    pageSize,
    hasMore: items.length > count,
    expanded: items.length > pageSize && count >= items.length,
    showMore: () => setState({ key: resetKey, count: count + pageSize }),
    showAll: () => setState({ key: resetKey, count: items.length }),
    showLess: () => setState({ key: resetKey, count: pageSize }),
  };
}

export type ShowMoreState = ReturnType<typeof useShowMore>;

/** "Showing 10 of 43 patients · Show 10 more · Show all". Renders nothing for a short list. */
export function ShowMoreFooter({ list, noun }: { list: ShowMoreState; noun: string }) {
  if (list.total <= list.pageSize) return null;
  const linkCls = 'font-medium text-[var(--teal)] hover:underline';
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-3 py-2.5 text-xs text-[var(--muted)]">
      <span>
        {list.expanded ? `Showing all ${list.total} ${noun}` : `Showing ${list.visible.length} of ${list.total} ${noun}`}
      </span>
      {list.hasMore && (
        <>
          <button type="button" className={linkCls} onClick={list.showMore}>
            Show {Math.min(list.pageSize, list.total - list.visible.length)} more
          </button>
          <button type="button" className={linkCls} onClick={list.showAll}>
            Show all
          </button>
        </>
      )}
      {list.expanded && (
        <button type="button" className={linkCls} onClick={list.showLess}>
          Show less
        </button>
      )}
    </div>
  );
}
