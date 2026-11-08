import { pillSmPrimary, pillSmAccent, pillSmNeutral } from '@/components/ui';
import type { AppointmentRequest } from '@/domain/types';
import { awaitingOrder, awaitingWants, isPastDay } from '@/domain/awaiting';
import { OnlineTag, timeAgo } from './RequestsInbox';

/**
 * Workspace → Appointments → Awaiting: everyone who asked for an appointment and has no time yet, public requests and
 * staff entries in one list. Book opens the usual booking sheet with their details; WhatsApp sends the "we've noted
 * your request" message (it never promises a time); Dismiss removes them after a confirm.
 */
export function AwaitingList({
  requests,
  today,
  limit,
  therapistNameFor,
  onBook,
  onMessage,
  onDismiss,
  onSeeAll,
  canMessage = () => true,
  bookedNoteFor,
}: {
  requests: AppointmentRequest[];
  /** ISO date of today, to tell entries whose day has passed. */
  today: string;
  limit: number;
  therapistNameFor: (id: string | null) => string | null;
  onBook: (request: AppointmentRequest) => void;
  onMessage: (request: AppointmentRequest) => void;
  onDismiss: (request: AppointmentRequest) => void;
  onSeeAll: () => void;
  /** False when this number belongs to a patient who asked not to be messaged. */
  canMessage?: (request: AppointmentRequest) => boolean;
  /** "Already booked for Fri, 6 Nov, 9:30 AM" when this person has an upcoming appointment. */
  bookedNoteFor?: (request: AppointmentRequest) => string | null;
}) {
  const ordered = awaitingOrder(requests, today);
  const shown = ordered.slice(0, limit);
  return (
    <ul className="-mx-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {shown.map((request) => {
        const therapist = therapistNameFor(request.preferredTherapistId);
        const past = isPastDay(request, today);
        return (
          <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
            <span className="min-w-0 flex-1 basis-48">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-sm font-medium text-[var(--ink)]">{request.name}</span>
                <OnlineTag request={request} />
                <span className="text-xs text-[var(--muted)]">{timeAgo(request.createdAt)}</span>
                <a href={`tel:${request.phone}`} className="py-0.5 text-xs text-[var(--teal)] hover:underline">
                  {request.phone}
                </a>
              </span>
              <span className="block text-xs text-[var(--muted)]">
                <span className={past ? 'font-medium text-[var(--amber-strong)]' : undefined}>{awaitingWants(request, today)}</span>
                {therapist ? `, with ${therapist}` : ''}
                {request.notes && <span className="text-[var(--ink)]"> · {request.notes}</span>}
              </span>
              {bookedNoteFor?.(request) && <span className="block text-xs font-medium text-[var(--teal-strong)]">{bookedNoteFor(request)}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className={pillSmPrimary}
                aria-label={`Book ${request.name}`}
                onClick={() => onBook(request)}
              >
                Book
              </button>
              {canMessage(request) && (
              <button
                type="button"
                className={pillSmAccent}
                aria-label={`WhatsApp ${request.name}`}
                onClick={() => onMessage(request)}
              >
                WhatsApp
              </button>
              )}
              <button
                type="button"
                className={pillSmNeutral}
                aria-label={`Dismiss ${request.name}`}
                onClick={() => onDismiss(request)}
              >
                Dismiss
              </button>
            </span>
          </li>
        );
      })}
      {ordered.length > shown.length && (
        <li className="px-5 py-2">
          <button type="button" className="text-xs font-medium text-[var(--teal)] hover:underline" onClick={onSeeAll}>
            See all {ordered.length} awaiting
          </button>
        </li>
      )}
    </ul>
  );
}
