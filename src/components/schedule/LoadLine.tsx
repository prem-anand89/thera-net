/** A therapist's day at a glance: caption + capacity bar. */
export type LoadSummary = { text: string; ratio: number | null };

/** Capacity bar (booked ÷ working minutes) in the therapist's colour, with a
 *  plain-language caption. The Schedule's one bold element — it answers
 *  "who can take a walk-in?" without reading the grid. */
export function LoadLine({ summary, color }: { summary: LoadSummary; color: string }) {
  const full = summary.ratio !== null && summary.ratio >= 1;
  return (
    <span className="mt-1 block">
      <span className={`block truncate text-[11px] ${full ? 'font-medium text-[var(--rust)]' : 'text-[var(--muted)]'}`}>{summary.text}</span>
      {summary.ratio !== null && (
        <span
          className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--border)]"
          role="meter"
          aria-label="Day booked"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(summary.ratio * 100)}
        >
          <span className="block h-full rounded-full" style={{ width: `${Math.max(summary.ratio * 100, summary.ratio > 0 ? 4 : 0)}%`, background: color }} />
        </span>
      )}
    </span>
  );
}
