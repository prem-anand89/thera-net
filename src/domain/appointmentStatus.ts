import type { AppointmentStatus } from './types';

/**
 * Shared between `WorkspacePage.tsx` ("Expected today") and
 * `RequestsPage.tsx` (Bookings tab) — kept in its own tiny module rather
 * than defined in either page, because `RequestsPage` is route-code-split
 * and `WorkspacePage` is not: importing one page's export from the other
 * would pull WorkspacePage's whole eager bundle into RequestsPage's lazy
 * chunk, the exact bundle-leakage `requestsSignals.ts` was already split
 * out to avoid (see that file's own doc comment).
 */
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  confirmed: 'Confirmed',
  rescheduled: 'Rescheduled',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  arrived: 'Arrived',
};

export const APPOINTMENT_STATUS_TONE: Record<
  AppointmentStatus,
  'teal' | 'green' | 'rust' | 'slate'
> = {
  confirmed: 'teal',
  rescheduled: 'teal',
  no_show: 'rust',
  cancelled: 'slate',
  arrived: 'green',
};
