import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService, dashboardService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { ErrorNote, Field, inputCls, btnPrimary, btnSecondary } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import {
  addDays,
  appointmentMinutes,
  firstAvailableSlot,
  nextAppointmentFor,
  patientAttendance,
  formatMinutes,
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

const LENGTH_OPTIONS = [15, 30, 45, 60, 90];

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
        className={`min-h-11 rounded-lg border px-2 text-xs font-medium ${selected ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : unavailable ? 'cursor-not-allowed border-[var(--border)] bg-[var(--paper)] text-[var(--muted)] line-through' : 'border-[var(--moss)]/40 bg-[var(--moss-light)] text-[var(--ink)] hover:border-[var(--moss)]'}`}
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="book-slot-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 shadow-xl sm:max-w-lg sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="book-slot-title" className="font-display text-lg font-semibold text-[var(--ink)]">{title}</h2>
            {rescheduleAppointment ? (
              <p className="text-sm text-[var(--muted)]">
                {rescheduleAppointment.patientName} · now {displayDate(toLocalDateStr(new Date(rescheduleAppointment.scheduledAt)))}, {minutesLabel(minutesOfDay(rescheduleAppointment.scheduledAt))}
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)]">Choose the patient, therapist, and an available slot.</p>
            )}
            {requestId && (requestNotes || requestPreferredTimeText) && (
              <div className="mt-3 rounded-lg bg-[var(--paper)] p-3 text-xs text-[var(--ink)]">
                {requestPreferredTimeText && <p><strong>Requested time:</strong> {requestPreferredTimeText}</p>}
                {requestNotes && <p><strong>Notes:</strong> {requestNotes}</p>}
              </div>
            )}
          </div>
          <button type="button" className="min-h-11 px-2 text-sm text-[var(--muted)]" onClick={onClose}>Close</button>
        </div>

        <div className="space-y-5">
          {!isReschedule && (
            <div>
              <p className="mb-2 text-xs font-medium text-[var(--muted)]">Patient</p>
              <div className="mb-3 flex gap-2">
                <button type="button" className={patientMode === 'find' ? btnPrimary : btnSecondary} onClick={() => setPatientMode('find')}>Find patient</button>
                <button type="button" className={patientMode === 'new' ? btnPrimary : btnSecondary} onClick={() => setPatientMode('new')}>New patient</button>
              </div>
              {patientMode === 'find' ? (
                <div className="space-y-3">
                  <SearchableSelect label="" value={patientId} onChange={(value) => setPatientId(value as UUID)} options={patientOptions} placeholder="Search name or phone" />
                  {patientId && !patients?.find((p) => p.id === patientId)?.phone && (
                    <Field label="Phone (none on file)"><input type="tel" className={inputCls} value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} /></Field>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Patient name"><input className={inputCls} value={patientName} onChange={(event) => setPatientName(event.target.value)} /></Field>
                  <Field label="Phone"><input type="tel" className={inputCls} value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} /></Field>
                </div>
              )}
            </div>
          )}

          {(attendance || alreadyBooked) && (
            <div className="space-y-2">
              <AttendanceNote attendance={attendance} />
              {alreadyBooked && (
                <p className="rounded-lg bg-[var(--teal-light)] px-3 py-2 text-xs text-[var(--ink)]">
                  Already booked: {displayDate(toLocalDateStr(new Date(alreadyBooked.scheduledAt)))}, {minutesLabel(minutesOfDay(alreadyBooked.scheduledAt))}.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            {therapistLocked ? (
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">Therapist</p>
                <p className="min-h-11 rounded-lg bg-[var(--paper)] px-3 py-2.5 text-sm text-[var(--ink)]">{therapistName ?? 'Unassigned'}</p>
              </div>
            ) : (
              <Field label="Therapist">
                <select className={inputCls} value={therapistId} onChange={(event) => { setTherapistId(event.target.value as UUID); setTherapistTouched(true); setSelectedTime(null); }}>
                  <option value="">Choose therapist</option>
                  {(therapists ?? []).map((therapist) => <option key={therapist.id} value={therapist.id}>{therapist.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Length">
              <select className={inputCls} value={lengthMinutes} onChange={(event) => { setLengthMinutes(Number(event.target.value)); setSelectedTime(null); }}>
                {lengthOptions.map((minutes) => <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>)}
              </select>
            </Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-[var(--muted)]">Date</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {quickDates.map((date, index) => {
                const dayClosed = isClosedDay(date, clinic.closedWeekdays, closedDates ?? []).closed;
                return <button key={date} type="button" onClick={() => { setSelectedDate(date); setSelectedTime(null); }} className={`min-h-11 shrink-0 rounded-lg border px-3 text-xs font-medium ${selectedDate === date ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : dayClosed ? 'border-[var(--border)] bg-[var(--slate-light)] text-[var(--muted)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]'}`}>{index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : displayDate(date)}{dayClosed ? ' · closed' : ''}</button>;
              })}
              <button type="button" onClick={() => setShowLater(true)} className="min-h-11 shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--teal)]">Later…</button>
            </div>
            {showLater && <input type="date" aria-label="Date" className={`${inputCls} mt-3`} value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setSelectedTime(null); }} />}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--muted)]">Available time</p>
              <button type="button" className="min-h-9 text-xs font-medium text-[var(--teal)] hover:underline" onClick={pickFirstAvailable}>
                First available →
              </button>
            </div>
            {closed.closed && (
              <p role="status" className="mb-2 rounded-lg bg-[var(--slate-light)] p-3 text-sm text-[var(--slate)]">
                {closed.kind === 'holiday'
                  ? `The clinic is closed this day${closed.label ? ` (${closed.label})` : ''}.`
                  : 'The clinic is normally closed on this day.'}{' '}
                You can still book, but check first.
              </p>
            )}
            {!therapistId ? <p className="rounded-lg bg-[var(--paper)] p-3 text-sm text-[var(--muted)]">Choose a therapist to see their available times.</p> : (
              <>
                {workingSlots.length === 0 && (
                  <p className="mb-2 rounded-lg bg-[var(--paper)] p-3 text-sm text-[var(--muted)]">{therapistName ?? 'This therapist'} isn't working this day.</p>
                )}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {workingSlots.map(renderSlot)}
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
                      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">{offSlots.map(renderSlot)}</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {!isReschedule && !requestId && (
            <div className="rounded-xl border border-[var(--border)] p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(event) => {
                    setRepeat(event.target.checked);
                    if (event.target.checked && repeatDays.length === 0) {
                      setRepeatDays([localDateTime(selectedDate, '00:00').getDay()]);
                    }
                  }}
                />
                Repeat this booking
              </label>
              {repeat && (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-[var(--muted)]">On</p>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Repeat on">
                      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                        const on = repeatDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setRepeatDays((current) => (on ? current.filter((d) => d !== day) : [...current, day]))}
                            className={`min-h-9 min-w-11 rounded-lg border px-2 text-xs font-medium ${on ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : 'border-[var(--border)] text-[var(--ink)]'}`}
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
                            {!row.skipped && row.problem === 'clash' && ' — clashes'}
                            {!row.skipped && row.problem === 'off-hours' && ' — outside hours'}
                            {!row.skipped && row.problem === 'past' && ' — in the past'}
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
                      {unresolved > 0 ? ` · ${unresolved} need a new time or skip` : ' · all free'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <ErrorNote message={error} />
          <div className="sticky -bottom-4 -mx-4 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-bottom-6 sm:-mx-6 sm:px-6 sm:pb-3">
            <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={`${btnPrimary} min-w-0 flex-1 sm:flex-none`} onClick={() => void submit()} disabled={busy}>
              {busy ? 'Saving…' : selectedTime ? `${submitLabel} · ${displayDate(selectedDate)}, ${minutesLabel(Number(selectedTime.slice(0, 2)) * 60 + Number(selectedTime.slice(3, 5)))} · ${formatMinutes(lengthMinutes)}` : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
