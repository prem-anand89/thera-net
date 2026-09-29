import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { hasSupabaseConfig } from '@/lib/env';
import { bookingService } from '@/services';
import type { UUID } from '@/domain/types';
import { publicLogoUrl } from '@/lib/supabase';

type AvailabilityData = {
  closedWeekdays: number[];
  closedDates: { date: string; label: string }[];
  appointments: { scheduled_at: string; therapist_id: UUID }[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function generateSlots(slotDurationMinutes: number, startHour: number, endHour: number) {
  const morning: string[] = [];
  const afternoon: string[] = [];
  const start = startHour * 60;
  const end = endHour * 60;
  for (let m = start; m < end; m += slotDurationMinutes) {
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    const isPM = hours >= 12;
    const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    const label = `${displayHour}:${mins.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
    if (hours < 12) morning.push(label);
    else afternoon.push(label);
  }
  return { morning, afternoon };
}

// ─── Mini Calendar ────────────────────────────────────────────────────────────

// Mock availability logic for UI demonstration
function getDayStatus(d: Date, today: Date, availability: AvailabilityData | null) {
  const iso = isoDate(d);
  const isPast = iso < isoDate(today);
  if (isPast) return 'past';
  
  if (!availability) return 'available'; // Default while loading

  if (availability.closedWeekdays.includes(d.getDay())) return 'closed';
  
  const closedDate = availability.closedDates.find(cd => cd.date === iso);
  if (closedDate) return 'holiday';

  // For fully booked days, we'll let the user click it and see empty slots.
  return 'available';
}

function MiniCalendar({
  selectedDate,
  onSelect,
  availability,
}: {
  selectedDate: string | null;
  onSelect: (date: string) => void;
  availability: AvailabilityData | null;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  // Shift so Mon=0
  const startOffset = (firstDay + 6) % 7;

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={prevMonth}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-xl font-bold font-serif text-[var(--ink)]">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-3 gap-2">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
          <div key={i} className="text-center text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
            {d}
          </div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 gap-2">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="h-12 w-full" />;

          const cellDate = new Date(viewYear, viewMonth, day);
          const iso = isoDate(cellDate);
          const status = getDayStatus(cellDate, today, availability);
          const isSelected = iso === selectedDate;

          let btnCls = "h-10 w-full rounded-xl font-semibold text-sm flex items-center justify-center transition-all ";
          let title = "";

          if (isSelected) {
            btnCls += "bg-[var(--teal)] text-white shadow-md";
          } else if (status === 'past') {
            btnCls += "text-[var(--muted)] opacity-30 cursor-not-allowed";
          } else if (status === 'closed') {
            btnCls += "bg-[#F9FAFB] text-[var(--muted)] opacity-60 cursor-not-allowed";
            title = "Closed";
          } else if (status === 'holiday') {
            btnCls += "bg-orange-50/50 text-orange-800/80 cursor-not-allowed";
            title = "Holiday / Clinic Closure";
          } else {
            btnCls += "hover:bg-[var(--paper)] text-[var(--ink)]";
            title = "Available";
          }

          return (
            <button
              key={i}
              type="button"
              title={title}
              disabled={status === 'past' || status === 'closed' || status === 'holiday'}
              onClick={() => onSelect(iso)}
              className={btnCls}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Time Slot Group ──────────────────────────────────────────────────────────

function TimeGroup({
  label,
  icon,
  slots,
  selectedTime,
  onSelect,
}: {
  label: string;
  icon: string;
  slots: string[];
  selectedTime: string | null;
  onSelect: (t: string) => void;
}) {
  if (slots.length === 0) return null;
  return (
    <div className="mb-4">
      <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        <span>{icon}</span> {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {slots.map((t) => {
          const sel = t === selectedTime;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all ${
                sel
                  ? 'border-[var(--teal)] bg-[var(--teal)] text-white shadow-sm'
                  : 'border-[var(--border)] bg-white text-[var(--ink)] hover:border-[var(--teal)] hover:text-[var(--teal)]'
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Public, unauthenticated patient booking request form — /book/$clinicSlug.
 * No login, no Shell chrome (see Shell.tsx's early-return for this path,
 * shared with `/f/`).
 *
 * Two-step flow:
 *   Step 1 — Patient details (name, phone+91, email, clinician, reason)
 *   Step 2 — Preferred date (mini calendar) + preferred time (grouped chips)
 *
 * Still a preference-based request, not a real slot blocker — front desk
 * confirms every request by hand.
 */
export function BookingFormPage() {
  const { clinicSlug } = useParams({ strict: false }) as { clinicSlug: string };

  // Clinic meta
  const [clinicName, setClinicName] = useState<string | null>(null);
  const [clinicLogo, setClinicLogo] = useState<string | null>(null);
  const [slotDuration, setSlotDuration] = useState(30);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [therapists, setTherapists] = useState<{ id: UUID; name: string }[]>([]);
  const [availability, setAvailability] = useState<AvailabilityData | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredTherapistId, setPreferredTherapistId] = useState('');
  const [notes, setNotes] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Form fields – step 2
  const [preferredDate, setPreferredDate] = useState<string | null>(null);
  const [preferredTime, setPreferredTime] = useState<string | null>(null);

  // Submit state
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setChecking(false);
      setInvalid(true);
      return;
    }
    (async () => {
      try {
        const [info, therapistList, avail] = await Promise.all([
          bookingService.getBookingClinicInfo(clinicSlug),
          bookingService.listBookingTherapists(clinicSlug),
          bookingService.getBookingAvailability(
            clinicSlug,
            isoDate(new Date()),
            isoDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)) // fetch next 90 days
          )
        ]);
        setClinicName(info.name);
        setClinicLogo(publicLogoUrl(info.logoPath) ?? null);
        setSlotDuration(info.slotDurationMinutes);
        setStartHour(info.bookingStartHour);
        setEndHour(info.bookingEndHour);
        setTherapists(therapistList);
        setAvailability(avail);
      } catch {
        setInvalid(true);
      }
      setChecking(false);
    })();
  }, [clinicSlug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setSubmitError('Full name and phone number are required.');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await bookingService.submitAppointmentRequest(
        clinicSlug,
        name.trim(),
        `${countryCode} ${phone.trim()}`,
        email.trim() || null,
        preferredTherapistId || null,
        notes.trim() || null,
        preferredDate || null,
        preferredTime || null
      );
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
    setBusy(false);
  }

  // ── Loading / error / done states ────────────────────────────────────────

  if (checking) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--teal)]" />
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        </div>
      </Centered>
    );
  }

  if (invalid) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--paper)] text-2xl">🔒</div>
          <p className="text-sm text-[var(--muted)]">
            This booking page is not available. Please contact the clinic directly.
          </p>
        </div>
      </Centered>
    );
  }

  if (done) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--teal-light)] text-3xl">
            ✓
          </div>
          <div>
            <p className="text-base font-semibold text-[var(--ink)]">Request sent!</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Thanks! {clinicName} will confirm your appointment shortly.
            </p>
          </div>
        </div>
      </Centered>
    );
  }

  // ── Slot grouping ─────────────────────────────────────────────────────────
  let { morning, afternoon } = generateSlots(slotDuration, startHour, endHour);

  if (preferredDate && availability) {
    const bookedTimes = availability.appointments
      .filter(a => !preferredTherapistId || a.therapist_id === preferredTherapistId)
      .map(a => new Date(a.scheduled_at))
      .filter(d => isoDate(d) === preferredDate)
      .map(d => {
        let h = d.getHours();
        const m = d.getMinutes();
        const isPM = h >= 12;
        h = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `${h}:${m.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
      });

    morning = morning.filter(t => !bookedTimes.includes(t));
    afternoon = afternoon.filter(t => !bookedTimes.includes(t));
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen"
      style={{ background: 'linear-gradient(135deg, #e8f4f8 0%, #f0f4f8 50%, #edf2f7 100%)' }}
    >
      {/* Main Content — no sticky header, logo is inside the card */}
      <main className="mx-auto max-w-md px-4 py-10">
        {/* The single form card */}
        <div className="rounded-[20px] border border-[var(--border)] bg-white shadow-lg">
          {/* Card header — logo + title in one row */}
          <div className="px-6 pt-8 pb-6 border-b border-[var(--border)] flex items-center gap-4">
            {/* Logo / fallback */}
            {clinicLogo ? (
              <div className="h-12 w-12 overflow-hidden rounded-full border border-[var(--border)] bg-white shadow-sm flex-shrink-0">
                <img src={clinicLogo} alt={clinicName || ''} className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--teal-light)] flex-shrink-0">
                <span className="text-2xl">🏥</span>
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-[var(--ink)] leading-tight">Book an appointment</h1>
              {clinicName && (
                <p className="mt-0.5 text-sm text-[var(--muted)]">{clinicName}</p>
              )}
            </div>
          </div>

          {/* Form body */}
          <form onSubmit={onSubmit} noValidate className="px-6 py-6 space-y-4">
            {/* --- Required fields --- */}
            <Field label="Full name *">
              <input
                type="text"
                autoComplete="name"
                placeholder="John Doe"
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="Phone number *">
              <div className="flex h-[46px]">
                <select
                  className={selectCls}
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                >
                  <option value="+91">🇮🇳 +91</option>
                  <option value="+1">🇺🇸 +1</option>
                  <option value="+44">🇬🇧 +44</option>
                  <option value="+61">🇦🇺 +61</option>
                  <option value="+971">🇦🇪 +971</option>
                </select>
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="9876543210"
                  className={`${inputCls} h-full rounded-l-none border-l-0`}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </Field>

            {/* --- Optional fields --- */}
            <div className="border-t border-[var(--border)] pt-4 mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">Optional</p>
              <div className="space-y-4">
                <Field label="Email address">
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className={inputCls}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                {/* Conditionally render clinician dropdown only if therapists.length > 0 */}
                {therapists.length > 0 && (
                  <Field label="Preferred clinician">
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
                  </Field>
                )}
                <Field label="Reason for visit">
                  <textarea
                    rows={3}
                    placeholder="Briefly describe what's bothering you…"
                    className={inputCls}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
              </div>
            </div>

            {/* --- Date Picker --- */}
            <div className="border-t border-[var(--border)] pt-4 mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">Preferred date & time</p>
              {/* Date trigger + popover wrapper — relative so the calendar overlays content below */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setCalendarOpen(prev => !prev)}
                  className="w-full flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-white p-3 text-sm text-left transition-colors hover:border-[var(--teal)]"
                >
                  <span className={preferredDate ? 'text-[var(--ink)] font-medium' : 'text-[var(--muted)]'}>
                    {preferredDate
                      ? new Date(preferredDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                      : '📅 Select a date (optional)'}
                  </span>
                  <span className="text-[var(--muted)] text-xs">{calendarOpen ? '▲' : '▼'}</span>
                </button>

                {/* Calendar overlays content below — position absolute, z-index high */}
                {calendarOpen && (
                  <div className="absolute left-0 right-0 bottom-full mb-2 z-50 rounded-[12px] border border-[var(--border)] bg-white p-4 shadow-2xl">
                    <MiniCalendar
                      selectedDate={preferredDate}
                      availability={availability}
                      onSelect={(d) => {
                        setPreferredDate(d);
                        setPreferredTime(null);
                        setCalendarOpen(false);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Time slots — appear below only after a date is selected */}
              {preferredDate && (
                <div className="mt-4 space-y-4">
                  <TimeGroup label="Morning" icon="☀️" slots={morning} selectedTime={preferredTime} onSelect={setPreferredTime} />
                  <TimeGroup label="Afternoon" icon="🌤️" slots={afternoon} selectedTime={preferredTime} onSelect={setPreferredTime} />
                </div>
              )}
            </div>

            {/* Error + Submit */}
            <div className="pt-2">
              {submitError && (
                <p className="mb-3 text-sm font-medium text-[var(--rust)]">{submitError}</p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-[var(--teal)] py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? 'Sending…' : 'Request Appointment →'}
              </button>
              <p className="mt-3 text-center text-xs text-[var(--muted)]">
                {clinicName} will confirm your appointment by phone or email.
              </p>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

// ─── Small reusable primitives ────────────────────────────────────────────────

const inputCls =
  'w-full rounded-[10px] border border-[var(--border)] bg-white p-3 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:outline-none transition-colors';

const selectCls = 'h-full rounded-l-[10px] border border-r-0 border-[var(--border)] bg-[var(--paper)] px-3 text-sm text-[var(--muted)] font-medium focus:outline-none';



function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block last:mb-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
