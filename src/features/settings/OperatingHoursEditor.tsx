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
import { formatDuration } from './shiftDraft';
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
    <div>
      <span className="mb-1 block text-xs text-[var(--muted)]">{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <input
          id={`${idPrefix}-start`}
          type="time"
          step={900}
          aria-label={`${label} starts`}
          className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm tab:min-h-9"
          value={toTime(value[0])}
          onChange={(e) => onChange([toMinutes(e.target.value), value[1]])}
        />
        <span className="text-xs text-[var(--muted)]">to</span>
        <input
          id={`${idPrefix}-end`}
          type="time"
          step={900}
          aria-label={`${label} ends`}
          className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm tab:min-h-9"
          value={toTime(value[1])}
          onChange={(e) => onChange([value[0], toMinutes(e.target.value)])}
        />
      </div>
    </div>
  );
}

const KINDS = [
  { value: 'continuous', label: 'Continuous', hint: 'Open all day, one stretch' },
  { value: 'split', label: 'Split', hint: 'Closed for lunch, or between a morning and an evening session' },
] as const;

/** "9 AM" or "1:30 PM": short enough to sit under a stretch of the day bar. */
function compactClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * The day drawn to scale, labelled by itself: each open stretch is a teal block carrying its length, a break is a
 * hatched block carrying its length, and the times sit under each stretch ("9 AM–1 PM", "1 PM–2 PM"). Reading the bar
 * alone gives the opening time, the closing time and the break.
 */
function DayBar({ shifts }: { shifts: Shifts }) {
  const start = shifts.s1[0];
  const end = shifts.s2 ? shifts.s2[1] : shifts.s1[1];
  if (end <= start) return null;
  const parts: { open: boolean; from: number; to: number }[] = [{ open: true, from: shifts.s1[0], to: shifts.s1[1] }];
  if (shifts.s2) {
    parts.push({ open: false, from: shifts.s1[1], to: shifts.s2[0] }, { open: true, from: shifts.s2[0], to: shifts.s2[1] });
  }
  const grow = (part: { from: number; to: number }) => ({ flex: `${Math.max(part.to - part.from, 1)} 1 0%` });
  return (
    <div data-testid="day-bar" role="img" aria-label={`${describeShifts(shifts)}${closedGapLabel(shifts) ? `. ${closedGapLabel(shifts)}` : ''}`}>
      <div className="flex h-8 gap-0.5">
        {parts.map((part, i) => (
          <div
            key={i}
            style={{
              ...grow(part),
              ...(part.open ? {} : { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 4px, var(--border) 4px 6px)' }),
            }}
            className={`flex min-w-0 items-center justify-center overflow-hidden text-[11px] font-medium ${
              part.open
                ? `bg-[var(--teal)] text-white ${i === 0 ? 'rounded-l-md' : ''} ${i === parts.length - 1 ? 'rounded-r-md' : ''}`
                : 'border-y border-dashed border-[var(--amber)] text-[var(--amber)]'
            }`}
          >
            <span className="truncate px-1">{formatDuration(part.to - part.from)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-[var(--muted)]">
        {parts.map((part, i) => (
          <div key={i} style={grow(part)} className={`min-w-0 text-center whitespace-nowrap ${part.open ? 'truncate' : 'text-[var(--amber)]'}`}>
            {compactClock(part.from)}–{compactClock(part.to)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShiftsFields({ shifts, onChange, idPrefix }: { shifts: Shifts; onChange: (next: Shifts) => void; idPrefix: string }) {
  const kind = shifts.s2 ? 'split' : 'continuous';
  const choose = (next: (typeof KINDS)[number]['value']) => {
    if (next === kind) return;
    // Continuous to Split cuts the day in two for you to adjust; back to Continuous joins it from first start to last end.
    onChange(next === 'split' ? splitSession(shifts.s1) : { s1: [shifts.s1[0], shifts.s2 ? shifts.s2[1] : shifts.s1[1]], s2: null });
  };
  const closed = closedGapLabel(shifts);
  return (
    <div className="space-y-2.5">
      <div role="radiogroup" aria-label="Hours type" className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--paper)] p-0.5">
        {KINDS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={kind === item.value}
            title={item.hint}
            onClick={() => choose(item.value)}
            className={`min-h-9 rounded-md px-3 text-xs font-medium ${
              kind === item.value ? 'bg-[var(--surface)] text-[var(--teal-strong)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <SessionRow label={shifts.s2 ? 'Session 1' : 'Open'} idPrefix={`${idPrefix}-s1`} value={shifts.s1} onChange={(s1) => onChange({ ...shifts, s1 })} />
      {shifts.s2 && <SessionRow label="Session 2" idPrefix={`${idPrefix}-s2`} value={shifts.s2} onChange={(s2) => onChange({ ...shifts, s2 })} />}
      <DayBar shifts={shifts} />
      {closed && shifts.s2 && (
        <p className="text-xs font-medium text-[var(--amber)]">
          {closed} · {formatDuration(shifts.s2[0] - shifts.s1[1])} break
        </p>
      )}
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
      htmlFor={perDayMode ? `oh-${openWeekdays[0]}-s1-start` : 'oh-s1-start'}
      label={
        <>
          Clinic operating hours
          <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">when patients can be booked</span>
        </>
      }
    >
      <div className="space-y-3" data-testid="operating-hours-editor">
        {openWeekdays.length > 1 && (
          <div role="radiogroup" aria-label="Hours by day" className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--paper)] p-0.5">
            {[
              { perDay: false, label: 'Same every day' },
              { perDay: true, label: 'Different each day' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="radio"
                aria-checked={perDayMode === item.perDay}
                onClick={() => {
                  if (perDayMode === item.perDay) return;
                  setPerDayMode(item.perDay);
                  // Back to one pattern for every open day: the first open day's hours.
                  if (!item.perDay) emit(shared, read.perDay);
                }}
                className={`min-h-9 rounded-md px-3 text-xs font-medium ${
                  perDayMode === item.perDay ? 'bg-[var(--surface)] text-[var(--teal-strong)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {!perDayMode ? (
          <ShiftsFields shifts={shared} idPrefix="oh" onChange={(next) => emit(next, read.perDay)} />
        ) : (
          <div className="space-y-3">
            {openWeekdays.map((day) => (
              <div key={day} className="rounded-lg border border-[var(--border)] p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--ink)]">{WEEKDAY_NAMES[day]}</p>
                  <button
                    type="button"
                    aria-label={`Copy ${WEEKDAY_NAMES[day]}'s hours to every open day`}
                    className="min-h-8 rounded-md px-2 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                    onClick={() => emit(null, Object.fromEntries(openWeekdays.map((d) => [d, read.perDay[day]])))}
                  >
                    Copy to all days
                  </button>
                </div>
                <ShiftsFields
                  shifts={read.perDay[day]}
                  idPrefix={`oh-${day}`}
                  onChange={(next) => emit(null, { ...read.perDay, [day]: next })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
