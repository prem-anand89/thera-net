import type { Appointment } from '@/domain/types';
import { APPOINTMENT_BLOCK_STYLE, APPOINTMENT_STATUS_LABEL } from '@/domain/appointmentStatus';
import {
  appointmentMinutes,
  minutesLabel,
  minutesOfDay,
  minutesToTime,
  type Interval,
} from '@/domain/schedule';
import { appointmentFill } from './scheduleColors';
import { PatientFlagPills } from './PatientFlagPills';
import { appointmentReason, patientFlags, type PatientFlagContext } from '@/domain/patientFlags';

/**
 * Bookable start times inside a free gap, split by clock hour so each hour is one
 * compact row of time buttons (every slot that fits wholly inside the gap).
 */
export function gapHourRows(gap: Interval, slotMinutes: number): number[][] {
  const rows = new Map<number, number[]>();
  for (let at = gap.start; at + slotMinutes <= gap.end; at += slotMinutes) {
    const hour = Math.floor(at / 60);
    rows.set(hour, [...(rows.get(hour) ?? []), at]);
  }
  return [...rows.values()];
}

type Row =
  | { kind: 'appointment'; at: number; appointment: Appointment }
  | { kind: 'gap'; at: number; gap: Interval; therapistName?: string; therapistId?: string }
  | { kind: 'now'; at: number };

/**
 * Phone day view: time-ordered rows, a "now" divider, and free gaps inline so booking is one tap.
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
  isColleague,
}: {
  appointments: Appointment[];
  slotMinutes: number;
  colorFor: (appointment: Appointment) => string;
  therapistNameFor: (appointment: Appointment) => string;
  showTherapist: boolean;
  /** Free intervals to list inline. */
  gaps: (Interval & { therapistName?: string; therapistId?: string })[];
  /** Minutes after midnight when the day is today, else null. */
  nowMinutes: number | null;
  onSelect: (appointment: Appointment) => void;
  onBookGap?: (time: string, therapistId?: string) => void;
  /** Marks one row as "Next up". */
  highlightId?: string | null;
  /** Patient flags + condition (`usePatientFlagContext`). */
  flagContext?: PatientFlagContext;
  /** Returns true if an appointment is a colleague's appointment (read-only for therapists). */
  isColleague?: (appointment: Appointment) => boolean;
}) {
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
    ...gaps.map((gap) => ({ kind: 'gap' as const, at: gap.start, sortAt: gap.start, gap, therapistName: gap.therapistName, therapistId: gap.therapistId })),
    ...(nowMinutes !== null ? [{ kind: 'now' as const, at: nowMinutes, sortAt: nowMinutes }] : []),
  ].sort((a, b) => a.sortAt - b.sortAt || (a.kind === 'now' ? -1 : b.kind === 'now' ? 1 : 0));

  return (
    <ol className="space-y-2">
      {rows.map((row) => {
        if (row.kind === 'now') {
          return (
            <li key="now" className="flex items-center gap-2 py-1 text-[11px] font-medium text-[var(--rust)]" aria-label="Now">
              <span className="h-2 w-2 rounded-full bg-[var(--rust)]" aria-hidden />
              <span className="h-px flex-1 bg-[var(--rust)]" aria-hidden />
              <span>{minutesLabel(row.at)}</span>
            </li>
          );
        }
        if (row.kind === 'gap') {
          // Free time is just the bookable times themselves, one row per hour — no "free" label needed.
          return gapHourRows(row.gap, slotMinutes).map((starts) => (
            <li key={`gap-${starts[0]}-${row.therapistId ?? 'any'}`} className="flex flex-wrap gap-1.5 rounded-xl border border-dashed border-[var(--moss)]/40 bg-[var(--moss-light)]/40 px-2 py-1.5">
              {starts.map((at) => (
                <button
                  key={at}
                  type="button"
                  disabled={!onBookGap}
                  onClick={() => onBookGap?.(minutesToTime(at), row.therapistId)}
                  className="min-h-11 rounded-lg border border-[var(--moss)]/40 bg-[var(--surface)] px-3 text-sm font-medium text-[var(--moss-strong)]"
                  aria-label={`Book ${row.therapistName ? `${row.therapistName} ` : ''}at ${minutesLabel(at)}`}
                >
                  {minutesLabel(at)}
                </button>
              ))}
            </li>
          ));
        }
        const { appointment } = row;
        const style = APPOINTMENT_BLOCK_STYLE[appointment.status];
        const minutes = appointmentMinutes(appointment, slotMinutes);
        const color = colorFor(appointment);
        // Same colour code as the grid and Workspace's Today rows.
        const fill = appointmentFill(appointment, color);
        const isReadonly = isColleague ? isColleague(appointment) : false;
        const flags = isReadonly ? [] : patientFlags(appointment, flagContext);
        const reason = isReadonly ? undefined : appointmentReason(appointment, flagContext)?.text;
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
                  {isReadonly && (
                    <span className="shrink-0 text-[11px] font-normal text-[var(--muted)]">· view only</span>
                  )}
                  {highlightId === appointment.id && (
                    <span className="shrink-0 rounded-full bg-[var(--teal)] px-1.5 text-[10px] font-medium leading-4 text-white">Next</span>
                  )}
                  {flags.length > 0 && <PatientFlagPills flags={flags} max={2} />}
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
