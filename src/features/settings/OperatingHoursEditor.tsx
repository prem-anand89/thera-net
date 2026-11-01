import { useMemo, useState } from 'react';
import { Field } from '@/components/ui';
import {
  closedGapLabel,
  describeShifts,
  envelopeOf,
  operatingFromDays,
  operatingFromShifts,
  shiftsFromOperating,
  shiftsProblem,
  splitSession,
  type Shifts,
} from '@/domain/operatingHours';
import { WEEKDAY_NAMES } from '@/domain/schedule';
import type { WorkingHours } from '@/domain/types';

const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/** What the editor hands back: the stored hours (null = one plain block) and the envelope hours that go with them. */
export type OperatingHoursChange = { operatingHours: WorkingHours | null; bookingStartHour: number; bookingEndHour: number };

/**
 * Turns the editor's value into what is stored. A single block that starts and ends on the hour, the same every day, is
 * the old behaviour: no `operating_hours`, just the two hours. Anything else (a closure in the middle, a half-hour time,
 * different days) is stored in full and the envelope is derived from it, exactly as the database trigger does.
 */
export function changeFor(uniform: Shifts | null, perDay: Record<number, Shifts>, openWeekdays: readonly number[]): OperatingHoursChange | null {
  if (uniform && !uniform.s2 && uniform.s1[0] % 60 === 0 && uniform.s1[1] % 60 === 0) {
    return { operatingHours: null, bookingStartHour: uniform.s1[0] / 60, bookingEndHour: uniform.s1[1] / 60 };
  }
  const hours = uniform ? operatingFromShifts(uniform) : operatingFromDays(perDay, openWeekdays);
  const envelope = envelopeOf(hours);
  return envelope ? { operatingHours: hours, bookingStartHour: envelope.startHour, bookingEndHour: envelope.endHour } : null;
}

/** Every problem in the current value, so Save can refuse and the editor can say why. */
export function operatingProblem(uniform: Shifts | null, perDay: Record<number, Shifts>, openWeekdays: readonly number[]): string | null {
  if (uniform) return shiftsProblem(uniform);
  for (const day of openWeekdays) {
    const problem = shiftsProblem(perDay[day], WEEKDAY_NAMES[day]);
    if (problem) return problem;
  }
  return null;
}

function SessionRow({
  label,
  value,
  onChange,
  idPrefix,
}: {
  label: string;
  value: [number, number];
  onChange: (next: [number, number]) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-[var(--muted)]">{label}</span>
      <input
        id={`${idPrefix}-start`}
        type="time"
        step={900}
        aria-label={`${label} starts`}
        className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
        value={toTime(value[0])}
        onChange={(e) => onChange([toMinutes(e.target.value), value[1]])}
      />
      <span className="text-xs text-[var(--muted)]">to</span>
      <input
        id={`${idPrefix}-end`}
        type="time"
        step={900}
        aria-label={`${label} ends`}
        className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
        value={toTime(value[1])}
        onChange={(e) => onChange([value[0], toMinutes(e.target.value)])}
      />
    </div>
  );
}

function ShiftsFields({ shifts, onChange, idPrefix }: { shifts: Shifts; onChange: (next: Shifts) => void; idPrefix: string }) {
  return (
    <div className="space-y-2">
      <SessionRow label="Open" idPrefix={`${idPrefix}-s1`} value={shifts.s1} onChange={(s1) => onChange({ ...shifts, s1 })} />
      <label className="flex min-h-9 items-center gap-2 text-sm text-[var(--ink)]">
        <input
          type="checkbox"
          checked={shifts.s2 !== null}
          onChange={(e) => {
            if (!e.target.checked) return onChange({ ...shifts, s2: null });
            // Cut the day in two with a gap in the middle, for the person to adjust.
            onChange(splitSession(shifts.s1));
          }}
        />
        Closed in the middle of the day, open again later
      </label>
      {shifts.s2 && <SessionRow label="Open again" idPrefix={`${idPrefix}-s2`} value={shifts.s2} onChange={(s2) => onChange({ ...shifts, s2 })} />}
    </div>
  );
}

/**
 * Settings → Schedule & Booking → Hours & closures: when the clinic is open. One session a day, or a second after a
 * closure in the middle of the day (a lunch break, or morning and evening sessions); the same every open day, or
 * customised per day. Saves through `onChange` as the stored hours plus the envelope hours that go with them.
 */
export function OperatingHoursEditor({
  operatingHours,
  startHour,
  endHour,
  closedWeekdays,
  onChange,
}: {
  operatingHours: WorkingHours | null | undefined;
  startHour: number;
  endHour: number;
  closedWeekdays: readonly number[];
  onChange: (change: OperatingHoursChange, problem: string | null) => void;
}) {
  const openWeekdays = useMemo(() => WEEK_ORDER.filter((d) => !closedWeekdays.includes(d)), [closedWeekdays]);
  const read = useMemo(
    () => shiftsFromOperating(operatingHours, openWeekdays, { startHour, endHour }),
    [operatingHours, openWeekdays, startHour, endHour]
  );
  const [perDayMode, setPerDayMode] = useState(read.uniform === null);

  function emit(uniform: Shifts | null, perDay: Record<number, Shifts>) {
    const change = changeFor(uniform, perDay, openWeekdays);
    if (change) onChange(change, operatingProblem(uniform, perDay, openWeekdays));
  }

  const shared: Shifts = read.uniform ?? read.perDay[openWeekdays[0]] ?? { s1: [startHour * 60, endHour * 60], s2: null };

  return (
    <Field
      label={
        <>
          Clinic operating hours
          <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">when patients can be booked</span>
        </>
      }
    >
      <div className="space-y-3" data-testid="operating-hours-editor">
        {!perDayMode ? (
          <ShiftsFields shifts={shared} idPrefix="oh" onChange={(next) => emit(next, read.perDay)} />
        ) : (
          <div className="space-y-3">
            {openWeekdays.map((day) => (
              <div key={day} className="rounded-lg border border-[var(--border)] p-2.5">
                <p className="mb-1.5 text-xs font-semibold text-[var(--ink)]">{WEEKDAY_NAMES[day]}</p>
                <ShiftsFields
                  shifts={read.perDay[day]}
                  idPrefix={`oh-${day}`}
                  onChange={(next) => emit(null, { ...read.perDay, [day]: next })}
                />
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-[var(--muted)]">
          {!perDayMode ? (
            <>
              {describeShifts(shared)}
              {closedGapLabel(shared) && <span className="ml-1 font-medium text-[var(--amber)]">· {closedGapLabel(shared)}</span>}
            </>
          ) : (
            <span>Each open day has its own hours.</span>
          )}
        </div>
        <button
          type="button"
          className="text-xs font-medium text-[var(--teal)] underline"
          onClick={() => {
            if (perDayMode) {
              // Back to one pattern for every open day: the first open day's hours.
              setPerDayMode(false);
              emit(shared, read.perDay);
            } else {
              setPerDayMode(true);
            }
          }}
        >
          {perDayMode ? 'Use the same hours every day' : 'Customise per day'}
        </button>
      </div>
    </Field>
  );
}
