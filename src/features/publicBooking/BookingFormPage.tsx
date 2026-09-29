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

  const todayIso = isoDate(today);

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={prevMonth}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--paper)] transition-colors"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-[var(--ink)]">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--paper)] transition-colors"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-semibold uppercase text-[var(--muted)] py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;

          const cellDate = new Date(viewYear, viewMonth, day);
          const iso = isoDate(cellDate);
          const isPast = cellDate < today;
          const isToday = iso === todayIso;
          const isSelected = iso === selectedDate;

          return (
            <button
              key={i}
              type="button"
              disabled={isPast}
              onClick={() => onSelect(iso)}
              className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-all ${
                isSelected
                  ? 'bg-[var(--teal)] text-white shadow-sm'
                  : isToday
                    ? 'border border-[var(--teal)] text-[var(--teal)]'
                    : isPast
                      ? 'text-[var(--muted)] opacity-40 cursor-not-allowed'
                      : 'text-[var(--ink)] hover:bg-[var(--teal-light)] hover:text-[var(--teal)]'
              }`}
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
      className="min-h-screen"
      style={{ background: 'var(--paper, #f5f7fa)' }}
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
      <main className="mx-auto max-w-lg px-4 py-8">
        <StepBar step={step} />

        {step === 1 && (
          <form onSubmit={goToStep2} noValidate>
            <Card>
              <CardTitle>Patient information</CardTitle>

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
                  <div className="flex items-center rounded-l-[10px] border border-r-0 border-[var(--border)] bg-[var(--paper)] px-3 text-sm text-[var(--muted)]">
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

              <Field label="Email address · optional">
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  className={inputCls}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              {therapists.length > 0 && (
                <Field label="Preferred clinician · optional">
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

              <Field label="Reason for visit · optional">
                <textarea
                  rows={2}
                  placeholder="Briefly describe what's bothering you…"
                  className={inputCls}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>

              {step1Error && <p className="text-sm text-[var(--rust)]">{step1Error}</p>}

              <button
                type="submit"
                className="mt-2 w-full rounded-[10px] bg-[var(--teal)] py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                Next →
              </button>
            </Card>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={onSubmit} noValidate>
            {/* Back link */}
            <button
              type="button"
              onClick={() => setStep(1)}
              className="mb-4 flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              ← Back
            </button>

            <Card>
              <CardTitle>Choose a preferred date</CardTitle>
              <p className="mb-4 text-xs text-[var(--muted)]">
                We'll try our best to accommodate your preference.
              </p>
              <MiniCalendar
                selectedDate={preferredDate}
                onSelect={(d) => {
                  setPreferredDate(d);
                  setPreferredTime(null);
                }}
              />
            </Card>

            {preferredDate && (
              <Card className="mt-4">
                <CardTitle>Preferred time · optional</CardTitle>
                <p className="mb-4 text-xs text-[var(--muted)]">
                  {new Date(preferredDate + 'T00:00:00').toLocaleDateString('en-IN', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </p>
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
              </Card>
            )}

            <div className="mt-4 space-y-3">
              {/* Summary pill */}
              <div className="rounded-[10px] border border-[var(--border)] bg-white px-4 py-3 text-sm">
                <p className="font-medium text-[var(--ink)]">{name}</p>
                <p className="text-[var(--muted)]">+91 {phone}</p>
                {preferredDate && (
                  <p className="mt-1 text-xs text-[var(--teal)]">
                    📅{' '}
                    {new Date(preferredDate + 'T00:00:00').toLocaleDateString('en-IN', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                    {preferredTime && ` · ${preferredTime}`}
                  </p>
                )}
              </div>

              {submitError && <p className="text-sm text-[var(--rust)]">{submitError}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-[10px] bg-[var(--teal)] py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? 'Sending…' : 'Submit request'}
              </button>

              <p className="text-center text-xs text-[var(--muted)]">
                {clinicName} will confirm your appointment by phone or email.
              </p>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

// ─── Small reusable primitives ────────────────────────────────────────────────

const inputCls =
  'w-full rounded-[10px] border border-[var(--border)] bg-white p-3 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:outline-none transition-colors';

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[14px] border border-[var(--border)] bg-white p-5 shadow-sm ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-base font-semibold text-[var(--ink)]">{children}</h2>;
}

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
