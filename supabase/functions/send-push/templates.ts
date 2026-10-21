export type PushKind =
  | 'appointment_confirmed'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'appointment_reassigned'
  | 'booking_request'
  | 'overnight_requests'
  | 'low_rating_feedback';

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  /** Buzz again when this replaces a notification with the same tag. */
  renotify?: boolean;
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

function formatDate(ymd: string, _timeZone: string): string {
  // A calendar date has no time zone: format it as the UTC date it names.
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(new Date(`${ymd}T00:00:00Z`));
}

/** Only the booking form's own `H:MM AM|PM` slot labels pass; anything else is dropped. */
export function sanitizeSlotLabel(raw: string | null): string | null {
  return raw && SLOT_LABEL.test(raw) ? raw : null;
}

/** Strips control characters and caps length so a stored name can't break the notification. */
export function sanitizePatientName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

export function buildBookingRequestPayload(details: BookingDetails, timeZone: string, hideName = false): PushPayload {
  const name = hideName ? '' : sanitizePatientName(details.patientName);
  const date = details.date ? formatDate(details.date, timeZone) : null;
  const parts = [name, date, sanitizeSlotLabel(details.timeLabel)].filter(Boolean);
  return {
    title: 'New booking request',
    body: parts.join(' · '),
    tag: 'booking-request',
    url: '/schedule?tab=bookings',
  };
}

/** The morning note for booking requests that arrived while pushes were paused (quiet hours). */
export function buildOvernightRequestsPayload(count: number): PushPayload {
  return {
    title: 'Booking requests waiting',
    body: `${count} new booking request${count === 1 ? '' : 's'} came in overnight`,
    tag: 'booking-request',
    url: '/schedule?tab=bookings',
  };
}

/** "Today", "Tomorrow" or "Wed 21 Oct" for a local date, relative to the local date `today`. */
export function relativeDayLabel(ymd: string, today: string): string {
  if (ymd === today) return 'Today';
  const [y, m, d] = today.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const tomorrow = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  if (ymd === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
}

export interface AppointmentPushInput {
  kind: Exclude<PushKind, 'booking_request' | 'overnight_requests' | 'low_rating_feedback'>;
  appointmentId: string;
  therapistId: string;
  /** Null when the recipient asked to keep patient names off notifications. */
  patientName: string | null;
  startsAt: string;
  /** The appointment's local date and today's local date, both YYYY-MM-DD in the clinic's zone. */
  localDate: string;
  today: string;
  timeZone: string;
  /** Appointments added for this therapist in the last few minutes (this one included); more than one collapses into one notification. */
  recentNewCount?: number;
}

const TITLES: Record<AppointmentPushInput['kind'], string> = {
  appointment_confirmed: 'New appointment',
  appointment_rescheduled: 'Appointment moved',
  appointment_cancelled: 'Appointment cancelled',
  appointment_reassigned: 'Appointment reassigned',
};

/**
 * One notification per appointment change, telling what happened and to whom and when. A burst of new
 * bookings for one therapist shares one tag, so the phone shows a single "3 new appointments" instead of three.
 * Tapping opens that day with the appointment's details.
 */
export function buildAppointmentPayload(input: AppointmentPushInput): PushPayload & { renotify: boolean } {
  const when = `${relativeDayLabel(input.localDate, input.today)}, ${formatTime(input.startsAt, input.timeZone)}`;
  const who = input.patientName ? sanitizePatientName(input.patientName) : '';
  const url = `/schedule?tab=bookings&view=schedule&mode=day&date=${input.localDate}&appointment=${input.appointmentId}`;
  const burst = input.kind === 'appointment_confirmed' && (input.recentNewCount ?? 1) > 1;
  if (input.kind === 'appointment_confirmed') {
    return {
      title: burst ? `${input.recentNewCount} new appointments` : TITLES.appointment_confirmed,
      body: burst ? `Latest: ${[who, when].filter(Boolean).join(' · ')}` : [who, when].filter(Boolean).join(' · '),
      // Every new booking for this therapist replaces the last one, so a burst reads as one count.
      tag: `appt-new:${input.therapistId}`,
      url,
      renotify: true,
    };
  }
  const detail = input.kind === 'appointment_reassigned' ? `${[who, when].filter(Boolean).join(' · ')} · now with someone else` : [who, when].filter(Boolean).join(' · ');
  return { title: TITLES[input.kind], body: detail, tag: `appt:${input.appointmentId}`, url, renotify: true };
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
    case 'appointment_reassigned':
      return { title: 'Thera.Net', body: `Appointment at ${at} moved to another therapist`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'low_rating_feedback':
      return { title: 'Thera.Net', body: 'New low-rated feedback, open to review', tag: 'feedback', url: '/schedule?tab=feedback' };
    case 'booking_request':
      throw new Error('booking_request uses buildBookingRequestPayload');
    case 'overnight_requests':
      throw new Error('overnight_requests uses buildOvernightRequestsPayload');
  }
}
