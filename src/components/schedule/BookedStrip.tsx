import { useEffect } from 'react';
import { bookingService } from '@/services';
import type { BookedSlot } from '@/components/BookSlotSheet';

/**
 * The "booked — tell the patient" strip shown after staff confirm a booking or a request, on the Schedule and on
 * Workspace. Booking never messages anyone by itself; this is the one-tap WhatsApp to the patient (and the
 * therapist, if their number is on file). It dismisses itself after 15 seconds.
 */
export function BookedStrip({
  booked,
  clinicName,
  therapist,
  onDismiss,
}: {
  booked: BookedSlot;
  clinicName: string;
  therapist?: { name: string; phone?: string | null };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 15_000);
    return () => clearTimeout(timer);
  }, [booked, onDismiss]);

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-[var(--teal)] bg-[var(--surface)] p-3 shadow-lg sm:bottom-4 sm:left-auto sm:max-w-md"
    >
      <p className="text-sm text-[var(--ink)]">
        <strong>{booked.patientName}</strong>{' '}
        {booked.kind === 'rescheduled' ? 'moved to' : booked.sessions ? `— ${booked.sessions} sessions booked, first on` : 'booked for'}{' '}
        {new Date(booked.scheduledAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
      </p>
      <div className="flex items-center gap-2">
        {booked.patientPhone && (
          <button
            type="button"
            className="min-h-9 text-xs font-medium text-[var(--teal)]"
            onClick={() =>
              bookingService.messagePatient(booked.kind, {
                patientName: booked.patientName,
                patientPhone: booked.patientPhone,
                clinicName,
                scheduledAt: booked.scheduledAt,
                therapistName: therapist?.name,
                sessions: booked.sessions,
              })
            }
          >
            Message patient
          </button>
        )}
        {therapist?.phone && (
          <button
            type="button"
            className="min-h-9 text-xs font-medium text-[var(--teal)]"
            onClick={() =>
              bookingService.messageTherapist(booked.kind, {
                therapistName: therapist.name,
                therapistPhone: therapist.phone!,
                patientName: booked.patientName,
                scheduledAt: booked.scheduledAt,
                sessions: booked.sessions,
              })
            }
          >
            Message therapist
          </button>
        )}
        <button type="button" className="text-xs font-medium text-[var(--muted)]" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
