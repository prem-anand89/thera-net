import { useState } from 'react';
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

export type AgendaSection = { id: string; name: string; color: string; readOnly: boolean; summary?: string };

/** Bookable start times inside a free gap: every slot that fits wholly in it. */
export function gapStarts(gap: Interval, slotMinutes: number): number[] {
  const starts: number[] = [];
  for (let at = gap.start; at + slotMinutes <= gap.end; at += slotMinutes) starts.push(at);
  return starts;
}

const GAP_CHIPS = 4;

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
  sections,
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
  /** Two or more therapists in view: one section per therapist (colour dot, name, day summary). */
  sections?: AgendaSection[];
}) {
  const [expandedGaps, setExpandedGaps] = useState<Set<string>>(new Set());
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

  const renderRow = (row: (typeof rows)[number], grouped: boolean) => {

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
      const key = `gap-${row.gap.start}-${row.therapistId ?? 'any'}`;
      const starts = gapStarts(row.gap, slotMinutes);
      const expanded = expandedGaps.has(key);
      const shown = expanded ? starts : starts.slice(0, GAP_CHIPS);
      return (
        <li key={key} className="rounded-xl border border-dashed border-[var(--moss)]/40 bg-[var(--moss-light)]/50 px-3 py-2">
          <p className="text-sm text-[var(--moss-strong)]">
            {minutesLabel(row.gap.start)} – {minutesLabel(row.gap.end)} · {!grouped && row.therapistName ? `${row.therapistName} free ` : 'free '}
            {formatMinutes(row.gap.end - row.gap.start)}
          </p>
          {onBookGap && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {shown.map((at) => (
                <button
                  key={at}
                  type="button"
                  onClick={() => onBookGap(minutesToTime(at), row.therapistId)}
                  className="min-h-11 rounded-lg border border-[var(--moss)]/40 bg-[var(--surface)] px-3 text-sm font-medium text-[var(--moss-strong)]"
                  aria-label={`Book ${row.therapistName ? `${row.therapistName} ` : ''}at ${minutesLabel(at)}`}
                >
                  {minutesLabel(at)}
                </button>
              ))}
              {starts.length > GAP_CHIPS && (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedGaps((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  className="min-h-11 px-2 text-sm font-medium text-[var(--teal)]"
                >
                  {expanded ? 'Fewer' : `+${starts.length - GAP_CHIPS} more`}
                </button>
              )}
            </div>
          )}
        </li>
      );
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
              {isReadonly && !grouped && (
                <span className="shrink-0 text-[11px] font-normal text-[var(--muted)]">· view only</span>
              )}
              {highlightId === appointment.id && (
                <span className="shrink-0 rounded-full bg-[var(--teal)] px-1.5 text-[10px] font-medium leading-4 text-white">Next</span>
              )}
              {flags.length > 0 && <PatientFlagPills flags={flags} max={2} />}
            </span>
            {reason && <span className="block truncate text-xs text-[var(--ink)]/80">{reason}</span>}
            <span className="block truncate text-xs text-[var(--muted)]">
              {showTherapist && !grouped && `${therapistNameFor(appointment)}, `}
              {style.mark && <span aria-hidden>{style.mark} </span>}
              {appointment.visitId ? 'Visit logged' : APPOINTMENT_STATUS_LABEL[appointment.status]}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const grouped = Boolean(sections && sections.length > 1);
  if (!grouped) {
    return <ol className="space-y-2">{rows.map((row) => renderRow(row, false))}</ol>;
  }
  const known = new Set(sections!.map((section) => section.id));
  const idOf = (row: (typeof rows)[number]) =>
    row.kind === 'appointment' ? row.appointment.therapistId ?? '' : row.kind === 'gap' ? row.therapistId ?? '' : '';
  const unassigned = rows.some((row) => row.kind === 'appointment' && !known.has(idOf(row)));
  const allSections: AgendaSection[] = [
    ...sections!,
    ...(unassigned ? [{ id: '', name: 'Unassigned', color: '#8a8f98', readOnly: false }] : []),
  ];
  return (
    <div className="space-y-4">
      {allSections.map((section) => {
        const own = rows.filter((row) => row.kind !== 'now' && (section.id === '' ? !known.has(idOf(row)) : idOf(row) === section.id));
        const ordered: typeof rows = [...own, ...(nowMinutes !== null ? [{ kind: 'now' as const, at: nowMinutes, sortAt: nowMinutes }] : [])].sort(
          (a, b) => a.sortAt - b.sortAt || (a.kind === 'now' ? -1 : b.kind === 'now' ? 1 : 0)
        );
        return (
          <section key={section.id || 'unassigned'} aria-label={section.name}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: section.color }} aria-hidden />
              <span className="truncate">{section.name}</span>
              {section.readOnly && <span className="text-[11px] font-normal text-[var(--muted)]">· view only</span>}
              {section.summary && <span className="ml-auto shrink-0 text-xs font-normal text-[var(--muted)]">{section.summary}</span>}
            </h3>
            {own.length > 0 ? (
              <ol className="space-y-2">{ordered.map((row) => renderRow(row, true))}</ol>
            ) : (
              <p className="rounded-xl bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">Nothing booked</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
