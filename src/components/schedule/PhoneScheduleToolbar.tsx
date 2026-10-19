import type { ReactNode } from 'react';
import type { PhoneView } from '@/features/schedule/schedulePhoneHelpers';

const VIEWS: { value: PhoneView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: '3day', label: '3-Day' },
];

/**
 * Phone schedule toolbar, one row. The week strip below it is the date
 * navigation, so there is no ‹ › here. Left: a two-line block with a short
 * month ("Oct '26") over the day's summary; when the viewer is away from today
 * the second line becomes a tappable "Today" instead. Then the therapist chip
 * (takes the spare width), the Day / 3-Day switch and the ⋮ menu.
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
  /** Short month, e.g. "Oct '26". */
  month: string;
  summary?: string;
  onToday: () => void;
  todayDisabled: boolean;
  view: PhoneView;
  onViewChange: (view: PhoneView) => void;
  filter: ReactNode;
  menu: ReactNode;
}) {
  const heading = (
    <span className="block truncate font-display text-[17px] font-semibold leading-tight text-[var(--ink)]">{month}</span>
  );
  return (
    <div className="flex items-center gap-1.5" data-phone-toolbar>
      {todayDisabled ? (
        <div className="min-w-0 shrink-0">
          <h2 className="m-0">{heading}</h2>
          {summary && <p className="truncate text-xs text-[var(--muted)]">{summary}</p>}
        </div>
      ) : (
        <button
          type="button"
          aria-label={`${month}. Go to today`}
          onClick={onToday}
          className="min-h-11 min-w-0 shrink-0 text-left"
        >
          {heading}
          <span className="block truncate text-xs font-medium text-[var(--teal)]">↩ Today</span>
        </button>
      )}
      <div className="min-w-0 flex-1 [&>div]:min-w-0 [&_button[aria-haspopup]]:w-full [&_button]:min-h-11">{filter}</div>
      <div className="flex shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5" role="group" aria-label="View">
        {VIEWS.map((candidate) => (
          <button
            key={candidate.value}
            type="button"
            aria-pressed={view === candidate.value}
            onClick={() => onViewChange(candidate.value)}
            className={`min-h-10 rounded-md px-2 text-xs font-medium ${view === candidate.value ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      {menu}
    </div>
  );
}
