import type { ReactNode } from 'react';
import type { PhoneView } from '@/features/schedule/schedulePhoneHelpers';

const VIEWS: { value: PhoneView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: '3day', label: '3-Day' },
];

/**
 * Phone schedule toolbar, two roomy rows. The week strip below it is the date
 * navigation. Row 1: the date as the headline ("Mon, 19 Oct", or "19 – 21 Oct"
 * in 3-Day) over the day's summary, a Today button when away from today, and
 * the ⋮ menu. Row 2: the therapist chip (takes the spare width) and the
 * Day / 3-Day switch.
 */
export function PhoneScheduleToolbar({
  title,
  summary,
  onToday,
  todayDisabled,
  view,
  onViewChange,
  filter,
  menu,
}: {
  /** The date headline, e.g. "Mon, 19 Oct". */
  title: string;
  summary?: string;
  onToday: () => void;
  todayDisabled: boolean;
  view: PhoneView;
  onViewChange: (view: PhoneView) => void;
  filter: ReactNode;
  menu: ReactNode;
}) {
  return (
    <div className="space-y-3" data-phone-toolbar>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-semibold leading-tight text-[var(--ink)]">{title}</h2>
          {summary && <p className="truncate text-xs text-[var(--muted)]">{summary}</p>}
        </div>
        {!todayDisabled && (
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-lg border border-[var(--border)] px-3.5 text-sm font-medium text-[var(--teal)]"
            onClick={onToday}
          >
            Today
          </button>
        )}
        {menu}
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 [&>div]:min-w-0 [&_button[aria-haspopup]]:w-full [&_button[aria-haspopup]]:max-w-none [&_button]:min-h-11">{filter}</div>
        <div className="flex shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5" role="group" aria-label="View">
          {VIEWS.map((candidate) => (
            <button
              key={candidate.value}
              type="button"
              aria-pressed={view === candidate.value}
              onClick={() => onViewChange(candidate.value)}
              className={`min-h-10 rounded-md px-3.5 text-sm font-medium ${view === candidate.value ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
