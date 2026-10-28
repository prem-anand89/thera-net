import type { AppointmentRequest, UUID } from '@/domain/types';
import { requestWants, timeAgo } from './RequestsInbox';

/** The request staff should look at first: the one wanted soonest (no date = last), then the one waiting longest. */
export function mostUrgentRequest(requests: AppointmentRequest[]): AppointmentRequest | null {
  const sorted = [...requests].sort((a, b) => {
    const da = a.preferredDate ?? '9999-12-31';
    const db = b.preferredDate ?? '9999-12-31';
    return da.localeCompare(db) || a.createdAt.localeCompare(b.createdAt);
  });
  return sorted[0] ?? null;
}

/**
 * The bar above the calendar: always there while a booking request waits, whatever day is on screen, so whoever
 * is at the desk can answer it straight away instead of finding it in the side list. Shows the most urgent one with
 * Confirm / Decline / Show on calendar; any others are one tap away.
 */
export function PendingRequestsBar({
  requests,
  therapistNameFor,
  onConfirm,
  onDecline,
  onFocus,
  onSeeAll,
}: {
  requests: AppointmentRequest[];
  therapistNameFor: (id: UUID | null) => string | null;
  onConfirm: (request: AppointmentRequest) => void;
  onDecline: (request: AppointmentRequest) => void;
  onFocus: (request: AppointmentRequest) => void;
  onSeeAll: () => void;
}) {
  const request = mostUrgentRequest(requests);
  if (!request) return null;
  const therapist = therapistNameFor(request.preferredTherapistId);
  const others = requests.length - 1;
  return (
    <div
      role="region"
      aria-label="Booking request to confirm"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-light)] px-3 py-2 text-sm text-[var(--ink)]"
    >
      <span className="min-w-0">
        <strong className="font-medium">{request.name}</strong> asked for {requestWants(request)}
        {therapist ? ` · ${therapist}` : ''}
        <span className="text-xs text-[var(--muted)]"> · {timeAgo(request.createdAt)}</span>
        {others > 0 && (
          <button type="button" className="ml-2 text-xs font-medium text-[var(--teal)] underline" onClick={onSeeAll}>
            +{others} more
          </button>
        )}
      </span>
      <span className="flex items-center gap-2">
        <button type="button" className="min-h-8 rounded-full bg-[var(--teal)] px-3 text-xs font-medium text-white hover:bg-[var(--teal-strong)]" onClick={() => onConfirm(request)}>
          Confirm
        </button>
        <button type="button" className="min-h-8 px-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--rust)]" onClick={() => onDecline(request)}>
          Decline
        </button>
        <button type="button" className="min-h-8 px-1 text-xs font-medium text-[var(--teal)] hover:underline" onClick={() => onFocus(request)}>
          Show on calendar
        </button>
      </span>
    </div>
  );
}
