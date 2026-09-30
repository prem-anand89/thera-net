import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Appointment } from '@/domain/types';
import { minutesLabel, minutesOfDay } from '@/domain/schedule';
import { AgendaList } from './AgendaList';

const UPCOMING_LIMIT = 5;

/**
 * Workspace → Today → Appointments. Kept short so it never pushes the rest
 * of the page down: visits in progress first (arrived, service not added
 * yet), then the next few upcoming, and finished ones folded away.
 */
export function TodayAppointments({
  appointments,
  slotMinutes,
  nowMinutes,
  nextUpId,
  colorFor,
  therapistNameFor,
  showTherapist,
  onSelect,
}: {
  appointments: Appointment[];
  slotMinutes: number;
  nowMinutes: number;
  nextUpId: string | null;
  colorFor: (appointment: Appointment) => string;
  therapistNameFor: (appointment: Appointment) => string;
  showTherapist: boolean;
  onSelect: (appointment: Appointment) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const inProgress = appointments.filter((a) => a.status === 'arrived' && !a.visitId);
  const upcoming = appointments.filter((a) => a.status === 'confirmed' || a.status === 'rescheduled');
  const done = appointments.filter((a) => a.visitId || a.status === 'no_show');
  const shownUpcoming = showAll ? upcoming : upcoming.slice(0, UPCOMING_LIMIT);

  if (appointments.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No appointments today.</p>;
  }

  return (
    <div className="space-y-4">
      {inProgress.length > 0 && (
        <section aria-label="In progress">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--amber)]">
            In progress · add service &amp; payment
          </h3>
          <ul className="space-y-2">
            {inProgress.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-light)] p-3">
                <button type="button" className="min-w-0 text-left" onClick={() => onSelect(a)}>
                  <span className="block truncate font-medium text-[var(--ink)]">{a.patientName}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {a.source === 'walk_in' ? 'Walk-in' : 'Arrived'} · {minutesLabel(minutesOfDay(a.scheduledAt))}
                    {showTherapist ? ` · ${therapistNameFor(a)}` : ''}
                  </span>
                </button>
                <Link
                  to="/visits/new"
                  search={{
                    appointmentId: a.id,
                    prefillName: a.patientName,
                    prefillPhone: a.patientPhone,
                    ...(a.patientId ? { patientId: a.patientId } : {}),
                  }}
                  className="shrink-0 rounded-lg bg-[var(--teal)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                >
                  Complete visit
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-label="Upcoming">
          {inProgress.length > 0 && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Upcoming</h3>}
          <AgendaList
            appointments={shownUpcoming}
            slotMinutes={slotMinutes}
            colorFor={colorFor}
            therapistNameFor={therapistNameFor}
            showTherapist={showTherapist}
            gaps={[]}
            nowMinutes={nowMinutes}
            highlightId={nextUpId}
            onSelect={onSelect}
          />
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
        <details className="rounded-xl border border-[var(--border)] px-3 py-2">
          <summary className="min-h-9 cursor-pointer text-sm text-[var(--muted)]">Done ({done.length})</summary>
          <div className="mt-2">
            <AgendaList
              appointments={done}
              slotMinutes={slotMinutes}
              colorFor={colorFor}
              therapistNameFor={therapistNameFor}
              showTherapist={showTherapist}
              gaps={[]}
              nowMinutes={null}
              onSelect={onSelect}
            />
          </div>
        </details>
      )}
    </div>
  );
}
