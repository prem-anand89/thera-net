import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { hasSupabaseConfig } from '@/lib/env';
import { bookingService } from '@/services';
import type { UUID, WorkingHours } from '@/domain/types';
import { publicLogoUrl } from '@/lib/supabase';
import { addDays, generateScheduleSlots, isPublicSlotTaken, toLocalDateStr } from '@/domain/schedule';
import { PoweredBy } from '@/components/BrandMark';

type AvailabilityData = {
  closedWeekdays: number[];
  closedDates: { date: string; label: string }[];
  appointments: { scheduled_at: string; therapist_id: UUID; duration_minutes?: number }[];
  /** Therapists with custom working hours (others use the clinic's). */
  therapistHours?: Record<string, WorkingHours>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  return toLocalDateStr(d);
}

// ─── Mini Calendar ────────────────────────────────────────────────────────────

/** Availability is fetched for this many days ahead; later dates can't be
 *  checked for closures, so they aren't offered. */
const BOOKING_WINDOW_DAYS = 90;

function getDayStatus(d: Date, today: Date, availability: AvailabilityData | null) {
  const iso = isoDate(d);
  const isPast = iso < isoDate(today);
  if (isPast) return 'past';
  if (iso > addDays(isoDate(today), BOOKING_WINDOW_DAYS)) return 'far';

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
          } else if (status === 'far') {
            btnCls += "text-[var(--muted)] opacity-30 cursor-not-allowed";
            title = "Not open for booking yet";
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
              disabled={status !== 'available'}
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
  slots,
  selectedTime,
  onSelect,
}: {
  label: string;
  slots: { label: string; open: boolean }[];
  selectedTime: string | null;
  onSelect: (t: string) => void;
}) {
  if (slots.length === 0) return null;
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 text-xs font-medium text-[var(--muted)]">{label}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.map(({ label: t, open }) => {
          const sel = t === selectedTime;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={sel}
              disabled={!open}
              aria-label={open ? t : `${t}, unavailable`}
              onClick={() => onSelect(t)}
              className={`min-h-11 rounded-xl border text-sm font-medium transition-colors ${
                sel
                  ? 'border-[var(--teal)] bg-[var(--teal)] text-white shadow-sm'
                  : open
                    ? 'border-[var(--border)] bg-white text-[var(--ink)] hover:border-[var(--teal)] hover:text-[var(--teal)]'
                    : 'cursor-not-allowed border-transparent bg-[var(--paper)] text-[var(--muted)]/70 line-through'
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

const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳', name: 'India' },
  { code: '+1', flag: '🇺🇸', name: 'US / Canada' },
  { code: '+44', flag: '🇬🇧', name: 'UK' },
  { code: '+61', flag: '🇦🇺', name: 'Australia' },
  { code: '+971', flag: '🇦🇪', name: 'UAE' },
  { code: '', flag: '🌍', name: 'Other (type full number)' },
];

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
          // Availability only refines the picker; if it fails the form still works.
          bookingService
            .getBookingAvailability(clinicSlug, isoDate(new Date()), addDays(isoDate(new Date()), BOOKING_WINDOW_DAYS))
            .catch(() => null),
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
      setSubmitError('Please add your name and phone number.');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await bookingService.submitAppointmentRequest(
        clinicSlug,
        name.trim(),
        [countryCode, phone.trim()].filter(Boolean).join(' '),
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
  const allSlots = generateScheduleSlots(slotDuration, startHour, endHour);
  const booked = (availability?.appointments ?? []).map((a) => ({
    scheduledAt: a.scheduled_at,
    therapistId: a.therapist_id,
    durationMinutes: a.duration_minutes,
  }));
  const nowTime = new Date();
  const todayIso = isoDate(nowTime);
  const openSlotsOn = (date: string) =>
    allSlots.filter((slot) => {
      if (date === todayIso && slot.minutes <= nowTime.getHours() * 60 + nowTime.getMinutes()) return false;
      return !isPublicSlotTaken(date, slot.minutes, slotDuration, booked, therapists.map((t) => t.id), preferredTherapistId || null, availability?.therapistHours ?? {}, { startHour, endHour });
    });
  const openSlots = preferredDate ? openSlotsOn(preferredDate) : [];
  const openLabels = new Set(openSlots.map((slot) => slot.label));
  // Every time still ahead on the chosen day; booked / off-hours ones are shown greyed.
  const daySlots = preferredDate
    ? allSlots
        .filter((slot) => !(preferredDate === todayIso && slot.minutes <= nowTime.getHours() * 60 + nowTime.getMinutes()))
        .map((slot) => ({ ...slot, open: openLabels.has(slot.label) }))
    : [];
  const groups = [
    { label: 'Morning', slots: daySlots.filter((slot) => slot.minutes < 12 * 60) },
    { label: 'Afternoon', slots: daySlots.filter((slot) => slot.minutes >= 12 * 60 && slot.minutes < 17 * 60) },
    { label: 'Evening', slots: daySlots.filter((slot) => slot.minutes >= 17 * 60) },
  ];
  const todayDate = new Date(`${todayIso}T00:00:00`);
  const dayOpen = (date: string) => getDayStatus(new Date(`${date}T00:00:00`), todayDate, availability) === 'available';
  // When the chosen day is full, offer the next day that still has a time.
  const nextOpenDay =
    preferredDate && openSlots.length === 0
      ? Array.from({ length: 30 }, (_, index) => addDays(preferredDate, index + 1)).find(
          (date) => dayOpen(date) && openSlotsOn(date).length > 0
        ) ?? null
      : null;
  const pickDate = (date: string) => {
    setPreferredDate(date);
    setPreferredTime(null);
    setCalendarOpen(false);
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  const stripDates = Array.from({ length: 14 }, (_, index) => addDays(todayIso, index));
  const therapistName = therapists.find((t) => t.id === preferredTherapistId)?.name;
  const summary = preferredDate
    ? `${new Date(`${preferredDate}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}${preferredTime ? ` · ${preferredTime}` : ' · any time'}`
    : 'No date picked — the clinic will suggest one';
  const hoursLabel = `${generateScheduleSlots(60, startHour, startHour + 1)[0]?.label.replace(':00', '') ?? ''}–${generateScheduleSlots(60, endHour, endHour + 1)[0]?.label.replace(':00', '') ?? ''}`;

  return (
    <div className="min-h-dvh bg-[linear-gradient(160deg,#e8f4f4_0%,#f3f5f7_45%,#eef1f5_100%)]">
      <main className="mx-auto max-w-lg px-3 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6 sm:px-4 sm:pt-10">
        <form onSubmit={onSubmit} noValidate className="overflow-hidden rounded-3xl border border-[var(--border)] bg-white shadow-lg">
          {/* Clinic header */}
          <header className="flex items-center gap-3.5 border-b border-[var(--border)] px-5 py-5 sm:px-6">
            {clinicLogo ? (
              <img src={clinicLogo} alt="" className="h-12 w-12 shrink-0 rounded-2xl border border-[var(--border)] object-cover" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--teal-light)] text-lg font-semibold text-[var(--teal)]" aria-hidden>
                {(clinicName ?? '?').trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight text-[var(--ink)]">{clinicName}</h1>
              <p className="mt-0.5 text-sm text-[var(--muted)]">Book an appointment</p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-[var(--muted)]">
                <span>⏱ {slotDuration} min visits</span>
                <span>🕘 {hoursLabel}</span>
              </p>
            </div>
          </header>

          {/* 1 — When */}
          <section className="space-y-4 px-5 py-5 sm:px-6" aria-labelledby="when-heading">
            {therapists.length > 0 && (
              <div>
                <SectionTitle id="clinician-heading" step={1} title="Clinician" hint="optional" />
                <p className="mb-2 mt-1 text-sm text-[var(--muted)]">Pick someone to see only their free times.</p>
                <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6" role="radiogroup" aria-label="Clinician">
                  {[{ id: '', name: 'Anyone available' }, ...therapists].map((t) => {
                    const on = preferredTherapistId === t.id;
                    return (
                      <button
                        key={t.id || 'any'}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          setPreferredTherapistId(t.id);
                          setPreferredTime(null);
                        }}
                        className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors ${
                          on ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : 'border-[var(--border)] bg-white text-[var(--ink)] hover:border-[var(--teal)]'
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <SectionTitle id="when-heading" step={therapists.length > 0 ? 2 : 1} title="Day & time" hint="optional" />
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-medium text-[var(--ink)]">Day</p>
                <div className="flex items-center gap-3 text-sm">
                  {preferredDate && (
                    <button type="button" className="text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => { setPreferredDate(null); setPreferredTime(null); }}>
                      Clear
                    </button>
                  )}
                  <button type="button" aria-expanded={calendarOpen} className="font-medium text-[var(--teal)]" onClick={() => setCalendarOpen((open) => !open)}>
                    {calendarOpen ? 'Hide calendar' : 'More dates'}
                  </button>
                </div>
              </div>
              {calendarOpen ? (
                <div className="rounded-2xl border border-[var(--border)] p-3">
                  <MiniCalendar selectedDate={preferredDate} availability={availability} onSelect={pickDate} />
                </div>
              ) : (
                <div className="-mx-5 flex snap-x scroll-px-5 gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6" role="group" aria-label="Choose a day">
                  {stripDates.map((date, index) => {
                    const value = new Date(`${date}T00:00:00`);
                    const open = dayOpen(date);
                    const selected = preferredDate === date;
                    return (
                      <button
                        key={date}
                        type="button"
                        disabled={!open}
                        aria-pressed={selected}
                        aria-label={`${value.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}${open ? '' : ', closed'}`}
                        onClick={() => pickDate(date)}
                        className={`flex h-[72px] w-[60px] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border text-center transition-colors ${
                          selected
                            ? 'border-[var(--teal)] bg-[var(--teal)] text-white'
                            : open
                              ? 'border-[var(--border)] bg-white text-[var(--ink)] hover:border-[var(--teal)]'
                              : 'border-transparent bg-[var(--paper)] text-[var(--muted)]'
                        }`}
                      >
                        <span className={`text-[11px] font-medium uppercase ${selected ? 'text-white/80' : 'text-[var(--muted)]'}`}>
                          {index === 0 ? 'Today' : value.toLocaleDateString('en-IN', { weekday: 'short' })}
                        </span>
                        <span className="text-lg font-semibold leading-tight">{value.getDate()}</span>
                        <span className={`text-[10px] ${selected ? 'text-white/80' : 'text-[var(--muted)]'}`}>
                          {open ? value.toLocaleDateString('en-IN', { month: 'short' }) : 'Closed'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {preferredDate && !stripDates.includes(preferredDate) && !calendarOpen && (
                <p className="mt-2 text-sm text-[var(--ink)]">
                  {new Date(`${preferredDate}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
              )}
            </div>

            {preferredDate && (
              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    Available times{therapistName ? ` with ${therapistName}` : ''}
                  </p>
                  {daySlots.some((slot) => !slot.open) && (
                    <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                      <span className="inline-block h-3 w-5 rounded border border-[var(--border)] bg-[var(--paper)]" aria-hidden /> greyed = booked or unavailable
                    </p>
                  )}
                </div>
                {openSlots.length === 0 ? (
                  <div className="rounded-2xl bg-[var(--paper)] p-4 text-center text-sm text-[var(--muted)]">
                    <p>No times left {therapistName ? `with ${therapistName} ` : ''}on this day.</p>
                    {nextOpenDay && (
                      <button type="button" onClick={() => pickDate(nextOpenDay)} className="mt-2 min-h-10 rounded-full border border-[var(--teal)] bg-white px-4 text-sm font-medium text-[var(--teal)]">
                        Try {new Date(`${nextOpenDay}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} →
                      </button>
                    )}
                  </div>
                ) : (
                  groups.map((group) => (
                    <TimeGroup
                      key={group.label}
                      label={group.label}
                      slots={group.slots.map((slot) => ({ label: slot.label, open: slot.open }))}
                      selectedTime={preferredTime}
                      onSelect={(time) => setPreferredTime(time === preferredTime ? null : time)}
                    />
                  ))
                )}
              </div>
            )}
          </section>

          {/* 2 — Details */}
          <section className="space-y-4 border-t border-[var(--border)] px-5 py-5 sm:px-6" aria-labelledby="details-heading">
            <SectionTitle id="details-heading" step={therapists.length > 0 ? 3 : 2} title="Your details" />
            <Field label="Full name">
              <input type="text" autoComplete="name" placeholder="Your name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <Field label="Phone (WhatsApp)">
              <div className="flex h-12 rounded-xl border border-[var(--border)] bg-white focus-within:border-[var(--teal)] focus-within:ring-2 focus-within:ring-[var(--teal)]/20">
                {/* The visible label sizes the box to its content; the native
                    select sits on top, invisible, so the phone's own picker opens. */}
                <div className="relative flex shrink-0 items-center gap-1 rounded-l-xl border-r border-[var(--border)] bg-[var(--paper)] px-3 text-sm font-medium text-[var(--ink)]">
                  <span aria-hidden>{COUNTRY_CODES.find((c) => c.code === countryCode)?.flag ?? '🌍'}</span>
                  <span aria-hidden>{countryCode || '+'}</span>
                  <span aria-hidden className="text-[10px] text-[var(--muted)]">▾</span>
                  <select aria-label="Country code" className="absolute inset-0 cursor-pointer opacity-0" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.name} {c.code}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  aria-label="Phone number"
                  placeholder={countryCode === '+91' ? '98765 43210' : countryCode ? 'Phone number' : 'Full number with country code'}
                  className="min-w-0 flex-1 rounded-r-xl bg-transparent px-3 text-base text-[var(--ink)] placeholder:text-[var(--muted)]/70 focus:outline-none sm:text-sm"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </Field>

            <Field label="Email" optional>
              <input type="email" autoComplete="email" placeholder="you@example.com" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>

            <Field label="Reason for visit" optional>
              <textarea rows={3} placeholder="Briefly describe what's bothering you" className={`${inputCls} h-auto py-3`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </section>

          {/* Summary + submit — pinned on phones, clear of the home indicator */}
          <div className="sticky bottom-0 border-t border-[var(--border)] bg-white/95 px-5 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:px-6 sm:pb-5">
            {submitError && <p className="mb-2 text-sm font-medium text-[var(--rust)]">{submitError}</p>}
            <p className="mb-2 flex items-center justify-between gap-3 text-sm" aria-live="polite">
              <span className="truncate text-[var(--ink)]">{summary}</span>
              <span className="shrink-0 truncate text-[var(--muted)]">{therapistName ?? 'Anyone available'}</span>
            </p>
            <button
              type="submit"
              disabled={busy}
              className="min-h-12 w-full rounded-full bg-[var(--teal)] text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Request appointment'}
            </button>
            <p className="mt-2 text-center text-xs text-[var(--muted)]">{clinicName} will confirm by phone or WhatsApp.</p>
          </div>
        </form>
        <PoweredBy />
      </main>
    </div>
  );
}


// ─── Small reusable primitives ────────────────────────────────────────────────

const inputCls =
  'h-12 w-full rounded-xl border border-[var(--border)] bg-white px-3.5 text-base text-[var(--ink)] placeholder:text-[var(--muted)]/70 focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20 transition-colors sm:text-sm';

function Field({ label, optional = false, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-sm font-medium text-[var(--ink)]">
        {label}
        {optional && <span className="text-xs font-normal text-[var(--muted)]">optional</span>}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({ id, step, title, hint }: { id: string; step: number; title: string; hint?: string }) {
  return (
    <h2 id={id} className="flex items-center gap-2.5 text-base font-semibold text-[var(--ink)]">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--teal-light)] text-xs font-semibold text-[var(--teal)]" aria-hidden>
        {step}
      </span>
      {title}
      {hint && <span className="text-xs font-normal text-[var(--muted)]">{hint}</span>}
    </h2>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="flex min-h-[80vh] items-center justify-center px-6 text-center">
        {children}
      </div>
      <PoweredBy />
    </>
  );
}
