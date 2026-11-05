import { useEffect, useMemo, useState } from 'react';
import { Field, SheetDialog, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { PhoneField } from '@/components/PhoneField';
import { usePatientDirectory } from '@/components/usePatientDirectory';
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

const MAX_SUGGESTIONS = 4;

/**
 * "Add to awaiting": someone who called in or walked in and there is no slot. A staff entry in the same
 * `appointment_requests` table as the public page's, so it shows in the same Awaiting list and is matched the same
 * way when a time opens. The name box doubles as a patient search: choosing an existing patient fills in their phone.
 * Online only (the entry is written by a server call).
 */
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
  const { patients } = usePatientDirectory(clinicId);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState(false);
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
    setPicked(false);
    setPreferredTherapistId('');
    setPreferredDate(initialDate);
    setPreferredTimeOfDay('any');
    setNotes('');
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  const suggestions = useMemo(() => {
    const needle = name.trim().toLowerCase();
    if (picked || needle.length < 2) return [];
    return patients
      .filter((p) => p.name.toLowerCase().includes(needle) || (p.phone ?? '').includes(needle) || p.mrno.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [patients, name, picked]);

  async function save() {
    if (!name.trim()) return setError('Enter their name.');
    if (!phone.trim()) return setError('A phone number is needed, so you can reach them when a time opens. Without one they can’t be added.');
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
    <SheetDialog
      open={open}
      title="Add to awaiting"
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>
            {busy ? 'Adding…' : 'Add to awaiting'}
          </button>
        </>
      }
    >
      <p className="text-sm text-[var(--muted)]">
        For someone who called or walked in and there is no time for them yet. They stay under Awaiting on Workspace until you book or dismiss them. Needs a connection.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Field label="Name" htmlFor="awaiting-name">
            <input
              id="awaiting-name"
              className={inputCls}
              value={name}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                setPicked(false);
              }}
              autoFocus
            />
          </Field>
          {suggestions.length > 0 && (
            <ul aria-label="Matching patients" className="mt-1 overflow-clip rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {suggestions.map((p) => (
                <li key={p.id} className="border-t border-[var(--border)] first:border-t-0">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-[var(--paper)]"
                    onClick={() => {
                      setName(p.name);
                      setPhone(p.phone ?? '');
                      setPicked(true);
                    }}
                  >
                    <span className="truncate font-medium text-[var(--ink)]">{p.name}</span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{p.mrno}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Field label="Phone" htmlFor="waitlist-phone">
          <PhoneField id="waitlist-phone" value={phone} onChange={setPhone} />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Preferred day" htmlFor="awaiting-day">
          <input id="awaiting-day" type="date" className={inputCls} value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} />
        </Field>
        <Field label="Time of day" htmlFor="awaiting-time">
          <select id="awaiting-time" className={inputCls} value={preferredTimeOfDay} onChange={(event) => setPreferredTimeOfDay(event.target.value as TimeOfDay | 'any')}>
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
          <Field label="Therapist (optional)" htmlFor="awaiting-therapist">
            <select id="awaiting-therapist" className={inputCls} value={preferredTherapistId} onChange={(event) => setPreferredTherapistId(event.target.value)}>
              <option value="">Any</option>
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
        <Field label="Notes (optional)" htmlFor="awaiting-notes">
          <textarea id="awaiting-notes" rows={2} className={`${inputCls} h-auto py-2`} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </SheetDialog>
  );
}
