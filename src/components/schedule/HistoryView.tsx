import { useMemo, useState } from 'react';
import { Pill, chipSelect, chipSelectChevron as chevron } from '@/components/ui';
import { addDays, filterHistory, minutesLabel, minutesOfDay, toLocalDateStr } from '@/domain/schedule';
import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from '@/domain/appointmentStatus';
import { appointmentReason, patientFlags, type PatientFlagContext } from '@/domain/patientFlags';
import type { Appointment, AppointmentStatus, UUID } from '@/domain/types';
import { appointmentFill } from './scheduleColors';
import { PatientFlagPills } from './PatientFlagPills';

type When = 'past' | 'upcoming';
type Range = '7' | '30' | '90' | 'custom';
const PAGE = 50;

const RANGE_LABEL: Record<When, Record<Exclude<Range, 'custom'>, string>> = {
  past: { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' },
  upcoming: { '7': 'Next 7 days', '30': 'Next 30 days', '90': 'Next 90 days' },
};

const STATUSES: AppointmentStatus[] = ['arrived', 'no_show', 'cancelled', 'confirmed', 'rescheduled'];

function dayHeading(date: string, today: string) {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Schedule → History, built for phones first and kept to two control rows:
 * Past / Upcoming beside the search, then one row of pill filters (range,
 * status, therapist — native selects, so phones get their own picker) and
 * the past's tappable outcome counters, then the same divided, colour-coded
 * rows as Workspace's Today list.
 */
export function HistoryView({
  appointments,
  therapists,
  today,
  colorFor,
  therapistNameFor,
  onSelect,
  flagContext,
}: {
  appointments: Appointment[];
  /** Empty hides the therapist filter (therapist logins see only their own). */
  therapists: { id: UUID; name: string }[];
  today: string;
  colorFor: (appointment: Appointment) => string;
  therapistNameFor: (appointment: Appointment) => string;
  onSelect: (appointment: Appointment) => void;
  flagContext?: PatientFlagContext;
}) {
  const [when, setWhen] = useState<When>('past');
  const [range, setRange] = useState<Range>('30');
  const [customDate, setCustomDate] = useState(() => addDays(today, -60));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  const [therapistId, setTherapistId] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const bounds = useMemo(() => {
    if (when === 'past') {
      const from = range === 'custom' ? customDate : addDays(today, -Number(range));
      return { from, to: addDays(today, -1) };
    }
    const to = range === 'custom' ? customDate : addDays(today, Number(range));
    return { from: today, to };
  }, [when, range, customDate, today]);

  // Everything in range and matching search/therapist — counters come from
  // this, so they show what each status filter would give.
  const inRange = useMemo(
    () =>
      filterHistory(appointments, { from: bounds.from, query, status: '', therapistId }).filter(
        (a) => toLocalDateStr(new Date(a.scheduledAt)) <= bounds.to
      ),
    [appointments, bounds, query, therapistId]
  );
  const rows = useMemo(() => {
    const filtered = status ? inRange.filter((a) => a.status === status) : inRange;
    return when === 'past' ? filtered : [...filtered].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }, [inRange, status, when]);
  const counts = {
    arrived: inRange.filter((a) => a.status === 'arrived').length,
    no_show: inRange.filter((a) => a.status === 'no_show').length,
    cancelled: inRange.filter((a) => a.status === 'cancelled').length,
  };

  const shown = rows.slice(0, limit);
  const groups: { date: string; rows: Appointment[] }[] = [];
  for (const row of shown) {
    const key = toLocalDateStr(new Date(row.scheduledAt));
    const last = groups[groups.length - 1];
    if (last && last.date === key) last.rows.push(row);
    else groups.push({ date: key, rows: [row] });
  }

  const switchWhen = (next: When) => {
    setWhen(next);
    setStatus('');
    setLimit(PAGE);
    setCustomDate(next === 'past' ? addDays(today, -60) : addDays(today, 60));
  };

  // Outcome counters double as status filters; a zero one can't filter to
  // anything, so it's left out unless it's the active filter.
  const counters = (
    [
      ['arrived', `${counts.arrived} attended`, 'bg-[var(--moss-light)] text-[var(--moss-strong)]', counts.arrived],
      ['no_show', `${counts.no_show} no-show${counts.no_show === 1 ? '' : 's'}`, 'bg-[var(--rust-light)] text-[var(--rust)]', counts.no_show],
      ['cancelled', `${counts.cancelled} cancelled`, 'bg-[var(--slate-light)] text-[var(--slate)]', counts.cancelled],
    ] as const
  ).filter(([key, , , count]) => count > 0 || status === key);

  return (
    <div className="space-y-2.5">
      {/* Row 1: Past / Upcoming beside the search. */}
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5" role="tablist" aria-label="Past or upcoming">
          {(['past', 'upcoming'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={when === candidate}
              onClick={() => switchWhen(candidate)}
              className={`min-h-9 rounded-full px-3.5 text-sm font-medium ${when === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
            >
              {candidate === 'past' ? 'Past' : 'Upcoming'}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-base focus:border-[var(--teal)] focus:outline-none sm:max-w-sm sm:text-sm"
          placeholder="Name or phone"
          aria-label="Search name or phone"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE);
          }}
        />
      </div>

      {/* Row 2: range, status, therapist, then the outcome counters — one
          row that scrolls sideways on phones. */}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
        <select aria-label="Date range" className={chipSelect} style={chevron} value={range} onChange={(event) => setRange(event.target.value as Range)}>
          {(['7', '30', '90'] as const).map((key) => (
            <option key={key} value={key}>{RANGE_LABEL[when][key]}</option>
          ))}
          <option value="custom">{when === 'past' ? 'Since a date…' : 'Until a date…'}</option>
        </select>
        {range === 'custom' && (
          <input
            type="date"
            aria-label={when === 'past' ? 'Since' : 'Until'}
            className="min-h-9 shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--ink)]"
            value={customDate}
            max={when === 'past' ? today : undefined}
            min={when === 'upcoming' ? today : undefined}
            onChange={(event) => setCustomDate(event.target.value)}
          />
        )}
        <select aria-label="Status" className={chipSelect} style={chevron} value={status} onChange={(event) => setStatus(event.target.value as AppointmentStatus | '')}>
          <option value="">All statuses</option>
          {STATUSES.map((candidate) => (
            <option key={candidate} value={candidate}>{APPOINTMENT_STATUS_LABEL[candidate]}</option>
          ))}
        </select>
        {therapists.length > 0 && (
          <select aria-label="Therapist" className={chipSelect} style={chevron} value={therapistId} onChange={(event) => setTherapistId(event.target.value)}>
            <option value="">All therapists</option>
            {therapists.map((therapist) => (
              <option key={therapist.id} value={therapist.id}>{therapist.name}</option>
            ))}
          </select>
        )}
        {when === 'past' && counters.length > 0 && (
          <>
            <span className="h-5 w-px shrink-0 bg-[var(--border)]" aria-hidden />
            {counters.map(([key, label, tone]) => (
              <button
                key={key}
                type="button"
                aria-pressed={status === key}
                onClick={() => setStatus((current) => (current === key ? '' : key))}
                className={`min-h-9 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium ${tone} ${status === key ? 'ring-2 ring-[var(--teal)] ring-offset-1' : ''}`}
              >
                {label}
              </button>
            ))}
          </>
        )}
      </div>

      {groups.length ? (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          {groups.map((group) => (
            <section key={group.date} aria-label={dayHeading(group.date, today)}>
              <h3 className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--paper)] px-4 py-1.5 text-xs font-semibold text-[var(--ink)]">
                {dayHeading(group.date, today)}
                <span className="font-normal text-[var(--muted)]">{group.rows.length}</span>
              </h3>
              <ul className="divide-y divide-[var(--border)]">
                {group.rows.map((appointment) => {
                  const color = colorFor(appointment);
                  const fill = appointmentFill(appointment, color);
                  const reason = appointmentReason(appointment, flagContext)?.text;
                  const detail = [reason, therapists.length ? therapistNameFor(appointment) : null].filter(Boolean).join(', ');
                  return (
                    <li key={appointment.id} className="border-l-4" style={{ borderLeftColor: color, background: fill.background }}>
                      <button type="button" onClick={() => onSelect(appointment)} className="flex w-full items-center gap-3 py-2.5 pl-3 pr-4 text-left">
                        <span className="w-16 shrink-0 whitespace-nowrap text-[13px] tabular-nums text-[var(--muted)]">
                          {minutesLabel(minutesOfDay(appointment.scheduledAt))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className={`truncate font-display text-sm font-medium ${fill.kind === 'no_show' ? 'text-[var(--rust)]' : fill.kind === 'cancelled' ? 'text-[var(--muted)] line-through' : 'text-[var(--ink)]'}`}>
                              {appointment.patientName}
                            </span>
                            <PatientFlagPills flags={patientFlags(appointment, flagContext)} max={1} />
                          </span>
                          {detail && <span className="block truncate text-xs text-[var(--muted)]">{detail}</span>}
                        </span>
                        <span className="shrink-0">
                          {appointment.visitId ? (
                            <Pill tone="green">Visit logged</Pill>
                          ) : (
                            <Pill tone={APPOINTMENT_STATUS_TONE[appointment.status]}>{APPOINTMENT_STATUS_LABEL[appointment.status]}</Pill>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
          {query || status || therapistId ? 'No appointments match these filters.' : when === 'past' ? 'No past appointments in this range.' : 'Nothing booked in this range yet.'}
        </p>
      )}

      {rows.length > limit && (
        <button type="button" className="min-h-11 w-full rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--teal)] hover:bg-[var(--paper)]" onClick={() => setLimit((current) => current + PAGE)}>
          Show more ({rows.length - limit} left)
        </button>
      )}
    </div>
  );
}
