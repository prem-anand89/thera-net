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

export function appointmentsOverlap(
  appointment: Appointment,
  candidateStart: Date,
  durationMinutes: number
): boolean {
  if (appointment.status === 'cancelled') return false;
  const appointmentStart = new Date(appointment.scheduledAt).getTime();
  const appointmentEnd = appointmentStart + durationMinutes * 60_000;
  const candidateEnd = candidateStart.getTime() + durationMinutes * 60_000;
  return appointmentStart < candidateEnd && appointmentEnd > candidateStart.getTime();
}

export function isTherapistSlotOccupied(
  appointments: Appointment[],
  therapistId: string,
  date: string,
  time: string,
  durationMinutes: number
): boolean {
  const candidateStart = localDateTime(date, time);
  return appointments.some(
    (appointment) =>
      appointment.therapistId === therapistId &&
      appointmentsOverlap(appointment, candidateStart, durationMinutes)
  );
}
