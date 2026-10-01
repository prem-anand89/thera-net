import { useState } from 'react';
import type { AppointmentRequest } from '@/domain/types';

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes || 1}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

export function requestWants(request: AppointmentRequest): string {
  if (!request.preferredDate) return request.preferredTimeText ? `Wants ${request.preferredTimeText}` : 'Any day';
  const day = new Date(`${request.preferredDate}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `Wants ${day}${request.preferredTimeText ? `, ${request.preferredTimeText}` : ''}`;
}

function RequestRow({
  request,
  therapistName,
  onConfirm,
  onDecline,
}: {
  request: AppointmentRequest;
  therapistName: string | null;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--ink)]">
            {request.name} <span className="text-xs font-normal text-[var(--muted)]">· {timeAgo(request.createdAt)}</span>
          </p>
          <p className="truncate text-xs text-[var(--muted)]">
            {requestWants(request)}
            {therapistName ? ` · ${therapistName}` : ''}
          </p>
          <a href={`tel:${request.phone}`} className="text-xs text-[var(--teal)] hover:underline">
            {request.phone}
          </a>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button type="button" className="min-h-9 rounded-lg bg-[var(--teal)] px-3 text-xs font-medium text-white" onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" className="min-h-9 px-3 text-xs font-medium text-[var(--muted)] hover:text-[var(--rust)]" onClick={onDecline}>
            Decline
          </button>
        </div>
      </div>
      {request.notes && <p className="mt-1 line-clamp-2 text-xs text-[var(--ink)]">{request.notes}</p>}
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
  limit = 5,
}: {
  requests: AppointmentRequest[];
  /** 'rows': flat divided rows sized like Workspace's visit list. */
  variant: 'strip' | 'rail' | 'list' | 'rows';
  therapistNameFor: (id: string | null) => string | null;
  onConfirm: (request: AppointmentRequest) => void;
  onDecline: (request: AppointmentRequest) => void;
  onSeeAll: () => void;
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
        />
      ))}
      {requests.length > shown.length && (
        <li>
          <button type="button" className="text-xs font-medium text-[var(--teal)] hover:underline" onClick={onSeeAll}>
            See all {requests.length} requests
          </button>
        </li>
      )}
    </ul>
  );

  if (variant === 'list') return rows;

  if (variant === 'rows') {
    return (
      <ul className="-mx-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {shown.map((request) => {
          const therapist = therapistNameFor(request.preferredTherapistId);
          return (
            <li key={request.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--ink)]">
                  {request.name}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">{timeAgo(request.createdAt)}</span>
                </span>
                <span className="block truncate text-xs text-[var(--muted)]">
                  {requestWants(request)}
                  {therapist ? `, with ${therapist}` : ''}
                  {', '}
                  <a href={`tel:${request.phone}`} className="text-[var(--teal)] hover:underline">
                    {request.phone}
                  </a>
                </span>
              </span>
              <button type="button" className="shrink-0 rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]" onClick={() => onConfirm(request)}>
                Confirm
              </button>
              <button type="button" className="shrink-0 px-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--rust)]" onClick={() => onDecline(request)}>
                Decline
              </button>
            </li>
          );
        })}
        {requests.length > shown.length && (
          <li className="px-5 py-2">
            <button type="button" className="text-xs font-medium text-[var(--teal)] hover:underline" onClick={onSeeAll}>
              See all {requests.length} requests
            </button>
          </li>
        )}
      </ul>
    );
  }

  if (variant === 'rail') {
    return (
      <section aria-label="Booking requests">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Requests <span className="ml-1 rounded-full bg-[var(--rust)] px-1.5 text-[10px] text-white">{requests.length}</span>
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
    <section aria-label="Booking requests" className="rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-light)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm text-[var(--ink)]"
      >
        <span>
          <strong>{requests.length} booking request{requests.length === 1 ? '' : 's'} waiting</strong>
          <span className="text-[var(--muted)]"> · oldest {timeAgo(oldest.createdAt)}</span>
        </span>
        <span className="text-xs font-medium text-[var(--teal)]">{open ? 'Hide' : 'Review'}</span>
      </button>
      {open && <div className="px-3 pb-3">{rows}</div>}
    </section>
  );
}
