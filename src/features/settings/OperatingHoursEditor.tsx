import { useMemo, useState } from 'react';
import { Field, InfoTip, Segmented } from '@/components/ui';
import {
  closedGapLabel,
  daysLabel,
  describeShifts,
  envelopeOf,
  groupDays,
  intervalsOf,
  operatingFromDays,
  operatingFromShifts,
  shiftsFromOperating,
  shiftsProblem,
  sameShifts,
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

/** "9 AM" or "12 PM": a ruler label. */
function hourTick(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** The stretch of the day every bar is drawn on: opening to closing for the whole week, widened by the staff-only hours. */
export type BarRange = { lo: number; hi: number; openFrom: number; openTo: number };

export function barRange(groups: readonly { shifts: Shifts }[], bufferHours: number): BarRange | null {
  if (groups.length === 0) return null;
  const openFrom = Math.floor(Math.min(...groups.map((g) => g.shifts.s1[0])) / 60) * 60;
  const openTo = Math.ceil(Math.max(...groups.map((g) => (g.shifts.s2 ?? g.shifts.s1)[1])) / 60) * 60;
  const buffer = Math.max(0, Math.round(bufferHours)) * 60;
  return { lo: Math.max(0, openFrom - buffer), hi: Math.min(1440, openTo + buffer), openFrom, openTo };
}

/**
 * Ruler marks from the start of the bar to its end, at most about six, in steps of 1 to 4 hours (a step that divides
 * the stretch evenly when one does). The end is always marked; a mark too close before it is dropped.
 */
export function rulerTicks(lo: number, hi: number): number[] {
  const hours = (hi - lo) / 60;
  if (hours <= 0) return [lo];
  const fits = [1, 2, 3, 4].filter((s) => hours / s <= 6);
  const step = (fits.find((s) => hours % s === 0) ?? fits[0] ?? Math.ceil(hours / 6)) * 60;
  const ticks: number[] = [];
  for (let t = lo; t < hi; t += step) ticks.push(t);
  if (ticks.length > 1 && hi - ticks[ticks.length - 1] < step * 0.6) ticks.pop();
  ticks.push(hi);
  return ticks;
}

/**
 * The day as a timeline with no text on the bar: it spans the clinic's opening hours plus the time staff may book
 * outside them (light teal at each end), the open sessions in teal, a closure hatched in amber. An hour ruler sits
 * underneath, from its start to its end (`rulerTicks`). All cards share one range so they line up.
 */
function DayBar({ shifts, range }: { shifts: Shifts; range: BarRange }) {
  const { lo, hi } = range;
  if (hi <= lo) return null;
  const at = (minutes: number) => ((minutes - lo) / (hi - lo)) * 100;
  const span = (from: number, to: number) => ({ left: `${at(from)}%`, width: `${at(to) - at(from)}%` });
  const ticks = rulerTicks(lo, hi);
  return (
    <div data-testid="day-bar" role="img" aria-label={`${describeShifts(shifts)}${closedGapLabel(shifts) ? `. ${closedGapLabel(shifts)}` : ''}`}>
      <div className="relative h-3 overflow-hidden rounded-full bg-[var(--paper)] ring-1 ring-inset ring-[var(--border)]">
        {range.openFrom > lo && <span data-part="staff" className="absolute inset-y-0 bg-[var(--teal-light)]" style={span(lo, range.openFrom)} />}
        {range.openTo < hi && <span data-part="staff" className="absolute inset-y-0 bg-[var(--teal-light)]" style={span(range.openTo, hi)} />}
        {shifts.s2 && (
          <span
            data-part="closed"
            className="absolute inset-y-0"
            style={{
              ...span(shifts.s1[1], shifts.s2[0]),
              backgroundImage: 'repeating-linear-gradient(135deg, var(--amber) 0 1.5px, transparent 1.5px 5px)',
              opacity: 0.6,
            }}
          />
        )}
        {[shifts.s1, ...(shifts.s2 ? [shifts.s2] : [])].map(([from, to]) => (
          <span key={from} data-part="open" className="absolute inset-y-0 rounded-full bg-[var(--teal)]" style={span(from, to)} />
        ))}
      </div>
      <div className="relative mt-1 h-3.5 text-caption leading-none text-[var(--muted)]">
        {ticks.map((t) => {
          const pct = at(t);
          return (
            <span
              key={t}
              className="absolute whitespace-nowrap"
              style={{ left: `${pct}%`, transform: pct < 6 ? 'none' : pct > 94 ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {hourTick(t)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** What the colours on the day bar mean; shown once under the cards. */
function BarLegend({ staff, closed }: { staff: boolean; closed: boolean }) {
  const swatch = 'inline-block h-2 w-3.5 rounded-sm align-middle';
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-hint text-[var(--muted)]" data-testid="bar-legend">
      <span>
        <span className={`${swatch} bg-[var(--teal)]`} /> Open
      </span>
      {closed && (
        <span>
          <span className={swatch} style={{ backgroundImage: 'repeating-linear-gradient(135deg, var(--amber) 0 1.5px, transparent 1.5px 5px)' }} /> Closed
        </span>
      )}
      {staff && (
        <span>
          <span className={`${swatch} bg-[var(--teal-light)] ring-1 ring-inset ring-[var(--border)]`} /> Staff can book
        </span>
      )}
    </p>
  );
}

function ShiftsFields({
  shifts,
  onChange,
  idPrefix,
  range,
}: {
  shifts: Shifts;
  onChange: (next: Shifts) => void;
  idPrefix: string;
  range: BarRange | null;
}) {
  const kind = shifts.s2 ? 'split' : 'continuous';
  const choose = (next: (typeof KINDS)[number]['value']) => {
    // Continuous to Split cuts the day in two for you to adjust; back to Continuous joins it from first start to last end.
    onChange(next === 'split' ? splitSession(shifts.s1) : { s1: [shifts.s1[0], shifts.s2 ? shifts.s2[1] : shifts.s1[1]], s2: null });
  };
  const closed = closedGapLabel(shifts);
  const problem = shiftsProblem(shifts);
  const openMinutes = intervalsOf(shifts).reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0);
  return (
    <div className="space-y-2.5">
      <Segmented label="Hours type" options={KINDS} value={kind} onChange={choose} />
      <SessionRow label={shifts.s2 ? 'Session 1' : 'Open'} idPrefix={`${idPrefix}-s1`} value={shifts.s1} onChange={(s1) => onChange({ ...shifts, s1 })} />
      {shifts.s2 && <SessionRow label="Session 2" idPrefix={`${idPrefix}-s2`} value={shifts.s2} onChange={(s2) => onChange({ ...shifts, s2 })} />}
      {range && <DayBar shifts={shifts} range={range} />}
      {problem ? (
        <p className="text-xs font-medium text-[var(--rust)]" role="alert">
          {problem}
        </p>
      ) : (
        <p className="text-xs text-[var(--muted)]" data-testid="hours-summary">
          {formatDuration(openMinutes)} open
          {closed && shifts.s2 && (
            <span className="font-medium text-[var(--amber)]">
              {' · '}
              {closed} ({formatDuration(shifts.s2[0] - shifts.s1[1])})
            </span>
          )}
        </p>
      )}
    </div>
  );
}

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Settings → Schedule & Booking → Hours & closures: when the clinic is open. The days that share the most common hours
 * are the "Usual hours" card. Any day that differs sits on a "Different hours" card whose day tiles really toggle: tap
 * a day to give it these hours, tap it again to send it back to the usual hours. "+ Add different hours for some days"
 * starts a card copied from the usual hours; set its times, then pick its days. One or two sessions a day
 * (Continuous | Split). Every card's day bar uses the same range: opening to closing plus the staff-only hours.
 */
export function OperatingHoursEditor({
  operatingHours,
  startHour,
  endHour,
  closedWeekdays,
  onChange,
  editing = true,
  bufferHours = 0,
}: {
  operatingHours: WorkingHours | null | undefined;
  startHour: number;
  endHour: number;
  closedWeekdays: readonly number[];
  onChange: (change: OperatingHoursChange, problem: string | null) => void;
  /** False while the section is read-only: hides the add / remove / cancel actions. */
  editing?: boolean;
  /** Hours staff may book before opening and after closing; widens the day bar. */
  bufferHours?: number;
}) {
  const openWeekdays = useMemo(() => WEEK_ORDER.filter((d) => !closedWeekdays.includes(d)), [closedWeekdays]);
  const read = useMemo(
    () => shiftsFromOperating(operatingHours, openWeekdays, { startHour, endHour }),
    [operatingHours, openWeekdays, startHour, endHour]
  );
  const groups = useMemo(() => groupDays(read.perDay, openWeekdays), [read.perDay, openWeekdays]);
  // The usual hours: the set most days share (the earliest such set on a tie).
  const usual = groups.reduce<(typeof groups)[number] | undefined>((best, g) => (!best || g.days.length > best.days.length ? g : best), undefined);
  const exceptions = groups.filter((g) => g !== usual);
  // A new set of hours no day uses yet; it becomes a card of its own when a day is picked for it.
  const [draft, setDraft] = useState<Shifts | null>(null);
  const range = barRange(draft ? [...groups, { shifts: draft }] : groups, bufferHours);

  /** Stores a whole week's hours: one pattern when every open day matches, otherwise per day. */
  function commit(perDay: Record<number, Shifts>) {
    const first = perDay[openWeekdays[0]];
    const same = first !== undefined && openWeekdays.every((d) => perDay[d] && sameShifts(perDay[d], first));
    const uniform = same ? first : null;
    const change = changeFor(uniform, perDay, openWeekdays);
    if (change) onChange(change, operatingProblem(uniform, perDay, openWeekdays));
  }

  const assign = (days: readonly number[], shifts: Shifts) => {
    const next = { ...read.perDay };
    for (const d of days) next[d] = shifts;
    commit(next);
  };

  const several = openWeekdays.length > 1;
  const usualShifts: Shifts = usual?.shifts ?? { s1: [startHour * 60, endHour * 60], s2: null };
  const anyClosure = groups.some((g) => g.shifts.s2) || Boolean(draft?.s2);

  // Small square letter tiles that toggle: lit = this card's day. Each carries its full name for screen readers.
  const dayTiles = (current: readonly number[], onToggle: (day: number, on: boolean) => void, label: string, disabled = false) => (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {openWeekdays.map((day) => {
        const on = current.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={SHORT_DAY[day]}
            title={SHORT_DAY[day]}
            disabled={disabled}
            onClick={() => onToggle(day, on)}
            className={`size-9 rounded-md border text-xs font-semibold disabled:opacity-50 ${
              on ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--teal)]'
            }`}
          >
            {SHORT_DAY[day][0]}
          </button>
        );
      })}
    </div>
  );

  const card = 'space-y-2.5 rounded-lg border border-[var(--border)] p-2.5';
  const draftMatches = draft !== null && groups.some((g) => sameShifts(g.shifts, draft));

  return (
    <Field
      htmlFor={`oh-g${usual?.days[0] ?? 1}-s1-start`}
      label={
        <>
          Opening hours
          <InfoTip text="Patients can only book inside these hours. Use Split if the clinic closes in the middle of the day." />
        </>
      }
    >
      <div className="space-y-3" data-testid="operating-hours-editor">
        {usual && (
          <div role="group" aria-label={`Hours for ${daysLabel(usual.days)}`} className={exceptions.length || draft ? card : 'space-y-2.5'}>
            {(exceptions.length > 0 || draft) && (
              <p className="text-xs font-semibold text-[var(--ink)]">
                Usual hours <span className="font-normal text-[var(--muted)]">· {daysLabel(usual.days)}</span>
              </p>
            )}
            <ShiftsFields shifts={usual.shifts} idPrefix={`oh-g${usual.days[0]}`} range={range} onChange={(next) => assign(usual.days, next)} />
          </div>
        )}
        {exceptions.map((group) => (
          <div key={group.days[0]} role="group" aria-label={`Hours for ${daysLabel(group.days)}`} className={card}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--ink)]">
                Different hours <span className="font-normal text-[var(--muted)]">· {daysLabel(group.days)}</span>
              </p>
              {editing && (
                <button
                  type="button"
                  className="min-h-8 rounded-md px-2 text-xs font-medium text-[var(--muted)] hover:bg-[var(--paper)]"
                  onClick={() => assign(group.days, usualShifts)}
                >
                  Remove
                </button>
              )}
            </div>
            {dayTiles(
              group.days,
              (day, on) => assign([day], on ? usualShifts : group.shifts),
              `Days with these hours (${daysLabel(group.days)})`
            )}
            <ShiftsFields shifts={group.shifts} idPrefix={`oh-g${group.days[0]}`} range={range} onChange={(next) => assign(group.days, next)} />
          </div>
        ))}
        {editing && draft && (
          <div role="group" aria-label="New hours" className="space-y-2.5 rounded-lg border border-dashed border-[var(--teal)] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--ink)]">Different hours</p>
              <button type="button" className="min-h-8 rounded-md px-2 text-xs font-medium text-[var(--muted)] hover:bg-[var(--paper)]" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
            <ShiftsFields shifts={draft} idPrefix="oh-new" range={range} onChange={setDraft} />
            <p className="text-xs text-[var(--muted)]">{draftMatches ? 'Change the times above, then pick the days that use them.' : 'Which days use these hours?'}</p>
            {dayTiles(
              [],
              (day) => {
                assign([day], draft);
                setDraft(null);
              },
              'Days with the new hours',
              draftMatches
            )}
          </div>
        )}
        {range && (range.lo < range.openFrom || anyClosure) && <BarLegend staff={range.lo < range.openFrom} closed={anyClosure} />}
        {editing && several && !draft && (
          <button
            type="button"
            className="min-h-9 rounded-lg border border-dashed border-[var(--border)] px-3 text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)]"
            onClick={() => setDraft(usualShifts)}
          >
            + Add different hours for some days
          </button>
        )}
      </div>
    </Field>
  );
}
