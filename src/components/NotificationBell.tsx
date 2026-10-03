import { useNavigate } from '@tanstack/react-router';
import {
  useNewFeedbackResponseCount,
  useNewLowRatingFeedbackCount,
  useNewTherapistAppointmentCount,
} from '@/features/schedule/scheduleSignals';
import { IconBell } from './NavIcons';
import type { UUID } from '@/domain/types';

/**
 * Header-level alert, visible from any page (unlike the Schedule nav
 * item's own pending-requests dot, which only shows while that tab is in
 * view). Aggregates signals that previously had no app-wide surface at
 * all: pending booking requests (passed in — Shell.tsx already computes
 * this for the nav badge, no need for a second query), new feedback
 * responses (admin-only, `scheduleSignals.ts`'s existing "since last
 * viewed" hooks — the same ones Workspace's own "new feedback" tile
 * reads), and — for a therapist viewer — their own new/changed
 * appointments (the one in-app signal a therapist gets at all besides
 * the automatic `notify-therapist` email; see that hook's own doc
 * comment). A given viewer only ever has one of {isAdmin, therapistId}
 * meaningfully set — a plain therapist is never also admin — so the
 * feedback and appointment counts never both contribute for the same
 * person. Turns red instead of the default teal specifically when a 1-2
 * star response is among the unread ones (Phase 6.5) — color is paired
 * with the count/tooltip text, never the only signal, same rule as every
 * other status indicator in this app.
 *
 * Realtime responsiveness comes for free from `syncEngine`'s own realtime
 * channel (it already subscribes to every `ALL_SYNCED_TABLES` entry,
 * including every table this bell cares about) — once those tables were
 * added to the `supabase_realtime` publication, a server-side insert
 * reaches this component within the engine's normal debounce window, no
 * separate subscription needed here.
 */
export function NotificationBell({
  clinicId,
  pendingRequestsCount,
  isAdmin,
  therapistId,
}: {
  clinicId: UUID;
  pendingRequestsCount: number;
  isAdmin: boolean;
  /** Set only for a therapist viewer — enables their own "new/changed
   *  appointment" count. Omit for admin/front_desk. */
  therapistId?: UUID;
}) {
  const navigate = useNavigate();
  const newFeedbackCount = useNewFeedbackResponseCount(clinicId, isAdmin);
  const lowRatingCount = useNewLowRatingFeedbackCount(clinicId, isAdmin);
  const newAppointmentCount = useNewTherapistAppointmentCount(clinicId, therapistId, !!therapistId);
  const total = pendingRequestsCount + newFeedbackCount + newAppointmentCount;
  const alert = lowRatingCount > 0;

  const parts: string[] = [];
  if (pendingRequestsCount > 0) {
    parts.push(`${pendingRequestsCount} new booking request${pendingRequestsCount === 1 ? '' : 's'}`);
  }
  if (newFeedbackCount > 0) {
    parts.push(`${newFeedbackCount} new feedback response${newFeedbackCount === 1 ? '' : 's'}`);
  }
  if (newAppointmentCount > 0) {
    parts.push(`${newAppointmentCount} new or updated appointment${newAppointmentCount === 1 ? '' : 's'}`);
  }
  const label = parts.length ? parts.join(', ') : 'No new notifications';

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--paper)] ${
        alert ? 'text-[var(--rust)]' : 'text-[var(--muted)]'
      }`}
      onClick={() =>
        void navigate({
          to: '/schedule',
          search: { tab: newFeedbackCount > 0 ? 'feedback' : 'bookings' },
        })
      }
    >
      <IconBell />
      {total > 0 && (
        <span
          className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
            alert ? 'bg-[var(--rust)]' : 'bg-[var(--teal)]'
          }`}
        >
          {total}
        </span>
      )}
    </button>
  );
}
