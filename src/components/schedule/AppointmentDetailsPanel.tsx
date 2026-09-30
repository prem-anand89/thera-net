import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ConfirmDialog, Pill } from '@/components/ui';
import { useClinic } from '@/app/clinicContext';
import { toFriendlyMessage } from '@/lib/errors';
import { bookingService } from '@/services';
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  isActiveAppointmentStatus,
} from '@/domain/appointmentStatus';
import {
  appointmentMinutes,
  formatMinutes,
  minutesLabel,
  minutesOfDay,
  type Attendance,
} from '@/domain/schedule';
import type { Appointment } from '@/domain/types';

const actionCls =
  'min-h-11 rounded-lg border border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--paper)] disabled:opacity-50';

export function AttendanceNote({ attendance }: { attendance: Attendance | null }) {
  if (!attendance || (attendance.noShows === 0 && attendance.cancelled === 0)) return null;
  const parts = [
    attendance.noShows ? `${attendance.noShows} no-show${attendance.noShows === 1 ? '' : 's'}` : '',
    attendance.cancelled ? `${attendance.cancelled} cancelled` : '',
  ].filter(Boolean);
  return (
    <p className={`rounded-lg px-3 py-2 text-xs ${attendance.noShows >= 2 ? 'bg-[var(--rust-light)] text-[var(--rust)]' : 'bg-[var(--amber-light)] text-[var(--amber)]'}`}>
      ! {parts.join(', ')} in the last 6 months{attendance.attended ? ` · attended ${attendance.attended}` : ''}. Consider calling to confirm.
    </p>
  );
}

/**
 * Google-Calendar-style details for one appointment: a right-hand panel from
 * `tab:` up, a bottom sheet on phones. All appointment actions live here so
 * calendar blocks and agenda rows stay glanceable.
 */
export function AppointmentDetailsPanel({
  appointment,
  therapistName,
  therapistColor,
  therapistPhone,
  slotMinutes,
  canManage,
  attendance,
  requestNotes,
  seriesLabel,
  onClose,
  onReschedule,
  onCancelSeries,
  onStartNote,
}: {
  appointment: Appointment | null;
  therapistName: string;
  therapistColor: string;
  therapistPhone?: string | null;
  slotMinutes: number;
  /** Admin / front desk, or the therapist the appointment belongs to. */
  canManage: boolean;
  attendance?: Attendance | null;
  /** The patient's note from the public booking request, if it came from one. */
  requestNotes?: string | null;
  /** e.g. "Session 3 of 8" when part of a repeat series. */
  seriesLabel?: string | null;
  onClose: () => void;
  onReschedule: (appointment: Appointment) => void;
  /** Cancels this and the following sessions of its series. */
  onCancelSeries?: (appointment: Appointment) => void;
  /** Opens "Start note" — notes now, service and payment later. */
  onStartNote?: (appointment: Appointment) => void;
}) {
  const clinic = useClinic();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!appointment) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appointment, onClose]);
  useEffect(() => setCopied(false), [appointment?.id]);

  if (!appointment) return null;
  const start = minutesOfDay(appointment.scheduledAt);
  const minutes = appointmentMinutes(appointment, slotMinutes);
  const active = isActiveAppointmentStatus(appointment.status);
  const dateLabel = new Date(appointment.scheduledAt).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeRange = `${minutesLabel(start)}–${minutesLabel(start + minutes)}`;
  const messageInput = {
    patientName: appointment.patientName,
    patientPhone: appointment.patientPhone,
    clinicName: clinic.name,
    scheduledAt: appointment.scheduledAt,
    therapistName,
  };
  const therapistInput = {
    therapistName,
    therapistPhone: therapistPhone ?? null,
    patientName: appointment.patientName,
    scheduledAt: appointment.scheduledAt,
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      alert(toFriendlyMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function copyDetails() {
    const text = `${appointment!.patientName} · ${dateLabel}, ${timeRange} · ${therapistName}`;
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-[var(--ink)]/30 tab:bg-[var(--ink)]/10" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-details-title"
        className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl tab:inset-y-0 tab:left-auto tab:right-0 tab:max-h-none tab:w-[380px] tab:rounded-none tab:border-l tab:border-[var(--border)] tab:p-5"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border)] tab:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="appointment-details-title" className="font-display text-lg font-semibold text-[var(--ink)]">
              {appointment.patientId ? (
                <Link to="/patients/$patientId" params={{ patientId: appointment.patientId }} className="text-[var(--teal)] hover:underline">
                  {appointment.patientName}
                </Link>
              ) : (
                appointment.patientName
              )}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Pill tone={APPOINTMENT_STATUS_TONE[appointment.status]}>{APPOINTMENT_STATUS_LABEL[appointment.status]}</Pill>
              {seriesLabel && <span className="text-xs text-[var(--muted)]">{seriesLabel}</span>}
            </div>
          </div>
          <button type="button" className="min-h-11 px-2 text-sm text-[var(--muted)]" onClick={onClose}>
            Close
          </button>
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-[var(--muted)]">When</dt>
            <dd className="text-[var(--ink)]">
              {dateLabel}
              <br />
              {timeRange} · {formatMinutes(minutes)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-[var(--muted)]">Therapist</dt>
            <dd className="flex items-center gap-1.5 text-[var(--ink)]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: therapistColor }} aria-hidden />
              {therapistName}
            </dd>
          </div>
          {appointment.patientPhone && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-[var(--muted)]">Phone</dt>
              <dd>
                <a href={`tel:${appointment.patientPhone}`} className="text-[var(--teal)] hover:underline">
                  {appointment.patientPhone}
                </a>
              </dd>
            </div>
          )}
          {appointment.previousScheduledAt && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-[var(--muted)]">Moved from</dt>
              <dd className="text-[var(--muted)]">
                {new Date(appointment.previousScheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </dd>
            </div>
          )}
          {requestNotes && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-[var(--muted)]">Note</dt>
              <dd className="text-[var(--ink)]">{requestNotes}</dd>
            </div>
          )}
        </dl>

        <div className="mt-3">
          <AttendanceNote attendance={attendance ?? null} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {active && (
            <button
              type="button"
              disabled={busy}
              className="col-span-2 min-h-11 rounded-lg bg-[var(--moss)] px-3 text-sm font-medium text-white hover:bg-[var(--moss-strong)] disabled:opacity-50"
              onClick={() => void run(() => bookingService.markAppointmentArrived(appointment.id))}
            >
              ✓ Mark arrived
            </button>
          )}
          {appointment.status === 'arrived' && !appointment.visitId && (
            <p className="col-span-2 rounded-lg bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber)]">
              In progress — add the service and payment with Complete visit.
            </p>
          )}
          {onStartNote && !appointment.visitId && appointment.status !== 'cancelled' && appointment.status !== 'no_show' && (
            <button type="button" className={`${actionCls} col-span-2 text-[var(--teal)]`} onClick={() => onStartNote(appointment)}>
              Start note — service later
            </button>
          )}
          {!appointment.visitId && appointment.status !== 'cancelled' && appointment.status !== 'no_show' && (
            <Link
              to="/visits/new"
              search={{
                appointmentId: appointment.id,
                prefillName: appointment.patientName,
                prefillPhone: appointment.patientPhone,
                ...(appointment.patientId ? { patientId: appointment.patientId } : {}),
              }}
              className="col-span-2 flex min-h-11 items-center justify-center rounded-lg bg-[var(--teal)] px-3 text-sm font-medium text-white hover:bg-[var(--teal-strong)]"
            >
              {appointment.status === 'arrived' ? 'Complete visit' : 'Create visit'}
            </Link>
          )}
          {active && appointment.patientPhone && (
            <button type="button" className={`${actionCls} text-[var(--teal)]`} onClick={() => bookingService.messagePatient('reminder', messageInput)}>
              Remind patient
            </button>
          )}
          {active && therapistPhone && (
            <button
              type="button"
              className={`${actionCls} text-[var(--teal)]`}
              onClick={() => bookingService.messageTherapist(appointment.status === 'rescheduled' ? 'rescheduled' : 'booked', therapistInput)}
            >
              Notify therapist
            </button>
          )}
          {active && canManage && (
            <>
              <button type="button" disabled={busy} className={`${actionCls} text-[var(--teal)]`} onClick={() => onReschedule(appointment)}>
                Reschedule
              </button>
              <button
                type="button"
                disabled={busy}
                className={`${actionCls} text-[var(--muted)]`}
                onClick={() => void run(() => bookingService.markAppointmentNoShow(appointment.id))}
              >
                No-show
              </button>
              <button type="button" disabled={busy} className={`${actionCls} col-span-2 text-[var(--rust)]`} onClick={() => setConfirmCancel(true)}>
                Cancel appointment
              </button>
            </>
          )}
        </div>

        {appointment.status === 'cancelled' && (
          <div className="mt-4 rounded-lg bg-[var(--paper)] p-3">
            <p className="text-sm text-[var(--ink)]">Let them know it's cancelled:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {appointment.patientPhone && (
                <button type="button" className={`${actionCls} text-[var(--teal)]`} onClick={() => bookingService.messagePatient('cancelled', messageInput)}>
                  Tell patient
                </button>
              )}
              {therapistPhone && (
                <button type="button" className={`${actionCls} text-[var(--teal)]`} onClick={() => bookingService.messageTherapist('cancelled', therapistInput)}>
                  Tell therapist
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3 text-xs">
          <button type="button" className="min-h-9 text-[var(--muted)] hover:text-[var(--ink)]" onClick={copyDetails}>
            {copied ? 'Copied' : 'Copy details'}
          </button>
          {!therapistPhone && active && (
            <span className="text-[var(--muted)]">Add the therapist's phone in Settings → Team to notify them.</span>
          )}
        </div>
      </aside>
      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this appointment?"
        message={
          <>
            {appointment.patientName} · {dateLabel}, {minutesLabel(start)}. The time becomes free again.
            {onCancelSeries && (
              <button
                type="button"
                className="mt-3 block text-sm font-medium text-[var(--rust)] hover:underline"
                onClick={() => {
                  setConfirmCancel(false);
                  onCancelSeries(appointment);
                }}
              >
                Cancel this and all following sessions…
              </button>
            )}
          </>
        }
        confirmLabel="Cancel appointment"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void run(() => bookingService.cancelAppointment(appointment.id));
        }}
      />
    </>
  );
}
