import { useMemo } from 'react';
import { addDays, addWeeks, toLocalDateStr, weekDays } from '@/domain/schedule';

interface MiniCalendarStripProps {
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (date: string) => void;
  appointmentDates: string[]; // YYYY-MM-DD, one entry per appointment
}

/** Compact, non-scrolling Monday–Sunday week navigator. */
export function MiniCalendarStrip({
  selectedDate,
  onSelectDate,
  appointmentDates,
}: MiniCalendarStripProps) {
  const days = useMemo(() => weekDays(selectedDate), [selectedDate]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const date of appointmentDates) result.set(date, (result.get(date) ?? 0) + 1);
    return result;
  }, [appointmentDates]);
  const today = toLocalDateStr(new Date());

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onSelectDate(addDays(selectedDate, event.key === 'ArrowRight' ? 1 : -1));
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg text-lg text-[var(--teal)] hover:bg-[var(--paper)]"
          aria-label="Previous week"
          onClick={() => onSelectDate(addWeeks(selectedDate, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          className="min-h-11 px-3 text-sm font-medium text-[var(--teal)]"
          onClick={() => onSelectDate(today)}
        >
          Today
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg text-lg text-[var(--teal)] hover:bg-[var(--paper)]"
          aria-label="Next week"
          onClick={() => onSelectDate(addWeeks(selectedDate, 1))}
        >
          ›
        </button>
      </div>
      <div
        role="tablist"
        aria-label="Week dates"
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-1"
      >
        {days.map((date) => {
          const value = new Date(`${date}T00:00:00`);
          const selected = date === selectedDate;
          const count = counts.get(date) ?? 0;
          const tone = selected
            ? 'bg-[var(--teal)] text-white'
            : date === today
              ? 'bg-[var(--teal-light)] text-[var(--teal)]'
              : 'text-[var(--ink)] hover:bg-[var(--paper)]';
          return (
            <button
              key={date}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${value.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}, ${count} appointments`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectDate(date)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-lg text-xs ${tone}`}
            >
              <span className="text-[10px] font-medium uppercase">
                {value.toLocaleDateString('en-IN', { weekday: 'short' })}
              </span>
              <span className="text-sm font-semibold">{value.getDate()}</span>
              <span className={`text-[10px] ${count === 0 ? 'invisible' : selected ? 'text-white' : 'text-[var(--muted)]'}`}>
                {count || 0}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
