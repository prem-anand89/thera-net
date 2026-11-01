import { daysLabel } from '@/domain/operatingHours';

/** Weekday index (0 = Sunday, as stored) and label, Monday first. */
const WEEK: [number, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];

/**
 * Which days of the week the clinic is open: one connected strip of seven cells (a filled cell is open, a plain one is
 * closed), with a plain sentence under it. Not the round chips used elsewhere, so it never reads as the same control as
 * the day tiles on the hours cards. `closedWeekdays` is what is stored; the strip shows the open ones lit.
 */
export function OpenDaysStrip({
  closedWeekdays,
  disabled,
  onChange,
}: {
  closedWeekdays: readonly number[];
  disabled?: boolean;
  onChange: (closedWeekdays: number[]) => void;
}) {
  const closed = WEEK.map(([day]) => day).filter((day) => closedWeekdays.includes(day));
  return (
    <div>
      <div role="group" aria-label="Open days" className="grid grid-cols-7 overflow-hidden rounded-xl border border-[var(--border)]">
        {WEEK.map(([day, label], i) => {
          const open = !closedWeekdays.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={open}
              disabled={disabled}
              onClick={() => onChange(open ? [...closedWeekdays, day].sort((a, b) => a - b) : closedWeekdays.filter((d) => d !== day))}
              className={`min-h-11 text-xs font-medium transition-colors ${i > 0 ? 'border-l border-[var(--border)]' : ''} ${
                open ? 'bg-[var(--teal)] text-white' : 'bg-[var(--paper)] text-[var(--muted)] hover:bg-[var(--surface)]'
              } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-[var(--muted)]" data-testid="open-days-summary">
        {closed.length === 0 ? 'Open every day' : closed.length === 7 ? 'Closed every day' : `Closed on ${daysLabel(closed)}`}
      </p>
    </div>
  );
}
