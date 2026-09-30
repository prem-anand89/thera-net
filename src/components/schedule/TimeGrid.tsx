import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Appointment, UUID } from '@/domain/types';
import { APPOINTMENT_BLOCK_STYLE } from '@/domain/appointmentStatus';
import {
  appointmentMinutes,
  appointmentStartsOnDate,
  assignLanes,
  blockGeometry,
  formatMinutes,
  generateScheduleSlots,
  minutesLabel,
  minutesOfDay,
  withinWorking,
  type ClosedDayInfo,
  type Interval,
} from '@/domain/schedule';
import { CLOSED_HATCH_STYLE } from './scheduleColors';

/** 30 minutes = 48px: tall enough for two lines of text in a 30-minute block. */
export const PX_PER_MINUTE = 1.6;

export type GridHours = { startHour: number; endHour: number };

type DayColumnProps = {
  label: string;
  date: string;
  appointments: Appointment[];
  hours: GridHours;
  slotMinutes: number;
  closed: ClosedDayInfo;
  colorFor: (appointment: Appointment) => string;
  /** Minutes after midnight when this column is today, else null. */
  nowMinutes: number | null;
  isPastDay: boolean;
  selectedId: string | null;
  onSelect: (appointment: Appointment) => void;
  /** Omit to make free time non-bookable (e.g. a therapist viewing a colleague). */
  onBook?: (time: string) => void;
  /** Narrow columns (week view) show start time + length instead of a range. */
  dense?: boolean;
  /** Working intervals; time outside them is shaded and not offered. */
  working?: Interval[];
};

/** One vertical day column: free slots tinted and bookable, blocks sized by length. */
export function DayColumn({
  label,
  date,
  appointments,
  hours,
  slotMinutes,
  closed,
  colorFor,
  nowMinutes,
  isPastDay,
  selectedId,
  onSelect,
  onBook,
  dense = false,
  working,
}: DayColumnProps) {
  const height = (hours.endHour - hours.startHour) * 60 * PX_PER_MINUTE;
  const blocks = useMemo(
    () =>
      appointments.map((appointment) => {
        const start = minutesOfDay(appointment.scheduledAt);
        return { appointment, start, end: start + appointmentMinutes(appointment, slotMinutes) };
      }),
    [appointments, slotMinutes]
  );
  const lanes = useMemo(
    () => assignLanes(blocks.map((b) => ({ id: b.appointment.id, start: b.start, end: b.end }))),
    [blocks]
  );
  const freeSlots = useMemo(() => {
    if (!onBook || closed.closed || isPastDay) return [];
    return generateScheduleSlots(slotMinutes, hours.startHour, hours.endHour).filter((slot) => {
      if (nowMinutes !== null && slot.minutes < nowMinutes) return false;
      if (working && !withinWorking(working, slot.minutes, slotMinutes)) return false;
      const end = slot.minutes + slotMinutes;
      // Same rule as the server: every non-cancelled appointment holds its time.
      return !blocks.some(
        (b) => b.appointment.status !== 'cancelled' && b.start < end && b.end > slot.minutes
      );
    });
  }, [onBook, closed.closed, isPastDay, slotMinutes, hours.startHour, hours.endHour, nowMinutes, blocks, working]);
  const offHours = useMemo(() => {
    if (!working || closed.closed) return [];
    const open = hours.startHour * 60;
    const close = hours.endHour * 60;
    const result: Interval[] = [];
    let cursor = open;
    for (const interval of [...working].sort((a, b) => a.start - b.start)) {
      if (interval.start > cursor) result.push({ start: cursor, end: Math.min(interval.start, close) });
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < close) result.push({ start: cursor, end: close });
    return result.filter((r) => r.end > r.start);
  }, [working, closed.closed, hours.startHour, hours.endHour]);

  return (
    <div
      className="relative border-l border-[var(--border)]"
      style={{ height, ...(closed.closed ? CLOSED_HATCH_STYLE : {}) }}
      aria-label={`${label}, ${date}`}
    >
      {Array.from({ length: hours.endHour - hours.startHour }, (_, index) => (
        <div
          key={index}
          className="pointer-events-none absolute inset-x-0 border-t border-[var(--border)]"
          style={{ top: index * 60 * PX_PER_MINUTE }}
        />
      ))}
      {offHours.map((range) => (
        <div
          key={range.start}
          className="pointer-events-none absolute inset-x-0 bg-[var(--paper)]"
          style={{ top: (range.start - hours.startHour * 60) * PX_PER_MINUTE, height: (range.end - range.start) * PX_PER_MINUTE }}
          aria-hidden
          data-off-hours
        />
      ))}
      {closed.closed && (
        <div className="pointer-events-none absolute inset-x-1 top-1 z-[1] truncate rounded bg-[var(--surface)]/90 px-1.5 py-0.5 text-center text-[11px] font-medium text-[var(--slate)]">
          Closed{closed.label ? ` · ${closed.label}` : ''}
        </div>
      )}
      {freeSlots.map((slot) => {
        const geometry = blockGeometry(slot.minutes, slotMinutes, hours.startHour, PX_PER_MINUTE);
        return (
          <button
            key={slot.time}
            type="button"
            onClick={() => onBook?.(slot.time)}
            aria-label={`Book ${label} at ${slot.label}`}
            className="group absolute inset-x-0.5 rounded-md text-left text-[11px] text-[var(--moss-strong)] hover:bg-[var(--moss-light)] focus-visible:bg-[var(--moss-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--teal)]"
            style={{ top: geometry.top + 1, height: geometry.height - 2 }}
          >
            {/* Free time stays blank so bookings stand out; touch screens (no
                hover) get a faint "+" so it's still discoverable. */}
            <span className="hidden px-1.5 opacity-40 pointer-coarse:inline group-hover:!hidden group-focus-visible:!hidden" aria-hidden>+</span>
            <span className="hidden px-1.5 group-hover:inline group-focus-visible:inline">+ {slot.label}</span>
          </button>
        );
      })}
      {blocks.map(({ appointment, start, end }) => {
        const geometry = blockGeometry(start, end - start, hours.startHour, PX_PER_MINUTE);
        const lane = lanes.get(appointment.id) ?? { lane: 0, lanes: 1 };
        const style = APPOINTMENT_BLOCK_STYLE[appointment.status];
        const compact = geometry.height < 34;
        return (
          <button
            key={appointment.id}
            type="button"
            onClick={() => onSelect(appointment)}
            title={`${appointment.patientName} · ${minutesLabel(start)}–${minutesLabel(end)}`}
            className={`absolute z-[2] overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs shadow-sm ${style.fill} ${style.text} ${
              selectedId === appointment.id ? 'outline outline-2 outline-[var(--teal)]' : ''
            }`}
            style={{
              top: geometry.top,
              height: geometry.height - 1,
              left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
              width: `calc(${100 / lane.lanes}% - 4px)`,
              borderLeftColor: colorFor(appointment),
            }}
          >
            {compact ? (
              <span className="block truncate">
                {style.mark && <span aria-hidden>{style.mark} </span>}
                {minutesLabel(start)} {appointment.patientName}
              </span>
            ) : (
              <>
                <span className="block truncate font-medium">
                  {style.mark && <span aria-hidden>{style.mark} </span>}
                  {appointment.patientName}
                </span>
                <span className="block truncate text-[11px] opacity-80">
                  {dense ? minutesLabel(start) : `${minutesLabel(start)}–${minutesLabel(end)}`} · {formatMinutes(end - start)}
                </span>
              </>
            )}
          </button>
        );
      })}
      {nowMinutes !== null && nowMinutes >= hours.startHour * 60 && nowMinutes <= hours.endHour * 60 && (
        <div
          className="pointer-events-none absolute inset-x-0 z-[3] border-t-2 border-[var(--rust)]"
          style={{ top: (nowMinutes - hours.startHour * 60) * PX_PER_MINUTE }}
          data-now-line
          aria-hidden
        >
          <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-[var(--rust)]" />
        </div>
      )}
    </div>
  );
}

function TimeAxis({ hours }: { hours: GridHours }) {
  return (
    <div className="relative" style={{ height: (hours.endHour - hours.startHour) * 60 * PX_PER_MINUTE }}>
      {Array.from({ length: hours.endHour - hours.startHour }, (_, index) => (
        <span
          key={index}
          // Labels centre on their hour line, except the first, which would
          // otherwise sit half under the sticky column headers.
          className={`absolute right-2 text-[11px] text-[var(--muted)] ${index === 0 ? 'top-0.5' : '-translate-y-1/2'}`}
          style={index === 0 ? undefined : { top: index * 60 * PX_PER_MINUTE }}
        >
          {minutesLabel((hours.startHour + index) * 60).replace(':00', '')}
        </span>
      ))}
    </div>
  );
}

/**
 * Where the grid should open. The focus is "now" while today is inside
 * booking hours, otherwise the first appointment, otherwise opening time.
 * The grid stays at the top (first rows visible) unless the focus would be
 * below the visible area; then it scrolls so the focus sits an hour down.
 */
export function initialScrollTop(
  hours: GridHours,
  options: { nowMinutes: number | null; firstStart: number | null; viewportHeight: number }
): number {
  const open = hours.startHour * 60;
  const close = hours.endHour * 60;
  const { nowMinutes, firstStart, viewportHeight } = options;
  const focus =
    nowMinutes !== null && nowMinutes >= open && nowMinutes < close
      ? nowMinutes
      : firstStart !== null && firstStart >= open && firstStart < close
        ? firstStart
        : open;
  const focusTop = (focus - open) * PX_PER_MINUTE;
  // Keep ~1.5 hours visible under the focus before scrolling at all.
  if (focusTop + 90 * PX_PER_MINUTE <= viewportHeight) return 0;
  return Math.max(0, focusTop - 60 * PX_PER_MINUTE);
}

/** Positions the grid once per date/week — never again while the user scrolls. */
function useInitialScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  key: string,
  compute: (viewportHeight: number) => number
) {
  const positionedFor = useRef<string | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || positionedFor.current === key) return;
    positionedFor.current = key;
    // Column headers take the top of the scroll box.
    const header = element.querySelector<HTMLElement>('[data-grid-header]')?.offsetHeight ?? 0;
    element.scrollTop = compute(element.clientHeight - header);
  }, [ref, key, compute]);
}

type GridColumn = {
  key: string;
  label: string;
  date: string;
  header: React.ReactNode;
  appointments: Appointment[];
  closed: ClosedDayInfo;
  onBook?: (time: string) => void;
  working?: Interval[];
};

function GridFrame({
  columns,
  hours,
  slotMinutes,
  today,
  nowMinutes,
  colorFor,
  selectedId,
  onSelect,
  scrollKey,
  minColumnWidth,
}: {
  columns: GridColumn[];
  hours: GridHours;
  slotMinutes: number;
  today: string;
  nowMinutes: number;
  colorFor: (appointment: Appointment) => string;
  selectedId: string | null;
  onSelect: (appointment: Appointment) => void;
  scrollKey: string;
  minColumnWidth: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const showsToday = columns.some((column) => column.date === today);
  const firstStart = columns
    .flatMap((column) => column.appointments.map((a) => minutesOfDay(a.scheduledAt)))
    .sort((a, b) => a - b)[0];
  const focusNow = showsToday ? nowMinutes : null;
  const computeScroll = useCallback(
    (viewportHeight: number) =>
      initialScrollTop(hours, { nowMinutes: focusNow, firstStart: firstStart ?? null, viewportHeight }),
    [hours, focusNow, firstStart]
  );
  useInitialScroll(scrollRef, scrollKey, computeScroll);
  const template = `56px repeat(${columns.length}, minmax(${minColumnWidth}px, 1fr))`;

  return (
    <div
      ref={scrollRef}
      className="max-h-[calc(100vh-240px)] min-h-[420px] overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="grid" style={{ gridTemplateColumns: template }}>
        <div className="sticky left-0 top-0 z-[5] border-b border-[var(--border)] bg-[var(--surface)]" />
        {columns.map((column) => (
          <div
            key={column.key}
            className="sticky top-0 z-[4] border-b border-l border-[var(--border)] bg-[var(--surface)] px-2 py-2"
            data-grid-header
          >
            {column.header}
          </div>
        ))}
        <div className="sticky left-0 z-[4] bg-[var(--surface)]">
          <TimeAxis hours={hours} />
        </div>
        {columns.map((column) => (
          <DayColumn
            key={column.key}
            label={column.label}
            date={column.date}
            appointments={column.appointments}
            hours={hours}
            slotMinutes={slotMinutes}
            closed={column.closed}
            colorFor={colorFor}
            nowMinutes={column.date === today ? nowMinutes : null}
            isPastDay={column.date < today}
            selectedId={selectedId}
            onSelect={onSelect}
            onBook={column.onBook}
            dense={minColumnWidth < 150}
            working={column.working}
          />
        ))}
      </div>
    </div>
  );
}

export type GridTherapist = { id: UUID | ''; name: string; color: string };

/** Athena-style: one column per therapist for a single day. */
export function ResourceDayGrid({
  date,
  today,
  nowMinutes,
  therapists,
  appointments,
  hours,
  slotMinutes,
  closed,
  colorFor,
  selectedId,
  onSelect,
  canBookFor,
  onBook,
  summaryFor,
  workingFor,
}: {
  date: string;
  today: string;
  nowMinutes: number;
  therapists: GridTherapist[];
  appointments: Appointment[];
  hours: GridHours;
  slotMinutes: number;
  closed: ClosedDayInfo;
  colorFor: (appointment: Appointment) => string;
  selectedId: string | null;
  onSelect: (appointment: Appointment) => void;
  canBookFor: (therapistId: string) => boolean;
  onBook: (input: { time: string; therapistId: string }) => void;
  summaryFor: (therapistId: string) => string;
  /** Working intervals for a therapist on this date; omit = booking hours. */
  workingFor?: (therapistId: string) => Interval[];
}) {
  const columns: GridColumn[] = therapists.map((therapist) => ({
    working: therapist.id && workingFor ? workingFor(therapist.id) : undefined,
    key: therapist.id || 'unassigned',
    label: therapist.name,
    date,
    closed,
    appointments: appointments.filter(
      (appointment) =>
        appointmentStartsOnDate(appointment, date) &&
        (therapist.id
          ? appointment.therapistId === therapist.id
          : !therapists.some((t) => t.id && t.id === appointment.therapistId))
    ),
    header: (
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--ink)]">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: therapist.color }} aria-hidden />
          {therapist.name}
        </p>
        <p className="text-[11px] text-[var(--muted)]">{summaryFor(therapist.id)}</p>
      </div>
    ),
    onBook:
      therapist.id && canBookFor(therapist.id)
        ? (time: string) => onBook({ time, therapistId: therapist.id })
        : undefined,
  }));

  return (
    <GridFrame
      columns={columns}
      hours={hours}
      slotMinutes={slotMinutes}
      today={today}
      nowMinutes={nowMinutes}
      colorFor={colorFor}
      selectedId={selectedId}
      onSelect={onSelect}
      scrollKey={date}
      minColumnWidth={170}
    />
  );
}

/** Google-style: one therapist, seven day columns. */
export function WeekTimeGrid({
  days,
  today,
  nowMinutes,
  appointments,
  hours,
  slotMinutes,
  closedFor,
  colorFor,
  selectedId,
  onSelect,
  onBook,
  onOpenDay,
  workingFor,
}: {
  days: string[];
  today: string;
  nowMinutes: number;
  appointments: Appointment[];
  hours: GridHours;
  slotMinutes: number;
  closedFor: (date: string) => ClosedDayInfo;
  colorFor: (appointment: Appointment) => string;
  selectedId: string | null;
  onSelect: (appointment: Appointment) => void;
  onBook?: (input: { date: string; time: string }) => void;
  onOpenDay: (date: string) => void;
  workingFor?: (date: string) => Interval[];
}) {
  const columns: GridColumn[] = days.map((day) => {
    const value = new Date(`${day}T00:00:00`);
    const dayAppointments = appointments.filter((a) => appointmentStartsOnDate(a, day));
    return {
      key: day,
      label: value.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }),
      date: day,
      closed: closedFor(day),
      appointments: dayAppointments,
      header: (
        <button type="button" onClick={() => onOpenDay(day)} className="w-full text-left" aria-label={`Open ${day} in day view`}>
          <span className={`block text-[11px] uppercase ${day === today ? 'text-[var(--teal)]' : 'text-[var(--muted)]'}`}>
            {value.toLocaleDateString('en-IN', { weekday: 'short' })}
          </span>
          <span
            className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold ${
              day === today ? 'bg-[var(--teal)] text-white' : 'text-[var(--ink)]'
            }`}
          >
            {value.getDate()}
          </span>
          <span className="ml-1 text-[11px] text-[var(--muted)]">
            {dayAppointments.filter((a) => a.status !== 'cancelled').length || ''}
          </span>
        </button>
      ),
      onBook: onBook ? (time: string) => onBook({ date: day, time }) : undefined,
      working: workingFor ? workingFor(day) : undefined,
    };
  });

  return (
    <GridFrame
      columns={columns}
      hours={hours}
      slotMinutes={slotMinutes}
      today={today}
      nowMinutes={nowMinutes}
      colorFor={colorFor}
      selectedId={selectedId}
      onSelect={onSelect}
      scrollKey={days[0]}
      minColumnWidth={110}
    />
  );
}
