import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Appointment } from '@/domain/types';
import {
  type ClosedDayInfo,
  type Interval,
  minutesOfDay,
  toLocalDateStr,
} from '@/domain/schedule';
import {
  DayColumn,
  TimeAxis,
  initialScrollTop,
  type GridColumn,
  type GridDragOptions,
  type GridHours,
  type GridTherapist,
  useGridDrag,
} from './TimeGrid';
import type { PatientFlagContext } from '@/domain/patientFlags';

export type MultiResourceWeekGridProps = {
  days: string[];
  today: string;
  nowMinutes: number;
  therapists: GridTherapist[];
  appointments: Appointment[];
  hours: GridHours;
  slotMinutes: number;
  closedFor: (date: string) => ClosedDayInfo;
  colorFor: (appointment: Appointment) => string;
  reasonFor?: (appointment: Appointment) => string | null;
  flagContext?: PatientFlagContext;
  selectedId: string | null;
  onSelect: (appointment: Appointment) => void;
  onBook?: (input: { date: string; time: string; therapistId: string }) => void;
  onOpenDay?: (date: string) => void;
  workingFor?: (therapistId: string, date: string) => Interval[];
  drag?: GridDragOptions;
};

/** Extracts a short name for compact sub-headers (e.g. "Dr. Priya" -> "Priya", "Prem Anand" -> "Prem"). */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '';
  const first = parts[0].toLowerCase().replace(/\.$/, '');
  if (first === 'dr' && parts.length > 1) {
    return parts[1];
  }
  return parts[0];
}

export function MultiResourceWeekGrid({
  days,
  today,
  nowMinutes,
  therapists,
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
}: MultiResourceWeekGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledOnceRef = useRef(false);

  // Filter out any invalid / empty therapist rows
  const activeTherapists = useMemo(
    () => therapists.filter((t) => Boolean(t.id)),
    [therapists]
  );

  // Group appointments by date and therapist for O(1) lookup
  const appointmentsByDayAndTherapist = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appt of appointments) {
      const apptDate = toLocalDateStr(new Date(appt.scheduledAt));
      const key = `${apptDate}:${appt.therapistId ?? 'unassigned'}`;
      const list = map.get(key);
      if (list) {
        list.push(appt);
      } else {
        map.set(key, [appt]);
      }
    }
    return map;
  }, [appointments]);

  // Appointment count per day for the day header badge (active appointments only)
  const dayAppointmentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const appt of appointments) {
      if (appt.status === 'cancelled') continue;
      const apptDate = toLocalDateStr(new Date(appt.scheduledAt));
      map.set(apptDate, (map.get(apptDate) ?? 0) + 1);
    }
    return map;
  }, [appointments]);

  // Columns specification for drag-and-drop operations
  const dragColumns = useMemo<GridColumn[]>(() => {
    const list: GridColumn[] = [];
    for (const day of days) {
      const closed = closedFor(day);
      if (closed.closed) {
        list.push({
          key: `closed:${day}`,
          label: `Closed, ${day}`,
          date: day,
          header: null,
          appointments: [],
          closed,
          therapistId: '',
        });
        continue;
      }
      if (activeTherapists.length === 0) {
        list.push({
          key: `empty:${day}`,
          label: `Empty, ${day}`,
          date: day,
          header: null,
          appointments: [],
          closed,
          therapistId: '',
        });
        continue;
      }
      for (const therapist of activeTherapists) {
        const key = `${day}:${therapist.id}`;
        list.push({
          key,
          label: `${therapist.name}, ${day}`,
          date: day,
          header: null,
          appointments: appointmentsByDayAndTherapist.get(key) ?? [],
          closed,
          therapistId: therapist.id,
          working: workingFor ? workingFor(therapist.id, day) : undefined,
          onBook: onBook ? (time) => onBook({ date: day, time, therapistId: therapist.id }) : undefined,
        });
      }
    }
    return list;
  }, [days, closedFor, activeTherapists, appointmentsByDayAndTherapist, workingFor, onBook]);

  const { columnDrag, placing, cancelPlacing } = useGridDrag({
    columns: dragColumns,
    hours,
    slotMinutes,
    today,
    nowMinutes,
    options: drag,
  });

  // Build the CSS Grid template columns
  const gridTemplate = useMemo(() => {
    const parts: string[] = ['56px']; // Time axis
    for (const day of days) {
      const closed = closedFor(day);
      if (closed.closed) {
        parts.push('minmax(90px, 110px)');
      } else {
        const colCount = Math.max(1, activeTherapists.length);
        for (let i = 0; i < colCount; i++) {
          parts.push('minmax(70px, 1fr)');
        }
      }
    }
    return parts.join(' ');
  }, [days, closedFor, activeTherapists]);

  // Initial scroll into view (vertical time focus + horizontal 'today' focus)
  const showsToday = days.includes(today);
  const firstStart = useMemo(() => {
    const starts = appointments
      .filter((a) => a.status !== 'cancelled')
      .map((a) => minutesOfDay(a.scheduledAt))
      .sort((a, b) => a - b);
    return starts[0] ?? null;
  }, [appointments]);

  const focusNow = showsToday ? nowMinutes : null;

  const performInitialScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || scrolledOnceRef.current) return;
    scrolledOnceRef.current = true;

    // 1. Vertical scroll: use initialScrollTop
    const headerHeight = 72; // ~38px row 1 + ~34px row 2
    const targetTop = initialScrollTop(hours, {
      nowMinutes: focusNow,
      firstStart,
      viewportHeight: el.clientHeight - headerHeight,
    });
    el.scrollTop = targetTop;

    // 2. Horizontal scroll: center today column if present
    if (showsToday) {
      const todayEl = el.querySelector<HTMLElement>(`[data-day-header="${today}"]`);
      if (todayEl) {
        const containerWidth = el.clientWidth;
        const targetLeft = todayEl.offsetLeft - containerWidth / 3;
        el.scrollLeft = Math.max(0, targetLeft);
      }
    }
  }, [hours, focusNow, firstStart, showsToday, today]);

  useEffect(() => {
    performInitialScroll();
  }, [performInitialScroll]);

  return (
    <div
      ref={scrollRef}
      className="max-h-[calc(100vh-240px)] min-h-[420px] overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
      data-multi-resource-week-grid
    >
      <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
        {/* =========================================================================
            HEADER ROW 1: Days of the week
            ========================================================================= */}
        <div className="sticky left-0 top-0 z-30 h-[38px] border-b border-[var(--border)] bg-[var(--surface)]" />
        {days.map((day) => {
          const dateObj = new Date(`${day}T00:00:00`);
          const closed = closedFor(day);
          const span = closed.closed ? 1 : Math.max(1, activeTherapists.length);
          const count = dayAppointmentCounts.get(day) ?? 0;
          const isToday = day === today;

          return (
            <div
              key={`day-header-${day}`}
              data-day-header={day}
              className={`sticky top-0 z-20 flex h-[38px] items-center justify-center border-b border-l border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-center ${
                isToday ? '[background-image:linear-gradient(color-mix(in_srgb,var(--teal-light)_30%,transparent),color-mix(in_srgb,var(--teal-light)_30%,transparent))]' : ''
              }`}
              style={{ gridColumn: `span ${span}` }}
            >
              <button
                type="button"
                onClick={() => onOpenDay?.(day)}
                className="flex items-center gap-1.5 hover:opacity-80"
                aria-label={`Open ${day} in day view`}
              >
                <span
                  className={`text-[11px] font-semibold uppercase tracking-wider ${
                    isToday ? 'text-[var(--teal)]' : 'text-[var(--muted)]'
                  }`}
                >
                  {dateObj.toLocaleDateString('en-IN', { weekday: 'short' })}
                </span>
                <span
                  className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold ${
                    isToday ? 'bg-[var(--teal)] text-white' : 'text-[var(--ink)]'
                  }`}
                >
                  {dateObj.getDate()}
                </span>
                {count > 0 && !closed.closed && (
                  <span className="rounded-full bg-[var(--border)]/70 px-1.5 py-0.2 text-[10px] font-medium text-[var(--muted)]">
                    {count}
                  </span>
                )}
              </button>
            </div>
          );
        })}

        {/* =========================================================================
            HEADER ROW 2: Therapist Sub-Columns
            ========================================================================= */}
        <div className="sticky left-0 top-[38px] z-30 h-[34px] border-b border-[var(--border)] bg-[var(--surface)]" />
        {days.map((day) => {
          const closed = closedFor(day);
          if (closed.closed) {
            return (
              <div
                key={`sub-closed-${day}`}
                className="sticky top-[38px] z-20 flex h-[34px] items-center justify-center border-b border-l border-[var(--border)] bg-[var(--surface)] px-1 text-[11px] font-medium text-[var(--muted)]"
              >
                Closed
              </div>
            );
          }

          if (activeTherapists.length === 0) {
            return (
              <div
                key={`sub-empty-${day}`}
                className="sticky top-[38px] z-20 flex h-[34px] items-center justify-center border-b border-l border-[var(--border)] bg-[var(--surface)] px-1 text-xs text-[var(--muted)]"
              >
                No staff
              </div>
            );
          }

          return activeTherapists.map((therapist) => (
            <div
              key={`sub-${day}-${therapist.id}`}
              className="sticky top-[38px] z-20 flex h-[34px] items-center justify-center gap-1 border-b border-l border-[var(--border)] bg-[var(--surface)] px-1 text-center"
              title={therapist.name}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: therapist.color }}
                aria-hidden
              />
              <span className="truncate text-xs font-medium text-[var(--ink)]">
                {shortName(therapist.name)}
              </span>
            </div>
          ));
        })}

        {/* =========================================================================
            BODY ROW: Time Axis + Day Columns
            ========================================================================= */}
        <div className="sticky left-0 z-20 bg-[var(--surface)]">
          <TimeAxis hours={hours} />
        </div>

        {days.map((day) => {
          const closed = closedFor(day);
          const isPastDay = day < today;
          const isToday = day === today;

          if (closed.closed) {
            const colDef = dragColumns.find((c) => c.key === `closed:${day}`);
            return (
              <DayColumn
                key={`col-closed-${day}`}
                label={`Closed, ${day}`}
                date={day}
                appointments={[]}
                hours={hours}
                slotMinutes={slotMinutes}
                closed={closed}
                colorFor={colorFor}
                nowMinutes={null}
                isPastDay={isPastDay}
                selectedId={selectedId}
                onSelect={onSelect}
                dense={true}
                minimalBlocks={true}
                drag={colDef ? columnDrag(colDef) : undefined}
              />
            );
          }

          if (activeTherapists.length === 0) {
            const colDef = dragColumns.find((c) => c.key === `empty:${day}`);
            return (
              <DayColumn
                key={`col-empty-${day}`}
                label={`Empty, ${day}`}
                date={day}
                appointments={[]}
                hours={hours}
                slotMinutes={slotMinutes}
                closed={closed}
                colorFor={colorFor}
                nowMinutes={null}
                isPastDay={isPastDay}
                selectedId={selectedId}
                onSelect={onSelect}
                dense={true}
                minimalBlocks={true}
                drag={colDef ? columnDrag(colDef) : undefined}
              />
            );
          }

          return activeTherapists.map((therapist) => {
            const key = `${day}:${therapist.id}`;
            const colAppointments = appointmentsByDayAndTherapist.get(key) ?? [];
            const workingIntervals = workingFor ? workingFor(therapist.id, day) : undefined;
            const colDef = dragColumns.find((c) => c.key === key);

            return (
              <DayColumn
                key={`col-${day}-${therapist.id}`}
                label={`${therapist.name}, ${day}`}
                date={day}
                appointments={colAppointments}
                hours={hours}
                slotMinutes={slotMinutes}
                closed={closed}
                colorFor={colorFor}
                reasonFor={reasonFor}
                flagContext={flagContext}
                nowMinutes={isToday ? nowMinutes : null}
                isPastDay={isPastDay}
                selectedId={selectedId}
                onSelect={onSelect}
                onBook={
                  onBook
                    ? (time) => onBook({ date: day, time, therapistId: therapist.id })
                    : undefined
                }
                dense={true}
                minimalBlocks={true}
                working={workingIntervals}
                drag={colDef ? columnDrag(colDef) : undefined}
              />
            );
          });
        })}
      </div>

      {placing && (
        <div className="fixed inset-x-4 bottom-20 z-30 flex items-center justify-between rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs text-white shadow-xl sm:left-auto sm:right-4 sm:max-w-md">
          <span>Tap a free slot to move {placing.appointment.patientName}</span>
          <button
            type="button"
            className="rounded px-2 py-0.5 font-medium text-[var(--teal-light)] hover:underline"
            onClick={cancelPlacing}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
