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

/** Fixed text per kind. No patient name, patient id, or free-text field is ever read here. */
export function buildPayload(kind: PushKind, when: string | null, timeZone: string): PushPayload {
  const at = when && kind !== 'booking_request' ? formatTime(when, timeZone) : '';
  switch (kind) {
    case 'appointment_confirmed':
      return { title: 'Thera.Net', body: `Appointment confirmed at ${at}`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'appointment_rescheduled':
      return { title: 'Thera.Net', body: `Appointment rescheduled to ${at}`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'appointment_cancelled':
      return { title: 'Thera.Net', body: `Appointment at ${at} cancelled`, tag: 'appointment', url: '/schedule?tab=bookings' };
    case 'booking_request':
      return {
        title: 'Thera.Net',
        body: when ? `New booking request for ${formatDate(when, timeZone)}` : 'New booking request',
        tag: 'booking-request',
        url: '/schedule?tab=bookings',
      };
    case 'low_rating_feedback':
      return { title: 'Thera.Net', body: 'New low-rated feedback, open to review', tag: 'feedback', url: '/schedule?tab=feedback' };
  }
}
