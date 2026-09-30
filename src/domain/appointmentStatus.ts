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

/**
 * Calendar block styling (Schedule grid, agenda, week views). The fill is
 * the status; the left bar is the therapist colour (see
 * `therapistColor` in `src/features/requests/schedule/scheduleColors.ts`).
 * Every status also carries a mark or word, so colour is never the only
 * signal.
 */
export const APPOINTMENT_BLOCK_STYLE: Record<
  AppointmentStatus,
  { fill: string; text: string; mark: string }
> = {
  confirmed: { fill: 'bg-[var(--teal-light)]', text: 'text-[var(--ink)]', mark: '' },
  rescheduled: { fill: 'bg-[var(--teal-light)]', text: 'text-[var(--ink)]', mark: '↻' },
  arrived: { fill: 'bg-[var(--moss-light)]', text: 'text-[var(--ink)]', mark: '✓' },
  no_show: { fill: 'bg-[var(--rust-light)]', text: 'text-[var(--rust)]', mark: '✕' },
  cancelled: { fill: 'bg-[var(--slate-light)]', text: 'text-[var(--muted)] line-through', mark: '' },
};

/** Statuses that still hold the therapist's time and can be acted on. */
export function isActiveAppointmentStatus(status: AppointmentStatus): boolean {
  return status === 'confirmed' || status === 'rescheduled';
}
