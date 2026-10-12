import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { hasSupabaseConfig } from '@/lib/env';
import { bookingService } from '@/services';
import type { UUID, WorkingHours } from '@/domain/types';
import { publicLogoUrl } from '@/lib/supabase';
import { addDays, generateScheduleSlots, isPublicSlotTaken, toLocalDateStr, workingIntervals } from '@/domain/schedule';
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

function getDayStatus(
  d: Date,
  today: Date,
  availability: AvailabilityData | null,
  preferredTherapistId: string,
  clinicHours: { startHour: number; endHour: number }
) {
  const iso = isoDate(d);
  const isPast = iso < isoDate(today);
  if (isPast) return 'past';
  if (iso > addDays(isoDate(today), BOOKING_WINDOW_DAYS)) return 'far';

  if (!availability) return 'available'; // Default while loading

  if (availability.closedWeekdays.includes(d.getDay())) return 'closed';

  const closedDate = availability.closedDates.find((cd) => cd.date === iso);
  if (closedDate) return 'holiday';

  // A preferred clinician's own day off — distinct from the clinic being closed.
  if (preferredTherapistId) {
    const hours = availability.therapistHours?.[preferredTherapistId];
    if (hours && workingIntervals(hours, iso, clinicHours).length === 0) return 'therapistOff';
  } else if (availability.therapistHours && Object.keys(availability.therapistHours).length > 0) {
    // If no preference and all active therapists with schedules are off on this day
    const allOff = Object.values(availability.therapistHours).every(
      (hours) => workingIntervals(hours, iso, clinicHours).length === 0
    );
    if (allOff) return 'therapistOff';
  }

  // For fully booked days, we'll let the user click it and see empty slots.
  return 'available';
}

function MiniCalendar({
  selectedDate,
  onSelect,
  availability,
  preferredTherapistId,
  clinicHours,
}: {
  selectedDate: string | null;
  onSelect: (date: string) => void;
  availability: AvailabilityData | null;
  preferredTherapistId: string;
  clinicHours: { startHour: number; endHour: number };
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
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
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
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={prevMonth}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-[var(--ink)] hover:bg-slate-100 transition-colors"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="font-display text-base font-bold text-[var(--ink)]">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-[var(--ink)] hover:bg-slate-100 transition-colors"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-2 gap-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
          <div key={i} className="text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {d}
          </div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="h-9 w-full" />;

          const cellDate = new Date(viewYear, viewMonth, day);
          const iso = isoDate(cellDate);
          const status = getDayStatus(cellDate, today, availability, preferredTherapistId, clinicHours);
          const isSelected = iso === selectedDate;
          const isToday = iso === isoDate(today);

          let btnCls = 'h-9 w-full rounded-lg font-semibold text-sm flex items-center justify-center transition-colors ';
          let title = '';

          if (isSelected) {
            btnCls += 'border border-[var(--teal)]/65 bg-[var(--teal-light)] text-[var(--teal-strong)] font-bold shadow-xs';
          } else if (isToday && status === 'available') {
            btnCls += 'border border-slate-400 bg-white font-bold text-[var(--teal-strong)] shadow-2xs hover:bg-slate-50';
            title = 'Today (Available)';
          } else if (status === 'past') {
            btnCls += 'text-slate-300 opacity-40 cursor-not-allowed';
          } else if (status === 'far') {
            btnCls += 'text-slate-300 opacity-40 cursor-not-allowed';
            title = 'Not open for booking yet';
          } else if (status === 'closed') {
            btnCls += 'bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed';
            title = 'Closed';
          } else if (status === 'holiday') {
            btnCls += 'bg-orange-50/60 text-orange-800/80 cursor-not-allowed border border-orange-100';
            title = 'Holiday / Clinic Closure';
          } else if (status === 'therapistOff') {
            btnCls += 'bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed';
            title = 'Not available with this clinician — other clinicians may still have time';
          } else {
            btnCls += 'hover:bg-slate-100 text-[var(--ink)]';
            title = 'Available';
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
  const openCount = slots.filter((s) => s.open).length;

  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          {label}
        </p>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
          {openCount} {openCount === 1 ? 'slot' : 'slots'} open
        </span>
      </div>
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
              className={`min-h-11 rounded-xl text-sm font-semibold transition-colors duration-75 ${
                sel
                  ? 'border border-[var(--teal)]/65 bg-[var(--teal-light)] text-[var(--teal-strong)] font-bold shadow-xs'
                  : open
                    ? 'border border-slate-200 bg-white text-[var(--ink)] hover:border-slate-300 hover:bg-slate-50'
                    : 'cursor-not-allowed border border-slate-100 bg-slate-50 text-slate-400/60 line-through text-xs font-normal'
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
 * Snappy, lightweight, and supports both specific date/time and flexible scheduling.
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

  // Form fields – date & time selection mode: 'specific' | 'flexible'
  const [scheduleMode, setScheduleMode] = useState<'specific' | 'flexible'>('specific');
  const [flexibleTimeOfDay, setFlexibleTimeOfDay] = useState<'any' | 'morning' | 'afternoon' | 'evening'>('any');
  const [preferredDate, setPreferredDate] = useState<string | null>(null);
  const [preferredTime, setPreferredTime] = useState<string | null>(null);

  // Submit state
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [joinedWaitlist, setJoinedWaitlist] = useState(false);

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

  // Memoized slots generation
  const allSlots = useMemo(
    () => generateScheduleSlots(slotDuration, startHour, endHour),
    [slotDuration, startHour, endHour]
  );

  const booked = useMemo(
    () =>
      (availability?.appointments ?? []).map((a) => ({
        scheduledAt: a.scheduled_at,
        therapistId: a.therapist_id,
        durationMinutes: a.duration_minutes,
      })),
    [availability?.appointments]
  );

  const therapistIds = useMemo(() => therapists.map((t) => t.id), [therapists]);

  const nowTime = new Date();
  const todayIso = isoDate(nowTime);
  const currentMinuteOfDay = nowTime.getHours() * 60 + nowTime.getMinutes() + 15;
  const clinicHours = useMemo(() => ({ startHour, endHour }), [startHour, endHour]);

  // Memoized slot calculation for preferredDate
  const openSlots = useMemo(() => {
    if (!preferredDate) return [];
    return allSlots.filter((slot) => {
      if (preferredDate === todayIso && slot.minutes <= currentMinuteOfDay) return false;
      return !isPublicSlotTaken(
        preferredDate,
        slot.minutes,
        slotDuration,
        booked,
        therapistIds,
        preferredTherapistId || null,
        availability?.therapistHours ?? {},
        clinicHours
      );
    });
  }, [preferredDate, allSlots, todayIso, currentMinuteOfDay, slotDuration, booked, therapistIds, preferredTherapistId, availability?.therapistHours, clinicHours]);

  const dayFull = preferredDate !== null && openSlots.length === 0;

  const daySlots = useMemo(() => {
    if (!preferredDate) return [];
    const openLabels = new Set(openSlots.map((slot) => slot.label));
    return allSlots
      .filter((slot) => !(preferredDate === todayIso && slot.minutes <= currentMinuteOfDay))
      .map((slot) => ({ ...slot, open: openLabels.has(slot.label) }));
  }, [preferredDate, allSlots, openSlots, todayIso, currentMinuteOfDay]);

  const groups = useMemo(
    () => [
      { label: 'Morning', slots: daySlots.filter((slot) => slot.minutes < 12 * 60) },
      { label: 'Afternoon', slots: daySlots.filter((slot) => slot.minutes >= 12 * 60 && slot.minutes < 17 * 60) },
      { label: 'Evening', slots: daySlots.filter((slot) => slot.minutes >= 17 * 60) },
    ],
    [daySlots]
  );

  const todayDate = useMemo(() => new Date(`${todayIso}T00:00:00`), [todayIso]);

  const dayStatusOf = (date: string) =>
    getDayStatus(new Date(`${date}T00:00:00`), todayDate, availability, preferredTherapistId, clinicHours);

  const nextOpenDay = useMemo(() => {
    if (!preferredDate || openSlots.length > 0) return null;
    return (
      Array.from({ length: 30 }, (_, index) => addDays(preferredDate, index + 1)).find((date) => {
        const isAvailableDay =
          getDayStatus(new Date(`${date}T00:00:00`), todayDate, availability, preferredTherapistId, clinicHours) ===
          'available';
        if (!isAvailableDay) return false;
        return allSlots.some(
          (slot) =>
            !isPublicSlotTaken(
              date,
              slot.minutes,
              slotDuration,
              booked,
              therapistIds,
              preferredTherapistId || null,
              availability?.therapistHours ?? {},
              clinicHours
            )
        );
      }) ?? null
    );
  }, [preferredDate, openSlots.length, todayDate, availability, preferredTherapistId, clinicHours, allSlots, slotDuration, booked, therapistIds]);

  const pickDate = (date: string) => {
    setPreferredDate(date);
    setPreferredTime(null);
    setCalendarOpen(false);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setSubmitError('Please add your name and phone number.');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const isFlexible = scheduleMode === 'flexible';
      await bookingService.submitAppointmentRequest(
        clinicSlug,
        name.trim(),
        [countryCode, phone.trim()].filter(Boolean).join(' '),
        email.trim() || null,
        preferredTherapistId || null,
        notes.trim() || null,
        isFlexible ? null : (preferredDate || null),
        isFlexible ? null : (preferredTime || null),
        isFlexible ? flexibleTimeOfDay : (dayFull ? 'any' : null),
        isFlexible ? false : dayFull
      );
      setJoinedWaitlist(isFlexible ? false : dayFull);
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
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-[var(--teal)]" />
          <p className="text-sm font-medium text-[var(--muted)]">Loading clinic availability…</p>
        </div>
      </Centered>
    );
  }

  if (invalid) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3 max-w-sm text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">🔒</div>
          <h2 className="font-display text-lg font-bold text-[var(--ink)]">Booking Page Unavailable</h2>
          <p className="text-sm text-[var(--muted)]">
            This booking link is not active or has been disabled. Please contact the clinic directly.
          </p>
        </div>
      </Centered>
    );
  }

  const therapistName = therapists.find((t) => t.id === preferredTherapistId)?.name;

  const summary =
    scheduleMode === 'flexible'
      ? `Flexible date · ${
          flexibleTimeOfDay === 'morning'
            ? 'Mornings preferred'
            : flexibleTimeOfDay === 'afternoon'
              ? 'Afternoons preferred'
              : flexibleTimeOfDay === 'evening'
                ? 'Evenings preferred'
                : 'Any time works'
        }`
      : preferredDate
        ? `${new Date(`${preferredDate}T00:00:00`).toLocaleDateString('en-IN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          })}${preferredTime ? ` · ${preferredTime}` : ' · any time'}`
        : 'No date picked — clinic will suggest one';

  if (done) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--teal-mist)] text-[var(--teal-strong)] border border-[var(--teal)]/30 text-3xl">
            ✓
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-[var(--ink)]">
              {joinedWaitlist ? "You're on the waitlist!" : 'Appointment requested!'}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">
              {joinedWaitlist
                ? `Thanks! Your chosen day is currently full, but ${clinicName} has added you to the waitlist and will reach out if a slot opens up.`
                : scheduleMode === 'flexible'
                  ? `Thank you! Since you're flexible with dates and times, ${clinicName} will check the earliest openings and contact you on WhatsApp or phone to confirm.`
                  : `Thank you! Your request has been sent to ${clinicName}. The front desk will verify the slot and confirm via WhatsApp or phone.`}
            </p>
          </div>
          <div className="mt-2 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Requested Details</p>
            <p className="mt-1 text-sm font-bold text-[var(--ink)]">{summary}</p>
            <p className="text-xs text-slate-500 mt-1">
              Clinician:{' '}
              <span className="font-semibold text-[var(--ink)]">
                {therapistName ?? 'First available'}
              </span>
            </p>
          </div>
        </div>
      </Centered>
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const stripDates = Array.from({ length: 14 }, (_, index) => addDays(todayIso, index));
  const hoursLabel = `${generateScheduleSlots(60, startHour, startHour + 1)[0]?.label.replace(':00', '') ?? ''}–${generateScheduleSlots(60, endHour, endHour + 1)[0]?.label.replace(':00', '') ?? ''}`;

  return (
    <div className="min-h-dvh bg-slate-50 text-[var(--ink)] antialiased">
      <main className="relative mx-auto max-w-lg px-3 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8 sm:px-4 sm:pt-10">
        <form
          onSubmit={onSubmit}
          noValidate
          className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md"
        >
          {/* Clinic header */}
          <header className="flex items-center gap-4 border-b border-slate-100 bg-white px-5 py-5 sm:px-6">
            {clinicLogo ? (
              <img
                src={clinicLogo}
                alt=""
                className="h-12 w-12 shrink-0 rounded-2xl border border-slate-200 object-cover shadow-xs"
              />
            ) : (
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--teal-mist)] text-xl font-bold text-[var(--teal-strong)] border border-[var(--teal)]/30 shadow-xs"
                aria-hidden
              >
                {(clinicName ?? '?').trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-bold leading-tight text-[var(--ink)] sm:text-xl">
                {clinicName}
              </h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>Online Booking Request</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                  ⏱ {slotDuration} min visits
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                  🕘 {hoursLabel}
                </span>
              </div>
            </div>
          </header>

          {/* 1 — Clinician & When */}
          <section className="space-y-5 px-5 py-5 sm:px-6" aria-labelledby="when-heading">
            {therapists.length > 0 && (
              <div>
                <SectionTitle id="clinician-heading" step={1} title="Clinician" hint="optional" />
                <p className="mb-2.5 mt-1 text-xs text-[var(--muted)]">
                  Pick a specific clinician or select First available for the earliest visit.
                </p>
                <div
                  className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6"
                  role="radiogroup"
                  aria-label="Clinician"
                >
                  {[{ id: '', name: 'First available' }, ...therapists].map((t) => {
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
                        className={`min-h-11 shrink-0 inline-flex items-center rounded-full px-4 text-sm font-semibold transition-colors duration-75 ${
                          on
                            ? 'border border-[var(--teal)]/65 bg-[var(--teal-light)] text-[var(--teal-strong)] shadow-xs'
                            : 'border border-slate-200 bg-white text-[var(--ink)] hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <SectionTitle
                id="when-heading"
                step={therapists.length > 0 ? 2 : 1}
                title="Day & time"
                hint="optional"
              />

              {/* Mode Toggle: Specific day vs I'm flexible */}
              <div className="mt-3 flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200/70">
                <button
                  type="button"
                  onClick={() => setScheduleMode('specific')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors duration-75 text-center ${
                    scheduleMode === 'specific'
                      ? 'bg-white text-[var(--ink)] shadow-xs'
                      : 'text-slate-600 hover:text-[var(--ink)]'
                  }`}
                >
                  Specific day & time
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScheduleMode('flexible');
                    setPreferredDate(null);
                    setPreferredTime(null);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors duration-75 text-center ${
                    scheduleMode === 'flexible'
                      ? 'bg-white text-[var(--ink)] shadow-xs'
                      : 'text-slate-600 hover:text-[var(--ink)]'
                  }`}
                >
                  I'm flexible (Any day)
                </button>
              </div>

              {/* Flexible Mode Card */}
              {scheduleMode === 'flexible' ? (
                <div className="mt-3 rounded-2xl border border-[var(--teal)]/25 bg-[var(--teal-mist)]/80 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--teal-light)] text-[var(--teal-strong)] font-bold text-sm">
                      ✓
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">Fine with any day of the week</p>
                      <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                        The clinic will check upcoming openings and reach out to offer the soonest slot that fits your schedule.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3.5 pt-3 border-t border-[var(--teal)]/15">
                    <p className="text-xs font-semibold text-slate-700 mb-2">Preferred time of day (optional):</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { id: 'any', label: 'Any time' },
                        { id: 'morning', label: 'Mornings' },
                        { id: 'afternoon', label: 'Afternoons' },
                        { id: 'evening', label: 'Evenings' },
                      ].map((tod) => {
                        const active = flexibleTimeOfDay === tod.id;
                        return (
                          <button
                            key={tod.id}
                            type="button"
                            onClick={() => setFlexibleTimeOfDay(tod.id as 'any' | 'morning' | 'afternoon' | 'evening')}
                            className={`min-h-11 rounded-xl text-xs font-semibold transition-colors duration-75 ${
                              active
                                ? 'border border-[var(--teal)]/65 bg-[var(--teal-light)] text-[var(--teal-strong)] font-bold shadow-xs'
                                : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {tod.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                /* Specific Day & Time Mode */
                <div className="mt-3">
                  <div className="mb-2.5 flex items-baseline justify-between">
                    <p className="text-sm font-semibold text-[var(--ink)]">Day</p>
                    <div className="flex items-center gap-3 text-xs">
                      {preferredDate && (
                        <button
                          type="button"
                          className="font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                          onClick={() => {
                            setPreferredDate(null);
                            setPreferredTime(null);
                          }}
                        >
                          Clear date
                        </button>
                      )}
                      <button
                        type="button"
                        aria-expanded={calendarOpen}
                        className="inline-flex items-center gap-1 font-semibold text-[var(--teal)] hover:text-teal-700 transition-colors"
                        onClick={() => setCalendarOpen((open) => !open)}
                      >
                        <span>{calendarOpen ? '← 14-day strip' : 'Month calendar'}</span>
                      </button>
                    </div>
                  </div>

                  {calendarOpen ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs">
                      <MiniCalendar
                        selectedDate={preferredDate}
                        availability={availability}
                        onSelect={pickDate}
                        preferredTherapistId={preferredTherapistId}
                        clinicHours={clinicHours}
                      />
                    </div>
                  ) : (
                    <div
                      className="-mx-5 flex snap-x scroll-px-5 gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6"
                      role="group"
                      aria-label="Choose a day"
                    >
                      {stripDates.map((date, index) => {
                        const value = new Date(`${date}T00:00:00`);
                        const status = dayStatusOf(date);
                        const open = status === 'available';
                        const selected = preferredDate === date;
                        const isToday = index === 0;
                        const closedCaption = status === 'therapistOff' ? 'Off' : 'Closed';
                        const closedAriaSuffix =
                          status === 'therapistOff' ? ', not available with this clinician' : ', closed';

                        return (
                          <button
                            key={date}
                            type="button"
                            disabled={!open}
                            aria-pressed={selected}
                            title={
                              status === 'therapistOff'
                                ? 'Not available with this clinician — other clinicians may still have time'
                                : undefined
                            }
                            aria-label={`${value.toLocaleDateString('en-IN', {
                              weekday: 'long',
                              day: 'numeric',
                              month: 'long',
                            })}${open ? '' : closedAriaSuffix}`}
                            onClick={() => {
                              setScheduleMode('specific');
                              pickDate(date);
                            }}
                            className={`flex h-[74px] w-[64px] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border text-center transition-colors duration-75 ${
                              selected
                                ? 'border border-[var(--teal)]/65 bg-[var(--teal-light)] text-[var(--teal-strong)] shadow-xs'
                                : isToday && open
                                  ? 'border-slate-300 bg-white text-[var(--ink)] shadow-2xs hover:border-slate-400 hover:bg-slate-50'
                                  : open
                                    ? 'border-slate-200 bg-white text-[var(--ink)] hover:border-slate-300 hover:bg-slate-50'
                                    : 'border-transparent bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed'
                            }`}
                          >
                            {isToday ? (
                              <span
                                className={`text-[9px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 leading-none ${
                                  selected
                                    ? 'bg-white text-[var(--teal-strong)] font-bold shadow-2xs border border-[var(--teal)]/20'
                                    : 'border border-[var(--teal)]/25 bg-[var(--teal-mist)] text-[var(--teal-strong)] font-semibold'
                                }`}
                              >
                                Today
                              </span>
                            ) : (
                              <span
                                className={`text-[10px] font-semibold uppercase tracking-wider ${
                                  selected ? 'text-[var(--teal-strong)] font-bold' : 'text-[var(--muted)]'
                                }`}
                              >
                                {value.toLocaleDateString('en-IN', { weekday: 'short' })}
                              </span>
                            )}
                            <span className={`font-display text-xl font-bold leading-tight my-0.5 ${
                              selected ? 'text-[var(--teal-strong)]' : ''
                            }`}>
                              {value.getDate()}
                            </span>
                            <span
                              className={`text-[10px] font-medium ${
                                selected
                                  ? 'text-[var(--teal-strong)] font-semibold'
                                  : 'text-[var(--muted)]'
                              }`}
                            >
                              {open ? value.toLocaleDateString('en-IN', { month: 'short' }) : closedCaption}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {preferredDate && !stripDates.includes(preferredDate) && !calendarOpen && (
                    <p className="mt-2 text-xs font-semibold text-[var(--ink)]">
                      Selected date:{' '}
                      {new Date(`${preferredDate}T00:00:00`).toLocaleDateString('en-IN', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    </p>
                  )}

                  {preferredDate && (
                    <div className="pt-3">
                      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          Available times{therapistName ? ` with ${therapistName}` : ''}
                        </p>
                        {daySlots.some((slot) => !slot.open) && (
                          <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                            <span
                              className="inline-block h-2.5 w-4 rounded border border-slate-200 bg-slate-100"
                              aria-hidden
                            />{' '}
                            greyed = booked / off
                          </p>
                        )}
                      </div>

                      {openSlots.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center shadow-xs">
                          <p className="font-semibold text-[var(--ink)] text-sm">
                            No times left {therapistName ? `with ${therapistName} ` : ''}on this day
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)] leading-relaxed">
                            Fill in your details below to join the waitlist — we'll reach out if a slot opens up.
                          </p>
                          {nextOpenDay && (
                            <button
                              type="button"
                              onClick={() => pickDate(nextOpenDay)}
                              className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--teal)]/40 bg-white px-4 text-xs font-semibold text-[var(--teal-strong)] shadow-xs hover:bg-[var(--teal-mist)] transition-colors"
                            >
                              <span>
                                Try{' '}
                                {new Date(`${nextOpenDay}T00:00:00`).toLocaleDateString('en-IN', {
                                  weekday: 'short',
                                  day: 'numeric',
                                  month: 'short',
                                })}
                              </span>
                              <span>→</span>
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
                </div>
              )}
            </div>
          </section>

          {/* 2 — Details */}
          <section
            className="space-y-4 border-t border-slate-100 bg-slate-50/40 px-5 py-5 sm:px-6"
            aria-labelledby="details-heading"
          >
            <SectionTitle id="details-heading" step={therapists.length > 0 ? 3 : 2} title="Your details" />

            <Field label="Full name">
              <input
                type="text"
                autoComplete="name"
                placeholder="e.g. John Doe"
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="Phone (WhatsApp)">
              <div className="flex h-12 rounded-xl border border-slate-200 bg-white shadow-xs focus-within:border-[var(--teal)] focus-within:ring-2 focus-within:ring-[var(--teal)]/20">
                <div className="relative flex shrink-0 items-center gap-1.5 rounded-l-xl border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-[var(--ink)] hover:bg-slate-100 transition-colors">
                  <span aria-hidden>{COUNTRY_CODES.find((c) => c.code === countryCode)?.flag ?? '🌍'}</span>
                  <span aria-hidden className="text-xs font-semibold">
                    {countryCode || '+'}
                  </span>
                  <span aria-hidden className="text-[10px] text-slate-400">
                    ▾
                  </span>
                  <select
                    aria-label="Country code"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                  >
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
                  placeholder={countryCode === '+91' ? '98765 43210' : countryCode ? 'Phone number' : 'Full number'}
                  className="min-w-0 flex-1 rounded-r-xl bg-transparent px-3 text-base text-[var(--ink)] placeholder:text-slate-400 focus:outline-none sm:text-sm"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--teal-light)] text-[var(--teal-strong)] text-[9px] font-bold">
                  ✓
                </span>
                <span>We will confirm your booking details via WhatsApp or phone.</span>
              </p>
            </Field>

            <Field label="Email" optional>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field label="Reason for visit" optional>
              <textarea
                rows={3}
                placeholder="Briefly describe what's bothering you or what care you're seeking"
                className={`${inputCls} h-auto py-3 resize-none`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </section>

          {/* Summary + submit — pinned on phones */}
          <div className="sticky bottom-0 border-t border-slate-200 bg-white px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg sm:static sm:px-6 sm:pb-6">
            {submitError && (
              <div className="mb-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-[var(--rust)]">
                {submitError}
              </div>
            )}
            <div
              className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
              aria-live="polite"
            >
              <div className="min-w-0">
                <p className="font-semibold text-[var(--ink)] truncate">{summary}</p>
              </div>
              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {therapistName ?? 'First available'}
              </span>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-[var(--teal)] text-base font-semibold text-white shadow-sm transition-colors duration-75 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>Sending request…</span>
                </span>
              ) : dayFull && scheduleMode === 'specific' ? (
                'Join the waitlist'
              ) : (
                'Request appointment'
              )}
            </button>
            <p className="mt-2 text-center text-xs text-[var(--muted)]">
              No upfront payment required · {clinicName} will confirm shortly.
            </p>
          </div>
        </form>

        <div className="mt-4">
          <PoweredBy />
        </div>
      </main>
    </div>
  );
}

// ─── Small reusable primitives ────────────────────────────────────────────────

const inputCls =
  'h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-base text-[var(--ink)] placeholder:text-slate-400 focus:border-[var(--teal)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]/20 transition-colors duration-75 sm:text-sm shadow-xs';

function Field({ label, optional = false, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-sm font-semibold text-[var(--ink)]">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-[var(--muted)]">optional</span>}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({ id, step, title, hint }: { id: string; step: number; title: string; hint?: string }) {
  return (
    <h2
      id={id}
      className="flex items-center gap-2.5 font-display text-sm font-semibold tracking-tight text-[var(--ink)] sm:text-base"
    >
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--teal)]/30 bg-[var(--teal-light)] text-xs font-bold text-[var(--teal-strong)]"
        aria-hidden
      >
        {step}
      </span>
      <span>{title}</span>
      {hint && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {hint}
        </span>
      )}
    </h2>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 text-[var(--ink)] antialiased flex flex-col justify-between p-4 sm:p-8">
      <div className="relative flex min-h-[70vh] items-center justify-center">
        {children}
      </div>
      <div className="relative">
        <PoweredBy />
      </div>
    </div>
  );
}
