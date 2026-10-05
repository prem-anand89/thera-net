import type { SetupStatus } from '@/domain/setupGuide';

/** Setup progress drawn as treatment-course session ticks, the same way the
 *  app shows package sessions: filled green for done, a teal ring for the
 *  step that's next, hollow for pending. */
export function SetupTicks({ statuses, size = 'sm' }: { statuses: SetupStatus[]; size?: 'sm' | 'lg' }) {
  const dot = size === 'lg' ? 'h-3 w-3' : 'h-2 w-2';
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {statuses.map((status, i) => (
        <span
          key={i}
          className={`${dot} shrink-0 rounded-full transition-colors motion-reduce:transition-none ${
            status === 'done'
              ? 'bg-[var(--moss)]'
              : status === 'next'
                ? 'bg-[var(--surface)] ring-2 ring-[var(--teal)]'
                : 'border border-[var(--border)] bg-[var(--surface)]'
          }`}
        />
      ))}
    </span>
  );
}
