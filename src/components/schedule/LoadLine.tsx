import type { DayLoadTone } from '@/domain/schedule';

/** A therapist's day at a glance: caption + capacity bar (see `dayLoad`). */
export type LoadSummary = { text: string; ratio: number | null; tone?: DayLoadTone };

const CAPTION: Record<DayLoadTone, string> = {
  normal: 'text-[var(--muted)]',
  busy: 'font-medium text-[var(--amber)]',
  full: 'font-medium text-[var(--rust)]',
  off: 'text-[var(--muted)]',
  done: 'text-[var(--muted)]',
};

/** Capacity bar (booked ÷ working minutes) with a plain-language caption —
 *  the Schedule's one bold element; it answers "who can take a walk-in?"
 *  without reading the grid. The bar is the therapist's colour, amber when
 *  the day is nearly full (≥70% or one slot left), rust when full, grey
 *  once today's hours are over. */
export function LoadLine({ summary, color }: { summary: LoadSummary; color: string }) {
  const tone = summary.tone ?? (summary.ratio !== null && summary.ratio >= 1 ? 'full' : 'normal');
  const barColor = tone === 'full' ? 'var(--rust)' : tone === 'busy' ? 'var(--amber)' : tone === 'done' ? 'var(--slate)' : color;
  return (
    <span className="mt-1 block">
      <span className={`block truncate text-[11px] ${CAPTION[tone]}`}>{summary.text}</span>
      {summary.ratio !== null && (
        <span
          className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--border)]"
          role="meter"
          aria-label="Day booked"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(summary.ratio * 100)}
        >
          <span className="block h-full rounded-full" style={{ width: `${Math.max(summary.ratio * 100, summary.ratio > 0 ? 4 : 0)}%`, background: barColor }} />
        </span>
      )}
    </span>
  );
}
