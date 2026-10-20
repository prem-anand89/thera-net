import type { ReactNode } from 'react';
import type { PhoneView } from '@/features/schedule/schedulePhoneHelpers';

const VIEWS: { value: PhoneView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: '3day', label: '3-Day' },
];

/**
 * Phone schedule controls, one row: the therapist chip (takes the spare
 * width), the Day / 3-Day switch and the ⋮ menu. There is no date headline;
 * the week strip below shows the selected day and `PhoneStatusLine` sits
 * under the strip.
 */
export function PhoneScheduleToolbar({
  view,
  onViewChange,
  filter,
  menu,
}: {
  view: PhoneView;
  onViewChange: (view: PhoneView) => void;
  filter: ReactNode;
  menu: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3" data-phone-toolbar>
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
      {menu}
    </div>
  );
}

/**
 * One small line under the week strip: what the selected day (or 3-day
 * window) holds, plus "↩ Today" at the right when away from today.
 */
export function PhoneStatusLine({
  label,
  summary,
  onToday,
  showToday,
  offCount = 0,
  onShowOff,
}: {
  /** "Today", "Tue 20 Oct", "Mon 19 – Wed 21 Oct". */
  label: string;
  summary: string;
  onToday: () => void;
  showToday: boolean;
  /** Therapists left out because they are off this day; tapping the note shows them. */
  offCount?: number;
  onShowOff?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]" data-phone-status>
      <p className="min-w-0 truncate">
        <span className="font-semibold text-[var(--ink)]">{label}</span> · {summary}
      </p>
      {offCount > 0 && onShowOff && (
        <button type="button" className="ml-auto min-h-11 shrink-0 text-xs font-medium text-[var(--teal)]" onClick={onShowOff}>
          {offCount} off · Show
        </button>
      )}
      {showToday && (
        <button type="button" className="min-h-11 shrink-0 pl-3 text-xs font-semibold text-[var(--teal)]" onClick={onToday}>
          ↩ Today
        </button>
      )}
    </div>
  );
}
