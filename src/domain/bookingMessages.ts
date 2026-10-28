/**
 * WhatsApp message text for appointments. Pure so the wording is tested in
 * one place; sending (wa.me) lives in `bookingService`.
 *
 * Therapist messages use the patient's first name + surname initial only —
 * a therapist's WhatsApp is a personal device, so the message carries no more
 * patient detail than they need to recognise the booking.
 */

export function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function timeOnlyLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** "Priya Nair" -> "Priya N." ; single names are left as they are. */
export function shortPatientName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export type PatientMessageKind = 'booked' | 'rescheduled' | 'cancelled' | 'reminder';

export function patientMessage(
  kind: PatientMessageKind,
  input: { patientName: string; clinicName: string; scheduledAt: string; therapistName?: string | null; sessions?: number }
): string {
  const series = input.sessions && input.sessions > 1 ? ` — the first of your ${input.sessions} sessions` : '';
  const who = input.therapistName ? ` with ${input.therapistName}` : '';
  const when = whenLabel(input.scheduledAt);
  switch (kind) {
    case 'booked':
      return `Hi ${input.patientName}, your appointment at ${input.clinicName}${who} is confirmed for ${when}${series}. See you then!`;
    case 'rescheduled':
      return `Hi ${input.patientName}, your appointment at ${input.clinicName}${who} has been moved to ${when}. Reply here if that doesn't work for you.`;
    case 'cancelled':
      return `Hi ${input.patientName}, your appointment at ${input.clinicName} on ${when} has been cancelled. Reply here to book a new time.`;
    case 'reminder':
      return `Hi ${input.patientName}, a reminder of your appointment at ${input.clinicName}${who} on ${when}. Reply here if you need to change it.`;
  }
}

/** Sent when staff decline a public booking request: polite, and offers to find another time. */
export function requestDeclinedMessage(input: { patientName: string; clinicName: string; requestedFor: string }): string {
  const asked = input.requestedFor ? ` for ${input.requestedFor}` : '';
  return `Hi ${input.patientName}, thank you for your request${asked} at ${input.clinicName}. We couldn't fit that time. Reply here and we'll find another time that suits you.`;
}

/** The day (no time) a follow-up falls on, e.g. "Fri, 30 Oct". */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export type FollowUpMessageKind = 'due' | 'missed' | 'no_show';

/**
 * The WhatsApp a front-desk person sends to bring a patient back: a review the therapist asked for ("due"), one that
 * was never rebooked after the reminders stopped ("missed"), or an appointment they did not come to ("no_show").
 * Always asks which time suits, so the reply leads straight to booking.
 */
export function followUpMessage(
  kind: FollowUpMessageKind,
  input: { patientName: string; clinicName: string; therapistName?: string | null; date: string }
): string {
  const who = input.therapistName ? input.therapistName : 'we';
  switch (kind) {
    case 'due':
      return `Hi ${input.patientName}, ${who} would like to see you for a review around ${dayLabel(input.date)} at ${input.clinicName}. What time suits you?`;
    case 'missed':
      return `Hi ${input.patientName}, we had planned a review with ${input.therapistName ?? 'you'} at ${input.clinicName}. Are you still planning to come in? Reply with a day that suits you.`;
    case 'no_show':
      return `Hi ${input.patientName}, we missed you at ${input.clinicName} on ${dayLabel(input.date)}. Would you like to rebook? Reply with a day that suits you.`;
  }
}

export type TherapistMessageKind = 'booked' | 'rescheduled' | 'cancelled';

export function therapistMessage(
  kind: TherapistMessageKind,
  input: { therapistName: string; patientName: string; scheduledAt: string; sessions?: number }
): string {
  const patient = shortPatientName(input.patientName);
  const series = input.sessions && input.sessions > 1 ? ` (first of ${input.sessions} sessions)` : '';
  const when = whenLabel(input.scheduledAt);
  switch (kind) {
    case 'booked':
      return `Hi ${input.therapistName}, new appointment: ${patient}, ${when}${series}.`;
    case 'rescheduled':
      return `Hi ${input.therapistName}, ${patient}'s appointment has moved to ${when}.`;
    case 'cancelled':
      return `Hi ${input.therapistName}, ${patient}'s appointment on ${when} was cancelled.`;
  }
}

/** One message with a therapist's whole day, e.g. sent the evening before. */
export function therapistDayListMessage(input: {
  therapistName: string;
  date: string; // YYYY-MM-DD
  appointments: { scheduledAt: string; patientName: string; durationMinutes: number }[];
}): string {
  const day = new Date(`${input.date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  if (input.appointments.length === 0) {
    return `Hi ${input.therapistName}, you have no appointments on ${day}.`;
  }
  const lines = [...input.appointments]
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map((a) => `• ${timeOnlyLabel(a.scheduledAt)} — ${shortPatientName(a.patientName)} (${a.durationMinutes} min)`);
  const count = input.appointments.length;
  return `Hi ${input.therapistName}, your ${count} appointment${count === 1 ? '' : 's'} on ${day}:\n${lines.join('\n')}`;
}
