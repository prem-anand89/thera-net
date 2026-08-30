import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { hasSupabaseConfig } from '@/lib/env';
import { bookingService } from '@/services';
import { btnPrimary } from '@/components/ui';
import type { UUID } from '@/domain/types';

/**
 * Public, unauthenticated patient booking request form — /book/$clinicSlug.
 * No login, no Shell chrome (see Shell.tsx's early-return for this path,
 * shared with `/f/`). No slot picker — per the handoff doc, v1 is name,
 * phone, optional therapist, and a plain free-text preferred day/time;
 * staff confirm it into a real scheduled time by hand from Requests →
 * Bookings. Structurally mirrors `FeedbackFormPage.tsx` (validate →
 * form → thank-you), the other public/no-Shell page in this module.
 */
export function BookingFormPage() {
  const { clinicSlug } = useParams({ strict: false }) as { clinicSlug: string };
  const [clinicName, setClinicName] = useState<string | null>(null);
  const [therapists, setTherapists] = useState<{ id: UUID; name: string }[]>([]);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredTherapistId, setPreferredTherapistId] = useState('');
  const [preferredTimeText, setPreferredTimeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setChecking(false);
      setInvalid(true);
      return;
    }
    (async () => {
      try {
        const [clinic, therapistList] = await Promise.all([
          bookingService.getBookingClinicName(clinicSlug),
          bookingService.listBookingTherapists(clinicSlug),
        ]);
        setClinicName(clinic);
        setTherapists(therapistList);
      } catch {
        setInvalid(true);
      }
      setChecking(false);
    })();
  }, [clinicSlug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError('Name and phone are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bookingService.submitAppointmentRequest(
        clinicSlug,
        name.trim(),
        phone.trim(),
        preferredTherapistId || null,
        preferredTimeText.trim() || null
      );
      setDone(true);
    } catch (e) {
      // Same reasoning as FeedbackFormPage: this RPC's raised text is
      // meant for the patient to read directly, not a generic fallback.
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    }
    setBusy(false);
  }

  if (checking) {
    return <Centered>Loading…</Centered>;
  }

  if (invalid) {
    return (
      <Centered>
        <p className="text-sm text-[var(--muted)]">
          This booking page is not available. Please contact the clinic directly.
        </p>
      </Centered>
    );
  }

  if (done) {
    return (
      <Centered>
        <p className="text-sm text-[var(--ink)]">
          Thanks! Your request has been sent to {clinicName}. They&rsquo;ll confirm your appointment
          shortly.
        </p>
      </Centered>
    );
  }

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <div className="mb-6 text-center">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">{clinicName}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Request an appointment</p>
      </div>
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Your name</span>
          <input
            type="text"
            required
            className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-2 text-sm text-[var(--ink)]"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Phone number</span>
          <input
            type="tel"
            required
            className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-2 text-sm text-[var(--ink)]"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        {therapists.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
              Preferred therapist (optional)
            </span>
            <select
              className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-2 text-sm text-[var(--ink)]"
              value={preferredTherapistId}
              onChange={(e) => setPreferredTherapistId(e.target.value)}
            >
              <option value="">No preference</option>
              {therapists.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
            Preferred day/time (optional)
          </span>
          <input
            type="text"
            placeholder="e.g. Weekday mornings, or Tue after 5pm"
            className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-2 text-sm text-[var(--ink)]"
            value={preferredTimeText}
            onChange={(e) => setPreferredTimeText(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-[var(--rust)]">{error}</p>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? 'Sending…' : 'Request appointment'}
        </button>
      </form>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 text-center">{children}</div>
  );
}
