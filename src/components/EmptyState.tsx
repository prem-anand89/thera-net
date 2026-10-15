import type { ReactNode } from 'react';
import { pillAccent } from '@/components/ui';

export type EmptyAction = { label: string; onClick: () => void };

/**
 * An empty list that says why it is empty and offers the next step (widen the range,
 * clear filters, add a record) instead of a dead-end sentence.
 */
export function EmptyState({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: EmptyAction[];
  /** Extra controls rendered after the action buttons (e.g. a primary link). */
  children?: ReactNode;
}) {
  const hasControls = (actions?.length ?? 0) > 0 || children;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center shadow-sm">
      <p className="text-sm font-medium text-[var(--ink)]">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-xs text-[var(--muted)]">{hint}</p>}
      {hasControls && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {actions?.map((a) => (
            <button key={a.label} type="button" className={pillAccent} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}
