import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Appointment, AppointmentRequest } from '@/domain/types';
import { matchingWaitlistEntries, type WaitlistOpening } from '@/domain/waitlistMatch';
import { awaitingOrder, openingFor } from '@/domain/awaiting';
import { toLocalDateStr } from '@/domain/schedule';

/**
 * "A time just opened": call `freed(appointment)` when an appointment is cancelled or moved away. `matches` are the
 * Awaiting entries that fit that day, therapist and part of the day (`matchingWaitlistEntries`), oldest first.
 * Nothing is remembered once dismissed; the list itself is always still on Workspace.
 */
export function useAwaitingOpening(pending: AppointmentRequest[]) {
  const [opening, setOpening] = useState<WaitlistOpening | null>(null);
  const matches = useMemo(
    () => (opening ? awaitingOrder(matchingWaitlistEntries(pending, opening), toLocalDateStr(new Date())) : []),
    [pending, opening]
  );
  // A time already gone frees nothing. Stable, so a re-render doesn't restart the strip's timer.
  const freed = useCallback((appointment: Pick<Appointment, 'scheduledAt' | 'therapistId'>) => {
    if (new Date(appointment.scheduledAt).getTime() > Date.now()) setOpening(openingFor(appointment));
  }, []);
  const clear = useCallback(() => setOpening(null), []);
  return { matches, freed, clear };
}

/** One line under the other strips: who is awaiting the time that just opened, and a Book button for the oldest. */
export function AwaitingOpenedStrip({
  matches,
  onBook,
  onDismiss,
}: {
  matches: AppointmentRequest[];
  onBook: (request: AppointmentRequest) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (matches.length === 0) return;
    const timer = setTimeout(onDismiss, 20_000);
    return () => clearTimeout(timer);
  }, [matches, onDismiss]);

  if (matches.length === 0) return null;
  const first = matches[0];
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-[var(--amber)] bg-[var(--surface)] p-3 shadow-lg sm:bottom-20 sm:left-auto sm:max-w-md"
    >
      <p className="text-sm text-[var(--ink)]">
        {matches.length === 1 ? (
          <>
            <strong>{first.name}</strong> is awaiting this time.
          </>
        ) : (
          <>
            <strong>{matches.length} people</strong> are awaiting this time.
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-h-9 rounded-full bg-[var(--teal)] px-3 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
          onClick={() => {
            onDismiss();
            onBook(first);
          }}
        >
          {matches.length === 1 ? 'Book' : `Book ${first.name}`}
        </button>
        <button type="button" className="text-xs font-medium text-[var(--muted)]" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
