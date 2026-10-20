import type { ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from '@/components/StatIcons';

/**
 * Tablet / desktop schedule controls, in the phones' order: ‹ › with the date
 * headline and summary, Today, the therapist chip (below `desktop:` — the rail
 * covers wider screens), Day | Week, Find a time (day view) and the ⋮ menu.
 * Purely presentational: the view owns the state and passes callbacks.
 */
export function ScheduleToolbar({
  mode,
  weekAvailable,
  onModeChange,
  onStep,
  onToday,
  todayDisabled,
  headline,
  summary,
  offCount = 0,
  onShowOff,
  filter,
  findTimeActive,
  onToggleFindTime,
  menu,
}: {
  mode: 'day' | 'week';
  weekAvailable: boolean;
  onModeChange: (mode: 'day' | 'week') => void;
  /** -1 previous, 1 next (a day or a week, by mode). */
  onStep: (direction: -1 | 1) => void;
  onToday: () => void;
  todayDisabled: boolean;
  /** `short` shows below `sm:`, `long` from `sm:`. */
  headline: { short: string; long: string };
  /** One-line day summary, shown in day mode. */
  summary: string | null;
  /** Therapists left out because they are off this day; tapping the note shows them. */
  offCount?: number;
  onShowOff?: () => void;
  filter: ReactNode;
  findTimeActive: boolean;
  onToggleFindTime: () => void;
  menu: ReactNode;
}) {
  const stepLabel = mode === 'day' ? 'day' : 'week';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-schedule-toolbar>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button type="button" className="hidden min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--teal)] hover:bg-[var(--paper)] tab:flex" aria-label={`Previous ${stepLabel}`} onClick={() => onStep(-1)}>
          <IconChevronLeft className="h-5 w-5" />
        </button>
        <button type="button" className="hidden min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--teal)] hover:bg-[var(--paper)] tab:flex" aria-label={`Next ${stepLabel}`} onClick={() => onStep(1)}>
          <IconChevronRight className="h-5 w-5" />
        </button>
        <div className="min-w-0 tab:ml-1">
          <h2 className="flex items-baseline gap-2 truncate font-display text-lg font-semibold leading-tight text-[var(--ink)]">
            <span className="sm:hidden">{headline.short}</span>
            <span className="hidden sm:inline">{headline.long}</span>
          </h2>
          {mode === 'day' && summary && (
            <p className="truncate text-xs text-[var(--muted)]">
              {summary}
              {offCount > 0 && onShowOff && (
                <>
                  {' · '}
                  <button type="button" className="font-medium text-[var(--teal)] hover:underline" onClick={onShowOff}>
                    {offCount} off · Show
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={todayDisabled}
          className="ml-1 min-h-9 shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
          onClick={onToday}
        >
          Today
        </button>
      </div>
      <div className="flex items-center gap-2">
        {filter}
        {weekAvailable && (
          <div className="hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 tab:flex" role="group" aria-label="View">
            {(['day', 'week'] as const).map((candidate) => (
              <button key={candidate} type="button" aria-pressed={mode === candidate} onClick={() => onModeChange(candidate)} className={`min-h-8 rounded-md px-3 text-xs font-medium ${mode === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}>
                {candidate === 'day' ? 'Day' : 'Week'}
              </button>
            ))}
          </div>
        )}
        {mode === 'day' && (
          <button
            type="button"
            aria-pressed={findTimeActive}
            onClick={onToggleFindTime}
            className={`hidden min-h-8 items-center rounded-lg border px-3 text-xs font-medium tab:inline-flex ${
              findTimeActive ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--teal)] hover:bg-[var(--paper)]'
            }`}
          >
            {findTimeActive ? 'Back to the day' : 'Find a time'}
          </button>
        )}
        {menu}
      </div>
    </div>
  );
}
