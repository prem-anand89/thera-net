import type { Appointment, AppointmentRequest } from './types';
import { minutesOfDay, toLocalDateStr } from './schedule';
import { timeOfDayFor, type WaitlistOpening } from './waitlistMatch';
import { lastTenDigits } from './phoneDigits';

/** Pending only, in the order staff should work them: oldest first, but entries whose day has passed sink to the bottom. */
export function awaitingOrder(requests: AppointmentRequest[], today: string): AppointmentRequest[] {
  const byAge = (a: AppointmentRequest, b: AppointmentRequest) => a.createdAt.localeCompare(b.createdAt);
  const pending = requests.filter((r) => r.status === 'pending');
  const current = pending.filter((r) => !isPastDay(r, today)).sort(byAge);
  const past = pending.filter((r) => isPastDay(r, today)).sort(byAge);
  return [...current, ...past];
}

/** Its preferred day has gone by. It stays on the list (still bookable); only Dismiss removes it. */
export function isPastDay(request: Pick<AppointmentRequest, 'preferredDate'>, today: string): boolean {
  return Boolean(request.preferredDate) && request.preferredDate! < today;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayOf(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Fri, 6 Nov, morning", "Any day", or "Was for 3 Nov" once the day has passed. */
export function awaitingWants(request: AppointmentRequest, today: string): string {
  if (request.preferredDate && isPastDay(request, today)) {
    const [, m, d] = request.preferredDate.split('-').map(Number);
    return `Was for ${d} ${MONTHS[m - 1]}`;
  }
  const day = request.preferredDate
    ? dayOf(request.preferredDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    : 'Any day';
  const part = request.preferredTimeOfDay && request.preferredTimeOfDay !== 'any' ? request.preferredTimeOfDay : undefined;
  return [day, part, request.preferredTimeText].filter(Boolean).join(', ');
}

/**
 * The WhatsApp for someone who is awaiting a slot. It must not promise one: it only says they are noted and will be
 * called. The "confirmed" message stays with the booking (BookedStrip).
 */
export function awaitingMessage(input: { patientName: string; clinicName: string }): string {
  return `Hi ${input.patientName}, this is ${input.clinicName}. We've noted your request for an appointment and will call you as soon as a time is free.`;
}

/** Quiet, never blocking: this number is already awaiting, or already has an upcoming appointment. */
export function awaitingDuplicateNotes(
  phone: string,
  pending: AppointmentRequest[],
  appointments: Appointment[],
  now: Date = new Date()
): string[] {
  const digits = lastTenDigits(phone);
  if (digits.length < 7) return [];
  const notes: string[] = [];
  const waiting = pending.find((r) => r.status === 'pending' && lastTenDigits(r.phone) === digits);
  if (waiting) notes.push(`${waiting.name} is already awaiting (added ${waiting.createdAt.slice(8, 10).replace(/^0/, '')} ${MONTHS[Number(waiting.createdAt.slice(5, 7)) - 1]}).`);
  const upcoming = appointments
    .filter((a) => lastTenDigits(a.patientPhone) === digits && (a.status === 'confirmed' || a.status === 'rescheduled') && new Date(a.scheduledAt).getTime() > now.getTime())
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  if (upcoming) {
    const when = new Date(upcoming.scheduledAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    notes.push(`${upcoming.patientName} already has an appointment on ${when}.`);
  }
  return notes;
}

/** The slot an appointment frees when it is cancelled or moved away: its day, therapist and part of the day. */
export function openingFor(appointment: Pick<Appointment, 'scheduledAt' | 'therapistId'>): WaitlistOpening {
  return {
    date: toLocalDateStr(new Date(appointment.scheduledAt)),
    therapistId: appointment.therapistId ?? null,
    timeOfDay: timeOfDayFor(minutesOfDay(appointment.scheduledAt)),
  };
}
