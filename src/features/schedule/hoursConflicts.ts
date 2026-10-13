import type { Appointment, WorkingHours } from '@/domain/types';
import {
  appointmentMinutes,
  minutesOfDay,
  toLocalDateStr,
  withinWorking,
  workingIntervals,
} from '@/domain/schedule';

export function appointmentsOutsideHours(input: {
  appointments: Appointment[];
  therapistId: string;
  hours: WorkingHours | null;
  clinicHours: { startHour: number; endHour: number };
  slotMinutes: number;
  todayIso: string;
}): Appointment[] {
  const { appointments, therapistId, hours, clinicHours, slotMinutes, todayIso } = input;
  return appointments.filter((a) => {
    if (a.therapistId !== therapistId || a.status === 'cancelled') return false;
    const apptDate = toLocalDateStr(new Date(a.scheduledAt));
    if (apptDate < todayIso) return false;
    const intervals = workingIntervals(hours, apptDate, clinicHours);
    return !withinWorking(
      intervals,
      minutesOfDay(a.scheduledAt),
      appointmentMinutes(a, slotMinutes)
    );
  });
}
