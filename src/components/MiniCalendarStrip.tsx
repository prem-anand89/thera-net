import { useMemo, useState } from 'react';
import { addDays, addWeeks, toLocalDateStr, weekDays, type ClosedDayInfo } from '@/domain/schedule';
import { IconChevronLeft, IconChevronRight } from '@/components/StatIcons';

const CLOSED_HATCH = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--slate-light) 0 6px, transparent 6px 12px)',
} as const;

interface MiniCalendarStripProps {
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (date: string) => void;
  appointmentDates: string[]; // YYYY-MM-DD, one entry per appointment
  /** Marks weekly closed days and holidays with a hatch. */
  closedFor?: (date: string) => ClosedDayInfo;
  /** Dates shown as one connected highlighted range (the phone 3-Day window); omit for a single selected day. */
  rangeDays?: string[];
}

/** One-row Monday–Sunday week navigator (‹ days ›). "Today" lives in the
 *  Schedule toolbar; appointment counts show as up to three dots. */
export function MiniCalendarStrip({
  selectedDate,
  onSelectDate,
  appointmentDates,
  closedFor,
  rangeDays,
}: MiniCalendarStripProps) {
  const days = useMemo(() => weekDays(selectedDate), [selectedDate]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const date of appointmentDates) result.set(date, (result.get(date) ?? 0) + 1);
    return result;
  }, [appointmentDates]);
  const today = toLocalDateStr(new Date());

  const [touchStart, setTouchStart] = useState<number | null>(null);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onSelectDate(addDays(selectedDate, event.key === 'ArrowRight' ? 1 : -1));
  }

  function handleTouchStart(e: React.TouchEvent) {
    setTouchStart(e.targetTouches[0].clientX);
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStart === null) return;
    const touchEnd = e.changedTouches[0].clientX;
    const distance = touchStart - touchEnd;
    
    if (distance > 50) {
      onSelectDate(addWeeks(selectedDate, 1)); // Swipe left -> Next week
    } else if (distance < -50) {
      onSelectDate(addWeeks(selectedDate, -1)); // Swipe right -> Prev week
    }
    setTouchStart(null);
  }

  return (
    <div className="flex items-center gap-1" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button
        type="button"
        className="flex h-11 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--teal)] hover:bg-[var(--paper)]"
        aria-label="Previous week"
        onClick={() => onSelectDate(addWeeks(selectedDate, -1))}
      >
        <IconChevronLeft className="h-5 w-5" />
      </button>
      <div
        role="tablist"
        aria-label="Week dates"
        onKeyDown={onKeyDown}
        className="grid min-w-0 flex-1 grid-cols-7 gap-1"
      >
        {days.map((date) => {
          const value = new Date(`${date}T00:00:00`);
          const selected = date === selectedDate;
          const rangeIndex = rangeDays ? rangeDays.indexOf(date) : -1;
          const inRange = rangeIndex >= 0;
          const highlighted = selected || inRange;
          const count = counts.get(date) ?? 0;
          const closed = closedFor?.(date);
          const tone = highlighted
            ? 'bg-[var(--teal)] text-white'
            : date === today
              ? 'bg-[var(--teal-light)] text-[var(--teal-strong)]'
              : 'text-[var(--ink)] hover:bg-[var(--paper)]';
          return (
            <button
              key={date}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${value.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}, ${closed?.closed ? `closed${closed.label ? ` (${closed.label})` : ''}, ` : ''}${count} appointments`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectDate(date)}
              data-in-range={inRange ? true : undefined}
              className={`relative flex h-12 flex-col items-center justify-center leading-none ${tone} ${
                inRange
                  ? `${rangeIndex === 0 ? 'rounded-l-lg' : 'rounded-l-none'} ${rangeIndex === (rangeDays?.length ?? 0) - 1 ? 'rounded-r-lg' : 'rounded-r-none -mr-1'}`
                  : 'rounded-lg'
              }`}
              style={closed?.closed && !highlighted ? CLOSED_HATCH : undefined}
            >
              <span className={`text-[10px] font-medium ${highlighted ? 'text-white/80' : 'text-[var(--muted)]'}`}>
                {value.toLocaleDateString('en-IN', { weekday: 'short' })}
              </span>
              <span className="mt-0.5 mb-1.5 text-sm font-semibold tabular-nums">{value.getDate()}</span>
              {/* Up to three dots — "some", "busy", "full" — the exact count is in the label. */}
              <span className="absolute bottom-1.5 flex gap-0.5" aria-hidden>
                {Array.from({ length: Math.min(3, Math.ceil(count / 3)) }, (_, i) => (
                  <span key={i} className={`h-1 w-1 rounded-full ${highlighted ? 'bg-white' : 'bg-[var(--teal)]'}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="flex h-11 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--teal)] hover:bg-[var(--paper)]"
        aria-label="Next week"
        onClick={() => onSelectDate(addWeeks(selectedDate, 1))}
      >
        <IconChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
