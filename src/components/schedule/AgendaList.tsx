import type { Appointment } from '@/domain/types';
import { APPOINTMENT_BLOCK_STYLE, APPOINTMENT_STATUS_LABEL } from '@/domain/appointmentStatus';
import {
  appointmentMinutes,
  formatMinutes,
  minutesLabel,
  minutesOfDay,
  minutesToTime,
  type Interval,
} from '@/domain/schedule';
import { appointmentFill } from './scheduleColors';
import { PatientFlagPills } from './PatientFlagPills';
import { appointmentReason, patientFlags, type PatientFlagContext } from '@/domain/patientFlags';

type Row =
  | { kind: 'appointment'; at: number; appointment: Appointment }
  | { kind: 'gap'; at: number; gap: Interval }
  | { kind: 'now'; at: number };

/**
 * Phone day view: time-ordered rows, a "now" divider, and — when a single
 * therapist is in view — free gaps inline so booking is one tap.
 */
export function AgendaList({
  appointments,
  slotMinutes,
  colorFor,
  therapistNameFor,
  showTherapist,
  gaps,
  nowMinutes,
  onSelect,
  onBookGap,
  highlightId,
  flagContext,
}: {
  appointments: Appointment[];
  slotMinutes: number;
  colorFor: (appointment: Appointment) => string;
  therapistNameFor: (appointment: Appointment) => string;
  showTherapist: boolean;
  /** Free intervals to list inline; empty when several therapists are shown. */
  gaps: Interval[];
  /** Minutes after midnight when the day is today, else null. */
  nowMinutes: number | null;
  onSelect: (appointment: Appointment) => void;
  onBookGap?: (time: string) => void;
  /** Marks one row as "Next up". */
  highlightId?: string | null;
  /** Patient flags + condition (`usePatientFlagContext`). */
  flagContext?: PatientFlagContext;
}) {
  let nowSortAt = nowMinutes;
  if (nowMinutes !== null) {
    let bestSortAt: number = nowMinutes;
    for (const appt of appointments) {
      const at = minutesOfDay(appt.scheduledAt);
      const end = at + appointmentMinutes(appt, slotMinutes);
      // If the appointment is currently ongoing, we want the "now" line to sit above it
      if (at <= nowMinutes && end > nowMinutes) {
        if (bestSortAt === nowMinutes || at < bestSortAt) {
          bestSortAt = at - 0.1;
        }
      }
    }
    for (const gap of gaps) {
      if (gap.start <= nowMinutes && gap.end > nowMinutes) {
        if (bestSortAt === nowMinutes || gap.start < bestSortAt) {
          bestSortAt = gap.start - 0.1;
        }
      }
    }
    nowSortAt = bestSortAt;
  }

  const rows: (Row & { sortAt: number })[] = [
    ...appointments.map((appointment) => {
      const at = minutesOfDay(appointment.scheduledAt);
      return {
        kind: 'appointment' as const,
        at,
        sortAt: at,
        appointment,
      };
    }),
    ...gaps.map((gap) => ({ kind: 'gap' as const, at: gap.start, sortAt: gap.start, gap })),
    ...(nowMinutes !== null && nowSortAt !== null ? [{ kind: 'now' as const, at: nowMinutes, sortAt: nowSortAt }] : []),
  ].sort((a, b) => a.sortAt - b.sortAt || (a.kind === 'now' ? -1 : b.kind === 'now' ? 1 : 0));

  return (
    <ol className="space-y-2">
      {rows.map((row) => {
        if (row.kind === 'now') {
          return (
            <li key="now" className="flex items-center gap-2 text-[11px] font-medium text-[var(--rust)]" aria-label="Now">
              <span className="h-2 w-2 rounded-full bg-[var(--rust)]" aria-hidden />
              <span className="h-px flex-1 bg-[var(--rust)]" aria-hidden />
              {minutesLabel(row.at)}
            </li>
          );
        }
        if (row.kind === 'gap') {
          return (
            <li key={`gap-${row.gap.start}`}>
              <button
                type="button"
                disabled={!onBookGap}
                onClick={() => onBookGap?.(minutesToTime(row.gap.start))}
                className="flex min-h-11 w-full items-center justify-between rounded-xl border border-dashed border-[var(--moss)]/40 bg-[var(--moss-light)]/50 px-3 text-left text-sm text-[var(--moss-strong)]"
              >
                <span>
                  {minutesLabel(row.gap.start)} · free {formatMinutes(row.gap.end - row.gap.start)}
                </span>
                {onBookGap && <span className="font-medium">+ Book</span>}
              </button>
            </li>
          );
        }
        const { appointment } = row;
        const style = APPOINTMENT_BLOCK_STYLE[appointment.status];
        const minutes = appointmentMinutes(appointment, slotMinutes);
        const color = colorFor(appointment);
        // Same colour code as the grid and Workspace's Today rows.
        const fill = appointmentFill(appointment, color);
        const flags = patientFlags(appointment, flagContext);
        const reason = appointmentReason(appointment, flagContext)?.text;
        return (
          <li key={appointment.id}>
            <button
              type="button"
              onClick={() => onSelect(appointment)}
              className={`flex w-full items-start gap-3 rounded-xl border border-[var(--border)] border-l-4 px-3 py-2.5 text-left ${highlightId === appointment.id ? 'ring-2 ring-[var(--teal)]' : ''}`}
              style={{ borderLeftColor: color, background: fill.background }}
            >
              <span className="w-16 shrink-0 whitespace-nowrap text-[13px] tabular-nums text-[var(--muted)]">
                {minutesLabel(row.at)}
                <span className="block text-[11px]">{minutes}m</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`truncate font-display text-sm font-medium ${style.text}`}>{appointment.patientName}</span>
                  {highlightId === appointment.id && (
                    <span className="shrink-0 rounded-full bg-[var(--teal)] px-1.5 text-[10px] font-medium leading-4 text-white">Next</span>
                  )}
                  <PatientFlagPills flags={flags} max={2} />
                </span>
                {reason && <span className="block truncate text-xs text-[var(--ink)]/80">{reason}</span>}
                <span className="block truncate text-xs text-[var(--muted)]">
                  {showTherapist && `${therapistNameFor(appointment)}, `}
                  {style.mark && <span aria-hidden>{style.mark} </span>}
                  {appointment.visitId ? 'Visit logged' : APPOINTMENT_STATUS_LABEL[appointment.status]}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
