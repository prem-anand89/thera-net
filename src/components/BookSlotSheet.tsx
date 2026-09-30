import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { ErrorNote, Field, inputCls, btnPrimary, btnSecondary } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import {
  addDays,
  appointmentMinutes,
  formatMinutes,
  generateScheduleSlots,
  isClosedDay,
  isTherapistSlotOccupied,
  localDateTime,
  localDateTimeToIso,
  minutesLabel,
  minutesOfDay,
  toLocalDateStr,
} from '@/domain/schedule';
import type { Appointment, UUID, Patient } from '@/domain/types';

export type BookedSlot = {
  kind: 'booked' | 'rescheduled';
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
  const [therapistTouched, setTherapistTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const closedDates = useLiveQuery(() => repos.clinicClosedDates.listByClinic(clinic.id), [clinic.id]);
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
    setPatientId('');
    setPatientName(prefilledPatientName ?? '');
    setPatientPhone(prefilledPatientPhone ?? '');
    setPatientMode(prefilledPatientName ? 'new' : 'find');
    setBusy(false);
    setError(null);
  }, [isOpen, rescheduleAppointment, prefilledDate, prefilledPatientName, prefilledPatientPhone, prefilledTherapistId, prefilledTime, today, slotMinutes]);

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
  const therapistName = (therapists ?? []).find((t) => t.id === therapistId)?.name;
  const therapistLocked = isReschedule || (lockTherapist && Boolean(therapistId));

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
  const submitLabel = isReschedule ? 'Move appointment' : 'Confirm booking';

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
            <p className="mb-2 text-xs font-medium text-[var(--muted)]">Available time</p>
            {closed.closed && (
              <p role="status" className="mb-2 rounded-lg bg-[var(--slate-light)] p-3 text-sm text-[var(--slate)]">
                {closed.kind === 'holiday'
                  ? `The clinic is closed this day${closed.label ? ` (${closed.label})` : ''}.`
                  : 'The clinic is normally closed on this day.'}{' '}
                You can still book, but check first.
              </p>
            )}
            {!therapistId ? <p className="rounded-lg bg-[var(--paper)] p-3 text-sm text-[var(--muted)]">Choose a therapist to see their available times.</p> : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot) => {
                  const unavailable = occupied(slot.time) || isPast(slot.time) || runsPastClose(slot.minutes);
                  return <button key={slot.time} type="button" disabled={unavailable} onClick={() => setSelectedTime(slot.time)} className={`min-h-11 rounded-lg border px-2 text-xs font-medium ${selectedTime === slot.time ? 'border-[var(--teal)] bg-[var(--teal)] text-white' : unavailable ? 'cursor-not-allowed border-[var(--border)] bg-[var(--paper)] text-[var(--muted)] line-through' : 'border-[var(--moss)]/40 bg-[var(--moss-light)] text-[var(--ink)] hover:border-[var(--moss)]'}`}>{slot.label}</button>;
                })}
              </div>
            )}
          </div>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
