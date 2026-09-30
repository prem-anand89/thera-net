import type { Appointment, WorkingHours } from './types';

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
  options: { minMinutes?: number; notBefore?: number; alignToSlots?: boolean; working?: Interval[] } = {}
): Interval[] {
  const open = hours.startHour * 60;
  // Round a start up onto the clinic's slot grid (09:00, 09:30, …), so free
  // time after a 45-minute booking or "now" is offered at a bookable time.
  const align = (minutes: number) =>
    options.alignToSlots ? open + Math.ceil((minutes - open) / fallbackMinutes) * fallbackMinutes : minutes;
  const dayStart = Math.max(open, options.notBefore ?? 0);
  const dayEnd = hours.endHour * 60;
  const busy = appointments
    .filter((a) => a.therapistId === therapistId && a.status !== 'cancelled' && appointmentStartsOnDate(a, date))
    .map((a) => {
      const start = minutesOfDay(a.scheduledAt);
      return { start, end: start + appointmentMinutes(a, fallbackMinutes) };
    })
    .sort((x, y) => x.start - y.start);
  let gaps: Interval[] = [];
  let cursor = dayStart;
  for (const block of busy) {
    if (block.start > cursor) gaps.push({ start: cursor, end: Math.min(block.start, dayEnd) });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < dayEnd) gaps.push({ start: cursor, end: dayEnd });
  if (options.working) gaps = clipToWorking(gaps, options.working);
  const min = options.minMinutes ?? fallbackMinutes;
  return gaps
    .map((gap) => ({ start: align(gap.start), end: gap.end }))
    .filter((gap) => gap.end - gap.start >= min);
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
  preferredTherapistId: string | null,
  /** Therapists with custom hours; others use the clinic's hours. */
  therapistHours: Record<string, WorkingHours> = {},
  clinicHours?: { startHour: number; endHour: number }
): boolean {
  const start = slotMinutes;
  const end = slotMinutes + lengthMinutes;
  const off = (therapistId: string | null) =>
    therapistId !== null &&
    clinicHours !== undefined &&
    therapistHours[therapistId] !== undefined &&
    !withinWorking(workingIntervals(therapistHours[therapistId], date, clinicHours), start, lengthMinutes);
  const busy = (therapistId: string | null) =>
    off(therapistId) ||
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

export type Attendance = { attended: number; noShows: number; cancelled: number };

const phoneDigits = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '').slice(-10);

/**
 * A patient's recent track record, for the "2 no-shows in 6 months" badge.
 * Matches by patient id when known, otherwise by the last 10 phone digits
 * (appointments from public requests have no patient id until arrival).
 * Only appointments already in the past count; `excludeId` skips the one
 * being viewed.
 */
export function patientAttendance(
  appointments: Appointment[],
  who: { patientId?: string | null; phone?: string | null },
  now: Date,
  options: { sinceMonths?: number; excludeId?: string } = {}
): Attendance {
  const since = new Date(now);
  since.setMonth(since.getMonth() - (options.sinceMonths ?? 6));
  const digits = phoneDigits(who.phone);
  const result: Attendance = { attended: 0, noShows: 0, cancelled: 0 };
  for (const a of appointments) {
    if (a.id === options.excludeId) continue;
    const same = who.patientId
      ? a.patientId === who.patientId || (!a.patientId && digits.length === 10 && phoneDigits(a.patientPhone) === digits)
      : digits.length === 10 && phoneDigits(a.patientPhone) === digits;
    if (!same) continue;
    const at = new Date(a.scheduledAt);
    if (at >= now || at < since) continue;
    if (a.status === 'no_show') result.noShows += 1;
    else if (a.status === 'cancelled') result.cancelled += 1;
    else if (a.status === 'arrived' || a.visitId) result.attended += 1;
  }
  return result;
}

/** Earliest upcoming live appointment for the same patient, to avoid double-booking them. */
export function nextAppointmentFor(
  appointments: Appointment[],
  who: { patientId?: string | null; phone?: string | null },
  now: Date
): Appointment | null {
  const digits = phoneDigits(who.phone);
  return (
    appointments
      .filter(
        (a) =>
          (a.status === 'confirmed' || a.status === 'rescheduled') &&
          new Date(a.scheduledAt) >= now &&
          ((who.patientId && a.patientId === who.patientId) ||
            (digits.length === 10 && phoneDigits(a.patientPhone) === digits))
      )
      .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))[0] ?? null
  );
}

/**
 * Earliest bookable start across the given therapists, searching forward
 * from `fromDate` for up to `days` days. Skips closed days, times that have
 * passed, times that would run past closing, and anything overlapping an
 * existing (non-cancelled) appointment for the chosen length.
 */
export function firstAvailableSlot(input: {
  appointments: Appointment[];
  therapistIds: string[];
  fromDate: string;
  days: number;
  hours: { startHour: number; endHour: number };
  slotMinutes: number;
  lengthMinutes: number;
  now: Date;
  isClosed: (date: string) => boolean;
  ignoreAppointmentId?: string;
  /** Working intervals per therapist and date; omit to use booking hours. */
  workingFor?: (therapistId: string, date: string) => Interval[];
}): { date: string; time: string; therapistId: string } | null {
  const slots = generateScheduleSlots(input.slotMinutes, input.hours.startHour, input.hours.endHour);
  for (let offset = 0; offset < input.days; offset += 1) {
    const date = addDays(input.fromDate, offset);
    if (input.isClosed(date)) continue;
    for (const slot of slots) {
      if (slot.minutes + input.lengthMinutes > input.hours.endHour * 60) continue;
      if (localDateTime(date, slot.time).getTime() < input.now.getTime()) continue;
      for (const therapistId of input.therapistIds) {
        if (input.workingFor && !withinWorking(input.workingFor(therapistId, date), slot.minutes, input.lengthMinutes)) continue;
        const busy = isTherapistSlotOccupied(input.appointments, therapistId, date, slot.time, input.lengthMinutes, {
          fallbackMinutes: input.slotMinutes,
          ignoreAppointmentId: input.ignoreAppointmentId,
        });
        if (!busy) return { date, time: slot.time, therapistId };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Therapist working hours
// ---------------------------------------------------------------------------

/**
 * A therapist's working intervals on a date (minutes after midnight). No
 * custom hours = the clinic's booking hours. A weekday missing from custom
 * hours is a day off. Clinic closures are handled separately (isClosedDay).
 */
export function workingIntervals(
  workingHours: WorkingHours | null | undefined,
  date: string,
  clinicHours: { startHour: number; endHour: number }
): Interval[] {
  if (!workingHours) return [{ start: clinicHours.startHour * 60, end: clinicHours.endHour * 60 }];
  const weekday = String(localDateTime(date, '00:00').getDay()) as keyof WorkingHours;
  return (workingHours[weekday] ?? []).map(([start, end]) => ({ start, end }));
}

/** Does [start, start + length) sit entirely inside one working interval? */
export function withinWorking(intervals: Interval[], start: number, length: number): boolean {
  return intervals.some((interval) => start >= interval.start && start + length <= interval.end);
}

/** Intersects free gaps with working intervals (drops breaks and off-hours). */
export function clipToWorking(gaps: Interval[], working: Interval[], minMinutes = 1): Interval[] {
  const result: Interval[] = [];
  for (const gap of gaps) {
    for (const interval of working) {
      const start = Math.max(gap.start, interval.start);
      const end = Math.min(gap.end, interval.end);
      if (end - start >= minMinutes) result.push({ start, end });
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

/** Validates the editor's value the same way the server does. */
export function workingHoursProblem(hours: WorkingHours): string | null {
  for (const [day, intervals] of Object.entries(hours)) {
    let previousEnd = -1;
    for (const [start, end] of intervals ?? []) {
      if (start < 0 || end > 1440 || start >= end) return `${WEEKDAY_NAMES[Number(day)]}: each start must be before its end.`;
      if (start < previousEnd) return `${WEEKDAY_NAMES[Number(day)]}: times overlap — keep them in order without overlaps.`;
      previousEnd = end;
    }
  }
  return null;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "9:00 AM–1:00 PM, 2:00 PM–6:00 PM" or "Off". */
export function describeDayHours(intervals: Interval[]): string {
  if (intervals.length === 0) return 'Off';
  return intervals.map((i) => `${minutesLabel(i.start)}–${minutesLabel(i.end)}`).join(', ');
}
