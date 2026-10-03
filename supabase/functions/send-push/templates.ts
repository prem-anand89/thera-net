export type PushKind =
  | 'appointment_confirmed'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'booking_request'
  | 'low_rating_feedback';

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export interface BookingDetails {
  patientName: string;
  date: string | null;
  timeLabel: string | null;
}

const SLOT_LABEL = /^(1[0-2]|0?[1-9]):[0-5]\d (AM|PM)$/;
const MAX_NAME_LENGTH = 60;

function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  }).format(new Date(iso));
}

function formatDate(ymd: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', timeZone,
  }).format(new Date(`${ymd}T00:00:00+05:30`));
}

/** Only the booking form's own `H:MM AM|PM` slot labels pass; anything else is dropped. */
export function sanitizeSlotLabel(raw: string | null): string | null {
  return raw && SLOT_LABEL.test(raw) ? raw : null;
}

/** Strips control characters and caps length so a stored name can't break the notification. */
export function sanitizePatientName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

export function buildBookingRequestPayload(details: BookingDetails, timeZone: string): PushPayload {
  const name = sanitizePatientName(details.patientName);
  const date = details.date ? formatDate(details.date, timeZone) : null;
  const parts = [name, date, sanitizeSlotLabel(details.timeLabel)].filter(Boolean);
  return {
    title: 'New booking request',
    body: parts.join(' · '),
    tag: 'booking-request',
    url: '/schedule?tab=bookings',
  };
}

export function buildPayload(kind: PushKind, when: string | null, timeZone: string): PushPayload {
  const at = when ? formatTime(when, timeZone) : '';
  switch (kind) {
    case 'appointment_confirmed':
      return { title: 'Thera.Net', body: `Appointment confirmed at ${at}`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'appointment_rescheduled':
      return { title: 'Thera.Net', body: `Appointment rescheduled to ${at}`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'appointment_cancelled':
      return { title: 'Thera.Net', body: `Appointment at ${at} cancelled`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'low_rating_feedback':
      return { title: 'Thera.Net', body: 'New low-rated feedback, open to review', tag: 'feedback', url: '/schedule?tab=feedback' };
    case 'booking_request':
      throw new Error('booking_request uses buildBookingRequestPayload');
  }
}
