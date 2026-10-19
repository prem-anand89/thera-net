import type { ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from '@/components/StatIcons';
import type { PhoneView } from '@/features/schedule/schedulePhoneHelpers';

const VIEWS: { value: PhoneView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: '3day', label: '3-Day' },
];

/**
 * Phone schedule toolbar in two rows so the date never competes with the
 * controls: row 1 is date navigation, row 2 is therapists, view and menu.
 */
export function PhoneScheduleToolbar({
  title,
  summary,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  onToday,
  todayDisabled,
  calendarOpen,
  onToggleCalendar,
  view,
  onViewChange,
  filter,
  menu,
}: {
  title: string;
  summary?: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  todayDisabled: boolean;
  calendarOpen: boolean;
  onToggleCalendar: () => void;
  view: PhoneView;
  onViewChange: (view: PhoneView) => void;
  filter: ReactNode;
  menu: ReactNode;
}) {
  const icon = 'flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[var(--teal)] active:bg-[var(--paper)]';
  return (
    <div className="space-y-2" data-phone-toolbar>
      <div className="flex items-center gap-1">
        <button type="button" className={icon} aria-label={prevLabel} onClick={onPrev}>
          <IconChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 rounded-lg px-1 text-center active:bg-[var(--paper)]"
          aria-expanded={calendarOpen}
          aria-label={`${title}. ${calendarOpen ? 'Hide' : 'Show'} calendar`}
          onClick={onToggleCalendar}
        >
          <span className="block truncate font-display text-lg font-semibold leading-tight text-[var(--ink)]">{title}</span>
          {summary && <span className="block truncate text-xs text-[var(--muted)]">{summary}</span>}
        </button>
        <button type="button" className={icon} aria-label={nextLabel} onClick={onNext}>
          <IconChevronRight className="h-5 w-5" />
        </button>
        <button
          type="button"
          disabled={todayDisabled}
          className="min-h-11 shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--teal)] disabled:opacity-50"
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
              className={`min-h-10 rounded-md px-3 text-xs font-medium ${view === candidate.value ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
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
