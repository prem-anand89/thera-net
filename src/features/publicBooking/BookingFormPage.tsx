import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { hasSupabaseConfig } from '@/lib/env';
import { bookingService } from '@/services';
import { btnPrimary } from '@/components/ui';
import type { UUID } from '@/domain/types';

const inputCls =
  'w-full rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-2.5 text-sm text-[var(--ink)] focus:border-[var(--teal)] focus:outline-none';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';

function generateSlots(slotDurationMinutes: number) {
  const slots: string[] = [];
  const start = 9 * 60; // 9:00 AM
  const end = 17 * 60; // 5:00 PM
  for (let m = start; m < end; m += slotDurationMinutes) {
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    const isPM = hours >= 12;
    const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    const displayMins = mins.toString().padStart(2, '0');
    slots.push(`${displayHour}:${displayMins} ${isPM ? 'PM' : 'AM'}`);
  }
  return slots;
}

function DaySelector({
  selectedDate,
  onSelect,
}: {
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory">
      {days.map((d) => {
        const iso = d.toISOString().slice(0, 10);
        const isSelected = selectedDate === iso;
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
        const dateNum = d.getDate();
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onSelect(iso)}
            className={`flex min-w-[60px] snap-center flex-col items-center justify-center rounded-lg border p-2 transition-colors ${
              isSelected
                ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal)]'
                : 'border-[var(--border)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--teal)]'
            }`}
          >
            <span className="text-xs font-semibold uppercase">{dayName}</span>
            <span className="text-lg font-bold">{dateNum}</span>
          </button>
        );
      })}
    </div>
  );
}

function TimeChipGrid({
  slotDurationMinutes,
  selectedTime,
  onSelect,
}: {
  slotDurationMinutes: number;
  selectedTime: string | null;
  onSelect: (time: string) => void;
}) {
  const slots = generateSlots(slotDurationMinutes);
  return (
    <div className="grid grid-cols-4 gap-2">
      {slots.map((time) => {
        const isSelected = selectedTime === time;
        return (
          <button
            key={time}
            type="button"
            onClick={() => onSelect(time)}
            className={`rounded-md border py-2 text-xs font-medium transition-colors ${
              isSelected
                ? 'border-[var(--teal)] bg-[var(--teal)] text-white'
                : 'border-[var(--border)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--teal)]'
            }`}
          >
            {time}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Public, unauthenticated patient booking request form — /book/$clinicSlug.
 * No login, no Shell chrome (see Shell.tsx's early-return for this path,
 * shared with `/f/`).
 *
 * Visually modeled on a fuller reference design (name/phone/email,
 * preferred clinician, notes, date, time) — but deliberately
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
  const [clinicLogo, setClinicLogo] = useState<string | null>(null);
  const [slotDuration, setSlotDuration] = useState(30);
  const [therapists, setTherapists] = useState<{ id: UUID; name: string }[]>([]);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredTherapistId, setPreferredTherapistId] = useState('');
  const [notes, setNotes] = useState('');
  const [preferredDate, setPreferredDate] = useState<string | null>(new Date().toISOString().slice(0, 10));
  const [preferredTime, setPreferredTime] = useState<string | null>(null);
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
        const [info, therapistList] = await Promise.all([
          bookingService.getBookingClinicInfo(clinicSlug),
          bookingService.listBookingTherapists(clinicSlug),
        ]);
        setClinicName(info.name);
        setClinicLogo(info.logoPath);
        setSlotDuration(info.slotDurationMinutes);
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
        email.trim() || null,
        preferredTherapistId || null,
        notes.trim() || null,
        preferredDate || null,
        preferredTime || null
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
    <div className="mx-auto mt-10 max-w-md px-4 pb-10">
      <div className="mb-6 text-center">
        {clinicLogo && (
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white shadow-sm">
            <img src={clinicLogo} alt={clinicName || ''} className="h-full w-full object-cover" />
          </div>
        )}
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
          <span className={labelCls}>Preferred date · optional</span>
          <DaySelector
            selectedDate={preferredDate}
            onSelect={(d) => {
              setPreferredDate(d);
              setPreferredTime(null); // Reset time when date changes
            }}
          />
        </div>

        <div>
          <span className={labelCls}>Preferred time · optional</span>
          <TimeChipGrid
            slotDurationMinutes={slotDuration}
            selectedTime={preferredTime}
            onSelect={setPreferredTime}
          />
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
