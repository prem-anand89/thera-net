import { useDialogBehavior } from '@/components/dialogBehavior';
import { useEffect, useRef, useState } from 'react';
import { ErrorNote, Field, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { bookingService } from '@/services';
import type { UUID } from '@/domain/types';
import type { TimeOfDay } from '@/domain/waitlistMatch';

const TIME_OF_DAY_OPTIONS: { value: TimeOfDay | 'any'; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
];

/** Staff-entered waitlist join — a phone call-in whose preferred day is
 *  full. Same shape as the public booking page's own waitlist join
 *  (`submit_appointment_request`/`add_waitlist_entry` both write the same
 *  `appointment_requests` row), so it shows up in Requests exactly the
 *  same way and gets matched the same way once a slot opens up. */
export function AddToWaitlistSheet({
  open,
  clinicId,
  initialDate,
  therapists,
  onClose,
  onAdded,
}: {
  open: boolean;
  clinicId: UUID;
  initialDate: string;
  therapists: { id: UUID; name: string }[];
  onClose: () => void;
  onAdded?: () => void;
}) {
  const dialogRef = useDialogBehavior<HTMLDivElement>(open, onClose);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredTherapistId, setPreferredTherapistId] = useState('');
  const [preferredDate, setPreferredDate] = useState(initialDate);
  const [preferredTimeOfDay, setPreferredTimeOfDay] = useState<TimeOfDay | 'any'>('any');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPhone('');
    setPreferredTherapistId('');
    setPreferredDate(initialDate);
    setPreferredTimeOfDay('any');
    setNotes('');
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  async function save() {
    if (!name.trim() || !phone.trim()) return setError('Name and phone are required.');
    setBusy(true);
    setError(null);
    try {
      await bookingService.addWaitlistEntry({
        clinicId,
        name: name.trim(),
        phone: phone.trim(),
        email: null,
        preferredTherapistId: preferredTherapistId || null,
        notes: notes.trim() || null,
        preferredDate: preferredDate || null,
        preferredTimeOfDay,
      });
      onAdded?.();
      onClose();
    } catch (saveError) {
      setError(toFriendlyMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef} role="dialog"
        aria-modal="true"
        aria-labelledby="add-waitlist-title"
        className="w-full rounded-t-2xl bg-[var(--surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="add-waitlist-title" className="font-display text-lg font-semibold text-[var(--ink)]">
          Add to waitlist
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          For a patient who called in about a day that's already full — they'll show up in Requests, and
          you'll be notified here if a matching slot opens up.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputCls} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label="Phone">
            <input type="tel" className={inputCls} value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Preferred day">
            <input type="date" className={inputCls} value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} />
          </Field>
          <Field label="Time of day">
            <select className={inputCls} value={preferredTimeOfDay} onChange={(event) => setPreferredTimeOfDay(event.target.value as TimeOfDay | 'any')}>
              {TIME_OF_DAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {therapists.length > 0 && (
          <div className="mt-3">
            <Field label="Preferred clinician (optional)">
              <select className={inputCls} value={preferredTherapistId} onChange={(event) => setPreferredTherapistId(event.target.value)}>
                <option value="">Anyone available</option>
                {therapists.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="mt-3">
          <Field label="Notes (optional)">
            <textarea rows={2} className={`${inputCls} h-auto py-2`} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>
        <ErrorNote message={error} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
            {busy ? 'Adding…' : 'Add to waitlist'}
          </button>
        </div>
      </div>
    </div>
  );
}
