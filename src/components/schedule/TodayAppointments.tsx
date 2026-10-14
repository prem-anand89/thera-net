import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { Appointment, AppointmentRequest } from '@/domain/types';
import { appointmentMinutes, lengthLabel, minutesLabel, minutesOfDay, toLocalDateStr } from '@/domain/schedule';
import { formatDateDM } from '@/domain/fiscalYear';
import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from '@/domain/appointmentStatus';
import { Pill } from '@/components/ui';
import { RequestsInbox } from './RequestsInbox';
import { appointmentFill } from './scheduleColors';
import { PatientFlagPills } from './PatientFlagPills';
import { appointmentReason, patientFlags, type PatientFlagContext } from '@/domain/patientFlags';

const UPCOMING_LIMIT = 5;
const DONE_OPEN_KEY = 'theranet:today-done-open';
const REQUESTS_LIMIT = 3;

const sectionHeading = 'mb-1.5 text-xs font-medium text-[var(--muted)]';
/** Flat divided rows bleeding to the card edge — the same density as the
 *  Visits tab's list (`ResponsiveVisitList`), and the Schedule grid's colour
 *  code (`appointmentFill`): therapist-colour edge, status fill. */
const listCls = '-mx-5 divide-y divide-[var(--border)] border-y border-[var(--border)]';

/**
 * Workspace → Today → Appointments. Kept short so it never pushes the rest
 * of the page down: public booking requests waiting for a confirm (admin /
 * front desk only), visits in progress (arrived, service not added yet),
 * then the next few upcoming, and finished ones folded away.
 */
export function TodayAppointments({
  appointments,
  slotMinutes,
  nextUpId,
  colorFor,
  therapistNameFor,
  showTherapist,
  onSelect,
  requests = [],
  therapistNameForId,
  onConfirmRequest,
  onDeclineRequest,
  onSeeAllRequests,
  flagContext,
  dueByVisitId,
  onCollect,
  onMarkArrived,
  onUndoNoShow,
  onRestoreCancelled,
}: {
  appointments: Appointment[];
  slotMinutes: number;
  nextUpId: string | null;
  colorFor: (appointment: Appointment) => string;
  therapistNameFor: (appointment: Appointment) => string;
  showTherapist: boolean;
  onSelect: (appointment: Appointment) => void;
  /** Pending public booking requests, oldest first. Omit for therapists. */
  requests?: AppointmentRequest[];
  therapistNameForId?: (id: string | null) => string | null;
  onConfirmRequest?: (request: AppointmentRequest) => void;
  onDeclineRequest?: (request: AppointmentRequest) => void;
  onSeeAllRequests?: () => void;
  /** Patient flags + condition (`usePatientFlagContext`); omit to hide them. */
  flagContext?: PatientFlagContext;
  /** Today's logged visits: true = still owes money, false = settled. Finished rows show Due / Paid from it. */
  dueByVisitId?: Map<string, boolean>;
  onCollect?: (visitId: string) => void;
  /** One-tap "Arrived" on an upcoming row (otherwise it takes row, panel, button). */
  onMarkArrived?: (appointment: Appointment) => void;
  /** Reverses a mistaken no-show; Rebook is the row itself (opens the panel with Reschedule). */
  onUndoNoShow?: (appointment: Appointment) => void;
  /** Brings a cancelled appointment back (managers). Shown only while its time is still ahead. */
  onRestoreCancelled?: (appointment: Appointment) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  // Finished rows carry Paid / Due / Undo, so they stay open unless the user folds them (remembered per device).
  const [doneOpen, setDoneOpen] = useState(() => {
    try {
      return localStorage.getItem(DONE_OPEN_KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  const inProgress = appointments.filter((a) => a.status === 'arrived' && !a.visitId);
  const upcoming = appointments.filter((a) => a.status === 'confirmed' || a.status === 'rescheduled');
  const done = appointments.filter((a) => a.visitId || a.status === 'no_show');
  const cancelled = appointments.filter((a) => a.status === 'cancelled' && !a.visitId);
  const shownUpcoming = showAll ? upcoming : upcoming.slice(0, UPCOMING_LIMIT);
  const hasRequests = requests.length > 0 && Boolean(onConfirmRequest && onDeclineRequest);
  const sectionCount = [hasRequests, inProgress.length > 0, upcoming.length > 0].filter(Boolean).length;

  const row = (a: Appointment, end: ReactNode, note?: string, showEndOnMobile = false) => {
    const length = lengthLabel(appointmentMinutes(a, slotMinutes));
    const color = colorFor(a);
    // Same colour code as the Schedule grid: therapist edge + status fill.
    const fill = appointmentFill(a, color);
    const flags = patientFlags(a, flagContext);
    const reason = appointmentReason(a, flagContext);
    const wideDetail = [note, reason?.text].filter(Boolean).join(', ');
    // Only states worth a word on a phone; "Visit logged" / "Done" are said by the Paid / Due marker.
    const mobileNote = note && note !== 'Visit logged' && note !== 'Done' ? note : undefined;
    const noteClass =
      note === 'Rescheduled'
        ? 'font-medium text-[var(--amber-strong,#b45309)]'
        : note === 'No-show'
          ? 'font-medium text-[var(--rust)]'
          : note === 'Walk-in' || note === 'Arrived'
            ? 'font-medium text-[var(--ink)]'
            : 'font-medium';
    return (
      <li
        key={a.id}
        className="flex min-h-14 items-start gap-3 border-l-4 py-2.5 pl-4 pr-5"
        style={{ borderLeftColor: color, background: fill.background }}
      >
        <button type="button" className="flex min-h-11 min-w-0 flex-1 items-start gap-3 text-left" onClick={() => onSelect(a)}>
          <span className="w-16 shrink-0 whitespace-nowrap pt-0.5 text-[13px] tabular-nums text-[var(--muted)] sm:w-[4.5rem] sm:text-sm">
            {minutesLabel(minutesOfDay(a.scheduledAt))}
            {toLocalDateStr(new Date(a.scheduledAt)) !== toLocalDateStr(new Date()) && (
              <span className="block text-[11px]">{formatDateDM(a.scheduledAt)}</span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`truncate font-display text-sm font-medium ${fill.kind === 'done' ? 'text-[var(--muted)]' : fill.kind === 'no_show' ? 'text-[var(--rust)]' : fill.kind === 'cancelled' ? 'text-[var(--muted)] line-through' : 'text-[var(--ink)]'}`}>
                {a.patientName}
              </span>
              {a.id === nextUpId && (
                <span className="shrink-0 rounded-full bg-[var(--teal)] px-1.5 text-[10px] font-medium leading-4 text-white">Next</span>
              )}
              <PatientFlagPills flags={flags} max={2} />
            </span>
            {/* Phones: two clean lines. Length and therapist live in the detail
                panel (the colour edge already says whose column it is). */}
            {(mobileNote || reason?.text) && (
              <span className="block truncate text-xs text-[var(--muted)] sm:hidden">
                {mobileNote && <span className={noteClass}>{mobileNote}</span>}
                {mobileNote && reason?.text ? ' · ' : ''}
                {reason?.text}
              </span>
            )}
            {wideDetail && <span className="hidden truncate text-xs text-[var(--muted)] sm:block">{wideDetail}</span>}
          </span>
          {showTherapist && <span className="hidden w-36 shrink-0 truncate pt-0.5 text-xs text-[var(--muted)] sm:block">{therapistNameFor(a)}</span>}
          <span className="hidden w-14 shrink-0 pt-0.5 text-xs text-[var(--muted)] sm:block">{length}</span>
        </button>
        {end && (
          <span className={`shrink-0 self-start pt-0.5 sm:flex sm:w-40 sm:justify-end ${showEndOnMobile ? '' : 'hidden sm:flex'}`}>
            {end}
          </span>
        )}
      </li>
    );
  };
  const statusPill = (a: Appointment) =>
    a.visitId ? (
      <Pill tone="green">Visit logged</Pill>
    ) : (
      <Pill tone={APPOINTMENT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</Pill>
    );

  const dueCount = done.filter((a) => a.visitId && dueByVisitId?.get(a.visitId)).length;
  const noShowCount = done.filter((a) => a.status === 'no_show' && !a.visitId).length;
  const doneSummary = [
    noShowCount > 0 ? `${noShowCount} no-show` : null,
    dueCount > 0 ? `${dueCount} due` : null,
  ]
    .filter(Boolean)
    .map((part) => ` · ${part}`)
    .join('');

  /** What a finished row's right side is for: payment state on a logged visit, undo on a no-show. */
  const doneEnd = (a: Appointment): ReactNode => {
    if (a.visitId && dueByVisitId?.has(a.visitId)) {
      return dueByVisitId.get(a.visitId) ? (
        <button
          type="button"
          className="min-h-11 rounded-full border sm:min-h-9 border-[var(--rust)] px-3 text-xs font-medium text-[var(--rust)] hover:bg-[var(--rust-light)]"
          aria-label={`Collect payment from ${a.patientName}`}
onClick={() => onCollect?.(a.visitId!)}
        >
          Due · Collect
        </button>
      ) : (
        <span className="text-xs font-medium text-[var(--moss-strong,var(--teal))]">Paid ✓</span>
      );
    }
    if (a.status === 'no_show' && !a.visitId && onUndoNoShow) {
      return (
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="min-h-11 rounded-full border sm:min-h-9 border-[var(--rust)] px-3 text-xs font-medium text-[var(--rust)] hover:bg-[var(--rust-light)]"
            aria-label={`Undo no-show for ${a.patientName}`}
onClick={() => onUndoNoShow(a)}
          >
            Undo
          </button>
          <button
            type="button"
            className="hidden min-h-11 rounded-full border sm:min-h-9 border-[var(--border)] px-3 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)] sm:inline-block"
            onClick={() => onSelect(a)}
          >
            Rebook
          </button>
        </span>
      );
    }
    return statusPill(a);
  };

  const requestsSection = hasRequests ? (
    <section aria-label="Requests to confirm">
      <h3 className={sectionHeading}>Requests to confirm ({requests.length})</h3>
      <RequestsInbox
        variant="rows"
        requests={requests}
        limit={REQUESTS_LIMIT}
        therapistNameFor={therapistNameForId ?? (() => null)}
        onConfirm={onConfirmRequest!}
        onDecline={onDeclineRequest!}
        onSeeAll={onSeeAllRequests ?? (() => undefined)}
      />
    </section>
  ) : null;

  if (appointments.length === 0) {
    return (
      <div className="space-y-4">
        {requestsSection}
        <p className="text-sm text-[var(--muted)]">No appointments today.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {requestsSection}

      {inProgress.length > 0 && (
        <section aria-label="In progress">
          <h3 className={sectionHeading}>In progress, add the service and payment</h3>
          <ul className={listCls}>
            {inProgress.map((a) =>
              row(
                a,
                <span className="flex items-center gap-2">
                  <span className="hidden sm:inline">
                    <Pill tone="amber">{a.source === 'walk_in' ? 'Walk-in' : 'Arrived'}</Pill>
                  </span>
                  <Link
                    to="/visits/new"
                    search={{
                      appointmentId: a.id,
                      prefillName: a.patientName,
                      prefillPhone: a.patientPhone,
                      ...(a.patientId ? { patientId: a.patientId } : {}),
                      from: '/workspace',
                    }}
                    className="inline-flex min-h-11 items-center rounded-full bg-[var(--teal)] px-3 text-xs font-medium text-white hover:bg-[var(--teal-strong)] sm:min-h-0 sm:px-2.5 sm:py-1"
                  >
                    <span className="sm:hidden">Complete</span>
                    <span className="hidden sm:inline">Complete visit</span>
                  </Link>
                </span>,
                a.source === 'walk_in' ? 'Walk-in' : 'Arrived',
                true
              )
            )}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-label="Upcoming">
          {sectionCount > 1 && <h3 className={sectionHeading}>Upcoming</h3>}
          <ul className={listCls}>
            {shownUpcoming.map((a) =>
              row(
                a,
                onMarkArrived ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-full border sm:min-h-9 border-[var(--teal)] px-3 text-xs font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]"
                    aria-label={`Mark ${a.patientName} arrived`}
onClick={() => onMarkArrived(a)}
                  >
                    Arrived
                  </button>
                ) : (
                  statusPill(a)
                ),
                a.status === 'rescheduled' ? 'Rescheduled' : undefined,
                Boolean(onMarkArrived)
              )
            )}
          </ul>
          {upcoming.length > UPCOMING_LIMIT && (
            <button type="button" className="mt-2 min-h-9 text-sm font-medium text-[var(--teal)]" onClick={() => setShowAll((current) => !current)}>
              {showAll ? 'Show fewer' : `Show all ${upcoming.length} upcoming`}
            </button>
          )}
        </section>
      )}

      {upcoming.length === 0 && inProgress.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{done.length > 0 ? 'All done for today ✓' : 'No more appointments today.'}</p>
      )}

      {done.length > 0 && (
        <details
          open={doneOpen}
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            setDoneOpen(open);
            try {
              localStorage.setItem(DONE_OPEN_KEY, open ? 'open' : 'closed');
            } catch {
              // storage unavailable — the choice just isn't remembered
            }
          }}
        >
          <summary className="min-h-9 cursor-pointer text-sm text-[var(--muted)]">
            Done ({done.length})
            <span className="text-xs">{doneSummary}</span>
          </summary>
          <ul className={`${listCls} mt-1`}>
            {done.map((a) => row(a, doneEnd(a), a.visitId ? 'Visit logged' : APPOINTMENT_STATUS_LABEL[a.status], Boolean(a.visitId ? dueByVisitId : onUndoNoShow)))}
          </ul>
        </details>
      )}

      {cancelled.length > 0 && (
        <details>
          <summary className="min-h-9 cursor-pointer text-sm text-[var(--muted)]">Cancelled ({cancelled.length})</summary>
          <ul className={`${listCls} mt-1`}>
            {cancelled.map((a) =>
              row(
                a,
                onRestoreCancelled && new Date(a.scheduledAt).getTime() > Date.now() ? (
                  <button
                    type="button"
                    aria-label={`Restore ${a.patientName}'s appointment`}
                    className="min-h-11 rounded-full border border-[var(--border)] px-3 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)] sm:min-h-9"
                    onClick={() => onRestoreCancelled(a)}
                  >
                    Restore
                  </button>
                ) : null,
                'Cancelled',
                Boolean(onRestoreCancelled)
              )
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
