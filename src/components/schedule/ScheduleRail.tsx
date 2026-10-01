import { useMemo, useState, type ReactNode } from 'react';
import type { UUID } from '@/domain/types';
import { addDays, toLocalDateStr, type ClosedDayInfo, type ClosedRange } from '@/domain/schedule';
import { CLOSED_HATCH_STYLE } from './scheduleColors';
import { LoadLine, type LoadSummary } from './LoadLine';

type RailTherapist = { id: UUID; name: string; color: string; summary: LoadSummary };

/**
 * Desktop left rail (Athena / Google Calendar): mini month, therapist
 * toggles with the day's load, and upcoming closures.
 */
export function ScheduleRail({
  date,
  today,
  onSelectDate,
  dayState,
  therapists,
  visibleIds,
  onToggleTherapist,
  onShowAll,
  showTherapistToggles,
  closures,
  canEditClosures,
  onAddClosure,
  onRemoveClosure,
  onOnlyTherapist,
  onEditHours,
  requests,
}: {
  date: string;
  today: string;
  onSelectDate: (date: string) => void;
  /** Per-day state for the mini month: free time left, closed, or neither. */
  dayState: (date: string) => { closed: ClosedDayInfo; hasFreeTime: boolean };
  therapists: RailTherapist[];
  /** Empty = everyone visible. */
  visibleIds: string[];
  onToggleTherapist: (id: UUID) => void;
  onShowAll: () => void;
  showTherapistToggles: boolean;
  closures: ClosedRange[];
  canEditClosures: boolean;
  onAddClosure: () => void;
  onRemoveClosure: (range: ClosedRange) => void;
  /** Shows only this therapist. */
  onOnlyTherapist?: (id: UUID) => void;
  /** Opens the working-hours editor (admin / front desk). */
  onEditHours?: (id: UUID) => void;
  /** Pending booking requests section (admin / front desk). */
  requests?: ReactNode;
}) {
  return (
    <aside className="space-y-5" aria-label="Calendar sidebar">
      <MiniMonth date={date} today={today} onSelectDate={onSelectDate} dayState={dayState} />
      {requests}

      {showTherapistToggles && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[var(--muted)]">Therapists</h3>
            {visibleIds.length > 0 && (
              <button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={onShowAll}>
                Show all
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {therapists.map((therapist) => {
              const on = visibleIds.length === 0 || visibleIds.includes(therapist.id);
              return (
                <li key={therapist.id} className="group relative">
                  <label className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--paper)]">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggleTherapist(therapist.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded"
                      style={{ accentColor: therapist.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--ink)]">{therapist.name}</span>
                      <LoadLine summary={therapist.summary} color={therapist.color} />
                    </span>
                  </label>
                  <span className="invisible absolute right-2 top-1.5 flex gap-1 rounded bg-[var(--paper)] group-hover:visible group-focus-within:visible">
                    {onEditHours && (
                      <button
                        type="button"
                        className="rounded px-1.5 text-[11px] font-medium text-[var(--teal)] hover:underline"
                        onClick={() => onEditHours(therapist.id)}
                        aria-label={`Working hours for ${therapist.name}`}
                      >
                        hours
                      </button>
                    )}
                    {onOnlyTherapist && (
                      <button
                        type="button"
                        className="rounded px-1.5 text-[11px] font-medium text-[var(--teal)] hover:underline"
                        onClick={() => onOnlyTherapist(therapist.id)}
                        aria-label={`Show only ${therapist.name}`}
                      >
                        only
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[var(--muted)]">Closed days</h3>
          {canEditClosures && (
            <button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={onAddClosure}>
              + Add
            </button>
          )}
        </div>
        {closures.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No upcoming closures.</p>
        ) : (
          <ul className="space-y-1">
            {closures.map((range) => (
              <li key={range.from} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={CLOSED_HATCH_STYLE} aria-hidden />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-[var(--ink)] hover:underline"
                  onClick={() => onSelectDate(range.from)}
                >
                  {range.label ?? 'Closed'} · {rangeLabel(range)}
                </button>
                {canEditClosures && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-[var(--rust)] hover:underline"
                    onClick={() => onRemoveClosure(range)}
                    aria-label={`Reopen ${range.label ?? 'closed days'} ${rangeLabel(range)}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

export function rangeLabel(range: ClosedRange): string {
  const fmt = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`;
}

function MiniMonth({
  date,
  today,
  onSelectDate,
  dayState,
}: {
  date: string;
  today: string;
  onSelectDate: (date: string) => void;
  dayState: (date: string) => { closed: ClosedDayInfo; hasFreeTime: boolean };
}) {
  const [cursor, setCursor] = useState(() => date.slice(0, 7));
  // Follow the selected date when it moves to another month.
  const [lastDate, setLastDate] = useState(date);
  if (lastDate !== date) {
    setLastDate(date);
    if (date.slice(0, 7) !== cursor) setCursor(date.slice(0, 7));
  }

  const cells = useMemo(() => {
    const first = `${cursor}-01`;
    const firstDay = new Date(`${first}T00:00:00`);
    const offset = (firstDay.getDay() + 6) % 7; // Monday first
    const start = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [cursor]);

  const monthLabel = new Date(`${cursor}-01T00:00:00`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
  const shiftMonth = (amount: number) => {
    const value = new Date(`${cursor}-01T00:00:00`);
    value.setMonth(value.getMonth() + amount);
    setCursor(toLocalDateStr(value).slice(0, 7));
  };

  return (
    <section aria-label="Month">
      <div className="mb-1 flex items-center justify-between">
        <button type="button" className="min-h-9 min-w-9 rounded-lg text-[var(--teal)] hover:bg-[var(--paper)]" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
          ‹
        </button>
        <span className="text-sm font-semibold text-[var(--ink)]">{monthLabel}</span>
        <button type="button" className="min-h-9 min-w-9 rounded-lg text-[var(--teal)] hover:bg-[var(--paper)]" aria-label="Next month" onClick={() => shiftMonth(1)}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium uppercase text-[var(--muted)]">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5">
        {cells.map((cell) => {
          const inMonth = cell.startsWith(cursor);
          const selected = cell === date;
          const isToday = cell === today;
          const state = dayState(cell);
          const free = state.hasFreeTime && !state.closed.closed && cell >= today;
          return (
            <button
              key={cell}
              type="button"
              onClick={() => onSelectDate(cell)}
              aria-label={`${cell}${state.closed.closed ? ', closed' : free ? ', has free time' : ''}`}
              aria-current={selected ? 'date' : undefined}
              className={`flex h-8 items-center justify-center rounded-full text-xs ${
                selected
                  ? 'bg-[var(--teal)] font-semibold text-white'
                  : isToday
                    ? 'font-semibold text-[var(--teal)] ring-1 ring-[var(--teal)]'
                    : free
                      ? 'bg-[var(--moss-light)] text-[var(--ink)]'
                      : inMonth
                        ? 'text-[var(--ink)] hover:bg-[var(--paper)]'
                        : 'text-[var(--muted)]/60'
              }`}
              style={state.closed.closed && !selected ? CLOSED_HATCH_STYLE : undefined}
            >
              {Number(cell.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex items-center gap-3 text-[10px] text-[var(--muted)]">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full border border-[var(--moss)]/40 bg-[var(--moss-light)]" aria-hidden /> Free time
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border border-[var(--border)]" style={CLOSED_HATCH_STYLE} aria-hidden /> Closed
        </span>
      </p>
    </section>
  );
}
