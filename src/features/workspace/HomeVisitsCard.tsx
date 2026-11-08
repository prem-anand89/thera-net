import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Appointment, Patient } from '@/domain/types';
import { minutesLabel, minutesOfDay } from '@/domain/schedule';
import { SectionCard, Pill, pillSmAccent, pillSmNeutral, pillSmPrimary } from '@/components/ui';
import { CopyAddressButton } from '@/components/CopyAddressButton';

export interface HomeVisitsCardProps {
  appointments: Appointment[];
  patientsById?: ReadonlyMap<string, Patient>;
  therapistRoster?: ReadonlyMap<string, { name: string; color: string }>;
  showTherapist?: boolean;
  onSelect?: (appointment: Appointment) => void;
  onMarkArrived?: (appointment: Appointment) => void | Promise<unknown>;
  onUndoArrived?: (appointment: Appointment) => void | Promise<unknown>;
}

/**
 * Workspace → Home visits today: today's home care appointments in route/time order,
 * with patient address, Copy address button, Call link, and Arrived / Log visit actions.
 */
export function HomeVisitsCard({
  appointments,
  patientsById,
  therapistRoster,
  showTherapist,
  onSelect,
  onMarkArrived,
  onUndoArrived,
}: HomeVisitsCardProps) {
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());

  const sorted = useMemo(
    () => [...appointments].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [appointments]
  );

  const leftCount = useMemo(
    () =>
      sorted.filter(
        (a) =>
          a.status === 'confirmed' ||
          a.status === 'rescheduled' ||
          (a.status === 'arrived' && !a.visitId)
      ).length,
    [sorted]
  );

  const badge =
    leftCount > 0 ? (
      <Pill tone="teal">{leftCount} left</Pill>
    ) : sorted.length > 0 ? (
      <Pill tone="slate">All done</Pill>
    ) : (
      <Pill tone="slate">None today</Pill>
    );

  async function handleArrived(a: Appointment) {
    if (!onMarkArrived || busyIds.has(a.id)) return;
    setBusyIds((prev) => new Set(prev).add(a.id));
    try {
      await onMarkArrived(a);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  }

  async function handleUndo(a: Appointment) {
    if (!onUndoArrived || busyIds.has(a.id)) return;
    setBusyIds((prev) => new Set(prev).add(a.id));
    try {
      await onUndoArrived(a);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  }

  return (
    <SectionCard title="Home visits today" badge={badge}>
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No home visits scheduled today</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {sorted.map((a) => {
            const patient = a.patientId ? patientsById?.get(a.patientId) : undefined;
            const address = patient?.address?.trim() || null;
            const phone = a.patientPhone?.trim() || patient?.phone?.trim() || null;
            const isArrived = a.status === 'arrived' && !a.visitId;
            const isUpcoming = a.status === 'confirmed' || a.status === 'rescheduled';
            const isCompleted = Boolean(a.visitId);
            const isCancelled = a.status === 'cancelled';
            const timeStr = minutesLabel(minutesOfDay(a.scheduledAt));
            const therapistName = a.therapistId ? therapistRoster?.get(a.therapistId)?.name : null;

            return (
              <li
                key={a.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div
                  className={`min-w-0 flex-1 ${onSelect ? 'cursor-pointer' : ''}`}
                  onClick={() => onSelect?.(a)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-num text-xs font-semibold text-[var(--ink)] sm:text-sm">
                      {timeStr}
                    </span>
                    <h4 className="font-medium text-[var(--ink)] sm:text-sm">{a.patientName}</h4>
                    {showTherapist && therapistName && (
                      <span className="rounded-full bg-[var(--paper)] px-2 py-0.5 text-caption font-medium text-[var(--muted)]">
                        {therapistName}
                      </span>
                    )}
                    {a.status === 'rescheduled' && <Pill tone="amber">Rescheduled</Pill>}
                    {isCompleted && <Pill tone="slate">Completed</Pill>}
                    {isCancelled && <Pill tone="slate">Cancelled</Pill>}
                  </div>

                  {address && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                      <span className="truncate max-w-md">{address}</span>
                      <CopyAddressButton address={address} />
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          className="font-medium text-[var(--teal)] hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Call
                        </a>
                      )}
                    </div>
                  )}

                  {!address && phone && (
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span>{phone}</span>
                      <a
                        href={`tel:${phone}`}
                        className="font-medium text-[var(--teal)] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Call
                      </a>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                  {isUpcoming && onMarkArrived && (
                    <button
                      type="button"
                      className={pillSmAccent}
                      aria-label={`Mark ${a.patientName} arrived`}
                      disabled={busyIds.has(a.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleArrived(a);
                      }}
                    >
                      Arrived
                    </button>
                  )}

                  {isArrived && (
                    <>
                      {onUndoArrived && (
                        <button
                          type="button"
                          className={pillSmNeutral}
                          aria-label={`Undo arrived for ${a.patientName}`}
                          disabled={busyIds.has(a.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleUndo(a);
                          }}
                        >
                          Undo
                        </button>
                      )}
                      <Link
                        to="/visits/new"
                        search={{
                          appointmentId: a.id,
                          prefillName: a.patientName,
                          prefillPhone: a.patientPhone,
                          ...(a.patientId ? { patientId: a.patientId } : {}),
                          from: '/workspace',
                        }}
                        className={pillSmPrimary}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Log visit
                      </Link>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

