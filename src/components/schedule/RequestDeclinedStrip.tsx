import { useEffect } from 'react';
import { bookingService } from '@/services';
import { requestDeclinedMessage } from '@/domain/bookingMessages';

/** What a declined request needs next: the one-tap WhatsApp telling the patient (declining never messages anyone itself). */
export type DeclinedRequest = { name: string; phone: string; requestedFor: string };

export function RequestDeclinedStrip({
  declined,
  clinicName,
  onDismiss,
}: {
  declined: DeclinedRequest;
  clinicName: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 15_000);
    return () => clearTimeout(timer);
  }, [declined, onDismiss]);

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg sm:bottom-4 sm:left-auto sm:max-w-md"
    >
      <p className="text-sm text-[var(--ink)]">
        <strong>{declined.name}</strong>&apos;s request was declined. They haven&apos;t been told yet.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-h-9 text-xs font-medium text-[var(--teal)]"
          onClick={() =>
            bookingService.sendText(
              requestDeclinedMessage({ patientName: declined.name, clinicName, requestedFor: declined.requestedFor }),
              declined.phone
            )
          }
        >
          Message patient
        </button>
        <button type="button" className="text-xs font-medium text-[var(--muted)]" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
