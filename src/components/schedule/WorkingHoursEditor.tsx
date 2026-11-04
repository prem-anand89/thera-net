import { WEEKDAY_NAMES, minutesToTime } from '@/domain/schedule';
import type { WorkingHours } from '@/domain/types';

type Day = keyof WorkingHours;
const WEEK_ORDER: Day[] = ['1', '2', '3', '4', '5', '6', '0']; // Monday first

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

type ClinicHoursForSheet = { startHour: number; endHour: number; closedWeekdays?: number[]; operating?: WorkingHours | null };

/**
 * Clinic hours on every open weekday — the starting point for custom hours. A clinic that closes at midday starts the
 * therapist on the same sessions (9–1 and 4–8), not on one long block across the closure.
 */
export function defaultWorkingHours(clinic: ClinicHoursForSheet): WorkingHours {
  const hours: WorkingHours = {};
  for (const day of WEEK_ORDER) {
    if ((clinic.closedWeekdays ?? []).includes(Number(day))) continue;
    const stored: unknown = clinic.operating?.[day];
    const sessions = Array.isArray(stored)
      ? stored.filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
      : [];
    hours[day] = sessions.length > 0 ? sessions.map(([start, end]) => [start, end] as [number, number]) : [[clinic.startHour * 60, clinic.endHour * 60]];
  }
  return hours;
}

/**
 * One therapist's own weekly hours, day by day: a day on or off, its start and end, and up to three breaks (the gaps
 * between intervals). Used inside `WorkingHoursSheet` and inline in the Team → Shifts person sheet. A day switched on
 * starts from the clinic's own sessions that day.
 */
export function WorkingHoursEditor({
  hours,
  onChange,
  clinic,
}: {
  hours: WorkingHours;
  onChange: (next: WorkingHours) => void;
  clinic: ClinicHoursForSheet;
}) {
  const setHours = (fn: (current: WorkingHours) => WorkingHours) => onChange(fn(hours));
  const update = (day: Day, intervals: [number, number][]) =>
    setHours((current) => {
      const next = { ...current };
      if (intervals.length) next[day] = intervals;
      else delete next[day];
      return next;
    });

  return (
    <ul className="space-y-3">
      {WEEK_ORDER.map((day) => {
        const intervals = hours[day] ?? [];
        const working = intervals.length > 0;
        return (
          <li key={day} className="rounded-xl border border-[var(--border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={working}
                  onChange={(event) =>
                    update(day, event.target.checked ? (defaultWorkingHours(clinic)[day] ?? [[clinic.startHour * 60, clinic.endHour * 60]]) : [])
                  }
                />
                {WEEKDAY_NAMES[Number(day)]}
              </label>
              {!working && <span className="text-xs text-[var(--muted)]">Day off</span>}
              {working && day === '1' && (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--teal)] hover:underline"
                  onClick={() =>
                    setHours((current) => {
                      const next: WorkingHours = {};
                      for (const target of WEEK_ORDER) {
                        if (target === '0' || target === '6') {
                          if (current[target]) next[target] = current[target];
                        } else next[target] = current['1']!.map(([a, b]) => [a, b] as [number, number]);
                      }
                      return next;
                    })
                  }
                >
                  Copy to Tue–Fri
                </button>
              )}
            </div>
            {working && (() => {
              const overallStart = intervals[0][0];
              const overallEnd = intervals[intervals.length - 1][1];
              const breaks: [number, number][] = [];
              for (let i = 0; i < intervals.length - 1; i++) {
                breaks.push([intervals[i][1], intervals[i + 1][0]]);
              }
              
              const rebuild = (newStart: number, newEnd: number, newBreaks: [number, number][]) => {
                const sorted = [...newBreaks].sort((a, b) => a[0] - b[0]);
                const result: [number, number][] = [];
                let cur = newStart;
                for (const b of sorted) {
                  if (b[0] > cur && b[0] < newEnd) {
                    result.push([cur, b[0]]);
                    cur = Math.min(b[1], newEnd);
                  }
                }
                if (cur < newEnd) {
                  result.push([cur, newEnd]);
                }
                if (result.length === 0) result.push([newStart, newEnd]);
                update(day, result);
              };

              return (
                <div className="mt-3 space-y-4 rounded-lg bg-[var(--paper)] p-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Working Hours</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        step={300}
                        className="min-h-10 w-full max-w-[140px] rounded-lg border border-[var(--border)] px-2 text-sm bg-[var(--surface)]"
                        value={minutesToTime(overallStart)}
                        onChange={(e) => rebuild(toMinutes(e.target.value), overallEnd, breaks)}
                      />
                      <span className="text-xs text-[var(--muted)]">to</span>
                      <input
                        type="time"
                        step={300}
                        className="min-h-10 w-full max-w-[140px] rounded-lg border border-[var(--border)] px-2 text-sm bg-[var(--surface)]"
                        value={minutesToTime(overallEnd)}
                        onChange={(e) => rebuild(overallStart, toMinutes(e.target.value), breaks)}
                      />
                    </div>
                  </div>

                  {breaks.map((b, index) => (
                    <div key={index} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--amber-strong)] uppercase tracking-wider">Break Time</span>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-[var(--rust)] hover:underline"
                          onClick={() => rebuild(overallStart, overallEnd, breaks.filter((_, i) => i !== index))}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          step={300}
                          className="min-h-10 w-full max-w-[140px] rounded-lg border border-[var(--amber-strong)]/30 px-2 text-sm bg-[var(--amber-light)] text-[var(--amber-strong)] focus:ring-[var(--amber)]"
                          value={minutesToTime(b[0])}
                          onChange={(e) => {
                            const next = [...breaks];
                            next[index] = [toMinutes(e.target.value), b[1]];
                            rebuild(overallStart, overallEnd, next);
                          }}
                        />
                        <span className="text-xs text-[var(--muted)]">to</span>
                        <input
                          type="time"
                          step={300}
                          className="min-h-10 w-full max-w-[140px] rounded-lg border border-[var(--amber-strong)]/30 px-2 text-sm bg-[var(--amber-light)] text-[var(--amber-strong)] focus:ring-[var(--amber)]"
                          value={minutesToTime(b[1])}
                          onChange={(e) => {
                            const next = [...breaks];
                            next[index] = [b[0], toMinutes(e.target.value)];
                            rebuild(overallStart, overallEnd, next);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  
                  {(() => {
                    const lastEnd = breaks.length ? breaks[breaks.length - 1][1] : overallStart;
                    const noRoom = lastEnd >= overallEnd || breaks.length >= 3;
                    return (
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--teal)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--muted)] disabled:no-underline"
                        disabled={noRoom}
                        onClick={() => {
                          const remaining = overallEnd - lastEnd;
                          const breakStart = remaining > 60 ? lastEnd + Math.floor((remaining - 60) / 2) : lastEnd;
                          const breakEnd = Math.min(overallEnd, breakStart + 30);
                          rebuild(overallStart, overallEnd, [...breaks, [breakStart, breakEnd]]);
                        }}
                      >
                        {breaks.length === 0 ? '+ Add a break' : '+ Add another break'}
                      </button>
                    );
                  })()}
                </div>
              );
            })()}
          </li>
        );
      })}
    </ul>
  );
}
