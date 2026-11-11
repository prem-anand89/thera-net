import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Appointment, Patient } from '@/domain/types';
import { minutesLabel, minutesOfDay } from '@/domain/schedule';
import { SectionCard, Pill, TherapistPill, pillSmAccent, pillSmNeutral, pillSmPrimary } from '@/components/ui';
import { CopyAddressButton } from '@/components/CopyAddressButton';
import { buildWhatsAppSendUrl, telHref } from '@/lib/pdfShare';

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

  const gridCols = showTherapist
    ? 'tab:grid-cols-[4.25rem_8.5rem_minmax(0,1.2fr)_minmax(0,1.2fr)_7.5rem_10rem_7.5rem]'
    : 'tab:grid-cols-[4.25rem_9.5rem_minmax(0,1.2fr)_minmax(0,1.2fr)_8rem_7.5rem]';

  return (
    <SectionCard title="Home visits today" badge={badge}>
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No home visits scheduled today</p>
      ) : (
        <div className="-mx-5 overflow-x-auto overflow-y-visible">
          <div className="min-w-full">
            <div className={`hidden tab:grid ${gridCols} tab:items-center tab:gap-2.5 desktop:gap-4 px-4 tab:px-5 py-2.5 border-y border-[var(--border)] bg-[var(--paper)] text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]`}>
              <div>Time</div>
              <div>Patient</div>
              <div>Condition / Service</div>
              <div>Address</div>
              <div>Contact</div>
              {showTherapist && <div>Therapist</div>}
              <div className="text-right">Action</div>
            </div>
            <ul className="divide-y divide-[var(--border)] tab:border-b tab:border-[var(--border)]">
            {sorted.map((a, i) => {
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
                  className={`flex flex-col gap-1 py-2.5 px-4 tab:px-5 tab:py-3 tab:gap-2 tab:grid ${gridCols} tab:items-center tab:gap-2.5 desktop:gap-4 hover:bg-[var(--teal-light)] transition-colors ${
                    i % 2 === 1 ? 'tab:bg-[var(--paper)]' : 'tab:bg-[var(--surface)]'
                  }`}
                >
                  {/* Col 1: Time */}
                  <div className="hidden tab:block font-num text-sm font-semibold tabular-nums text-[var(--ink)]">
                    {timeStr}
                  </div>

                  {/* Col 2: Patient */}
                  <div
                    className={`min-w-0 ${onSelect ? 'cursor-pointer' : ''}`}
                    onClick={() => onSelect?.(a)}
                    {...(onSelect
                      ? {
                          role: 'button' as const,
                          tabIndex: 0,
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelect(a);
                            }
                          },
                        }
                      : {})}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="tab:hidden font-num text-[13px] font-semibold tabular-nums text-[var(--ink)]">{timeStr}</span>
                      <h4 className="font-display font-medium text-sm text-[var(--ink)] truncate">
                        {a.patientName}
                      </h4>
                      {showTherapist && therapistName && (
                        <span className="rounded-full bg-[var(--paper)] px-2 py-0.5 text-caption font-medium text-[var(--muted)] tab:hidden">
                          {therapistName}
                        </span>
                      )}
                      {a.status === 'rescheduled' && <Pill tone="amber">Rescheduled</Pill>}
                      {isCompleted && <Pill tone="slate">Completed</Pill>}
                      {isCancelled && <Pill tone="slate">Cancelled</Pill>}
                    </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                        {patient?.mrno && (
                          <span className="font-num truncate">
                            {patient.mrno}
                          </span>
                        )}
                        {patient?.primaryCondition && (
                          <span className="tab:hidden truncate">
                            · {patient.primaryCondition}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Col 3: Condition / Service (Desktop / Tablet) */}
                    <div className="hidden tab:block min-w-0 text-sm text-[var(--ink)]">
                      {patient?.primaryCondition ? (
                        <span className="truncate font-medium block">{patient.primaryCondition}</span>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </div>

                    {/* Col 4: Address */}
                    <div className="min-w-0 text-xs text-[var(--muted)]">
                      {address ? (
                        <div className="flex items-center gap-1.5 text-[var(--ink)]">
                          <span className="truncate text-sm tab:text-xs" title={address}>{address}</span>
                          <CopyAddressButton address={address} />
                        </div>
                      ) : (
                        <span className="hidden tab:inline">—</span>
                      )}
                    </div>

                    {/* Col 5: Contact */}
                    <div className="min-w-0 text-xs text-[var(--muted)]">
                      {phone ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0 tab:block">
                          <div className="font-num font-medium text-xs text-[var(--ink)]">
                            {phone}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] tab:mt-0.5">
                            <a
                              href={telHref(phone)}
                              className="font-medium text-[var(--teal)] hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Call
                            </a>
                            <span>·</span>
                            <a
                              href={buildWhatsAppSendUrl('', phone)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-[var(--moss)] hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              WhatsApp
                            </a>
                          </div>
                        </div>
                      ) : (
                        <span className="hidden tab:inline">—</span>
                      )}
                    </div>

                    {/* Col 6: Therapist */}
                    {showTherapist && (
                      <div className="hidden tab:block min-w-0 truncate">
                        {therapistName ? (
                          <TherapistPill>{therapistName}</TherapistPill>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </div>
                    )}

                    {/* Col 7: Action */}
                  <div className={`shrink-0 items-center gap-2 justify-end ${(isUpcoming && onMarkArrived) || isArrived ? 'flex' : 'hidden tab:flex'}`}>
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
          </div>
        </div>
      )}
    </SectionCard>
  );
}

