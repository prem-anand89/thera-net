import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { hasSupabaseConfig } from '@/lib/env';
import { bookingService } from '@/services';
import { btnPrimary } from '@/components/ui';
import type { UUID } from '@/domain/types';

const inputCls =
  'w-full rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-2.5 text-sm text-[var(--ink)] focus:border-[var(--teal)] focus:outline-none';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';
const chipCls =
  'rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]';

function tomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Public, unauthenticated patient booking request form — /book/$clinicSlug.
 * No login, no Shell chrome (see Shell.tsx's early-return for this path,
 * shared with `/f/`).
 *
 * Visually modeled on a fuller reference design (name/phone/email,
 * preferred clinician, service, notes, date, time) — but deliberately
 * stops short of that reference's "pick a date to see available times"
 * behavior. Per the handoff doc, v1 has no slot picker / weekly
 * availability / conflict checking: "Do not start here." `preferredDate`
 * and `preferredTimeText` below are both plain, unconstrained preferences
 * — nothing checks them against any therapist's real calendar. Front desk
 * still confirms every request by hand into a real scheduled time.
 */
export function BookingFormPage() {
  const { clinicSlug } = useParams({ strict: false }) as { clinicSlug: string };
  const [clinicName, setClinicName] = useState<string | null>(null);
  const [therapists, setTherapists] = useState<{ id: UUID; name: string }[]>([]);
  const [services, setServices] = useState<{ id: UUID; name: string; category: string }[]>([]);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredTherapistId, setPreferredTherapistId] = useState('');
  const [serviceCatalogId, setServiceCatalogId] = useState('');
  const [notes, setNotes] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [flexible, setFlexible] = useState(false);
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
        const [clinic, therapistList, serviceList] = await Promise.all([
          bookingService.getBookingClinicName(clinicSlug),
          bookingService.listBookingTherapists(clinicSlug),
          bookingService.listBookingServices(clinicSlug),
        ]);
        setClinicName(clinic);
        setTherapists(therapistList);
        setServices(serviceList);
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
        email.trim() || null,
        preferredTherapistId || null,
        serviceCatalogId || null,
        notes.trim() || null,
        preferredDate || null,
        flexible ? 'Flexible' : preferredTimeText.trim() || null
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

  const servicesByCategory = services.reduce<Map<string, typeof services>>((map, s) => {
    const list = map.get(s.category) ?? [];
    list.push(s);
    map.set(s.category, list);
    return map;
  }, new Map());

  return (
    <div className="mx-auto mt-10 max-w-md px-4 pb-10">
      <div className="mb-6 text-center">
        <h1 className="font-display text-xl font-semibold text-[var(--ink)]">
          Request an appointment
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{clinicName}</p>
      </div>
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6"
      >
        <label className="block">
          <span className={labelCls}>Name *</span>
          <input
            type="text"
            required
            placeholder="Full name"
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Phone *</span>
            <input
              type="tel"
              required
              placeholder="Mobile"
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Email · optional</span>
            <input
              type="email"
              placeholder="Email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>

        {therapists.length > 0 && (
          <label className="block">
            <span className={labelCls}>Preferred clinician · optional</span>
            <select
              className={inputCls}
              value={preferredTherapistId}
              onChange={(e) => setPreferredTherapistId(e.target.value)}
            >
              <option value="">No preference — any available clinician</option>
              {therapists.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {services.length > 0 && (
          <label className="block">
            <span className={labelCls}>Service · optional</span>
            <select
              className={inputCls}
              value={serviceCatalogId}
              onChange={(e) => setServiceCatalogId(e.target.value)}
            >
              <option value="">Choose a service…</option>
              {[...servicesByCategory.entries()].map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className={labelCls}>Reason for visit · optional</span>
          <textarea
            rows={2}
            placeholder="Briefly describe what's bothering you or why you're coming in"
            className={inputCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={labelCls}>Preferred date · optional</span>
            <button
              type="button"
              className={chipCls}
              onClick={() => setPreferredDate(tomorrowDate())}
            >
              Tomorrow
            </button>
          </div>
          <input
            type="date"
            className={inputCls}
            value={preferredDate}
            onChange={(e) => setPreferredDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={labelCls}>Preferred time · optional</span>
            <button
              type="button"
              className={chipCls}
              style={flexible ? { background: 'var(--teal-light)' } : undefined}
              onClick={() => setFlexible((v) => !v)}
            >
              I&rsquo;m flexible
            </button>
          </div>
          {!flexible && (
            <input
              type="text"
              placeholder="e.g. Weekday mornings, or Tue after 5pm"
              className={inputCls}
              value={preferredTimeText}
              onChange={(e) => setPreferredTimeText(e.target.value)}
            />
          )}
        </div>

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
