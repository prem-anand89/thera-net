import { notify } from '@/lib/notify';
import { appHeaderHeight } from '@/lib/appHeaderHeight';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment } from '@/domain/types';
import { appointmentMinutes, dragTarget, dropAllowed, edgeScrollSpeed, resizeTarget, minutesOfDay } from '@/domain/schedule';
import { PX_PER_MINUTE, GridHours, DragGhost, ColumnDrag, PHONE_STICKY_TOP, PHONE_BOTTOM_NAV, GridColumn, GridDragOptions } from './gridShared';

/** Touch: hold this long without moving to lift a block. */
const LONG_PRESS_MS = 300;

/** Touch: a finger that moves more than this before the lift is scrolling, not dragging. */
const TOUCH_SLOP_PX = 8;

/**
 * Drag state for one grid. Mouse / pen: press a block and drag (to another
 * column too), or drag its bottom edge to resize. Touch: a swipe scrolls as
 * usual; press and hold lifts the block, then the finger drags it (15-minute
 * steps). Lifting and letting go without moving enters "tap a free time to
 * move it" mode instead. Near the top or bottom edge the grid auto-scrolls.
 */
export function useGridDrag(input: {
  columns: GridColumn[];
  hours: GridHours;
  slotMinutes: number;
  today: string;
  nowMinutes: number;
  options?: GridDragOptions;
  pxPerMinute?: number;
  /** The grid's scroll box (or, with `pageScroll`, the grid inside the scrolling page). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pageScroll?: boolean;
}) {
  const { columns, hours, slotMinutes, today, nowMinutes, options, pxPerMinute = PX_PER_MINUTE, scrollRef, pageScroll = false } = input;
  const elements = useRef(new Map<string, HTMLDivElement>());
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ appointment: Appointment; duration: number } | null>(null);
  // Swallow the click that follows a drag or long-press — but only for a
  // moment: if the pointer was released elsewhere, that click never reaches
  // the block, and a plain boolean stayed set and ate the next real click.
  const suppressClickUntil = useRef(0);
  // A lifted touch drag owns the finger: the grid's touchmove stops the page scrolling.
  const touchLifted = useRef(false);
  const latest = useRef({ columns, hours, slotMinutes, today, nowMinutes, options, pageScroll });
  latest.current = { columns, hours, slotMinutes, today, nowMinutes, options, pageScroll };

  // Registered once and non-passive (a listener added mid-gesture is too late for iOS);
  // it only cancels while a block is lifted, so ordinary swipes scroll natively.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onTouchMove = (event: TouchEvent) => {
      if (touchLifted.current && event.cancelable) event.preventDefault();
    };
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => element.removeEventListener('touchmove', onTouchMove);
  }, [scrollRef]);

  const scroller = useMemo(
    () => ({
      top: () => (latest.current.pageScroll ? window.scrollY : scrollRef.current?.scrollTop ?? 0),
      by: (dy: number) => {
        if (latest.current.pageScroll) window.scrollBy(0, dy);
        else if (scrollRef.current) scrollRef.current.scrollTop += dy;
      },
      /** The visible strip of grid, below the sticky column headers (and app header / above the bottom nav on page scroll). */
      area: () => {
        const element = scrollRef.current;
        const header = element?.querySelector<HTMLElement>('[data-grid-header]')?.offsetHeight ?? 0;
        if (latest.current.pageScroll) {
          return { top: appHeaderHeight(PHONE_STICKY_TOP) + header, bottom: window.innerHeight - PHONE_BOTTOM_NAV };
        }
        const rect = element?.getBoundingClientRect();
        return rect
          ? { top: Math.max(rect.top, 0) + header, bottom: Math.min(rect.bottom, window.innerHeight) }
          : { top: 0, bottom: 0 };
      },
    }),
    [scrollRef]
  );

  const validate = useCallback((columnKey: string, appointmentId: string, start: number, duration: number) => {
    const { columns: cols, slotMinutes: slot, today: day, nowMinutes: now } = latest.current;
    const column = cols.find((c) => c.key === columnKey);
    if (!column || column.therapistId === '' || column.isColleague) return false;
    // A shared column holds several therapists: only the moving appointment's own therapist can clash with it.
    const moving = column.multi ? cols.flatMap((c) => c.appointments).find((a) => a.id === appointmentId) : null;
    return dropAllowed({
      columnAppointments: column.multi ? column.appointments.filter((a) => a.therapistId === moving?.therapistId) : column.appointments,
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
      const touch = event.pointerType === 'touch';
      if (!touch && event.button !== 0) return;
      const originStart = minutesOfDay(appointment.scheduledAt);
      const duration = appointmentMinutes(appointment, latest.current.slotMinutes);
      const originColumn = latest.current.columns.find((c) => c.appointments.some((a) => a.id === appointment.id));
      if (!originColumn) return;

      const startX = event.clientX;
      const startY = event.clientY;
      const startScroll = scroller.top();
      let pointer = { x: startX, y: startY };
      let active = false;
      // Auto-scroll waits for the finger to move: a block held still near an edge must stay put (release = tap-to-place).
      let dragged = !touch;
      let current: DragGhost | null = null;
      let frame = 0;

      const update = () => {
        const { hours: h } = latest.current;
        // Auto-scroll moves the grid under a still finger, so the scrolled distance counts as dragged distance.
        const deltaPx = pointer.y - startY + scroller.top() - startScroll;
        let columnKey = originColumn.key;
        let start = originStart;
        let length = duration;
        if (mode === 'move') {
          for (const [key, element] of elements.current) {
            const rect = element.getBoundingClientRect();
            if (pointer.x >= rect.left && pointer.x <= rect.right) columnKey = key;
          }
          start = dragTarget({ originalStart: originStart, duration, deltaPx, pxPerMinute, hours: h });
        } else {
          length = resizeTarget({ start: originStart, originalDuration: duration, deltaPx, pxPerMinute, hours: h });
        }
        current = { columnKey, appointmentId: appointment.id, start, duration: length, valid: validate(columnKey, appointment.id, start, length) };
        setGhost(current);
      };
      const autoScroll = () => {
        const area = scroller.area();
        const speed = dragged ? edgeScrollSpeed(pointer.y, area.top, area.bottom) : 0;
        if (speed !== 0) {
          scroller.by(speed);
          update();
        }
        frame = requestAnimationFrame(autoScroll);
      };
      const lift = () => {
        active = true;
        touchLifted.current = touch;
        setDraggingId(appointment.id);
        document.body.style.userSelect = 'none';
        frame = requestAnimationFrame(autoScroll);
      };
      const holdTimer = touch
        ? window.setTimeout(() => {
            navigator.vibrate?.(15);
            lift();
            update();
          }, LONG_PRESS_MS)
        : 0;

      const onMove = (move: PointerEvent) => {
        pointer = { x: move.clientX, y: move.clientY };
        const moved = Math.hypot(move.clientX - startX, move.clientY - startY);
        if (!active) {
          // Touch before the lift: a moving finger is scrolling, so let it.
          if (touch) {
            if (moved > TOUCH_SLOP_PX) stop(false);
            return;
          }
          if (moved < 5) return;
          lift();
        }
        if (moved > TOUCH_SLOP_PX) dragged = true;
        update();
      };
      const stop = (commit: boolean) => {
        window.clearTimeout(holdTimer);
        cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        touchLifted.current = false;
        if (active) {
          document.body.style.userSelect = '';
          suppressClickUntil.current = Date.now() + 500;
          const unchanged = !current || (current.columnKey === originColumn.key && current.start === originStart && current.duration === duration);
          if (commit && current && !unchanged) finish(appointment, current);
          // Held and let go in place: fall back to tapping a free time.
          else if (commit && touch) setPlacing({ appointment, duration });
        }
        setGhost(null);
        setDraggingId(null);
      };
      const onUp = () => stop(true);
      const onCancel = () => stop(false);
      const onKey = (key: KeyboardEvent) => {
        if (key.key === 'Escape') stop(false);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
    },
    [finish, validate, pxPerMinute, scroller]
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
        notify.error('Not free for the full length.');
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
          placing: placing && column.therapistId !== '' ? { duration: placing.duration } : null,
          onPlace: (start) => place(column.key, start),
        }
      : undefined;

  return { columnDrag, placing, cancelPlacing: () => setPlacing(null) };
}
