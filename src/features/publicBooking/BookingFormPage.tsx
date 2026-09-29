import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { hasSupabaseConfig } from '@/lib/env';
import { bookingService } from '@/services';
import type { UUID } from '@/domain/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function generateSlots(slotDurationMinutes: number) {
  const morning: string[] = [];
  const afternoon: string[] = [];
  const start = 9 * 60;
  const end = 17 * 60;
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
function getDayStatus(d: Date, today: Date) {
  const iso = isoDate(d);
  const isPast = iso < isoDate(today);
  if (isPast) return 'past';
  if (d.getDay() === 0) return 'closed'; // Sunday
  if (d.getDate() === 14 || d.getDate() === 20) return 'holiday';
  if (d.getDate() === 15 || d.getDate() === 22) return 'booked';
  return 'available';
}

function MiniCalendar({
  selectedDate,
  onSelect,
}: {
  selectedDate: string | null;
  onSelect: (date: string) => void;
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
          const status = getDayStatus(cellDate, today);
          const isSelected = iso === selectedDate;

          let btnCls = "h-12 w-full rounded-xl font-semibold text-base flex items-center justify-center transition-all ";
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
          } else if (status === 'booked') {
            btnCls += "text-[var(--muted)] cursor-not-allowed border-2 border-dotted border-gray-300 bg-white opacity-80";
            title = "Fully booked";
          } else {
            btnCls += "hover:bg-[var(--paper)] text-[var(--ink)]";
            title = "Available";
          }

          return (
            <button
              key={i}
              type="button"
              title={title}
              disabled={status === 'past' || status === 'closed' || status === 'holiday' || status === 'booked'}
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

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepBar({ step }: { step: 1 | 2 }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-0">
      {[
        { n: 1, label: 'Your info' },
        { n: 2, label: 'When to come' },
      ].map(({ n, label }, idx) => {
        const done = step > n;
        const active = step === n;
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all ${
                  done
                    ? 'bg-[var(--teal)] text-white'
                    : active
                      ? 'bg-[var(--teal)] text-white shadow-md'
                      : 'bg-[var(--paper)] text-[var(--muted)] border border-[var(--border)]'
                }`}
              >
                {done ? '✓' : n}
              </div>
              <span
                className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${
                  active ? 'text-[var(--teal)]' : 'text-[var(--muted)]'
                }`}
              >
                {label}
              </span>
            </div>
            {idx < 1 && (
              <div
                className={`mx-2 mb-5 h-px w-16 transition-colors ${
                  done ? 'bg-[var(--teal)]' : 'bg-[var(--border)]'
                }`}
              />
            )}
          </div>
        );
      })}
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
  const [therapists, setTherapists] = useState<{ id: UUID; name: string }[]>([]);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);

  // Step state
  const [step, setStep] = useState<1 | 2>(1);

  // Form fields – step 1
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredTherapistId, setPreferredTherapistId] = useState('');
  const [notes, setNotes] = useState('');
  const [step1Error, setStep1Error] = useState<string | null>(null);

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

  function goToStep2(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setStep1Error('Full name and phone number are required.');
      return;
    }
    setStep1Error(null);
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSubmitError(null);
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
  const { morning, afternoon } = generateSlots(slotDuration);

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen bg-gradient-to-br from-[#f0f9ff] via-[#f8fafc] to-[#f1f5f9]"
    >
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b border-[var(--border)] bg-white/90 px-4 py-3 backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {clinicLogo ? (
            <div className="h-8 w-8 overflow-hidden rounded-full border border-[var(--border)] bg-white shadow-sm flex-shrink-0">
              <img src={clinicLogo} alt={clinicName || ''} className="h-full w-full object-cover" />
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--teal-light)] flex-shrink-0">
              <span className="text-[var(--teal)] text-sm">🏥</span>
            </div>
          )}
          <div>
            <p className="text-xs text-[var(--muted)]">Book an appointment</p>
            <p className="text-sm font-semibold text-[var(--ink)] leading-tight">{clinicName}</p>
          </div>
        </div>
      </header>

      {/* Content */}
      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="rounded-[20px] border border-[var(--border)] bg-white p-6 shadow-sm md:p-10">
          {step === 1 && (
            <form onSubmit={goToStep2} noValidate>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-8">
                {/* Left Column: Personal Details */}
                <div>
                  <h2 className="mb-6 text-2xl font-bold text-[var(--ink)]">Patient details</h2>
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
                    <div className="flex">
                      <div className="flex items-center rounded-l-[10px] border border-r-0 border-[var(--border)] bg-[var(--paper)] px-4 text-sm text-[var(--muted)] font-medium">
                        🇮🇳 +91
                      </div>
                      <input
                        type="tel"
                        autoComplete="tel"
                        placeholder="9876543210"
                        className={`${inputCls} rounded-l-none`}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </Field>

                  <Field label="Email address (optional)">
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      className={inputCls}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                </div>

                {/* Right Column: Preferences */}
                <div>
                  <h2
                    className="mb-6 hidden text-2xl font-bold text-transparent md:block select-none"
                    aria-hidden="true"
                  >
                    Optional
                  </h2>

                  {therapists.length > 0 && (
                    <Field label="Preferred clinician (optional)">
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

                  <Field label="Reason for visit (optional)">
                    <textarea
                      rows={4}
                      placeholder="Briefly describe what's bothering you…"
                      className={inputCls}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </Field>
                  {step1Error && <p className="mt-2 text-sm font-medium text-[var(--rust)]">{step1Error}</p>}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="mt-12 flex flex-col-reverse items-center justify-between gap-6 border-t border-[var(--border)] pt-8 md:flex-row">
                <StepBar step={step} />
                <button
                  type="submit"
                  className="w-full rounded-full bg-[var(--teal)] px-8 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 md:w-auto"
                >
                  Continue
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={onSubmit} noValidate>
              <div className="grid grid-cols-1 md:grid-cols-[400px_1fr] gap-x-12 gap-y-12 items-start">
                {/* Left Column: Calendar Component */}
                <div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-xl shadow-teal-900/5">
                    <h3 className="text-xl font-bold font-serif mb-6 text-[var(--ink)]">
                      {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </h3>
                    <MiniCalendar
                      selectedDate={preferredDate}
                      onSelect={(d) => {
                        setPreferredDate(d);
                        setPreferredTime(null);
                      }}
                    />
                  </div>
                </div>

                {/* Right Column: Time Selection */}
                <div>
                  <h2 className="text-3xl font-bold text-[var(--ink)] mb-2">Book Your Appointment</h2>
                  
                  {!preferredDate ? (
                    <p className="text-[var(--muted)] text-base mb-8">
                      Select a date on the left to see available times.
                    </p>
                  ) : (
                    <>
                      <p className="text-[var(--muted)] text-base mb-8">
                        Select an available time slot for{' '}
                        <strong className="text-[var(--ink)] font-semibold">
                          {new Date(preferredDate + 'T00:00:00').toLocaleDateString('en-IN', {
                            weekday: 'long',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </strong>
                      </p>

                      <div className="space-y-6">
                        <TimeGroup
                          label="Morning"
                          icon="☀️"
                          slots={morning}
                          selectedTime={preferredTime}
                          onSelect={setPreferredTime}
                        />
                        <TimeGroup
                          label="Afternoon"
                          icon="🌤️"
                          slots={afternoon}
                          selectedTime={preferredTime}
                          onSelect={setPreferredTime}
                        />
                      </div>
                    </>
                  )}
                  {submitError && <p className="mt-4 text-sm font-medium text-[var(--rust)]">{submitError}</p>}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="mt-12 flex flex-col items-center justify-between gap-6 border-t border-[var(--border)] pt-8 md:flex-row">
                <div className="flex w-full items-center justify-between gap-6 md:w-auto">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                  >
                    ← Back
                  </button>
                  <div className="hidden md:block">
                    <StepBar step={step} />
                  </div>
                </div>
                
                <div className="md:hidden">
                  <StepBar step={step} />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-full bg-[var(--teal)] px-8 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60 md:w-auto"
                >
                  {busy ? 'Sending…' : 'Continue'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Small reusable primitives ────────────────────────────────────────────────

const inputCls =
  'w-full rounded-[10px] border border-[var(--border)] bg-white p-3 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:outline-none transition-colors';



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
