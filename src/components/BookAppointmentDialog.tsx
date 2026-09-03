import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { btnPrimary, btnSecondary, inputCls, ErrorNote, Field } from '@/components/ui';
import type { UUID } from '@/domain/types';

/** `<input type="datetime-local">` needs local-time-no-offset — same
 *  reasoning as RequestsPage's own copy of this: a plain toISOString()
 *  slice would silently shift by the browser's UTC offset. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultScheduledAt(): string {
  return toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000).toISOString());
}

/**
 * Quick "book this patient an appointment" action from the Patients list —
 * same underlying RPC as Requests → Bookings' own "+ New booking" form
 * (`create_appointment_staff`, straight to a confirmed appointment, no
 * pending-request row), just reachable from a patient's own row instead of
 * requiring a detour through Requests. Pre-fills name/phone from the
 * patient record and, when given, the therapist who saw them last —
 * front desk usually wants "same therapist as before," not a blank pick.
 */
export function BookAppointmentDialog({
  clinicId,
  patientId,
  patientName,
  patientPhone,
  defaultTherapistId,
  onClose,
  onBooked,
}: {
  clinicId: UUID;
  /** Always known here — this dialog only ever opens from a clicked row
   *  in the Patients list, never from a typed name, so the appointment
   *  links to the real patient record from creation rather than waiting
   *  for a visit (see the RPC's own migration comment on why that's safe
   *  here specifically). */
  patientId: UUID;
  patientName: string;
  patientPhone: string | null;
  defaultTherapistId?: string | null;
  onClose: () => void;
  onBooked: () => void;
}) {
  const therapists = useLiveQuery(() => repos.therapists.list(clinicId, true), [clinicId]);
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt());
  const [therapistId, setTherapistId] = useState(defaultTherapistId ?? '');
  const [phone, setPhone] = useState(patientPhone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!phone.trim()) {
      setError('Phone is required to send a booking confirmation.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bookingService.createAppointmentStaff(
        clinicId,
        patientName,
        phone,
        therapistId || null,
        new Date(scheduledAt).toISOString(),
        patientId
      );
      onBooked();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-appointment-title"
        className="w-full max-w-sm space-y-4 rounded-2xl bg-[var(--surface)] p-4 sm:p-5"
      >
        <h2 id="book-appointment-title" className="text-sm font-semibold text-[var(--ink)]">
          Book {patientName}
        </h2>
        <div className="space-y-3">
          <Field label="Phone">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Scheduled for">
            <input
              type="datetime-local"
              className={inputCls}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </Field>
          <Field label="Therapist">
            <select
              className={inputCls}
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
            >
              <option value="">No preference</option>
              {(therapists ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <ErrorNote message={error} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Booking…' : 'Book appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}
