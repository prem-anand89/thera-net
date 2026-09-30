import { useEffect, useMemo, useRef } from 'react';
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
  type ClosedDayInfo,
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
      const end = slot.minutes + slotMinutes;
      // Same rule as the server: every non-cancelled appointment holds its time.
      return !blocks.some(
        (b) => b.appointment.status !== 'cancelled' && b.start < end && b.end > slot.minutes
      );
    });
  }, [onBook, closed.closed, isPastDay, slotMinutes, hours.startHour, hours.endHour, nowMinutes, blocks]);

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
      {closed.closed && (
        <div className="pointer-events-none absolute inset-x-1 top-1 z-[1] rounded bg-[var(--surface)]/90 px-1.5 py-0.5 text-center text-[11px] font-medium text-[var(--slate)]">
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
            className="group absolute inset-x-0.5 rounded-md bg-[var(--moss-light)]/50 text-left text-[11px] text-transparent hover:bg-[var(--moss-light)] hover:text-[var(--moss-strong)] focus-visible:text-[var(--moss-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--teal)]"
            style={{ top: geometry.top + 1, height: geometry.height - 2 }}
          >
            <span className="px-1.5">+ {slot.label}</span>
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
                  {minutesLabel(start)}–{minutesLabel(end)} · {formatMinutes(end - start)}
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
          className="absolute right-2 -translate-y-1/2 text-[11px] text-[var(--muted)]"
          style={{ top: index * 60 * PX_PER_MINUTE, ...(index === 0 ? { transform: 'none' } : {}) }}
        >
          {minutesLabel((hours.startHour + index) * 60).replace(':00', '')}
        </span>
      ))}
    </div>
  );
}

/** Scrolls the grid so "now" (or the first appointment) is near the top. */
function useInitialScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  hours: GridHours,
  focusMinutes: number | null,
  key: string
) {
  useEffect(() => {
    const element = ref.current;
    if (!element || focusMinutes === null) return;
    element.scrollTop = Math.max(0, (focusMinutes - hours.startHour * 60 - 45) * PX_PER_MINUTE);
  }, [ref, hours.startHour, focusMinutes, key]);
}

type GridColumn = {
  key: string;
  label: string;
  date: string;
  header: React.ReactNode;
  appointments: Appointment[];
  closed: ClosedDayInfo;
  onBook?: (time: string) => void;
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
  useInitialScroll(scrollRef, hours, showsToday ? nowMinutes : firstStart ?? null, scrollKey);
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
}) {
  const columns: GridColumn[] = therapists.map((therapist) => ({
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
