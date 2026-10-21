import { appHeaderHeight } from '@/lib/appHeaderHeight';
import { shortName } from './therapistNames';
import { Panel } from '../ui';
import { loadDots } from './loadDots';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Appointment, UUID } from '@/domain/types';
import { appointmentMinutes, appointmentStartsOnDate, minutesLabel, minutesOfDay, withinWorking, type ClosedDayInfo, type Interval } from '@/domain/schedule';
import { LoadLine, type LoadSummary } from './LoadLine';
import { type PatientFlagContext } from '@/domain/patientFlags';
import { PX_PER_MINUTE, GridHours, PHONE_STICKY_TOP, PHONE_BOTTOM_NAV, GridColumn, GridDragOptions } from './gridShared';
import { DayColumn } from './DayColumn';
import { useGridDrag } from './useGridDrag';
export { PX_PER_MINUTE } from './gridShared';
export type { MultiLaneConfig, GridDragOptions, MoveTarget, GridHours, DragGhost, GridColumn } from './gridShared';
export { DayColumn } from './DayColumn';
export { useGridDrag } from './useGridDrag';

export type { LoadSummary } from './LoadLine';

export function TimeAxis({
  hours,
  pxPerMinute = PX_PER_MINUTE,
  nowMinutes = null,
}: {
  hours: GridHours;
  pxPerMinute?: number;
  /** When set, a "now" time badge is drawn on the axis at that time. */
  nowMinutes?: number | null;
}) {
  return (
    <div className="relative" style={{ height: (hours.endHour - hours.startHour) * 60 * pxPerMinute }}>
      {Array.from({ length: hours.endHour - hours.startHour }, (_, index) => (
        <span
          key={index}
          // Labels centre on their hour line, except the first, which would
          // otherwise sit half under the sticky column headers.
          className={`absolute right-2 text-[11px] text-[var(--muted)] ${index === 0 ? 'top-0.5' : '-translate-y-1/2'}`}
          style={index === 0 ? undefined : { top: index * 60 * pxPerMinute }}
        >
          {minutesLabel((hours.startHour + index) * 60).replace(':00', '')}
        </span>
      ))}
      {nowMinutes !== null && nowMinutes >= hours.startHour * 60 && nowMinutes <= hours.endHour * 60 && (
        <span
          className="pointer-events-none absolute right-0.5 z-[1] -translate-y-1/2 rounded bg-[var(--rust)] px-1 text-[9px] font-semibold leading-4 text-white"
          style={{ top: (nowMinutes - hours.startHour * 60) * pxPerMinute }}
          data-now-badge
        >
          {minutesLabel(nowMinutes).replace(' ', '')}
        </span>
      )}
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
  options: { nowMinutes: number | null; firstStart: number | null; viewportHeight: number; pxPerMinute?: number }
): number {
  const open = hours.startHour * 60;
  const close = hours.endHour * 60;
  const { nowMinutes, firstStart, viewportHeight, pxPerMinute = PX_PER_MINUTE } = options;
  const focus =
    nowMinutes !== null && nowMinutes >= open && nowMinutes < close
      ? nowMinutes
      : firstStart !== null && firstStart >= open && firstStart < close
        ? firstStart
        : open;
  const focusTop = (focus - open) * pxPerMinute;
  // Keep ~1.5 hours visible under the focus before scrolling at all.
  if (focusTop + 90 * pxPerMinute <= viewportHeight) return 0;
  return Math.max(0, focusTop - 60 * pxPerMinute);
}

/** Positions the grid once per date/week — never again while the user scrolls. */
function useInitialScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  key: string,
  compute: (viewportHeight: number) => number,
  pageScroll = false
) {
  const positionedFor = useRef<string | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || positionedFor.current === key) return;
    const firstTime = positionedFor.current === null;
    positionedFor.current = key;
    // Column headers take the top of the scroll box.
    const header = element.querySelector<HTMLElement>('[data-grid-header]')?.offsetHeight ?? 0;
    if (pageScroll) {
      // The page scrolls, not the grid: position once when the grid opens, never on a
      // later date change (that would scroll the date strip the user just tapped out of view).
      if (!firstTime) return;
      const headerTop = appHeaderHeight(PHONE_STICKY_TOP);
      const visible = window.innerHeight - headerTop - PHONE_BOTTOM_NAV - header;
      const offset = compute(visible);
      if (offset > 0) {
        window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - headerTop + offset });
      }
      return;
    }
    element.scrollTop = compute(element.clientHeight - header);
  }, [ref, key, compute, pageScroll]);
}

export function GridFrame({
  columns,
  hours,
  slotMinutes,
  stepMinutes,
  today,
  nowMinutes,
  colorFor,
  reasonFor,
  flagContext,
  selectedId,
  onSelect,
  scrollKey,
  minColumnWidth,
  drag,
  phone = false,
  pxPerMinute = PX_PER_MINUTE,
}: {
  columns: GridColumn[];
  hours: GridHours;
  slotMinutes: number;
  stepMinutes?: number;
  today: string;
  nowMinutes: number;
  colorFor: (appointment: Appointment) => string;
  /** Short condition / reason shown on blocks an hour or longer. */
  reasonFor?: (appointment: Appointment) => string | null;
  /** Patient flags shown as small badges on each block. */
  flagContext?: PatientFlagContext;
  selectedId: string | null;
  onSelect: (appointment: Appointment) => void;
  scrollKey: string;
  minColumnWidth: number;
  drag?: GridDragOptions;
  /** Phone presentation: narrow time axis, adaptive blocks, visible free time, viewport-height scroll box. */
  phone?: boolean;
  pxPerMinute?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const showsToday = columns.some((column) => column.date === today);
  const firstStart = columns
    .flatMap((column) => column.appointments.map((a) => minutesOfDay(a.scheduledAt)))
    .sort((a, b) => a - b)[0];
  const focusNow = showsToday ? nowMinutes : null;
  const computeScroll = useCallback(
    (viewportHeight: number) =>
      initialScrollTop(hours, { nowMinutes: focusNow, firstStart: firstStart ?? null, viewportHeight, pxPerMinute }),
    [hours, focusNow, firstStart, pxPerMinute]
  );
  // Phone grids up to three columns fit the screen width, so the page scrolls and the grid has no box of its own.
  const pageScroll = phone && columns.length <= 3;
  useInitialScroll(scrollRef, scrollKey, computeScroll, pageScroll);
  const stickyTop = pageScroll ? { top: `var(--app-header-h, calc(${PHONE_STICKY_TOP}px + env(safe-area-inset-top)))` } : undefined;
  // One-column phone Day: no axis column — the hour rail lives inside the column so the cards get the width.
  const railMode = phone && columns.length === 1;
  const template = railMode
    ? `minmax(${minColumnWidth}px, 1fr)`
    : `${phone ? 52 : 56}px repeat(${columns.length}, minmax(${minColumnWidth}px, 1fr))`;
  const { columnDrag, placing, cancelPlacing } = useGridDrag({ columns, hours, slotMinutes, today, nowMinutes, options: drag, pxPerMinute, scrollRef, pageScroll });

  return (
    <>
    {placing && (
      <div
        role="status"
        className={`flex items-center justify-between gap-3 rounded-xl bg-[var(--teal-light)] px-3 py-2 text-sm text-[var(--ink)] ${
          // Page scroll: the top of the grid may be off-screen, so the bar sits above the bottom nav, clear of the round Book button.
          pageScroll ? 'fixed bottom-[calc(5rem+env(safe-area-inset-bottom)+0.5rem)] left-4 right-[5.5rem] z-[10] shadow-lg' : 'mb-2'
        }`}
        data-placing-bar
      >
        <span>
          Tap free time to move <strong>{placing.appointment.patientName}</strong>.
        </span>
        <button type="button" className="min-h-9 text-xs font-medium text-[var(--teal)]" onClick={cancelPlacing}>
          Cancel
        </button>
      </div>
    )}
    <div
      ref={scrollRef}
      className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${
        pageScroll
          ? ''
          : phone
            ? 'max-h-[calc(100dvh-17rem)] min-h-[320px] overflow-auto overscroll-contain'
            : 'max-h-[calc(100vh-240px)] min-h-[420px] overflow-auto'
      }`}
      data-schedule-grid
    >
      <div className="grid" style={{ gridTemplateColumns: template }}>
        {!railMode && <div className="sticky left-0 top-0 z-[5] border-b border-[var(--border)] bg-[var(--surface)]" style={stickyTop} />}
        {columns.map((column) => (
          <div
            key={column.key}
            className={`sticky top-0 z-[4] border-b border-[var(--border)] bg-[var(--surface)] px-2 py-2 ${railMode ? '' : 'border-l'}`}
            style={stickyTop}
            data-grid-header
          >
            {column.header}
          </div>
        ))}
        {!railMode && (
          <div className="sticky left-0 z-[4] bg-[var(--surface)]">
            <TimeAxis hours={hours} pxPerMinute={pxPerMinute} nowMinutes={phone && showsToday ? nowMinutes : null} />
          </div>
        )}
        {columns.map((column) => (
          <DayColumn
            key={column.key}
            label={column.label}
            date={column.date}
            appointments={column.appointments}
            hours={hours}
            slotMinutes={slotMinutes}
            stepMinutes={stepMinutes}
            closed={column.closed}
            colorFor={colorFor}
            reasonFor={column.isColleague ? undefined : reasonFor}
            flagContext={column.isColleague ? undefined : flagContext}
            nowMinutes={column.date === today ? nowMinutes : null}
            isPastDay={column.date < today}
            selectedId={selectedId}
            onSelect={onSelect}
            onBook={column.onBook}
            dense={minColumnWidth < 150}
            phone={phone}
            rail={railMode}
            pxPerMinute={pxPerMinute}
            working={column.working}
            drag={columnDrag(column)}
            isColleague={column.isColleague}
            multi={column.multi}
          />
        ))}
      </div>
    </div>
    </>
  );
}

export type GridTherapist = {
  id: UUID | '';
  name: string;
  color: string;
  /** When set, the column's color dot is a button that opens the color sheet (admin, or the therapist's own column). */
  onPickColor?: () => void;
};

/** Athena-style: one column per therapist for a single day. */
export function ResourceDayGrid({
  date,
  today,
  nowMinutes,
  therapists,
  appointments,
  hours,
  slotMinutes,
  stepMinutes,
  closed,
  colorFor,
  reasonFor,
  flagContext,
  selectedId,
  onSelect,
  canBookFor,
  onBook,
  summaryFor,
  workingFor,
  drag,
  phone = false,
  pxPerMinute,
}: {
  date: string;
  today: string;
  nowMinutes: number;
  therapists: GridTherapist[];
  appointments: Appointment[];
  hours: GridHours;
  slotMinutes: number;
  /** Free time is offered every this many minutes (the clinic's "Start times every"); defaults to slotMinutes. */
  stepMinutes?: number;
  closed: ClosedDayInfo;
  colorFor: (appointment: Appointment) => string;
  /** Short condition / reason shown on blocks an hour or longer. */
  reasonFor?: (appointment: Appointment) => string | null;
  /** Patient flags shown as small badges on each block. */
  flagContext?: PatientFlagContext;
  selectedId: string | null;
  onSelect: (appointment: Appointment) => void;
  canBookFor: (therapistId: string) => boolean;
  onBook: (input: { time: string; therapistId: string }) => void;
  summaryFor: (therapistId: string) => LoadSummary;
  /** Working intervals for a therapist on this date; omit = booking hours. */
  workingFor?: (therapistId: string) => Interval[];
  drag?: GridDragOptions;
  /** Phone presentation (see GridFrame). */
  phone?: boolean;
  pxPerMinute?: number;
}) {
  const columns: GridColumn[] = therapists.map((therapist) => {
    const isColleague = Boolean(therapist.id && !canBookFor(therapist.id));
    return {
      therapistId: therapist.id,
      isColleague,
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
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--ink)]" title={therapist.name}>
            {therapist.onPickColor ? (
              <button
                type="button"
                aria-label={`Change ${therapist.name}'s color`}
                title="Change color"
                className="relative h-2.5 w-2.5 shrink-0 rounded-full before:absolute before:-inset-2.5 before:content-[''] hover:ring-2 hover:ring-[var(--ink)]/30"
                style={{ background: therapist.color }}
                onClick={(event) => {
                  event.stopPropagation();
                  therapist.onPickColor?.();
                }}
              />
            ) : (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: therapist.color }} aria-hidden />
            )}
            {/* Three or more phone columns are narrow: the first name is what tells them apart ("Dr" would cost the space). */}
            {phone && therapists.length > 2 ? shortName(therapist.name) : therapist.name}
            {isColleague && !phone && (
              <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">· view only</span>
            )}
          </p>
          {isColleague && phone && <p className="truncate text-[11px] text-[var(--muted)]">view only</p>}
          <LoadLine summary={summaryFor(therapist.id)} color={therapist.color} />
        </div>
      ),
      onBook:
        therapist.id && canBookFor(therapist.id)
          ? (time: string) => onBook({ time, therapistId: therapist.id })
          : undefined,
    };
  });

  return (
    <GridFrame
      columns={columns}
      hours={hours}
      slotMinutes={slotMinutes}
      stepMinutes={stepMinutes}
      today={today}
      nowMinutes={nowMinutes}
      colorFor={colorFor}
      reasonFor={reasonFor}
      flagContext={flagContext}
      selectedId={selectedId}
      onSelect={onSelect}
      scrollKey={date}
      minColumnWidth={phone ? 96 : 170}
      drag={drag}
      phone={phone}
      pxPerMinute={pxPerMinute}
    />
  );
}

/** Several therapists in one week grid: shared day columns with a therapist pill on each block. */
export type WeekMultiTherapist = {
  therapists: GridTherapist[];
  canBookFor: (therapistId: string) => boolean;
  workingForTherapist: (therapistId: string, date: string) => Interval[];
  /** Therapists free and working at the tapped time, so the booking sheet offers only them. */
  onBookFree: (input: { date: string; time: string; freeTherapistIds: string[] }) => void;
};

const MAX_WEEK_LANES = 3;

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

/** Google-style week: one therapist, or (with `multi`) several sharing the day columns. */
export function WeekTimeGrid({
  days,
  today,
  nowMinutes,
  appointments,
  hours,
  slotMinutes,
  stepMinutes = slotMinutes,
  closedFor,
  colorFor,
  reasonFor,
  flagContext,
  selectedId,
  onSelect,
  onBook,
  onOpenDay,
  workingFor,
  drag,
  phone = false,
  pxPerMinute,
  isColleague = false,
  multi,
}: {
  days: string[];
  today: string;
  nowMinutes: number;
  appointments: Appointment[];
  hours: GridHours;
  slotMinutes: number;
  /** Free time is offered every this many minutes (the clinic's "Start times every"); defaults to slotMinutes. */
  stepMinutes?: number;
  closedFor: (date: string) => ClosedDayInfo;
  colorFor: (appointment: Appointment) => string;
  /** Short condition / reason shown on blocks an hour or longer. */
  reasonFor?: (appointment: Appointment) => string | null;
  /** Patient flags shown as small badges on each block. */
  flagContext?: PatientFlagContext;
  selectedId: string | null;
  onSelect: (appointment: Appointment) => void;
  onBook?: (input: { date: string; time: string }) => void;
  onOpenDay: (date: string) => void;
  workingFor?: (date: string) => Interval[];
  drag?: GridDragOptions;
  /** Phone presentation (see GridFrame); used with 3 days for the phone 3-Day view. */
  phone?: boolean;
  pxPerMinute?: number;
  /** The shown therapist is a colleague: read-only, no reasons or flags. */
  isColleague?: boolean;
  /** Several therapists in the same columns (desktop / iPad week). */
  multi?: WeekMultiTherapist;
}) {
  const [overflowList, setOverflowList] = useState<{ title: string; appointments: Appointment[] } | null>(null);
  const columns: GridColumn[] = days.map((day) => {
    const value = new Date(`${day}T00:00:00`);
    const dayAppointments = appointments.filter((a) => appointmentStartsOnDate(a, day));
    let multiColumn: Pick<GridColumn, 'multi' | 'working' | 'onBook'> | null = null;
    if (multi) {
      const bookable = multi.therapists.filter((t) => t.id && multi.canBookFor(t.id));
      const clashes = (therapistId: string, minutes: number, length: number, ignoreId?: string) =>
        dayAppointments.some((a) => {
          if (a.therapistId !== therapistId || a.status === 'cancelled' || a.id === ignoreId) return false;
          const start = minutesOfDay(a.scheduledAt);
          return start < minutes + length && start + appointmentMinutes(a, slotMinutes) > minutes;
        });
      const freeTherapistIds = (minutes: number, length = stepMinutes) =>
        bookable
          .filter((t) => withinWorking(multi.workingForTherapist(t.id, day), minutes, length) && !clashes(t.id, minutes, length))
          .map((t) => t.id);
      const byId = new Map(multi.therapists.map((t) => [t.id, t]));
      multiColumn = {
        // Time nobody works stays blank: shade the union of everyone's working hours.
        working: mergeIntervals(multi.therapists.flatMap((t) => multi.workingForTherapist(t.id, day))),
        onBook: bookable.length
          ? (time: string) => {
              const [h, m] = time.split(':').map(Number);
              multi.onBookFree({ date: day, time, freeTherapistIds: freeTherapistIds(h * 60 + m) });
            }
          : undefined,
        multi: {
          maxLanes: MAX_WEEK_LANES,
          pillFor: (a) => {
            const therapist = a.therapistId ? byId.get(a.therapistId) : undefined;
            return therapist ? { name: shortName(therapist.name) } : null;
          },
          // A move may land outside working hours (it asks first, as in Day view), so only clashes count.
          freeAt: (minutes, length, moving) =>
            moving
              ? Boolean(moving.therapistId) && !clashes(moving.therapistId!, minutes, length, moving.id)
              : freeTherapistIds(minutes, length).length > 0,
          onOverflow: (list, title) => setOverflowList({ title, appointments: list }),
        },
      };
    }
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
          {phone ? (
            <span className="ml-1 inline-flex gap-0.5 align-middle" aria-label={`${dayAppointments.filter((a) => a.status !== 'cancelled').length} booked`} data-load-dots>
              {Array.from({ length: loadDots(dayAppointments.filter((a) => a.status !== 'cancelled').length) }, (_, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full bg-[var(--teal)]" aria-hidden />
              ))}
            </span>
          ) : (
            <span className="ml-1 text-[11px] text-[var(--muted)]">
              {dayAppointments.filter((a) => a.status !== 'cancelled').length || ''}
            </span>
          )}
        </button>
      ),
      onBook: onBook && !isColleague ? (time: string) => onBook({ date: day, time }) : undefined,
      working: workingFor ? workingFor(day) : undefined,
      isColleague,
      ...multiColumn,
    };
  });

  return (
    <>
      <GridFrame
        columns={columns}
        hours={hours}
        slotMinutes={slotMinutes}
        stepMinutes={stepMinutes}
        today={today}
        nowMinutes={nowMinutes}
        colorFor={colorFor}
        reasonFor={reasonFor}
        flagContext={flagContext}
        selectedId={selectedId}
        onSelect={onSelect}
        scrollKey={days[0]}
        minColumnWidth={phone ? 92 : 110}
        drag={drag}
        phone={phone}
        pxPerMinute={pxPerMinute}
      />
      <Panel open={overflowList !== null} onClose={() => setOverflowList(null)} title={overflowList?.title ?? ''}>
        <ul className="divide-y divide-[var(--border)]" data-overflow-list>
          {overflowList?.appointments.map((a) => {
            const start = minutesOfDay(a.scheduledAt);
            const therapist = multi?.therapists.find((t) => t.id === a.therapistId);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-3 py-2 text-left"
                  onClick={() => {
                    setOverflowList(null);
                    onSelect(a);
                  }}
                >
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorFor(a) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--ink)]">{a.patientName}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {therapist ? `${shortName(therapist.name)} · ` : ''}
                      {minutesLabel(start)}–{minutesLabel(start + appointmentMinutes(a, slotMinutes))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
