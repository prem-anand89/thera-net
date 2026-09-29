import { useMemo, useEffect, useRef } from 'react';

interface MiniCalendarStripProps {
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (date: string) => void;
  appointmentDates: string[]; // Array of YYYY-MM-DD strings (can contain duplicates for multiple appts)
}

export function MiniCalendarStrip({
  selectedDate,
  onSelectDate,
  appointmentDates,
}: MiniCalendarStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Generate 15 days (7 before today, today, 7 after today)
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = [];
    for (let i = -7; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      result.push(d);
    }
    return result;
  }, []);

  // Pre-calculate appointment counts per date string
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of appointmentDates) {
      map[d] = (map[d] || 0) + 1;
    }
    return map;
  }, [appointmentDates]);

  // Scroll the selected date into view on mount
  useEffect(() => {
    if (scrollRef.current) {
      const selectedEl = scrollRef.current.querySelector('[data-selected="true"]');
      if (selectedEl) {
        selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [selectedDate]);

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="border-b border-[var(--border)] bg-white py-3 shadow-sm">
      <div
        ref={scrollRef}
        className="hide-scrollbar flex items-center gap-3 overflow-x-auto px-4 snap-x snap-mandatory"
      >
        {days.map((date) => {
          const localStr =
            date.getFullYear() +
            '-' +
            String(date.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(date.getDate()).padStart(2, '0');

          const isSelected = localStr === selectedDate;
          const isToday = localStr === todayStr;

          const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
          const dayNum = date.getDate();

          const count = counts[localStr] || 0;
          // Up to 3 dots
          const dots = Math.min(count, 3);

          return (
            <button
              key={localStr}
              type="button"
              data-selected={isSelected}
              onClick={() => onSelectDate(localStr)}
              className={`group relative flex min-w-[50px] shrink-0 snap-center flex-col items-center justify-center rounded-2xl p-2 transition-colors ${
                isSelected ? 'bg-[var(--teal)]/10' : 'hover:bg-[var(--paper)]'
              }`}
            >
              <span
                className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${
                  isSelected ? 'text-[var(--teal)]' : 'text-[var(--muted)]'
                }`}
              >
                {dayName}
              </span>
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  isToday && !isSelected
                    ? 'bg-[var(--teal)] text-white'
                    : isSelected
                    ? 'text-[var(--teal)]'
                    : 'text-[var(--ink)]'
                }`}
              >
                {dayNum}
              </span>

              {/* Dots indicator */}
              <div className="absolute bottom-1 flex gap-0.5">
                {Array.from({ length: dots }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 w-1 rounded-full ${
                      isSelected ? 'bg-[var(--teal)]' : 'bg-[var(--teal)]/50'
                    }`}
                  />
                ))}
              </div>

              {/* Bold underline for selected */}
              {isSelected && (
                <div className="absolute inset-x-2 -bottom-3 h-[3px] rounded-t-full bg-[var(--teal)]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
