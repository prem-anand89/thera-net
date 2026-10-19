import type { ReactNode } from 'react';
import type { PhoneView } from '@/features/schedule/schedulePhoneHelpers';

const VIEWS: { value: PhoneView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: '3day', label: '3-Day' },
];

/**
 * Phone schedule toolbar. The week strip below it is the date navigation, so
 * this has no ‹ › row: a month line (month, the day's summary, Today) and one
 * row of therapist chip, Day / 3-Day switch and the ⋮ menu.
 */
export function PhoneScheduleToolbar({
  month,
  summary,
  onToday,
  todayDisabled,
  view,
  onViewChange,
  filter,
  menu,
}: {
  /** e.g. "October 2026". */
  month: string;
  summary?: string;
  onToday: () => void;
  todayDisabled: boolean;
  view: PhoneView;
  onViewChange: (view: PhoneView) => void;
  filter: ReactNode;
  menu: ReactNode;
}) {
  return (
    <div className="space-y-2" data-phone-toolbar>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-semibold leading-tight text-[var(--ink)]">{month}</h2>
          {summary && <p className="truncate text-xs text-[var(--muted)]">{summary}</p>}
        </div>
        <button
          type="button"
          disabled={todayDisabled}
          className="min-h-11 shrink-0 rounded-lg border border-[var(--border)] px-3.5 text-xs font-medium text-[var(--teal)] disabled:opacity-50"
          onClick={onToday}
        >
          Today
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 [&_button]:min-h-11">{filter}</div>
        <div className="flex shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5" role="group" aria-label="View">
          {VIEWS.map((candidate) => (
            <button
              key={candidate.value}
              type="button"
              aria-pressed={view === candidate.value}
              onClick={() => onViewChange(candidate.value)}
              className={`min-h-10 rounded-md px-3.5 text-xs font-medium ${view === candidate.value ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        {menu}
      </div>
    </div>
  );
}
