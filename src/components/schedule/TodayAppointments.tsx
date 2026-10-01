import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { Appointment, AppointmentRequest } from '@/domain/types';
import { appointmentMinutes, formatMinutes, minutesLabel, minutesOfDay } from '@/domain/schedule';
import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from '@/domain/appointmentStatus';
import { Pill } from '@/components/ui';
import { RequestsInbox } from './RequestsInbox';

const UPCOMING_LIMIT = 5;
const REQUESTS_LIMIT = 3;

const sectionHeading = 'mb-1.5 text-xs font-medium text-[var(--muted)]';
/** Flat divided rows bleeding to the card edge — the same density as the
 *  Visits tab's list (`ResponsiveVisitList`), so switching tabs doesn't
 *  change the scale of the page. */
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
}) {
  const [showAll, setShowAll] = useState(false);
  const inProgress = appointments.filter((a) => a.status === 'arrived' && !a.visitId);
  const upcoming = appointments.filter((a) => a.status === 'confirmed' || a.status === 'rescheduled');
  const done = appointments.filter((a) => a.visitId || a.status === 'no_show');
  const shownUpcoming = showAll ? upcoming : upcoming.slice(0, UPCOMING_LIMIT);
  const hasRequests = requests.length > 0 && Boolean(onConfirmRequest && onDeclineRequest);
  const sectionCount = [hasRequests, inProgress.length > 0, upcoming.length > 0].filter(Boolean).length;

  const row = (a: Appointment, end: ReactNode, note?: string) => {
    const length = formatMinutes(appointmentMinutes(a, slotMinutes));
    return (
      <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onSelect(a)}>
          <span className="w-16 shrink-0 whitespace-nowrap text-[13px] tabular-nums text-[var(--muted)] sm:w-[4.5rem] sm:text-sm">{minutesLabel(minutesOfDay(a.scheduledAt))}</span>
          <span aria-hidden className="hidden h-2 w-2 shrink-0 rounded-full sm:block" style={{ background: colorFor(a) }} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-[var(--ink)]">{a.patientName}</span>
              {a.id === nextUpId && <Pill tone="teal">Next</Pill>}
            </span>
            <span className="flex items-center gap-1.5 truncate text-xs text-[var(--muted)] sm:hidden">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorFor(a) }} />
              {note ? `${note}, ` : ''}
              {length}
              {showTherapist ? `, ${therapistNameFor(a)}` : ''}
            </span>
          </span>
          {showTherapist && <span className="hidden w-36 shrink-0 truncate text-xs text-[var(--muted)] sm:block">{therapistNameFor(a)}</span>}
          <span className="hidden w-14 shrink-0 text-xs text-[var(--muted)] sm:block">{length}</span>
        </button>
        <span className="shrink-0">{end}</span>
      </li>
    );
  };
  const statusPill = (a: Appointment) =>
    a.visitId ? (
      <Pill tone="green">Visit logged</Pill>
    ) : (
      // "Confirmed" is the default state — on phones it gives its width to the name.
      <span className={a.status === 'confirmed' ? 'hidden sm:inline' : undefined}>
        <Pill tone={APPOINTMENT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</Pill>
      </span>
    );

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
                    }}
                    className="rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                  >
                    <span className="sm:hidden">Complete</span>
                    <span className="hidden sm:inline">Complete visit</span>
                  </Link>
                </span>,
                a.source === 'walk_in' ? 'Walk-in' : 'Arrived'
              )
            )}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-label="Upcoming">
          {sectionCount > 1 && <h3 className={sectionHeading}>Upcoming</h3>}
          <ul className={listCls}>{shownUpcoming.map((a) => row(a, statusPill(a)))}</ul>
          {upcoming.length > UPCOMING_LIMIT && (
            <button type="button" className="mt-2 min-h-9 text-sm font-medium text-[var(--teal)]" onClick={() => setShowAll((current) => !current)}>
              {showAll ? 'Show fewer' : `Show all ${upcoming.length} upcoming`}
            </button>
          )}
        </section>
      )}

      {upcoming.length === 0 && inProgress.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No more appointments today.</p>
      )}

      {done.length > 0 && (
        <details>
          <summary className="min-h-9 cursor-pointer text-sm text-[var(--muted)]">Done ({done.length})</summary>
          <ul className={`${listCls} mt-1`}>{done.map((a) => row(a, statusPill(a)))}</ul>
        </details>
      )}
    </div>
  );
}
