import { notify } from '@/lib/notify';
import { appHeaderHeight } from '@/lib/appHeaderHeight';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment, UUID } from '@/domain/types';
import { APPOINTMENT_BLOCK_STYLE } from '@/domain/appointmentStatus';
import {
  appointmentMinutes,
  appointmentStartsOnDate,
  assignLanes,
  blockGeometry,
  dragTarget,
  dropAllowed,
  resizeTarget,
  lengthLabel,
  generateScheduleSlots,
  minutesLabel,
  minutesOfDay,
  withinWorking,
  type ClosedDayInfo,
  type Interval,
} from '@/domain/schedule';
import { CLOSED_HATCH_STYLE, appointmentFill } from './scheduleColors';
import { LoadLine, type LoadSummary } from './LoadLine';
import { patientFlags, type PatientFlagContext } from '@/domain/patientFlags';
import { BlockFlagBadges } from './BlockFlagBadges';
import { WideBlock } from './WideBlock';
import { useElementWidth } from './useElementWidth';
import { densityFor } from '@/features/schedule/schedulePhoneHelpers';
export type { LoadSummary } from './LoadLine';

/** 30 minutes = 48px: tall enough for two lines of text in a 30-minute block. */
export const PX_PER_MINUTE = 1.6;

export type GridHours = { startHour: number; endHour: number };

/** Width of the in-column time rail used by the single-column phone Day (no separate axis column). */
const RAIL_W = 34;

type DayColumnProps = {
  label: string;
  date: string;
  appointments: Appointment[];
  hours: GridHours;
  slotMinutes: number;
  closed: ClosedDayInfo;
  colorFor: (appointment: Appointment) => string;
  /** Short condition / reason shown on blocks an hour or longer. */
  reasonFor?: (appointment: Appointment) => string | null;
  /** Patient flags (new/package/balance/at-risk/don't-message) shown as small badges on each block. */
  flagContext?: PatientFlagContext;
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
  /** Drag / move wiring from GridFrame (tablet + desktop only). */
  drag?: ColumnDrag;
  /** When true, renders textless color blocks with tooltip on hover (multi-therapist week view). */
  minimalBlocks?: boolean;
  /** Colleague column viewed read-only by an individual therapist. */
  isColleague?: boolean;
  /** Pixels per minute; phones raise it so a free slot is always tappable. */
  pxPerMinute?: number;
  /** Phone presentation: block detail adapts to column width, free time is visibly tinted. */
  phone?: boolean;
  /** Single-column phone Day: hour labels on a continuous rail inside the column, wide appointment cards. */
  rail?: boolean;
};

export type DragGhost = { columnKey: string; appointmentId: string; start: number; duration: number; valid: boolean };

type ColumnDrag = {
  columnKey: string;
  register: (element: HTMLDivElement | null) => void;
  canDrag: (appointment: Appointment) => boolean;
  onPointerDown: (event: React.PointerEvent, appointment: Appointment, mode: 'move' | 'resize') => void;
  /** True right after a drag, so the block's click doesn't also open details. */
  consumeClick: () => boolean;
  ghost: DragGhost | null;
  draggingId: string | null;
  /** Touch "tap a free time to move" mode. */
  placing: boolean;
  onPlace: (start: number) => void;
};

/** Grid block look from the shared status colour code (`appointmentFill`). */
function blockLook(appointment: Appointment, color: string): { className: string; style: React.CSSProperties } {
  const fill = appointmentFill(appointment, color);
  const text =
    fill.kind === 'done' ? 'text-[var(--muted)]'
      : fill.kind === 'no_show' ? APPOINTMENT_BLOCK_STYLE.no_show.text
        : fill.kind === 'cancelled' ? APPOINTMENT_BLOCK_STYLE.cancelled.text
          : 'text-[var(--ink)]';
  const lift = fill.kind === 'upcoming' ? 'border border-[var(--border)] shadow-sm' : fill.kind === 'arrived' ? 'shadow-sm' : '';
  return { className: `${text} ${lift}`, style: { background: fill.background } };
}

/** One vertical day column: free slots tinted and bookable, blocks sized by length. */
export function DayColumn({
  label,
  date,
  appointments,
  hours,
  slotMinutes,
  closed,
  colorFor,
  reasonFor,
  flagContext,
  nowMinutes,
  isPastDay,
  selectedId,
  onSelect,
  onBook,
  dense = false,
  working,
  drag,
  minimalBlocks = false,
  isColleague = false,
  pxPerMinute = PX_PER_MINUTE,
  phone = false,
  rail = false,
}: DayColumnProps) {
  const [columnElement, setColumnElement] = useState<HTMLDivElement | null>(null);
  const columnWidth = useElementWidth(phone ? columnElement : null, 150);
  // Stable ref callback (it also feeds the drag hook) so the measured element isn't re-set each render.
  const dragRegister = useRef(drag?.register);
  dragRegister.current = drag?.register;
  const registerColumn = useCallback((element: HTMLDivElement | null) => {
    setColumnElement(element);
    dragRegister.current?.(element);
  }, []);
  const height = (hours.endHour - hours.startHour) * 60 * pxPerMinute;
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
    if ((!onBook && !drag?.placing) || closed.closed || isPastDay) return [];
    return generateScheduleSlots(slotMinutes, hours.startHour, hours.endHour).filter((slot) => {
      if (nowMinutes !== null && slot.minutes < nowMinutes) return false;
      const end = slot.minutes + slotMinutes;
      // Same rule as the server: every non-cancelled appointment holds its time.
      return !blocks.some(
        (b) => b.appointment.status !== 'cancelled' && b.start < end && b.end > slot.minutes
      );
    });
  }, [onBook, drag?.placing, closed.closed, isPastDay, slotMinutes, hours.startHour, hours.endHour, nowMinutes, blocks]);
  const offHours = useMemo(() => {
    if (!working || closed.closed) return [];
    const open = hours.startHour * 60;
    const close = hours.endHour * 60;
    type OffRange = Interval & { kind: 'before' | 'break' | 'after' | 'allDay' };
    if (working.length === 0) {
      return close > open ? [{ start: open, end: close, kind: 'allDay' as const }] : [];
    }
    const result: OffRange[] = [];
    let cursor = open;
    [...working]
      .sort((a, b) => a.start - b.start)
      .forEach((interval, index) => {
        if (interval.start > cursor) {
          result.push({ start: cursor, end: Math.min(interval.start, close), kind: index === 0 ? 'before' : 'break' });
        }
        cursor = Math.max(cursor, interval.end);
      });
    if (cursor < close) result.push({ start: cursor, end: close, kind: 'after' });
    return result.filter((r) => r.end > r.start);
  }, [working, closed.closed, hours.startHour, hours.endHour]);

  return (
    <div
      ref={registerColumn}
      className="relative border-l border-[var(--border)]"
      style={{ height, ...(closed.closed ? CLOSED_HATCH_STYLE : {}) }}
      aria-label={`${label}, ${date}`}
      data-colleague={isColleague ? true : undefined}
    >
      {Array.from({ length: hours.endHour - hours.startHour }, (_, index) => (
        <div
          key={index}
          className="pointer-events-none absolute inset-x-0 border-t border-[var(--border)]"
          style={{ top: index * 60 * pxPerMinute }}
        />
      ))}
      {rail &&
        Array.from({ length: hours.endHour - hours.startHour }, (_, index) => (
          <div
            key={`half-${index}`}
            className="pointer-events-none absolute border-t border-dashed border-[var(--border)]/60"
            style={{ top: (index * 60 + 30) * pxPerMinute, left: RAIL_W, right: 0 }}
            aria-hidden
            data-half-hour
          />
        ))}
      {offHours.map((range) => (
        <div
          key={range.start}
          className={
            range.kind === 'break'
              ? 'pointer-events-none absolute inset-x-0 border-y border-dashed border-[var(--border)] bg-[var(--amber-light)]/40'
              : 'pointer-events-none absolute inset-x-0 bg-[var(--paper)]'
          }
          style={{ top: (range.start - hours.startHour * 60) * pxPerMinute, height: (range.end - range.start) * pxPerMinute }}
          aria-hidden
          data-off-hours
          data-break={range.kind === 'break' ? true : undefined}
        />
      ))}
      {closed.closed && (
        <div className="pointer-events-none absolute inset-x-1 top-1 z-[1] truncate rounded bg-[var(--surface)]/90 px-1.5 py-0.5 text-center text-[11px] font-medium text-[var(--slate)]">
          Closed{closed.label ? ` · ${closed.label}` : ''}
        </div>
      )}
      {rail && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] bg-[var(--surface)]" style={{ width: RAIL_W }} aria-hidden />
          <div className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-[var(--border)]" style={{ left: 16 }} aria-hidden data-rail />
          {Array.from({ length: hours.endHour - hours.startHour }, (_, index) => {
            const hour = hours.startHour + index;
            // The Now badge takes the rail's place when it is within a label's height of an hour line.
            const labelTop = index === 0 ? 13 : index * 60 * pxPerMinute;
            const nowTop = nowMinutes === null ? null : (nowMinutes - hours.startHour * 60) * pxPerMinute;
            if (nowTop !== null && Math.abs(nowTop - labelTop) < 12) return null;
            return (
              <span
                key={index}
                className="pointer-events-none absolute left-0 z-[2] w-[33px] -translate-y-1/2 whitespace-nowrap bg-[var(--surface)] py-px text-center text-[10px] leading-[1.05] tabular-nums text-[var(--muted)]"
                style={{ top: index === 0 ? 13 : index * 60 * pxPerMinute }}
                aria-hidden
              >
                {hour % 12 || 12}
                <small className="ml-px text-[8px] opacity-75">{hour >= 12 ? 'PM' : 'AM'}</small>
              </span>
            );
          })}
        </>
      )}
      <div className="absolute inset-y-0 right-0" style={{ left: rail ? RAIL_W : 0 }}>
      {freeSlots.map((slot) => {
        const geometry = blockGeometry(slot.minutes, slotMinutes, hours.startHour, pxPerMinute);
        const isOffHours = Boolean(working && !withinWorking(working, slot.minutes, slotMinutes));
        return (
          <button
            key={slot.time}
            type="button"
            onClick={() => (drag?.placing ? drag.onPlace(slot.minutes) : onBook?.(slot.time))}
            aria-label={
              drag?.placing
                ? `Move here: ${label} at ${slot.label}${isOffHours ? ' (outside working hours)' : ''}`
                : `Book ${label} at ${slot.label}${isOffHours ? ' (outside working hours)' : ''}`
            }
            className={`group absolute inset-x-0.5 rounded-md text-left text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--teal)] ${
              isOffHours
                ? 'text-slate-400 hover:bg-slate-100/70 focus-visible:bg-slate-100'
                : 'text-[var(--moss-strong)] hover:bg-[var(--moss-light)] focus-visible:bg-[var(--moss-light)]'
            } ${isOffHours ? 'bg-slate-100/40' : 'bg-[var(--moss-light)]/40'} ${
              drag?.placing ? 'border border-dashed border-[var(--moss)]/60 bg-[var(--moss-light)]/60' : ''
            }`}
            style={{ top: geometry.top + 1, height: geometry.height - 2 }}
          >
            {/* Free time stays blank so bookings stand out. The tint is the affordance on every size; phones show nothing more; pointer devices reveal "+ time" on hover, touch tablets a faint "+". */}
            {!phone && (
              <>
                <span className="hidden px-1.5 opacity-40 pointer-coarse:inline group-hover:!hidden group-focus-visible:!hidden" aria-hidden>+</span>
                <span className={`hidden px-1.5 group-hover:inline group-focus-visible:inline ${minimalBlocks ? 'text-[10px]' : ''}`}>
                  {minimalBlocks ? '+' : `+ ${slot.label}`}
                </span>
              </>
            )}
          </button>
        );
      })}
      {blocks.map(({ appointment, start, end }) => {
        const geometry = blockGeometry(start, end - start, hours.startHour, pxPerMinute);
        const lane = lanes.get(appointment.id) ?? { lane: 0, lanes: 1 };
        const style = APPOINTMENT_BLOCK_STYLE[appointment.status];
        const look = blockLook(appointment, colorFor(appointment));
        const reason = reasonFor?.(appointment) ?? null;
        const flags = patientFlags(appointment, flagContext);
        const density = phone ? densityFor(columnWidth, geometry.height) : null;
        const compact = density ? density === 'compact' && geometry.height < 34 : geometry.height < 34;
        // Over for today: ended before now (the morning reads as done, not empty).
        const over = nowMinutes !== null && end <= nowMinutes && appointment.status !== 'cancelled';
        const draggable = Boolean(drag?.canDrag(appointment)) && !isPastDay;
        return (
          <button
            key={appointment.id}
            type="button"
            onClick={() => {
              if (drag?.consumeClick()) return;
              onSelect(appointment);
            }}
            onPointerDown={draggable ? (event) => drag!.onPointerDown(event, appointment, 'move') : undefined}
            onContextMenu={draggable ? (event) => event.preventDefault() : undefined}
            title={`${appointment.patientName} · ${minutesLabel(start)}–${minutesLabel(end)}${reason ? ` · ${reason}` : ''}${flags.length ? ` · ${flags.map((f) => f.label).join(', ')}` : ''}${draggable ? ' · drag to move' : ''}`}
            className={`group/block absolute z-[2] overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs transition-shadow hover:shadow-md ${look.className} ${
              selectedId === appointment.id ? 'outline outline-2 outline-[var(--teal)]' : ''
            } ${draggable ? 'pointer-fine:cursor-grab' : ''} ${drag?.draggingId === appointment.id ? 'opacity-40' : over ? 'opacity-75' : ''}`}
            style={{
              top: geometry.top,
              height: geometry.height - 1,
              left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
              width: `calc(${100 / lane.lanes}% - 4px)`,
              borderLeftColor: colorFor(appointment),
              ...look.style,
            }}
          >
            {draggable && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 hidden h-2 cursor-ns-resize pointer-fine:block group-hover/block:bg-[var(--ink)]/10"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  drag!.onPointerDown(event, appointment, 'resize');
                }}
              />
            )}
            {rail ? (
              <WideBlock
                name={appointment.patientName}
                start={start}
                end={end}
                reason={reason}
                flags={flags}
                height={geometry.height - 1}
                mark={style.mark || undefined}
              />
            ) : !minimalBlocks ? (
              <>
                {density !== 'compact' && <BlockFlagBadges flags={flags} />}
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
                    {density !== 'compact' && (
                      <span className="block truncate text-[11px] opacity-80">
                        {dense || density === 'medium' ? minutesLabel(start) : `${minutesLabel(start)}–${minutesLabel(end)}`}
                      </span>
                    )}
                    {reason && (!density || density === 'full') && geometry.height >= 60 * pxPerMinute && (
                      <span className="mt-0.5 block truncate text-[11px] italic opacity-80">{reason}</span>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="flex h-full w-full flex-col justify-start overflow-hidden px-1 py-0.5 leading-tight text-left">
                <div className="flex items-center justify-between gap-0.5 w-full">
                  <span className="truncate text-[10px] font-semibold text-[var(--ink)]">
                    {appointment.patientName}
                  </span>
                  {flags.length > 0 && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ink)]/40" />
                  )}
                </div>
                {geometry.height >= 26 && (
                  <span className="truncate text-[9px] font-medium opacity-75">
                    {minutesLabel(start)}
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
      {drag?.ghost && drag.ghost.columnKey === drag.columnKey && (
        <div
          className={`pointer-events-none absolute inset-x-1 z-[4] rounded-md border-2 border-dashed px-1.5 py-0.5 text-[11px] font-medium ${
            drag.ghost.valid ? 'border-[var(--teal)] bg-[var(--teal-light)]/70 text-[var(--teal)]' : 'border-[var(--rust)] bg-[var(--rust-light)]/70 text-[var(--rust)]'
          }`}
          style={{
            top: (drag.ghost.start - hours.startHour * 60) * pxPerMinute,
            height: Math.max(drag.ghost.duration * pxPerMinute, 18),
          }}
          data-drag-ghost
        >
          {minutesLabel(drag.ghost.start)} · {lengthLabel(drag.ghost.duration)}
          {!drag.ghost.valid && ' · not free'}
        </div>
      )}
      </div>
      {nowMinutes !== null && nowMinutes >= hours.startHour * 60 && nowMinutes <= hours.endHour * 60 && (
        <div
          className={`pointer-events-none absolute right-0 z-[3] border-t border-[var(--rust)]/55 ${rail ? 'left-4' : 'left-0'}`}
          style={{ top: (nowMinutes - hours.startHour * 60) * pxPerMinute }}
          data-now-line
          aria-hidden
        >
          {rail ? (
            // The time badge sits on the rail (left of the cards) so it never covers card text.
            <span className="absolute left-0.5 top-0 z-[3] -translate-y-1/2 rounded bg-[var(--rust)] px-1 text-[9px] font-semibold leading-[13px] text-white" data-now-badge>
              {Math.floor(nowMinutes / 60) % 12 || 12}:{String(nowMinutes % 60).padStart(2, '0')}
            </span>
          ) : (
            <span className="absolute -left-[3px] -top-[4px] h-[7px] w-[7px] rounded-full bg-[var(--rust)]" />
          )}
        </div>
      )}
    </div>
  );
}

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

/** Phone page scroll: fallback app header height (60px + 1px border) until the shell measures it, and the bottom nav. */
const PHONE_STICKY_TOP = 61;
const PHONE_BOTTOM_NAV = 64;

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

export type GridColumn = {
  key: string;
  label: string;
  date: string;
  header: React.ReactNode;
  appointments: Appointment[];
  closed: ClosedDayInfo;
  onBook?: (time: string) => void;
  working?: Interval[];
  /** Resource grid: the column's therapist ('' = Unassigned, not a drop target). */
  therapistId?: string;
  /** Colleague column viewed read-only by an individual therapist. */
  isColleague?: boolean;
};

export type MoveTarget = { date: string; therapistId: string | null; start: number; duration: number };

export type GridDragOptions = {
  canDrag: (appointment: Appointment) => boolean;
  onMove: (appointment: Appointment, target: MoveTarget) => void;
};

const LONG_PRESS_MS = 450;

/**
 * Drag state for one grid. Mouse / pen: press a block and drag (to another
 * column too), or drag its bottom edge to resize. Touch: dragging would fight
 * scrolling, so a long-press enters "tap a free time to move it" mode.
 */
export function useGridDrag(input: {
  columns: GridColumn[];
  hours: GridHours;
  slotMinutes: number;
  today: string;
  nowMinutes: number;
  options?: GridDragOptions;
  pxPerMinute?: number;
}) {
  const { columns, hours, slotMinutes, today, nowMinutes, options, pxPerMinute = PX_PER_MINUTE } = input;
  const elements = useRef(new Map<string, HTMLDivElement>());
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ appointment: Appointment; duration: number } | null>(null);
  // Swallow the click that follows a drag or long-press — but only for a
  // moment: if the pointer was released elsewhere, that click never reaches
  // the block, and a plain boolean stayed set and ate the next real click.
  const suppressClickUntil = useRef(0);
  const latest = useRef({ columns, hours, slotMinutes, today, nowMinutes, options });
  latest.current = { columns, hours, slotMinutes, today, nowMinutes, options };

  const validate = useCallback((columnKey: string, appointmentId: string, start: number, duration: number) => {
    const { columns: cols, slotMinutes: slot, today: day, nowMinutes: now } = latest.current;
    const column = cols.find((c) => c.key === columnKey);
    if (!column || column.therapistId === '' || column.isColleague) return false;
    return dropAllowed({
      columnAppointments: column.appointments,
      movingId: appointmentId,
      start,
      duration,
      slotMinutes: slot,
      closed: column.closed.closed,
      isPast: column.date < day || (column.date === day && start < now),
    });
  }, []);

  const finish = useCallback((appointment: Appointment, target: DragGhost) => {
    const column = latest.current.columns.find((c) => c.key === target.columnKey);
    if (!column || !target.valid) return;
    latest.current.options?.onMove(appointment, {
      date: column.date,
      therapistId: column.therapistId === undefined ? appointment.therapistId : column.therapistId || null,
      start: target.start,
      duration: target.duration,
    });
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent, appointment: Appointment, mode: 'move' | 'resize') => {
      if (!latest.current.options) return;
      const originStart = minutesOfDay(appointment.scheduledAt);
      const duration = appointmentMinutes(appointment, latest.current.slotMinutes);
      const originColumn = latest.current.columns.find((c) => c.appointments.some((a) => a.id === appointment.id));
      if (!originColumn) return;

      if (event.pointerType === 'touch') {
        const timer = window.setTimeout(() => {
          suppressClickUntil.current = Date.now() + 1500;
          setPlacing({ appointment, duration });
          navigator.vibrate?.(15);
        }, LONG_PRESS_MS);
        const cancel = () => {
          window.clearTimeout(timer);
          window.removeEventListener('pointerup', cancel);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('pointermove', onMoveCheck);
        };
        const startX = event.clientX;
        const startY = event.clientY;
        const onMoveCheck = (move: PointerEvent) => {
          if (Math.hypot(move.clientX - startX, move.clientY - startY) > 8) cancel();
        };
        window.addEventListener('pointerup', cancel);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('pointermove', onMoveCheck);
        return;
      }
      if (event.button !== 0) return;

      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let current: DragGhost | null = null;

      const onMove = (move: PointerEvent) => {
        if (!active && Math.hypot(move.clientX - startX, move.clientY - startY) < 5) return;
        if (!active) {
          active = true;
          setDraggingId(appointment.id);
          document.body.style.userSelect = 'none';
        }
        const { hours: h } = latest.current;
        let columnKey = originColumn.key;
        let start = originStart;
        let length = duration;
        if (mode === 'move') {
          for (const [key, element] of elements.current) {
            const rect = element.getBoundingClientRect();
            if (move.clientX >= rect.left && move.clientX <= rect.right) columnKey = key;
          }
          start = dragTarget({ originalStart: originStart, duration, deltaPx: move.clientY - startY, pxPerMinute, hours: h });
        } else {
          length = resizeTarget({ start: originStart, originalDuration: duration, deltaPx: move.clientY - startY, pxPerMinute, hours: h });
        }
        current = { columnKey, appointmentId: appointment.id, start, duration: length, valid: validate(columnKey, appointment.id, start, length) };
        setGhost(current);
      };
      const stop = (commit: boolean) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
        document.body.style.userSelect = '';
        if (active) {
          suppressClickUntil.current = Date.now() + 500;
          const unchanged = current && current.columnKey === originColumn.key && current.start === originStart && current.duration === duration;
          if (commit && current && !unchanged) finish(appointment, current);
        }
        setGhost(null);
        setDraggingId(null);
      };
      const onUp = () => stop(true);
      const onKey = (key: KeyboardEvent) => {
        if (key.key === 'Escape') stop(false);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey);
    },
    [finish, validate, pxPerMinute]
  );

  const place = useCallback(
    (columnKey: string, start: number) => {
      if (!placing) return;
      const target: DragGhost = {
        columnKey,
        appointmentId: placing.appointment.id,
        start,
        duration: placing.duration,
        valid: validate(columnKey, placing.appointment.id, start, placing.duration),
      };
      if (!target.valid) {
        notify.error('That time is not free for the whole appointment.');
        return;
      }
      setPlacing(null);
      finish(placing.appointment, target);
    },
    [placing, validate, finish]
  );

  const columnDrag = (column: GridColumn): ColumnDrag | undefined =>
    options
      ? {
          columnKey: column.key,
          register: (element) => {
            if (element) elements.current.set(column.key, element);
            else elements.current.delete(column.key);
          },
          canDrag: options.canDrag,
          onPointerDown,
          consumeClick: () => {
            const value = Date.now() < suppressClickUntil.current;
            suppressClickUntil.current = 0;
            return value;
          },
          ghost,
          draggingId: draggingId ?? placing?.appointment.id ?? null,
          placing: Boolean(placing) && column.therapistId !== '',
          onPlace: (start) => place(column.key, start),
        }
      : undefined;

  return { columnDrag, placing, cancelPlacing: () => setPlacing(null) };
}

function GridFrame({
  columns,
  hours,
  slotMinutes,
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
  const { columnDrag, placing, cancelPlacing } = useGridDrag({ columns, hours, slotMinutes, today, nowMinutes, options: drag, pxPerMinute });

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
          Tap a free time to move <strong>{placing.appointment.patientName}</strong>.
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
          />
        ))}
      </div>
    </div>
    </>
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
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--ink)]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: therapist.color }} aria-hidden />
            {therapist.name}
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
}: {
  days: string[];
  today: string;
  nowMinutes: number;
  appointments: Appointment[];
  hours: GridHours;
  slotMinutes: number;
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
      onBook: onBook && !isColleague ? (time: string) => onBook({ date: day, time }) : undefined,
      working: workingFor ? workingFor(day) : undefined,
      isColleague,
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
  );
}
