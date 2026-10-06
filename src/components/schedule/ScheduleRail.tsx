import { useMemo, useState, type ReactNode } from 'react';
import type { UUID } from '@/domain/types';

function therapistInitials(name: string) {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '';
}
import { addDays, toLocalDateStr, type ClosedDayInfo, type ClosedRange } from '@/domain/schedule';
import { IconChevronLeft, IconChevronRight } from '@/components/StatIcons';
import { LoadLine, type LoadSummary } from './LoadLine';

type RailTherapist = { id: UUID; name: string; color: string; summary: LoadSummary };
/** Per-day state for the mini month: closed, free time left, appointments booked. */
export type RailDayState = { closed: ClosedDayInfo; hasFreeTime: boolean; booked: number };

/** Rail sections sit on white cards so they read as panels on the paper page. */
const railCard = 'rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3';

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
  dayState: (date: string) => RailDayState;
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
    <aside className="space-y-3" aria-label="Calendar sidebar">
      <MiniMonth date={date} today={today} onSelectDate={onSelectDate} dayState={dayState} />
      {requests}

      {showTherapistToggles && (
        <section className={railCard}>
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
                  <label className="flex cursor-pointer items-start gap-3.5 rounded-xl px-2.5 py-2 hover:bg-[var(--paper)] transition-colors">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggleTherapist(therapist.id)}
                      className="sr-only"
                    />
                    
                    <div className="relative shrink-0 mt-0.5">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full border-[2px] bg-[var(--surface)] text-[13px] font-semibold transition-all ${
                          on ? 'text-[var(--ink)]' : 'border-transparent text-[var(--muted)] opacity-70 bg-[var(--paper)]'
                        }`}
                        style={on ? { borderColor: therapist.color } : {}}
                      >
                        {therapistInitials(therapist.name)}
                      </div>
                      
                      {on && (
                        <div
                          className="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full border-2 border-[var(--surface)] text-white"
                          style={{ backgroundColor: therapist.color }}
                        >
                          <svg viewBox="0 0 14 14" fill="none" className="h-2.5 w-2.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 7.5L5.5 10L11 4" />
                          </svg>
                        </div>
                      )}
                    </div>

                    <span className="min-w-0 flex-1 pt-0.5">
                      <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{therapist.name}</span>
                      <LoadLine summary={therapist.summary} color={therapist.color} />
                    </span>
                  </label>
                  <div className="absolute right-3 top-2.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    {onEditHours && (
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface)] text-[var(--muted)] shadow-sm hover:text-[var(--teal)] transition-colors border border-[var(--border)]"
                        onClick={() => onEditHours(therapist.id)}
                        aria-label={`Working hours for ${therapist.name}`}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                    )}
                    {onOnlyTherapist && (
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface)] text-[var(--muted)] shadow-sm hover:text-[var(--teal)] transition-colors border border-[var(--border)]"
                        onClick={() => onOnlyTherapist(therapist.id)}
                        aria-label={`Show only ${therapist.name}`}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={railCard}>
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
                <span className="h-3 w-3 shrink-0 rounded-sm border border-[var(--border)]" style={RAIL_CLOSED_STYLE} aria-hidden />
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
  dayState: (date: string) => RailDayState;
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
  const navButton = 'flex min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--teal)] hover:bg-[var(--teal-light)]';

  return (
    <section aria-label="Month" className={railCard}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className={navButton} aria-label="Previous month" onClick={() => shiftMonth(-1)}>
          <IconChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-display text-base font-semibold text-[var(--ink)]">{monthLabel}</span>
        <button type="button" className={navButton} aria-label="Next month" onClick={() => shiftMonth(1)}>
          <IconChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => (
          <span key={index} className={index >= 5 ? 'text-[var(--muted)]/60' : 'text-[var(--muted)]'}>
            {label}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5">
        {cells.map((cell) => {
          const inMonth = cell.startsWith(cursor);
          const selected = cell === date;
          const isToday = cell === today;
          const state = dayState(cell);
          const closed = state.closed.closed;
          const free = state.hasFreeTime && !closed && cell >= today;
          // Most working days have free time, so flag the exception: a day
          // with bookings and nothing left (a day off has no bookings).
          const full = inMonth && !closed && cell >= today && !state.hasFreeTime && state.booked > 0;
          const dots = !inMonth || closed ? 0 : loadDots(state.booked);
          const text = selected
            ? 'bg-[var(--teal)] font-semibold text-white'
            : isToday
              ? 'font-bold text-[var(--teal)] ring-2 ring-inset ring-[var(--teal)] hover:bg-[var(--teal-light)]'
              : !inMonth
                ? 'text-[var(--muted)]/40 hover:bg-[var(--teal-light)]'
                : closed
                  ? 'text-[var(--slate)] hover:bg-[var(--teal-light)]'
                  : cell < today
                    ? 'text-[var(--muted)] hover:bg-[var(--teal-light)]'
                    : 'font-medium text-[var(--ink)] hover:bg-[var(--teal-light)]';
          const details = [
            closed ? 'closed' : null,
            state.booked ? `${state.booked} booked` : null,
            full ? 'fully booked' : free ? 'has free time' : null,
          ].filter(Boolean);
          return (
            <button
              key={cell}
              type="button"
              onClick={() => onSelectDate(cell)}
              aria-label={[cell, ...details].join(', ')}
              aria-current={selected ? 'date' : undefined}
              className={`relative flex h-9 flex-col items-center justify-center rounded-lg text-xs tabular-nums ${text}`}
              style={closed && !selected && inMonth ? RAIL_CLOSED_STYLE : undefined}
            >
              {Number(cell.slice(8))}
              <span className="flex h-1 gap-0.5" aria-hidden>
                {Array.from({ length: dots }, (_, index) => (
                  <span key={index} className={`h-1 w-1 rounded-full ${selected ? 'bg-white' : 'bg-[var(--teal)]'}`} />
                ))}
              </span>
              {full && (
                <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-[var(--rust)]'}`} aria-hidden />
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--muted)]">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--teal)]" aria-hidden /> Booked
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--rust)]" aria-hidden /> Full
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border border-[var(--border)]" style={RAIL_CLOSED_STYLE} aria-hidden /> Closed
        </span>
      </p>
    </section>
  );
}

/** Closed days in the mini month: a tighter, darker hatch than the grid's,
 *  so it still reads at 36px on a white card. */
const RAIL_CLOSED_STYLE = {
  backgroundColor: 'var(--paper)',
  backgroundImage: 'repeating-linear-gradient(135deg, var(--border) 0 1.5px, transparent 1.5px 5px)',
} as const;

/** Load dots under a day: 1–2 booked → 1, 3–5 → 2, 6+ → 3. */
export function loadDots(booked: number): number {
  if (booked <= 0) return 0;
  if (booked <= 2) return 1;
  if (booked <= 5) return 2;
  return 3;
}
