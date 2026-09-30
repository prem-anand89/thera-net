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
import { appointmentMinutes, formatMinutes, minutesLabel, minutesOfDay } from '@/domain/schedule';
import type { Appointment } from '@/domain/types';

const actionCls =
  'min-h-11 rounded-lg border border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--paper)] disabled:opacity-50';

/**
 * Google-Calendar-style details for one appointment: a right-hand panel from
 * `tab:` up, a bottom sheet on phones. All appointment actions live here so
 * calendar blocks and agenda rows stay glanceable.
 */
export function AppointmentDetailsPanel({
  appointment,
  therapistName,
  therapistColor,
  slotMinutes,
  canManage,
  onClose,
  onReschedule,
}: {
  appointment: Appointment | null;
  therapistName: string;
  therapistColor: string;
  slotMinutes: number;
  /** Admin / front desk, or the therapist the appointment belongs to. */
  canManage: boolean;
  onClose: () => void;
  onReschedule: (appointment: Appointment) => void;
}) {
  const clinic = useClinic();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (!appointment) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appointment, onClose]);

  if (!appointment) return null;
  const start = minutesOfDay(appointment.scheduledAt);
  const minutes = appointmentMinutes(appointment, slotMinutes);
  const active = isActiveAppointmentStatus(appointment.status);
  const dateLabel = new Date(appointment.scheduledAt).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  async function run(action: () => Promise<void>, closeAfter = false) {
    setBusy(true);
    try {
      await action();
      if (closeAfter) onClose();
    } catch (error) {
      alert(toFriendlyMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-[var(--ink)]/30 tab:bg-[var(--ink)]/10" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-details-title"
        className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 shadow-xl tab:inset-y-0 tab:left-auto tab:right-0 tab:max-h-none tab:w-[380px] tab:rounded-none tab:border-l tab:border-[var(--border)] tab:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="appointment-details-title" className="font-display text-lg font-semibold text-[var(--ink)]">
              {appointment.patientId ? (
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: appointment.patientId }}
                  className="text-[var(--teal)] hover:underline"
                >
                  {appointment.patientName}
                </Link>
              ) : (
                appointment.patientName
              )}
            </h2>
            <div className="mt-1">
              <Pill tone={APPOINTMENT_STATUS_TONE[appointment.status]}>
                {APPOINTMENT_STATUS_LABEL[appointment.status]}
              </Pill>
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
              {minutesLabel(start)}–{minutesLabel(start + minutes)} · {formatMinutes(minutes)}
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
                {new Date(appointment.previousScheduledAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-5 grid grid-cols-2 gap-2">
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
              Create visit
            </Link>
          )}
          {active && appointment.patientPhone && (
            <button
              type="button"
              className={`${actionCls} text-[var(--teal)]`}
              onClick={() =>
                void bookingService
                  .shareBookingConfirmation(
                    clinic.id,
                    appointment.patientName,
                    appointment.patientPhone,
                    clinic.name,
                    appointment.scheduledAt
                  )
                  .catch((error) => alert(toFriendlyMessage(error)))
              }
            >
              WhatsApp
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
              <button
                type="button"
                disabled={busy}
                className={`${actionCls} text-[var(--rust)]`}
                onClick={() => setConfirmCancel(true)}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </aside>
      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this appointment?"
        message={`${appointment.patientName} · ${dateLabel}, ${minutesLabel(start)}. The time becomes free again.`}
        confirmLabel="Cancel appointment"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void run(() => bookingService.cancelAppointment(appointment.id), true);
        }}
      />
    </>
  );
}
