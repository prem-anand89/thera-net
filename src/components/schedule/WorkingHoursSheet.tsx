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
            Add a second time on a day to leave a break between them. Only these times are offered for booking.
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
                    {working && (
                      <div className="mt-2 space-y-2">
                        {intervals.map(([start, end], index) => (
                          <div key={index} className="flex items-center gap-2">
                            <input
                              type="time"
                              step={300}
                              aria-label={`${WEEKDAY_NAMES[Number(day)]} start ${index + 1}`}
                              className="min-h-10 rounded-lg border border-[var(--border)] px-2 text-sm"
                              value={minutesToTime(start)}
                              onChange={(event) => {
                                const next = intervals.map((i) => [...i] as [number, number]);
                                next[index][0] = toMinutes(event.target.value);
                                update(day, next);
                              }}
                            />
                            <span className="text-xs text-[var(--muted)]">to</span>
                            <input
                              type="time"
                              step={300}
                              aria-label={`${WEEKDAY_NAMES[Number(day)]} end ${index + 1}`}
                              className="min-h-10 rounded-lg border border-[var(--border)] px-2 text-sm"
                              value={minutesToTime(end)}
                              onChange={(event) => {
                                const next = intervals.map((i) => [...i] as [number, number]);
                                next[index][1] = toMinutes(event.target.value);
                                update(day, next);
                              }}
                            />
                            {intervals.length > 1 && (
                              <button
                                type="button"
                                aria-label="Remove this time"
                                className="min-h-10 min-w-10 rounded-lg text-[var(--muted)] hover:bg-[var(--paper)]"
                                onClick={() => update(day, intervals.filter((_, i) => i !== index))}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                        {intervals.length < 4 && (
                          <button
                            type="button"
                            className="text-xs font-medium text-[var(--teal)] hover:underline"
                            onClick={() => {
                              const lastEnd = intervals[intervals.length - 1][1];
                              const start = Math.min(lastEnd + 60, 23 * 60);
                              update(day, [...intervals, [start, Math.min(start + 180, 1440)]]);
                            }}
                          >
                            + Add time after a break
                          </button>
                        )}
                      </div>
                    )}
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
