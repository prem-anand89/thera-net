import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService, dashboardService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { ErrorNote, Field, inputCls, btnPrimary } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import {
  addDays,
  appointmentMinutes,
  firstAvailableSlot,
  nextAppointmentFor,
  patientAttendance,
  lengthLabel,
  generateScheduleSlots,
  isClosedDay,
  isTherapistSlotOccupied,
  localDateTime,
  localDateTimeToIso,
  minutesLabel,
  minutesOfDay,
  toLocalDateStr,
  seriesDates,
  seriesProblem,
  WEEKDAY_NAMES,
  withinWorking,
  workingIntervals,
} from '@/domain/schedule';
import type { Appointment, UUID, Patient } from '@/domain/types';
import { AttendanceNote } from '@/components/schedule/AppointmentDetailsPanel';
import { therapistColor } from '@/components/schedule/scheduleColors';

export type BookedSlot = {
  kind: 'booked' | 'rescheduled';
  /** Set when a repeat booking created several sessions. */
  sessions?: number;
  appointmentId: UUID;
  scheduledAt: string;
  durationMinutes: number;
  patientName: string;
  patientPhone: string;
  therapistId: UUID;
};

type BookSlotSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  onBooked?: (result: BookedSlot) => void;
  appointments?: Appointment[];
  prefilledDate?: string;
  prefilledTime?: string;
  prefilledTherapistId?: UUID;
  prefilledPatientName?: string;
  prefilledPatientPhone?: string;
  /** An existing patient to book (e.g. from the Patients list). */
  prefilledPatientId?: UUID;
  requestId?: UUID;
  requestNotes?: string;
  requestPreferredTimeText?: string;
  /** Therapist logins book only for themselves. */
  lockTherapist?: boolean;
  /** Set to move an existing appointment instead of creating one. Patient and
   *  therapist are then fixed; only date, time and length change. */
  rescheduleAppointment?: Appointment;
};

const LENGTH_OPTIONS = [30, 45, 60, 90];

function displayDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function BookSlotSheet({
  isOpen,
  onClose,
  onBooked,
  appointments = [],
  prefilledDate,
  prefilledTime,
  prefilledTherapistId,
  prefilledPatientName,
  prefilledPatientPhone,
  prefilledPatientId,
  requestId,
  requestNotes,
  requestPreferredTimeText,
  lockTherapist = false,
  rescheduleAppointment,
}: BookSlotSheetProps) {
  const clinic = useClinic();
  const { myTherapistId } = useWorkspaceScope();
  const slotMinutes = clinic.slotDurationMinutes || 30;
  const startHour = clinic.bookingStartHour ?? 9;
  const endHour = clinic.bookingEndHour ?? 17;
  const today = toLocalDateStr(new Date());
  const isReschedule = Boolean(rescheduleAppointment);

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [lengthMinutes, setLengthMinutes] = useState(slotMinutes);
  const [therapistId, setTherapistId] = useState<UUID | ''>('');
  const [patientId, setPatientId] = useState<UUID | ''>('');
  const [patientMode, setPatientMode] = useState<'find' | 'new'>('find');
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [showLater, setShowLater] = useState(false);
  const [showOffHours, setShowOffHours] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatCount, setRepeatCount] = useState(6);
  const [repeatCountTouched, setRepeatCountTouched] = useState(false);
  const [rowOverrides, setRowOverrides] = useState<Record<string, { time?: string; skipped?: boolean }>>({});
  const [therapistTouched, setTherapistTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const closedDates = useLiveQuery(() => repos.clinicClosedDates.listByClinic(clinic.id), [clinic.id]);
  const openPackages = useLiveQuery(
    () => (isOpen && repeat && patientId ? dashboardService.openPackages(clinic.id) : undefined),
    [isOpen, repeat, patientId, clinic.id]
  );
  const packageLeft = useMemo(() => {
    const row = (openPackages ?? []).find((p) => p.patientId === patientId);
    return row ? Math.max(row.packageTotal - row.sessionsLogged, 0) : null;
  }, [openPackages, patientId]);
  useEffect(() => {
    if (repeat && !repeatCountTouched && packageLeft && packageLeft >= 2) setRepeatCount(Math.min(packageLeft, 52));
  }, [repeat, repeatCountTouched, packageLeft]);
  const patientOptions = useMemo(
    () =>
      [...(patients ?? [])]
        .sort((a: Patient, b: Patient) => a.name.localeCompare(b.name))
        .map((patient: Patient) => ({ value: patient.id, label: `${patient.name} (${patient.phone ?? 'no phone'})` })),
    [patients]
  );
  const slots = useMemo(() => generateScheduleSlots(slotMinutes, startHour, endHour), [slotMinutes, startHour, endHour]);
  const quickDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(today, index)), [today]);
  const lengthOptions = useMemo(
    () => [...new Set([...LENGTH_OPTIONS, slotMinutes, rescheduleAppointment ? appointmentMinutes(rescheduleAppointment, slotMinutes) : slotMinutes])].sort((a, b) => a - b),
    [slotMinutes, rescheduleAppointment]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (rescheduleAppointment) {
      const at = new Date(rescheduleAppointment.scheduledAt);
      const date = toLocalDateStr(at);
      setSelectedDate(date);
      setSelectedTime(null);
      setLengthMinutes(appointmentMinutes(rescheduleAppointment, slotMinutes));
      setTherapistId(rescheduleAppointment.therapistId ?? '');
      setTherapistTouched(true);
      setShowLater(date < today || date > addDays(today, 6));
    } else {
      const date = prefilledDate ?? today;
      setSelectedDate(date);
      setSelectedTime(prefilledTime ? prefilledTime.slice(0, 5) : null);
      setLengthMinutes(slotMinutes);
      setTherapistId(prefilledTherapistId ?? '');
      setTherapistTouched(Boolean(prefilledTherapistId));
      setShowLater(date < today || date > addDays(today, 6));
    }
    setPatientId(prefilledPatientId ?? '');
    setPatientName(prefilledPatientId ? '' : prefilledPatientName ?? '');
    setPatientPhone(prefilledPatientPhone ?? '');
    setPatientMode(prefilledPatientName && !prefilledPatientId ? 'new' : 'find');
    setShowOffHours(false);
    setRepeat(false);
    setRepeatDays([]);
    setRepeatCount(6);
    setRepeatCountTouched(false);
    setRowOverrides({});
    setBusy(false);
    setError(null);
  }, [isOpen, rescheduleAppointment, prefilledDate, prefilledPatientId, prefilledPatientName, prefilledPatientPhone, prefilledTherapistId, prefilledTime, today, slotMinutes]);

  // Solo clinics and therapist logins shouldn't have to pick themselves.
  useEffect(() => {
    if (!isOpen || therapistTouched || therapistId || !therapists) return;
    const fallback = myTherapistId && therapists.some((t) => t.id === myTherapistId)
      ? myTherapistId
      : therapists.length === 1 ? therapists[0].id : '';
    if (fallback) setTherapistId(fallback);
  }, [isOpen, therapistTouched, therapistId, therapists, myTherapistId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const closed = isClosedDay(selectedDate, clinic.closedWeekdays, closedDates ?? []);
  const isPast = (time: string) => localDateTime(selectedDate, time).getTime() < Date.now();
  const runsPastClose = (minutes: number) => minutes + lengthMinutes > endHour * 60;
  const occupied = (time: string) =>
    Boolean(therapistId) && isTherapistSlotOccupied(appointments, therapistId, selectedDate, time, lengthMinutes, {
      fallbackMinutes: slotMinutes,
      ignoreAppointmentId: rescheduleAppointment?.id,
    });
  const therapistRow = (therapists ?? []).find((t) => t.id === therapistId);
  const therapistName = therapistRow?.name;
  const workingNow = workingIntervals(therapistRow?.workingHours, selectedDate, { startHour, endHour });
  const workingSlots = slots.filter((slot) => withinWorking(workingNow, slot.minutes, lengthMinutes));
  const offSlots = slots.filter((slot) => !withinWorking(workingNow, slot.minutes, lengthMinutes));
  const renderSlot = (slot: (typeof slots)[number]) => {
    const unavailable = occupied(slot.time) || isPast(slot.time) || runsPastClose(slot.minutes);
    const selected = selectedTime === slot.time;
    return (
      <button
        key={slot.time}
        type="button"
        disabled={unavailable}
        aria-pressed={selected}
        onClick={() => setSelectedTime(slot.time)}
        className={`min-h-11 rounded-lg border px-1 text-xs font-medium tabular-nums ${selected ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : unavailable ? 'cursor-not-allowed border-transparent bg-[var(--paper)] text-[var(--muted)]/60' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--teal)] hover:bg-[var(--teal-light)]'}`}
      >
        {slot.label}
      </button>
    );
  };
  const therapistLocked = isReschedule || (lockTherapist && Boolean(therapistId));
  const now = new Date();
  const chosenPatient = patientId ? patients?.find((p) => p.id === patientId) : undefined;
  const who = rescheduleAppointment
    ? { patientId: rescheduleAppointment.patientId, phone: rescheduleAppointment.patientPhone }
    : patientMode === 'find'
      ? chosenPatient ? { patientId: chosenPatient.id, phone: chosenPatient.phone } : null
      : patientPhone.replace(/\D/g, '').length >= 10 ? { phone: patientPhone } : null;
  const attendance = who ? patientAttendance(appointments, who, now, { excludeId: rescheduleAppointment?.id }) : null;
  const alreadyBooked = who && !rescheduleAppointment ? nextAppointmentFor(appointments, who, now) : null;

  function pickFirstAvailable() {
    const candidates = therapistLocked || therapistId ? [therapistId].filter(Boolean) : (therapists ?? []).map((t) => t.id);
    const found = firstAvailableSlot({
      appointments,
      therapistIds: candidates as string[],
      fromDate: selectedDate < today ? today : selectedDate,
      days: 21,
      hours: { startHour, endHour },
      slotMinutes,
      lengthMinutes,
      now,
      isClosed: (date) => isClosedDay(date, clinic.closedWeekdays, closedDates ?? []).closed,
      ignoreAppointmentId: rescheduleAppointment?.id,
      workingFor: (id, date) =>
        workingIntervals((therapists ?? []).find((t) => t.id === id)?.workingHours, date, { startHour, endHour }),
    });
    if (!found) return setError('No free time in the next 3 weeks for this length.');
    setError(null);
    setSelectedDate(found.date);
    setShowLater(found.date > addDays(today, 6));
    setTherapistId(found.therapistId as UUID);
    setTherapistTouched(true);
    setSelectedTime(found.time);
  }

  const isClosedDate = (date: string) => isClosedDay(date, clinic.closedWeekdays, closedDates ?? []).closed;
  const workingOn = (date: string) => workingIntervals(therapistRow?.workingHours, date, { startHour, endHour });
  const plannedRows =
    repeat && selectedTime && therapistId
      ? seriesDates({ startDate: selectedDate, weekdays: repeatDays, count: repeatCount, isClosed: isClosedDate }).map((date) => {
          const override = rowOverrides[date] ?? {};
          const time = override.time ?? selectedTime;
          return {
            date,
            time,
            skipped: Boolean(override.skipped),
            problem: seriesProblem({ appointments, therapistId, date, time, lengthMinutes, slotMinutes, now, working: workingOn(date) }),
          };
        })
      : [];
  const activeRows = plannedRows.filter((row) => !row.skipped);
  const unresolved = activeRows.filter((row) => row.problem !== null).length;

  function findTimeFor(date: string) {
    const found = firstAvailableSlot({
      appointments,
      therapistIds: [therapistId],
      fromDate: date,
      days: 1,
      hours: { startHour, endHour },
      slotMinutes,
      lengthMinutes,
      now,
      isClosed: () => false,
      workingFor: (_id, day) => workingOn(day),
    });
    setRowOverrides((current) => ({ ...current, [date]: found ? { time: found.time } : { skipped: true } }));
  }

  async function submit() {
    if (!therapistId) return setError('Choose a therapist first.');
    if (!selectedTime) return setError('Choose an available time.');
    const scheduledAt = localDateTimeToIso(selectedDate, selectedTime);

    if (rescheduleAppointment) {
      setBusy(true);
      setError(null);
      try {
        await bookingService.rescheduleAppointment(rescheduleAppointment.id, scheduledAt, lengthMinutes);
        onBooked?.({
          kind: 'rescheduled',
          appointmentId: rescheduleAppointment.id,
          scheduledAt,
          durationMinutes: lengthMinutes,
          patientName: rescheduleAppointment.patientName,
          patientPhone: rescheduleAppointment.patientPhone,
          therapistId,
        });
        onClose();
      } catch (submitError) {
        setError(toFriendlyMessage(submitError));
      } finally {
        setBusy(false);
      }
      return;
    }

    const existing = patientId ? patients?.find((patient) => patient.id === patientId) : undefined;
    const finalName = patientMode === 'find' ? existing?.name ?? '' : patientName.trim();
    const finalPhone = patientMode === 'find' ? (existing?.phone || patientPhone).trim() : patientPhone.trim();
    if (patientMode === 'find' && !existing) return setError('Choose an existing patient, or switch to New patient.');
    if (!finalName) return setError('Enter the patient name.');
    if (!finalPhone) return setError('This patient has no phone on file — enter one so the booking can be confirmed.');

    if (repeat) {
      if (activeRows.length < 2) return setError('A repeat booking needs at least two sessions.');
      if (unresolved > 0) return setError('Some sessions clash — pick another time or skip them.');
      setBusy(true);
      setError(null);
      try {
        const starts = activeRows.map((row) => localDateTimeToIso(row.date, row.time));
        const seriesId = await bookingService.confirmBookingSeries({
          clinicId: clinic.id,
          patientId: patientMode === 'find' ? patientId || null : null,
          patientName: finalName,
          patientPhone: finalPhone,
          therapistId,
          starts,
          durationMinutes: lengthMinutes,
        });
        onBooked?.({
          kind: 'booked',
          appointmentId: seriesId,
          scheduledAt: starts[0],
          durationMinutes: lengthMinutes,
          patientName: finalName,
          patientPhone: finalPhone,
          therapistId,
          sessions: starts.length,
        });
        onClose();
      } catch (submitError) {
        setError(toFriendlyMessage(submitError));
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const appointmentId = await bookingService.confirmBookingSlot({
        clinicId: clinic.id,
        patientId: patientMode === 'find' ? patientId || null : null,
        patientName: finalName,
        patientPhone: finalPhone,
        therapistId,
        scheduledAt,
        requestId: requestId ?? null,
        durationMinutes: lengthMinutes,
      });
      onBooked?.({
        kind: 'booked',
        appointmentId,
        scheduledAt,
        durationMinutes: lengthMinutes,
        patientName: finalName,
        patientPhone: finalPhone,
        therapistId,
      });
      onClose();
    } catch (submitError) {
      setError(toFriendlyMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  const title = isReschedule ? 'Reschedule' : requestId ? 'Confirm request' : 'New booking';
  const submitLabel = isReschedule ? 'Move appointment' : repeat && activeRows.length > 1 ? `Book ${activeRows.length} sessions` : 'Confirm booking';
  const timeLabel = selectedTime ? minutesLabel(Number(selectedTime.slice(0, 2)) * 60 + Number(selectedTime.slice(3, 5))) : null;
  const summary = selectedTime
    ? `${displayDate(selectedDate)}, ${timeLabel} · ${lengthLabel(lengthMinutes)}${therapistName ? ` · ${therapistName}` : ''}`
    : null;
  const roster = [...(therapists ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const colorOf = (id: string) => therapistColor(Math.max(0, roster.findIndex((t) => t.id === id)));
  const dayParts = [
    { label: 'Morning', slots: workingSlots.filter((slot) => slot.minutes < 12 * 60) },
    { label: 'Afternoon', slots: workingSlots.filter((slot) => slot.minutes >= 12 * 60 && slot.minutes < 17 * 60) },
    { label: 'Evening', slots: workingSlots.filter((slot) => slot.minutes >= 17 * 60) },
  ].filter((part) => part.slots.length > 0);
  const chip = (on: boolean) =>
    `flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${
      on ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--teal)]/50'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-slot-title"
        className="flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-[var(--surface)] shadow-xl sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header — stays put while the body scrolls. */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 pb-3 pt-3 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <span aria-hidden className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[var(--border)] sm:hidden" />
            <h2 id="book-slot-title" className="font-display text-lg font-semibold text-[var(--ink)]">{title}</h2>
            {rescheduleAppointment && (
              <p className="truncate text-sm text-[var(--muted)]">
                <span className="font-display font-medium text-[var(--ink)]">{rescheduleAppointment.patientName}</span>, now{' '}
                {displayDate(toLocalDateStr(new Date(rescheduleAppointment.scheduledAt)))}, {minutesLabel(minutesOfDay(rescheduleAppointment.scheduledAt))}
              </p>
            )}
          </div>
          <button type="button" aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--paper)]" onClick={onClose} disabled={busy}>
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-6">
          {requestId && (requestNotes || requestPreferredTimeText) && (
            <div className="rounded-xl bg-[var(--amber-light)] px-3 py-2.5 text-sm text-[var(--ink)]">
              {requestPreferredTimeText && <p><span className="text-[var(--muted)]">Asked for</span> {requestPreferredTimeText}</p>}
              {requestNotes && <p className="mt-0.5"><span className="text-[var(--muted)]">Reason</span> {requestNotes}</p>}
            </div>
          )}

          {!isReschedule && (
            <section aria-labelledby="book-patient">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 id="book-patient" className={sectionTitle}>Patient</h3>
                <div className="flex rounded-lg bg-[var(--paper)] p-0.5" role="group" aria-label="Patient type">
                  {(['find', 'new'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={patientMode === mode}
                      onClick={() => setPatientMode(mode)}
                      className={`min-h-9 rounded-md px-3 text-xs font-medium ${patientMode === mode ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)]'}`}
                    >
                      {mode === 'find' ? 'Existing patient' : 'New patient'}
                    </button>
                  ))}
                </div>
              </div>
              {patientMode === 'find' ? (
                <div className="space-y-3">
                  <SearchableSelect label="" value={patientId} onChange={(value) => setPatientId(value as UUID)} options={patientOptions} placeholder="Search name or phone" />
                  {patientId && !patients?.find((p) => p.id === patientId)?.phone && (
                    <Field label="Phone (none on file)"><input type="tel" inputMode="tel" autoComplete="tel" className={inputCls} value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} /></Field>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Patient name"><input className={inputCls} autoComplete="name" value={patientName} onChange={(event) => setPatientName(event.target.value)} /></Field>
                  <Field label="Phone"><input type="tel" inputMode="tel" autoComplete="tel" className={inputCls} value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} /></Field>
                </div>
              )}
              {(attendance || alreadyBooked) && (
                <div className="mt-3 space-y-2">
                  <AttendanceNote attendance={attendance} />
                  {alreadyBooked && (
                    <p className="rounded-lg bg-[var(--teal-light)] px-3 py-2 text-xs text-[var(--ink)]">
                      Already booked: {displayDate(toLocalDateStr(new Date(alreadyBooked.scheduledAt)))}, {minutesLabel(minutesOfDay(alreadyBooked.scheduledAt))}.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
          {isReschedule && attendance && <AttendanceNote attendance={attendance} />}

          <section aria-labelledby="book-who">
            <h3 id="book-who" className={`${sectionTitle} mb-2`}>Therapist and length</h3>
            {therapistLocked ? (
              <p className="mb-3 flex items-center gap-2 text-sm text-[var(--ink)]">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: therapistId ? colorOf(therapistId) : 'var(--slate)' }} />
                {therapistName ?? 'Unassigned'}
              </p>
            ) : (
              <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="radiogroup" aria-label="Therapist">
                {roster.map((therapist) => (
                  <button
                    key={therapist.id}
                    type="button"
                    role="radio"
                    aria-checked={therapistId === therapist.id}
                    onClick={() => { setTherapistId(therapist.id); setTherapistTouched(true); setSelectedTime(null); }}
                    className={chip(therapistId === therapist.id)}
                  >
                    <span aria-hidden className="h-2.5 w-2.5 rounded-full ring-2 ring-white/70" style={{ background: colorOf(therapist.id) }} />
                    {therapist.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Length">
              {lengthOptions.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  role="radio"
                  aria-checked={lengthMinutes === minutes}
                  onClick={() => { setLengthMinutes(minutes); setSelectedTime(null); }}
                  className={`min-h-9 min-w-14 rounded-lg border px-2.5 text-xs font-medium ${
                    lengthMinutes === minutes ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  {lengthLabel(minutes)}
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="book-date">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="book-date" className={sectionTitle}>Day</h3>
              <button type="button" className="min-h-9 text-xs font-medium text-[var(--teal)] hover:underline" onClick={() => setShowLater((current) => !current)}>
                {showLater ? 'Hide calendar' : 'Other date'}
              </button>
            </div>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="radiogroup" aria-label="Day">
              {quickDates.map((date, index) => {
                const dayClosed = isClosedDay(date, clinic.closedWeekdays, closedDates ?? []).closed;
                const value = new Date(`${date}T00:00:00`);
                const on = selectedDate === date;
                return (
                  <button
                    key={date}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`${index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : displayDate(date)}${dayClosed ? ', closed' : ''}`}
                    onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                    className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-center leading-none sm:w-auto sm:flex-1 ${
                      on ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : dayClosed ? 'border-[var(--border)] bg-[var(--slate-light)] text-[var(--muted)]' : 'border-[var(--border)] text-[var(--ink)] hover:border-[var(--teal)]/50'
                    }`}
                  >
                    <span className={`text-[10px] font-medium ${on ? 'text-white/80' : 'text-[var(--muted)]'}`}>
                      {index === 0 ? 'Today' : value.toLocaleDateString('en-IN', { weekday: 'short' })}
                    </span>
                    <span className="mt-1 text-base font-semibold tabular-nums">{value.getDate()}</span>
                  </button>
                );
              })}
            </div>
            {(showLater || !quickDates.includes(selectedDate)) && (
              <input type="date" aria-label="Date" className={`${inputCls} mt-3`} value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setSelectedTime(null); }} />
            )}
          </section>

          <section aria-labelledby="book-time">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="book-time" className={sectionTitle}>Time</h3>
              <button type="button" className="flex min-h-9 items-center gap-1 rounded-full bg-[var(--teal-light)] px-3 text-xs font-medium text-[var(--teal-strong)] hover:bg-[var(--teal)] hover:text-white" onClick={pickFirstAvailable}>
                First available
              </button>
            </div>
            {closed.closed && (
              <p role="status" className="mb-3 rounded-lg bg-[var(--slate-light)] p-3 text-sm text-[var(--slate)]">
                {closed.kind === 'holiday'
                  ? `The clinic is closed this day${closed.label ? ` (${closed.label})` : ''}.`
                  : 'The clinic is normally closed on this day.'}{' '}
                You can still book, but check first.
              </p>
            )}
            {!therapistId ? (
              <p className="rounded-lg bg-[var(--paper)] p-3 text-sm text-[var(--muted)]">Choose a therapist to see their free times.</p>
            ) : (
              <>
                {workingSlots.length === 0 && (
                  <p className="mb-2 rounded-lg bg-[var(--paper)] p-3 text-sm text-[var(--muted)]">{therapistName ?? 'This therapist'} isn't working this day.</p>
                )}
                <div className="space-y-3">
                  {dayParts.map((part) => (
                    <div key={part.label}>
                      <p className="mb-1.5 text-[11px] font-medium text-[var(--muted)]">{part.label}</p>
                      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">{part.slots.map(renderSlot)}</div>
                    </div>
                  ))}
                </div>
                {offSlots.length > 0 && (
                  <div className="mt-3">
                    <button
                      type="button"
                      aria-expanded={showOffHours || offSlots.some((slot) => slot.time === selectedTime)}
                      className="min-h-9 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]"
                      onClick={() => setShowOffHours((current) => !current)}
                    >
                      {showOffHours || offSlots.some((slot) => slot.time === selectedTime) ? '▾' : '▸'} Outside working hours ({offSlots.length})
                    </button>
                    {(showOffHours || offSlots.some((slot) => slot.time === selectedTime)) && (
                      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-5">{offSlots.map(renderSlot)}</div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {!isReschedule && !requestId && (
            <section className="rounded-xl border border-[var(--border)]">
              <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3 text-sm font-medium text-[var(--ink)]">
                <span>
                  Repeat this booking
                  <span className="block text-xs font-normal text-[var(--muted)]">Same time on chosen weekdays</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Repeat this booking"
                  className="h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-[var(--border)] transition-colors before:block before:h-4 before:w-4 before:translate-x-0.5 before:rounded-full before:bg-white before:shadow before:transition-transform checked:bg-[var(--teal)] checked:before:translate-x-[18px]"
                  checked={repeat}
                  onChange={(event) => {
                    setRepeat(event.target.checked);
                    if (event.target.checked && repeatDays.length === 0) {
                      setRepeatDays([localDateTime(selectedDate, '00:00').getDay()]);
                    }
                  }}
                />
              </label>
              {repeat && (
                <div className="space-y-3 border-t border-[var(--border)] p-3">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-[var(--muted)]">On</p>
                    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Repeat on">
                      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                        const on = repeatDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setRepeatDays((current) => (on ? current.filter((d) => d !== day) : [...current, day]))}
                            className={`min-h-10 rounded-lg border text-xs font-medium ${on ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : 'border-[var(--border)] text-[var(--ink)]'}`}
                          >
                            {WEEKDAY_NAMES[day].slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    <Field label="Sessions">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={2}
                        max={52}
                        className={`${inputCls} w-24`}
                        value={repeatCount}
                        onChange={(event) => {
                          setRepeatCountTouched(true);
                          setRepeatCount(Math.max(2, Math.min(52, Number(event.target.value) || 2)));
                        }}
                      />
                    </Field>
                    {packageLeft !== null && packageLeft >= 2 && (
                      <p className="pb-2 text-xs text-[var(--muted)]">{packageLeft} sessions left in their package</p>
                    )}
                  </div>
                  {!selectedTime ? (
                    <p className="text-xs text-[var(--muted)]">Pick a time above to see the dates.</p>
                  ) : (
                    <ul className="max-h-64 space-y-1.5 overflow-y-auto" aria-label="Planned sessions">
                      {plannedRows.map((row, index) => (
                        <li
                          key={row.date}
                          className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                            row.skipped ? 'bg-[var(--paper)] text-[var(--muted)] line-through' : row.problem ? 'bg-[var(--rust-light)] text-[var(--rust)]' : 'bg-[var(--moss-light)] text-[var(--ink)]'
                          }`}
                        >
                          <span>
                            {index + 1}. {displayDate(row.date)}, {minutesLabel(Number(row.time.slice(0, 2)) * 60 + Number(row.time.slice(3, 5)))}
                            {!row.skipped && row.problem === 'clash' && ', clashes'}
                            {!row.skipped && row.problem === 'off-hours' && ', outside hours'}
                            {!row.skipped && row.problem === 'past' && ', in the past'}
                          </span>
                          <span className="flex shrink-0 gap-2">
                            {!row.skipped && row.problem && (
                              <button type="button" className="font-medium underline" onClick={() => findTimeFor(row.date)}>
                                Find a time
                              </button>
                            )}
                            <button
                              type="button"
                              className="font-medium underline"
                              onClick={() =>
                                setRowOverrides((current) => ({ ...current, [row.date]: { ...current[row.date], skipped: !row.skipped } }))
                              }
                            >
                              {row.skipped ? 'Undo' : 'Skip'}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedTime && (
                    <p className="text-xs text-[var(--muted)]">
                      {activeRows.length} session{activeRows.length === 1 ? '' : 's'}
                      {unresolved > 0 ? `, ${unresolved} need a new time or skip` : ', all free'}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer — what will be booked, then the action. */}
        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
          <ErrorNote message={error} />
          <p className="mb-2 truncate text-sm text-[var(--ink)]" aria-live="polite">
            {summary ?? <span className="text-[var(--muted)]">Pick a time to continue</span>}
          </p>
          <button type="button" className={`${btnPrimary} w-full`} onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const sectionTitle = 'text-sm font-semibold text-[var(--ink)]';
