import { capLanes } from '@/domain/laneCap';
import { initials } from './therapistNames';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Appointment } from '@/domain/types';
import { APPOINTMENT_BLOCK_STYLE } from '@/domain/appointmentStatus';
import { appointmentMinutes, assignLanes, blockGeometry, PLACE_STEP_MINUTES, lengthLabel, generateScheduleSlots, minutesLabel, minutesOfDay, withinWorking, type ClosedDayInfo, type Interval } from '@/domain/schedule';
import { CLOSED_HATCH_STYLE, appointmentFill } from './scheduleColors';
import { patientFlags, type PatientFlagContext } from '@/domain/patientFlags';
import { BlockFlagBadges } from './BlockFlagBadges';
import { WideBlock } from './WideBlock';
import { useElementWidth } from './useElementWidth';
import { densityFor } from '@/features/schedule/schedulePhoneHelpers';
import { PX_PER_MINUTE, GridHours, RAIL_W, MultiLaneConfig, ColumnDrag } from './gridShared';

/** Width reserved at a cluster's right edge for its "+N" chip. */
const OVERFLOW_CHIP_W = 26;

/** Lanes narrower than this drop the therapist pill and time (first name + therapist only). */
const NARROW_LANE_PX = 72;

/** Lanes narrower than this show only initials; from here up a first name still fits. */
const TINY_LANE_PX = 40;

type DayColumnProps = {
  label: string;
  date: string;
  appointments: Appointment[];
  hours: GridHours;
  /** Default appointment length (and the length of legacy rows with none). */
  slotMinutes: number;
  /** Free time is offered every this many minutes; defaults to slotMinutes. */
  stepMinutes?: number;
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
  /** Several therapists share this column: capped lanes, therapist pills, shared free time. */
  multi?: MultiLaneConfig;
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
  stepMinutes = slotMinutes,
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
  multi,
}: DayColumnProps) {
  const [columnElement, setColumnElement] = useState<HTMLDivElement | null>(null);
  const columnWidth = useElementWidth(phone || multi ? columnElement : null, 150);
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
  const capped = useMemo(
    () => (multi ? capLanes(blocks.map((b) => ({ id: b.appointment.id, start: b.start, end: b.end })), multi.maxLanes) : null),
    [blocks, multi]
  );
  const freeAt = multi?.freeAt;
  const placeLength = drag?.placing?.duration ?? null;
  const movingId = placeLength !== null ? drag?.draggingId ?? null : null;
  const movingTherapistId = movingId ? appointments.find((a) => a.id === movingId)?.therapistId ?? null : null;
  const moving = useMemo(() => (movingId ? { id: movingId, therapistId: movingTherapistId } : null), [movingId, movingTherapistId]);
  // Placing targets come every 30 minutes and must fit the moving appointment's own length; booking targets follow the clinic slot.
  const targetStep = placeLength !== null ? PLACE_STEP_MINUTES : stepMinutes;
  const freeSlots = useMemo(() => {
    if ((!onBook && placeLength === null) || closed.closed || isPastDay) return [];
    return generateScheduleSlots(targetStep, hours.startHour, hours.endHour).filter((slot) => {
      if (nowMinutes !== null && slot.minutes < nowMinutes) return false;
      const length = placeLength ?? stepMinutes;
      const end = slot.minutes + length;
      if (placeLength !== null && end > hours.endHour * 60) return false;
      // Shared column: free when any bookable therapist is free and working, not when nobody is booked;
      // when moving, only the moving appointment's own therapist counts.
      if (freeAt) return freeAt(slot.minutes, length, moving ?? undefined);
      // Same rule as the server: every non-cancelled appointment holds its time (the one being moved frees its own).
      return !blocks.some(
        (b) => b.appointment.id !== movingId && b.appointment.status !== 'cancelled' && b.start < end && b.end > slot.minutes
      );
    });
  }, [onBook, placeLength, movingId, moving, targetStep, closed.closed, isPastDay, stepMinutes, hours.startHour, hours.endHour, nowMinutes, blocks, freeAt]);
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
        const geometry = blockGeometry(slot.minutes, targetStep, hours.startHour, pxPerMinute);
        const isOffHours = Boolean(working && !withinWorking(working, slot.minutes, placeLength ?? stepMinutes));
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
        const lane = capped ? capped.visible.get(appointment.id) : lanes.get(appointment.id) ?? { lane: 0, lanes: 1 };
        // Beyond the lane cap: reachable through the cluster's "+N" chip.
        if (!lane) return null;
        const reserve = capped && 'hasOverflow' in lane && lane.hasOverflow ? OVERFLOW_CHIP_W : 0;
        const laneWidth = (columnWidth - reserve) / lane.lanes - 4;
        const narrowLane = Boolean(multi) && laneWidth < NARROW_LANE_PX;
        const tinyLane = Boolean(multi) && laneWidth < TINY_LANE_PX;
        const pill = multi ? multi.pillFor(appointment) : null;
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
            // Narrow lanes show only initials, so give the block its full name for screen readers.
            aria-label={multi ? `${appointment.patientName}, ${minutesLabel(start)}${pill ? `, ${pill.name}` : ''}` : undefined}
            title={`${appointment.patientName} · ${minutesLabel(start)}–${minutesLabel(end)}${reason ? ` · ${reason}` : ''}${flags.length ? ` · ${flags.map((f) => f.label).join(', ')}` : ''}${draggable ? ' · drag to move' : ''}`}
            className={`group/block absolute z-[2] overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs transition-shadow hover:shadow-md ${narrowLane ? 'px-0.5' : ''} ${look.className} ${
              selectedId === appointment.id ? 'outline outline-2 outline-[var(--teal)]' : ''
            } ${draggable ? 'select-none [-webkit-touch-callout:none] pointer-fine:cursor-grab' : ''} ${drag?.draggingId === appointment.id ? 'opacity-40' : over ? 'opacity-75' : ''}`}
            style={{
              top: geometry.top,
              height: geometry.height - 1,
              // Plain percentages unless a "+N" chip takes the right edge of this cluster.
              left: reserve ? `calc((100% - ${reserve}px) * ${lane.lane / lane.lanes} + 2px)` : `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
              width: reserve ? `calc((100% - ${reserve}px) / ${lane.lanes} - 4px)` : `calc(${100 / lane.lanes}% - 4px)`,
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
            ) : multi ? (
              tinyLane ? (
                <span className="block truncate text-center text-[10px] font-semibold leading-tight">
                  {style.mark && <span aria-hidden>{style.mark}</span>}
                  {initials(appointment.patientName)}
                </span>
              ) : narrowLane ? (
                // Two or three lanes in a narrow column: the first name still fits, and the therapist below it.
                <>
                  <span className="block truncate text-[10px] tracking-tight font-semibold leading-tight">
                    {style.mark && <span aria-hidden>{style.mark}</span>}
                    {appointment.patientName.trim().split(/\s+/)[0]}
                  </span>
                  {pill && geometry.height >= 34 && (
                    <span className="block truncate text-[9px] leading-tight opacity-70" data-lane-therapist>
                      {pill.name}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {pill && (
                    <span
                      className="mb-px inline-block max-w-full truncate rounded px-1 text-[10px] font-medium leading-4 text-[var(--ink)]"
                      style={{ background: `color-mix(in srgb, ${colorFor(appointment)} 28%, var(--surface))` }}
                      data-therapist-pill
                    >
                      {pill.name}
                    </span>
                  )}
                  <span className="block truncate font-medium">
                    {style.mark && <span aria-hidden>{style.mark} </span>}
                    {appointment.patientName}
                  </span>
                  {geometry.height >= 45 * pxPerMinute && (
                    <span className="block truncate text-[11px] opacity-80">{minutesLabel(start)}</span>
                  )}
                </>
              )
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
                    {(density !== 'compact' || geometry.height >= 45 * pxPerMinute) && (
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
      {capped?.overflow.map((group) => {
        const hidden = blocks.filter((b) => group.hiddenIds.includes(b.appointment.id)).sort((a, b) => a.start - b.start);
        const geometry = blockGeometry(group.start, group.end - group.start, hours.startHour, pxPerMinute);
        const title = `${hidden.length} more at ${minutesLabel(group.start)}`;
        return (
          <button
            key={`overflow-${group.start}`}
            type="button"
            aria-label={`${hidden.length} more appointments at ${minutesLabel(group.start)}`}
            onClick={() => multi!.onOverflow(hidden.map((b) => b.appointment), title)}
            className="absolute right-0.5 z-[2] flex items-start justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] pt-0.5 text-[10px] font-semibold text-[var(--teal)] shadow-sm hover:bg-[var(--teal-light)]"
            style={{ top: geometry.top, height: Math.max(geometry.height - 1, 20), width: OVERFLOW_CHIP_W - 4 }}
            data-lane-overflow
          >
            +{hidden.length}
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
