import { useState } from 'react';
import type { AppointmentRequest } from '@/domain/types';

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes || 1}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

/** "Online": came from the public booking page, so nobody on the team has spoken to them yet. */
export function OnlineTag({ request }: { request: AppointmentRequest }) {
  if (request.source !== 'online') return null;
  return <span className="rounded-full bg-[var(--teal-light)] px-1.5 text-[10px] font-semibold leading-4 text-[var(--teal-strong)]">Online</span>;
}

export function requestWants(request: AppointmentRequest): string {
  if (!request.preferredDate) return request.preferredTimeText ? request.preferredTimeText : 'Any day';
  const day = new Date(`${request.preferredDate}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${day}${request.preferredTimeText ? `, ${request.preferredTimeText}` : ''}`;
}

function RequestRow({
  request,
  therapistName,
  onConfirm,
  onDecline,
  onFocus,
  onMessage,
}: {
  request: AppointmentRequest;
  therapistName: string | null;
  onConfirm: () => void;
  onDecline: () => void;
  onMessage?: () => void;
  /** Show it on the calendar (jump to its day and time). The name and time become the button; the phone link and actions stay separate. */
  onFocus?: () => void;
}) {
  const summary = (
    <>
      <span className="block text-sm font-medium text-[var(--ink)]">
        {request.name} <OnlineTag request={request} /> <span className="text-xs font-normal text-[var(--muted)]">· {timeAgo(request.createdAt)}</span>
      </span>
      <span className="block text-xs text-[var(--muted)]">
        {requestWants(request)}
        {therapistName ? ` · ${therapistName}` : ''}
      </span>
    </>
  );
  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
      {onFocus ? (
        <button type="button" className="block w-full text-left hover:opacity-80" onClick={onFocus} title="Show on the calendar">
          {summary}
        </button>
      ) : (
        <div>{summary}</div>
      )}
      <a href={`tel:${request.phone}`} className="inline-block py-0.5 text-xs text-[var(--teal)] hover:underline">
        {request.phone}
      </a>
      {request.notes && <p className="line-clamp-2 text-xs text-[var(--ink)]">{request.notes}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" className="min-h-9 rounded-lg bg-[var(--teal)] px-3 text-xs font-medium text-white" onClick={onConfirm}>
          Book
        </button>
        {onMessage && (
          <button type="button" className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--teal)]" onClick={onMessage}>
            WhatsApp
          </button>
        )}
        <button type="button" className="min-h-9 px-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--rust)]" onClick={onDecline}>
          Dismiss
        </button>
      </div>
    </li>
  );
}

/**
 * Pending public booking requests shown where staff already are: a
 * collapsible strip above the calendar, or a section in the desktop rail.
 * The Requests tab remains the full list.
 */
export function RequestsInbox({
  requests,
  variant,
  therapistNameFor,
  onConfirm,
  onDecline,
  onSeeAll,
  onFocus,
  onMessage,
  limit = 5,
}: {
  requests: AppointmentRequest[];
  variant: 'strip' | 'rail' | 'list';
  therapistNameFor: (id: string | null) => string | null;
  onConfirm: (request: AppointmentRequest) => void;
  onDecline: (request: AppointmentRequest) => void;
  onSeeAll: () => void;
  /** Jump the calendar to a request's day and time (Schedule only). */
  onFocus?: (request: AppointmentRequest) => void;
  /** WhatsApp "we've noted your request" to the person. Omit to hide the button. */
  onMessage?: (request: AppointmentRequest) => void;
  limit?: number;
}) {
  const [open, setOpen] = useState(false);
  if (requests.length === 0) return null;
  const oldest = [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const shown = requests.slice(0, limit);
  const rows = (
    <ul className="space-y-2">
      {shown.map((request) => (
        <RequestRow
          key={request.id}
          request={request}
          therapistName={therapistNameFor(request.preferredTherapistId)}
          onConfirm={() => onConfirm(request)}
          onDecline={() => onDecline(request)}
          onFocus={onFocus ? () => onFocus(request) : undefined}
          onMessage={onMessage ? () => onMessage(request) : undefined}
        />
      ))}
      {requests.length > shown.length && (
        <li>
          <button type="button" className="text-xs font-medium text-[var(--teal)] hover:underline" onClick={onSeeAll}>
            See all {requests.length} awaiting
          </button>
        </li>
      )}
    </ul>
  );

  if (variant === 'list') return rows;

  if (variant === 'rail') {
    return (
      <section aria-label="Awaiting" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Awaiting <span className="ml-1 rounded-full bg-[var(--rust)] px-1.5 text-[10px] text-white">{requests.length}</span>
          </h3>
          <button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={onSeeAll}>
            All
          </button>
        </div>
        {rows}
      </section>
    );
  }

  return (
    <section aria-label="Awaiting" className="rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-light)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm text-[var(--ink)]"
      >
        <span>
          <strong>{requests.length} awaiting</strong>
          <span className="text-[var(--muted)]"> · oldest {timeAgo(oldest.createdAt)}</span>
        </span>
        <span className="text-xs font-medium text-[var(--teal)]">{open ? 'Hide' : 'Review'}</span>
      </button>
      {open && <div className="px-3 pb-3">{rows}</div>}
    </section>
  );
}
