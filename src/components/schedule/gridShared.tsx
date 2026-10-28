import type { RequestGhost } from './RequestGhostBlock';
import type { Appointment } from '@/domain/types';
import { type ClosedDayInfo, type Interval } from '@/domain/schedule';

/** 30 minutes = 48px: tall enough for two lines of text in a 30-minute block. */
export const PX_PER_MINUTE = 1.6;

export type GridHours = { startHour: number; endHour: number };

/** Width of the in-column time rail used by the single-column phone Day (no separate axis column). */
export const RAIL_W = 34;

/** A day column that holds several therapists' appointments (the multi-therapist week grid). */
export type MultiLaneConfig = {
  maxLanes: number;
  /** Therapist pill for a block; null for unassigned. */
  pillFor: (appointment: Appointment) => { name: string } | null;
  /**
   * Booking: true when at least one bookable therapist is free and working for [minutes, minutes + length).
   * Moving: true when the moving appointment's own therapist is free then (its own time counts as free).
   */
  freeAt: (minutes: number, length: number, moving?: { id: string; therapistId: string | null }) => boolean;
  /** Opens the list behind a "+N" chip. */
  onOverflow: (appointments: Appointment[], title: string) => void;
};

export type DragGhost = { columnKey: string; appointmentId: string; start: number; duration: number; valid: boolean };

export type ColumnDrag = {
  columnKey: string;
  register: (element: HTMLDivElement | null) => void;
  canDrag: (appointment: Appointment) => boolean;
  onPointerDown: (event: React.PointerEvent, appointment: Appointment, mode: 'move' | 'resize') => void;
  /** True right after a drag, so the block's click doesn't also open details. */
  consumeClick: () => boolean;
  ghost: DragGhost | null;
  draggingId: string | null;
  /** Touch "tap a free time to move" mode: the moving appointment's length, else null. */
  placing: { duration: number } | null;
  onPlace: (start: number) => void;
};

/** Phone page scroll: fallback app header height (60px + 1px border) until the shell measures it, and the bottom nav. */
export const PHONE_STICKY_TOP = 61;

export const PHONE_BOTTOM_NAV = 64;

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
  /** Several therapists share this column (multi-therapist week). */
  multi?: MultiLaneConfig;
  /** Pending booking requests drawn as quiet markers at their requested time. */
  ghosts?: RequestGhost[];
};

export type MoveTarget = { date: string; therapistId: string | null; start: number; duration: number };

export type GridDragOptions = {
  canDrag: (appointment: Appointment) => boolean;
  onMove: (appointment: Appointment, target: MoveTarget) => void;
};
