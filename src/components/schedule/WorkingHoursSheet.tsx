import { useEffect, useState } from 'react';
import { ErrorNote, btnPrimary, btnSecondary } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { WEEKDAY_NAMES, minutesToTime, workingHoursProblem } from '@/domain/schedule';
import type { WorkingHours } from '@/domain/types';

type Day = keyof WorkingHours;
const WEEK_ORDER: Day[] = ['1', '2', '3', '4', '5', '6', '0']; // Monday first

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Clinic hours on every open weekday — the starting point for custom hours. */
export function defaultWorkingHours(clinic: { startHour: number; endHour: number; closedWeekdays?: number[] }): WorkingHours {
  const hours: WorkingHours = {};
  for (const day of WEEK_ORDER) {
    if (!(clinic.closedWeekdays ?? []).includes(Number(day))) hours[day] = [[clinic.startHour * 60, clinic.endHour * 60]];
  }
  return hours;
}

/**
 * Weekly hours for one therapist. Several times per day are allowed; the gap
 * between them is the break (e.g. 9–1 and 2–6 = lunch 1–2), so breaks never
 * need entering separately. "Clinic hours" clears the custom hours.
 */
export function WorkingHoursSheet({
  open,
  therapistName,
  value,
  clinic,
  onSave,
  onClose,
}: {
  open: boolean;
  therapistName: string;
  value: WorkingHours | null | undefined;
  clinic: { startHour: number; endHour: number; closedWeekdays?: number[] };
  onSave: (hours: WorkingHours | null) => Promise<void>;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [hours, setHours] = useState<WorkingHours>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCustom(Boolean(value));
    setHours(value ?? defaultWorkingHours(clinic));
    setError(null);
    setBusy(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opened
  }, [open]);

  if (!open) return null;

  const update = (day: Day, intervals: [number, number][]) =>
    setHours((current) => {
      const next = { ...current };
      if (intervals.length) next[day] = intervals;
      else delete next[day];
      return next;
    });

  async function save() {
    const value = custom ? hours : null;
    if (value) {
      const problem = workingHoursProblem(value);
      if (problem) return setError(problem);
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (saveError) {
      setError(toFriendlyMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="working-hours-title"
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-[var(--surface)] shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] p-4 sm:p-5">
          <h2 id="working-hours-title" className="font-display text-lg font-semibold text-[var(--ink)]">
            Working hours · {therapistName}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Set the start and end of the day, and optionally add one or more breaks. Only the available time is offered for booking.
          </p>
          <div className="mt-3 flex rounded-lg border border-[var(--border)] p-0.5" role="radiogroup" aria-label="Hours">
            {[false, true].map((candidate) => (
              <button
                key={String(candidate)}
                type="button"
                role="radio"
                aria-checked={custom === candidate}
                onClick={() => setCustom(candidate)}
                className={`min-h-9 flex-1 rounded-md px-3 text-xs font-medium ${custom === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
              >
                {candidate ? 'Custom hours' : 'Same as clinic hours'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {!custom ? (
            <p className="text-sm text-[var(--muted)]">
              Uses the clinic's booking hours ({minutesToTime(clinic.startHour * 60)}–{minutesToTime(clinic.endHour * 60)}) on every open day.
            </p>
          ) : (
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
                            update(day, event.target.checked ? [[clinic.startHour * 60, clinic.endHour * 60]] : [])
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
                            const noRoom = lastEnd >= overallEnd;
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
          )}
          <ErrorNote message={error} />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save hours'}</button>
        </div>
      </div>
    </div>
  );
}
