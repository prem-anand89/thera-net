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
}) {
  const rows: Row[] = [
    ...appointments.map((appointment) => ({
      kind: 'appointment' as const,
      at: minutesOfDay(appointment.scheduledAt),
      appointment,
    })),
    ...gaps.map((gap) => ({ kind: 'gap' as const, at: gap.start, gap })),
    ...(nowMinutes !== null ? [{ kind: 'now' as const, at: nowMinutes }] : []),
  ].sort((a, b) => a.at - b.at || (a.kind === 'now' ? -1 : b.kind === 'now' ? 1 : 0));

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
        return (
          <li key={appointment.id}>
            <button
              type="button"
              onClick={() => onSelect(appointment)}
              className={`flex w-full items-stretch gap-3 rounded-xl border-l-4 p-3 text-left ${style.fill}`}
              style={{ borderLeftColor: colorFor(appointment) }}
            >
              <span className="w-16 shrink-0 text-xs text-[var(--muted)]">
                {minutesLabel(row.at)}
                <br />
                {formatMinutes(minutes)}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-medium ${style.text}`}>{appointment.patientName}</span>
                <span className="block truncate text-xs text-[var(--muted)]">
                  {showTherapist && `${therapistNameFor(appointment)} · `}
                  {style.mark && <span aria-hidden>{style.mark} </span>}
                  {APPOINTMENT_STATUS_LABEL[appointment.status]}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
