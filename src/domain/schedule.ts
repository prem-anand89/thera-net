import type { Appointment } from './types';

export type ScheduleSlot = {
  minutes: number;
  time: string;
  label: string;
};

const pad = (value: number) => String(value).padStart(2, '0');

/** Calendar UI dates always use the browser's local day, never UTC. */
export function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`);
}

export function localDateTimeToIso(date: string, time: string): string {
  return localDateTime(date, time).toISOString();
}

export function addDays(date: string, amount: number): string {
  const next = localDateTime(date, '00:00');
  next.setDate(next.getDate() + amount);
  return toLocalDateStr(next);
}

/** Monday is the first day of a TheraNet scheduling week. */
export function getWeekStart(date: string): string {
  const value = localDateTime(date, '00:00');
  const daysSinceMonday = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - daysSinceMonday);
  return toLocalDateStr(value);
}

export function addWeeks(date: string, amount: number): string {
  return addDays(getWeekStart(date), amount * 7);
}

export function weekDays(date: string): string[] {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function generateScheduleSlots(
  slotDurationMinutes: number,
  startHour: number,
  endHour: number
): ScheduleSlot[] {
  const safeDuration = [15, 30, 45, 60].includes(slotDurationMinutes)
    ? slotDurationMinutes
    : 30;
  const slots: ScheduleSlot[] = [];
  for (let minutes = startHour * 60; minutes < endHour * 60; minutes += safeDuration) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const displayHour = hour % 12 || 12;
    slots.push({
      minutes,
      time: `${pad(hour)}:${pad(minute)}`,
      label: `${displayHour}:${pad(minute)} ${hour >= 12 ? 'PM' : 'AM'}`,
    });
  }
  return slots;
}

export function appointmentStartsOnDate(appointment: Appointment, date: string): boolean {
  return toLocalDateStr(new Date(appointment.scheduledAt)) === date;
}

/** Length of an appointment; rows cached before `duration_minutes` existed fall back. */
export function appointmentMinutes(appointment: Appointment, fallbackMinutes: number): number {
  return appointment.durationMinutes ?? fallbackMinutes;
}

/**
 * Does a live appointment intersect [candidateStart, candidateStart + candidateMinutes)?
 * Mirrors the server's `therapist_has_overlap`: each appointment uses its own length.
 */
export function appointmentsOverlap(
  appointment: Appointment,
  candidateStart: Date,
  candidateMinutes: number,
  fallbackMinutes: number = candidateMinutes
): boolean {
  if (appointment.status === 'cancelled') return false;
  const appointmentStart = new Date(appointment.scheduledAt).getTime();
  const appointmentEnd = appointmentStart + appointmentMinutes(appointment, fallbackMinutes) * 60_000;
  const candidateEnd = candidateStart.getTime() + candidateMinutes * 60_000;
  return appointmentStart < candidateEnd && appointmentEnd > candidateStart.getTime();
}

export function isTherapistSlotOccupied(
  appointments: Appointment[],
  therapistId: string,
  date: string,
  time: string,
  durationMinutes: number,
  options: { fallbackMinutes?: number; ignoreAppointmentId?: string } = {}
): boolean {
  const candidateStart = localDateTime(date, time);
  return appointments.some(
    (appointment) =>
      appointment.id !== options.ignoreAppointmentId &&
      appointment.therapistId === therapistId &&
      appointmentsOverlap(appointment, candidateStart, durationMinutes, options.fallbackMinutes)
  );
}

export type ClosedDayInfo = { closed: boolean; kind: 'weekday' | 'holiday' | null; label: string | null };

/** Weekly closed days come from `clinics.closed_weekdays` (0 = Sunday); one-off
 *  closures from `clinic_closed_dates`. A holiday label wins over the weekday. */
export function isClosedDay(
  date: string,
  closedWeekdays: number[] | undefined,
  closedDates: { closedDate: string; label: string | null }[]
): ClosedDayInfo {
  const holiday = closedDates.find((row) => row.closedDate === date);
  if (holiday) return { closed: true, kind: 'holiday', label: holiday.label };
  if ((closedWeekdays ?? []).includes(localDateTime(date, '00:00').getDay())) {
    return { closed: true, kind: 'weekday', label: null };
  }
  return { closed: false, kind: null, label: null };
}

/** Minutes after local midnight. */
export function minutesOfDay(iso: string): number {
  const value = new Date(iso);
  return value.getHours() * 60 + value.getMinutes();
}

export type Interval = { start: number; end: number }; // minutes after midnight

/**
 * Free intervals for one therapist inside booking hours, at least `minMinutes`
 * long. `notBefore` (minutes after midnight) clips time that has already passed.
 */
export function freeGaps(
  appointments: Appointment[],
  therapistId: string,
  date: string,
  hours: { startHour: number; endHour: number },
  fallbackMinutes: number,
  options: { minMinutes?: number; notBefore?: number } = {}
): Interval[] {
  const dayStart = Math.max(hours.startHour * 60, options.notBefore ?? 0);
  const dayEnd = hours.endHour * 60;
  const busy = appointments
    .filter((a) => a.therapistId === therapistId && a.status !== 'cancelled' && appointmentStartsOnDate(a, date))
    .map((a) => {
      const start = minutesOfDay(a.scheduledAt);
      return { start, end: start + appointmentMinutes(a, fallbackMinutes) };
    })
    .sort((x, y) => x.start - y.start);
  const gaps: Interval[] = [];
  let cursor = dayStart;
  for (const block of busy) {
    if (block.start > cursor) gaps.push({ start: cursor, end: Math.min(block.start, dayEnd) });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < dayEnd) gaps.push({ start: cursor, end: dayEnd });
  const min = options.minMinutes ?? fallbackMinutes;
  return gaps.filter((gap) => gap.end - gap.start >= min);
}

/** Pixel placement of a block in a day column that starts at `dayStartHour`. */
export function blockGeometry(
  startMinutes: number,
  durationMinutes: number,
  dayStartHour: number,
  pxPerMinute: number
): { top: number; height: number } {
  return {
    top: (startMinutes - dayStartHour * 60) * pxPerMinute,
    height: Math.max(durationMinutes * pxPerMinute, 18),
  };
}

/**
 * Side-by-side lanes for blocks that overlap in one column (only possible for
 * the Unassigned column or legacy data — the server blocks same-therapist
 * overlaps). Returns lane index and lane count of the overlapping cluster.
 */
export function assignLanes(items: { id: string; start: number; end: number }[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; end: number; lane: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 0);
    for (const item of cluster) result.set(item.id, { lane: item.lane, lanes });
    cluster = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    const used = new Set(cluster.filter((c) => c.end > item.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    cluster.push({ id: item.id, end: item.end, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}

/** "4h30", "45m", "2h". */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h${String(minutes).padStart(2, '0')}` : `${hours}h`;
}

/** Label for minutes after midnight, e.g. 630 -> "10:30 AM". */
export function minutesLabel(total: number): string {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${hour % 12 || 12}:${pad(minute)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function minutesToTime(total: number): string {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function isUnassigned(appointment: Appointment, knownTherapists: Map<string, string>): boolean {
  return !appointment.therapistId || !knownTherapists.has(appointment.therapistId);
}

/** '' is the synthetic "Unassigned" column: no therapist, or one no longer listed. */
export function belongsToColumn(
  appointment: Appointment,
  columnId: string,
  knownTherapists: Map<string, string>
): boolean {
  return columnId ? appointment.therapistId === columnId : isUnassigned(appointment, knownTherapists);
}

export function countByDate(dates: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) counts.set(date, (counts.get(date) ?? 0) + 1);
  return counts;
}

export function filterHistory(
  appointments: Appointment[],
  filters: { from: string; query: string; status: string; therapistId: string }
): Appointment[] {
  const query = filters.query.trim().toLowerCase();
  return appointments
    .filter((a) => toLocalDateStr(new Date(a.scheduledAt)) >= filters.from)
    .filter((a) => !filters.status || a.status === filters.status)
    .filter((a) => !filters.therapistId || a.therapistId === filters.therapistId)
    .filter(
      (a) =>
        !query ||
        a.patientName.toLowerCase().includes(query) ||
        (a.patientPhone ?? '').toLowerCase().includes(query)
    )
    .sort((x, y) => y.scheduledAt.localeCompare(x.scheduledAt));
}

export type ClosedRange = { from: string; to: string; label: string | null };

/** Groups single closed dates into consecutive runs with the same label. */
export function groupClosedRanges(rows: { closedDate: string; label: string | null }[]): ClosedRange[] {
  const sorted = [...rows].sort((a, b) => a.closedDate.localeCompare(b.closedDate));
  const ranges: ClosedRange[] = [];
  for (const row of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.label === row.label && addDays(last.to, 1) === row.closedDate) {
      last.to = row.closedDate;
    } else {
      ranges.push({ from: row.closedDate, to: row.closedDate, label: row.label });
    }
  }
  return ranges;
}

/**
 * Public booking form: is a start time unavailable? With a preferred
 * therapist, only their bookings count; with no preference the time is
 * taken only when every therapist is busy (any one of them could see the
 * patient). Each booking blocks its own length.
 */
export function isPublicSlotTaken(
  date: string,
  slotMinutes: number,
  lengthMinutes: number,
  booked: { scheduledAt: string; therapistId: string | null; durationMinutes?: number }[],
  therapistIds: string[],
  preferredTherapistId: string | null
): boolean {
  const start = slotMinutes;
  const end = slotMinutes + lengthMinutes;
  const busy = (therapistId: string | null) =>
    booked.some((b) => {
      if (b.therapistId !== therapistId) return false;
      if (toLocalDateStr(new Date(b.scheduledAt)) !== date) return false;
      const bStart = minutesOfDay(b.scheduledAt);
      return bStart < end && bStart + (b.durationMinutes ?? lengthMinutes) > start;
    });
  if (preferredTherapistId) return busy(preferredTherapistId);
  if (therapistIds.length === 0) return booked.some((b) => busy(b.therapistId));
  return therapistIds.every((id) => busy(id));
}
