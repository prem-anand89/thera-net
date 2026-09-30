import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookSlotSheet, type BookedSlot } from '@/components/BookSlotSheet';
import { MiniCalendarStrip } from '@/components/MiniCalendarStrip';
import { ConfirmDialog, KebabMenu, SectionCard, btnPrimary, btnSecondary, inputCls, menuItem } from '@/components/ui';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { toFriendlyMessage } from '@/lib/errors';
import { repos, bookingService } from '@/services';
import {
  addDays,
  addWeeks,
  appointmentMinutes,
  filterHistory,
  formatMinutes,
  freeGaps,
  getWeekStart,
  groupClosedRanges,
  isClosedDay,
  minutesLabel,
  minutesOfDay,
  toLocalDateStr,
  weekDays,
  type ClosedRange,
} from '@/domain/schedule';
import {
  APPOINTMENT_BLOCK_STYLE,
  APPOINTMENT_STATUS_LABEL,
} from '@/domain/appointmentStatus';
import type { Appointment, UUID } from '@/domain/types';
import { AgendaList } from './schedule/AgendaList';
import { AppointmentDetailsPanel } from './schedule/AppointmentDetailsPanel';
import { ClosedDaysSheet } from './schedule/ClosedDaysSheet';
import { FindTimePanel } from './schedule/FindTimePanel';
import { ScheduleRail, rangeLabel } from './schedule/ScheduleRail';
import { ResourceDayGrid, WeekTimeGrid, type GridTherapist } from './schedule/TimeGrid';
import { UNASSIGNED_COLOR, therapistColor } from './schedule/scheduleColors';

type BookingView = 'schedule' | 'requests' | 'history';
type ScheduleMode = 'day' | 'week';
type ScheduleSearch = {
  tab?: 'feedback' | 'bookings';
  view?: BookingView;
  mode?: ScheduleMode;
  date?: string;
  /** Comma-separated therapist ids; empty = everyone. */
  therapist?: string;
};

type SheetState = {
  date?: string;
  time?: string;
  therapistId?: UUID;
  requestId?: UUID;
  patientName?: string;
  patientPhone?: string;
  requestNotes?: string;
  requestPreferredTimeText?: string;
  /** Snapshot taken when the sheet opens, so a sync mid-edit can't reset it. */
  reschedule?: Appointment;
};

function longDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function timeAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes || 1}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}

function dateForAppointment(appointment: Appointment) {
  return toLocalDateStr(new Date(appointment.scheduledAt));
}

/** Re-renders every minute so the "now" line and past-slot checks stay current. */
function useNowMinutes() {
  const read = () => {
    const now = new Date();
    return { today: toLocalDateStr(now), minutes: now.getHours() * 60 + now.getMinutes() };
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setNow(read()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, select, textarea, [contenteditable="true"], [role="dialog"]'));
}

export function ScheduleBookingsView() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const scope = useWorkspaceScope();
  const search = useSearch({ from: '/schedule' }) as ScheduleSearch;
  const now = useNowMinutes();
  const today = now.today;
  const view = search.view ?? 'schedule';
  const mode = search.mode ?? 'day';
  const date = search.date ?? today;
  const canManageAll = scope.isClinicWideView;
  const isTherapist = scope.role === 'therapist';
  const myTherapistId = scope.myTherapistId;
  const slotMinutes = clinic.slotDurationMinutes || 30;
  const hours = useMemo(
    () => ({ startHour: clinic.bookingStartHour ?? 9, endHour: clinic.bookingEndHour ?? 17 }),
    [clinic.bookingStartHour, clinic.bookingEndHour]
  );

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const allAppointments = useLiveQuery(() => repos.appointments.listByClinic(clinic.id), [clinic.id]);
  const requests = useLiveQuery(
    () => (canManageAll ? repos.appointmentRequests.listByClinic(clinic.id) : undefined),
    [canManageAll, clinic.id]
  );
  const closedDates = useLiveQuery(() => repos.clinicClosedDates.listByClinic(clinic.id), [clinic.id]);

  const roster = useMemo(
    () =>
      [...(therapists ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((therapist, index) => ({ id: therapist.id, name: therapist.name, color: therapistColor(index) })),
    [therapists]
  );
  const rosterById = useMemo(() => new Map(roster.map((t) => [t.id, t])), [roster]);
  const colorFor = useCallback(
    (appointment: Appointment) =>
      (appointment.therapistId && rosterById.get(appointment.therapistId)?.color) || UNASSIGNED_COLOR,
    [rosterById]
  );
  const therapistNameFor = useCallback(
    (appointment: Appointment) =>
      appointment.therapistId ? rosterById.get(appointment.therapistId)?.name ?? 'Former therapist' : 'Unassigned',
    [rosterById]
  );

  // A therapist only ever works with their own column.
  const selectedIds = useMemo(() => {
    if (isTherapist) return myTherapistId ? [myTherapistId] : [];
    return (search.therapist ?? '').split(',').filter((id) => rosterById.has(id));
  }, [isTherapist, myTherapistId, search.therapist, rosterById]);
  const visibleRoster = useMemo(
    () =>
      isTherapist
        ? roster.filter((t) => t.id === myTherapistId)
        : selectedIds.length
          ? roster.filter((t) => selectedIds.includes(t.id))
          : roster,
    [isTherapist, myTherapistId, selectedIds, roster]
  );
  const singleTherapist = visibleRoster.length === 1 ? visibleRoster[0] : null;

  const [showCancelled, setShowCancelled] = useState(false);
  const scopedAppointments = useMemo(() => {
    const rows = allAppointments ?? [];
    return isTherapist ? rows.filter((a) => myTherapistId && a.therapistId === myTherapistId) : rows;
  }, [allAppointments, isTherapist, myTherapistId]);
  const visibleAppointments = useMemo(
    () =>
      scopedAppointments.filter(
        (a) =>
          (showCancelled || a.status !== 'cancelled') &&
          (!selectedIds.length || (a.therapistId !== null && selectedIds.includes(a.therapistId)))
      ),
    [scopedAppointments, showCancelled, selectedIds]
  );
  const byDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of visibleAppointments) {
      const key = dateForAppointment(appointment);
      map.set(key, [...(map.get(key) ?? []), appointment]);
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return map;
  }, [visibleAppointments]);
  const dayAppointments = useMemo(() => byDate.get(date) ?? [], [byDate, date]);

  const closedFor = useCallback(
    (day: string) => isClosedDay(day, clinic.closedWeekdays, closedDates ?? []),
    [clinic.closedWeekdays, closedDates]
  );
  const closedToday = closedFor(date);
  const closures = useMemo(
    () => groupClosedRanges(closedDates ?? []).filter((range) => range.to >= today).slice(0, 8),
    [closedDates, today]
  );

  const summaryFor = useCallback(
    (therapistId: string) => {
      const rows = dayAppointments.filter(
        (a) => a.status !== 'cancelled' && (therapistId ? a.therapistId === therapistId : !a.therapistId || !rosterById.has(a.therapistId))
      );
      const minutes = rows.reduce((sum, a) => sum + appointmentMinutes(a, slotMinutes), 0);
      return rows.length ? `${rows.length} · ${formatMinutes(minutes)}` : 'Free';
    },
    [dayAppointments, rosterById, slotMinutes]
  );

  const gridTherapists: GridTherapist[] = useMemo(() => {
    const columns: GridTherapist[] = visibleRoster.map((t) => ({ id: t.id, name: t.name, color: t.color }));
    const orphaned = !selectedIds.length && dayAppointments.some((a) => !a.therapistId || !rosterById.has(a.therapistId));
    if (orphaned) columns.push({ id: '', name: 'Unassigned', color: UNASSIGNED_COLOR });
    return columns;
  }, [visibleRoster, selectedIds.length, dayAppointments, rosterById]);

  const pendingRequests = useMemo(
    () => (requests ?? []).filter((r) => r.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [requests]
  );

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findTime, setFindTime] = useState(false);
  const [closedSheetOpen, setClosedSheetOpen] = useState(false);
  const [removing, setRemoving] = useState<ClosedRange | null>(null);
  const [declining, setDeclining] = useState<{ id: UUID; name: string } | null>(null);
  const [historyFrom, setHistoryFrom] = useState(() => addDays(today, -30));
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyTherapist, setHistoryTherapist] = useState('');
  const [confirmed, setConfirmed] = useState<BookedSlot | null>(null);
  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => setConfirmed(null), 15_000);
    return () => clearTimeout(timer);
  }, [confirmed]);

  const selectedAppointment = selectedId ? scopedAppointments.find((a) => a.id === selectedId) ?? null : null;

  const setSchedule = useCallback(
    (next: Partial<ScheduleSearch>) => {
      void navigate({
        to: '/schedule',
        replace: true,
        search: {
          tab: 'bookings',
          view,
          mode,
          date,
          ...(search.therapist ? { therapist: search.therapist } : {}),
          ...next,
        },
      });
    },
    [navigate, view, mode, date, search.therapist]
  );

  const step = useCallback(
    (direction: 1 | -1) => setSchedule({ date: mode === 'day' ? addDays(date, direction) : addWeeks(date, direction) }),
    [setSchedule, mode, date]
  );

  function setTherapists(ids: string[]) {
    setSchedule({ therapist: ids.length && ids.length < roster.length ? ids.join(',') : undefined });
  }
  function toggleTherapist(id: UUID) {
    const current = selectedIds.length ? selectedIds : roster.map((t) => t.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setTherapists(next.length ? next : [id]);
  }

  function openBooking(input: SheetState = {}) {
    setConfirmed(null);
    setSelectedId(null);
    setSheet({
      date,
      ...(isTherapist && myTherapistId ? { therapistId: myTherapistId } : {}),
      ...(singleTherapist && !input.therapistId ? { therapistId: singleTherapist.id } : {}),
      ...input,
    });
  }

  const canManageAppointment = (appointment: Appointment) =>
    canManageAll || (Boolean(myTherapistId) && appointment.therapistId === myTherapistId);
  const canBookFor = (therapistId: string) => canManageAll || therapistId === myTherapistId;

  // Keyboard shortcuts (Google Calendar's): t today, d / w view, arrows move.
  useEffect(() => {
    if (view !== 'schedule') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (sheet || selectedId || closedSheetOpen) return;
      if (event.key === 't') setSchedule({ date: toLocalDateStr(new Date()) });
      else if (event.key === 'd') setSchedule({ mode: 'day' });
      else if (event.key === 'w') setSchedule({ mode: 'week' });
      else if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, sheet, selectedId, closedSheetOpen, setSchedule, step]);

  async function decline(requestId: UUID) {
    try {
      await bookingService.declineAppointmentRequest(requestId);
    } catch (error) {
      alert(toFriendlyMessage(error));
    }
  }

  const dayState = useCallback(
    (day: string) => {
      const closed = closedFor(day);
      if (closed.closed || day < today) return { closed, hasFreeTime: false };
      const list = byDate.get(day) ?? [];
      const notBefore = day === today ? now.minutes : undefined;
      const hasFreeTime = visibleRoster.some(
        (t) => freeGaps(list, t.id, day, hours, slotMinutes, { notBefore }).length > 0
      );
      return { closed, hasFreeTime };
    },
    [closedFor, today, byDate, now.minutes, visibleRoster, hours, slotMinutes]
  );

  if (scope.role === 'unknown') {
    return <p className="py-10 text-center text-sm text-[var(--muted)]">Loading schedule…</p>;
  }
  if (isTherapist && scope.isUnlinkedTherapist) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
        Your login isn't linked to a therapist on the team yet. Ask your clinic admin to link it in
        Settings → Team, then your schedule will appear here.
      </p>
    );
  }

  const views: [BookingView, string][] = canManageAll
    ? [['schedule', 'Schedule'], ['requests', `Requests${pendingRequests.length ? ` (${pendingRequests.length})` : ''}`], ['history', 'History']]
    : [['schedule', 'My schedule'], ['history', 'History']];
  const activeView = !canManageAll && view === 'requests' ? 'schedule' : view;
  const dayNow = date === today ? now.minutes : null;
  const dayGaps = singleTherapist && !closedToday.closed && date >= today
    ? freeGaps(dayAppointments, singleTherapist.id, date, hours, slotMinutes, { notBefore: dayNow ?? undefined, alignToSlots: true })
    : [];
  const liveDay = dayAppointments.filter((a) => a.status !== 'cancelled');
  const upcoming = liveDay.filter((a) => (a.status === 'confirmed' || a.status === 'rescheduled') && (date > today || (date === today && minutesOfDay(a.scheduledAt) >= now.minutes))).length;
  const arrived = liveDay.filter((a) => a.status === 'arrived').length;
  const noShow = liveDay.filter((a) => a.status === 'no_show').length;
  const closureForDate = closures.find((range) => range.from <= date && range.to >= date)
    ?? groupClosedRanges(closedDates ?? []).find((range) => range.from <= date && range.to >= date);

  return (
    <div className="space-y-4 pb-20">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
        {/* Below desktop the week strip carries Today / previous / next, so the
            header doesn't repeat them. */}
        <div className="hidden items-center gap-1 desktop:flex">
          <button type="button" className={btnSecondary} onClick={() => setSchedule({ date: today })}>Today</button>
          <button type="button" className="min-h-11 min-w-11 rounded-lg text-lg text-[var(--teal)] hover:bg-[var(--paper)]" aria-label={mode === 'day' ? 'Previous day' : 'Previous week'} onClick={() => step(-1)}>‹</button>
          <button type="button" className="min-h-11 min-w-11 rounded-lg text-lg text-[var(--teal)] hover:bg-[var(--paper)]" aria-label={mode === 'day' ? 'Next day' : 'Next week'} onClick={() => step(1)}>›</button>
        </div>
        <h2 className="min-w-0 flex-1 truncate font-display text-base font-semibold text-[var(--ink)]">
          {mode === 'day' ? longDate(date) : `Week of ${longDate(getWeekStart(date))}`}
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5" role="group" aria-label="View">
            {(['day', 'week'] as const).map((candidate) => (
              <button key={candidate} type="button" aria-pressed={mode === candidate} onClick={() => setSchedule({ mode: candidate })} className={`min-h-9 rounded-md px-3 text-xs font-medium ${mode === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}>
                {candidate === 'day' ? 'Day' : 'Week'}
              </button>
            ))}
          </div>
          <button type="button" className={btnPrimary} onClick={() => openBooking()}>+ Book</button>
        </div>
      </header>

      <nav aria-label="Booking views" className="flex gap-4 border-b border-[var(--border)]">
        {views.map(([candidate, label]) => (
          <button key={candidate} type="button" onClick={() => setSchedule({ view: candidate })} className={`min-h-11 border-b-2 px-1 text-sm font-medium ${activeView === candidate ? 'border-[var(--teal)] text-[var(--teal)]' : 'border-transparent text-[var(--muted)]'}`}>
            {label}
          </button>
        ))}
      </nav>

      {activeView === 'schedule' && (
        <div className="desktop:grid desktop:grid-cols-[240px_minmax(0,1fr)] desktop:gap-6">
          <div className="hidden desktop:block">
            <ScheduleRail
              date={date}
              today={today}
              onSelectDate={(selected) => setSchedule({ date: selected })}
              dayState={dayState}
              therapists={roster.map((t) => ({ ...t, summary: summaryFor(t.id) }))}
              visibleIds={selectedIds}
              onToggleTherapist={toggleTherapist}
              onShowAll={() => setTherapists([])}
              showTherapistToggles={canManageAll && roster.length > 1}
              closures={closures}
              canEditClosures={canManageAll}
              onAddClosure={() => setClosedSheetOpen(true)}
              onRemoveClosure={setRemoving}
            />
          </div>

          <div className="min-w-0 space-y-3">
            <div className="desktop:hidden">
              <MiniCalendarStrip
                selectedDate={date}
                onSelectDate={(selected) => setSchedule({ date: selected })}
                appointmentDates={visibleAppointments.filter((a) => a.status !== 'cancelled').map(dateForAppointment)}
                closedFor={closedFor}
              />
            </div>

            {closedToday.closed && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--slate-light)] px-3 py-2 text-sm text-[var(--slate)]">
                <span>
                  <strong>Closed</strong>
                  {closedToday.kind === 'holiday'
                    ? `${closedToday.label ? ` — ${closedToday.label}` : ''}${closureForDate ? ` (${rangeLabel(closureForDate)})` : ''}`
                    : ' — weekly closed day'}
                  . Public booking is off for this day.
                </span>
                {canManageAll && closedToday.kind === 'holiday' && closureForDate && (
                  <button type="button" className="text-xs font-medium text-[var(--rust)] hover:underline" onClick={() => setRemoving(closureForDate)}>
                    Reopen
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {canManageAll && roster.length > 1 && (
                <div className="chip-row desktop:hidden">
                  <button type="button" className={`toggle-chip ${selectedIds.length === 0 ? 'on' : ''}`} onClick={() => setTherapists([])}>All</button>
                  {roster.map((t) => (
                    <button key={t.id} type="button" className={`toggle-chip ${selectedIds.length === 1 && selectedIds[0] === t.id ? 'on' : ''}`} onClick={() => setTherapists([t.id])}>
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: t.color }} aria-hidden />
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-[var(--muted)]">
                {mode === 'day'
                  ? liveDay.length
                    ? `${liveDay.length} appointment${liveDay.length === 1 ? '' : 's'}${upcoming ? ` · ${upcoming} upcoming` : ''}${arrived ? ` · ${arrived} arrived` : ''}${noShow ? ` · ${noShow} no-show` : ''}`
                    : 'No appointments'
                  : null}
              </p>
              <div className="ml-auto flex items-center gap-1">
                {mode === 'day' && (
                  <button type="button" className="min-h-11 px-2 text-sm font-medium text-[var(--teal)] tab:hidden" onClick={() => setFindTime((current) => !current)}>
                    {findTime ? 'Back to day' : 'Find a time'}
                  </button>
                )}
                <label className="hidden min-h-11 items-center gap-1.5 text-xs text-[var(--muted)] desktop:flex">
                  <input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} />
                  Show cancelled
                </label>
                {/* Below desktop, the secondary controls live in one menu. */}
                <div className="desktop:hidden">
                  <KebabMenu ariaLabel="More schedule options">
                    {(close) => (
                      <>
                        <button type="button" className={menuItem} onClick={() => { setShowCancelled((current) => !current); close(); }}>
                          {showCancelled ? 'Hide cancelled' : 'Show cancelled'}
                        </button>
                        {canManageAll && (
                          <button type="button" className={menuItem} onClick={() => { setClosedSheetOpen(true); close(); }}>
                            Set closed days
                          </button>
                        )}
                      </>
                    )}
                  </KebabMenu>
                </div>
              </div>
            </div>

            {mode === 'day' ? (
              <>
                <div className="hidden tab:block">
                  <ResourceDayGrid
                    date={date}
                    today={today}
                    nowMinutes={now.minutes}
                    therapists={gridTherapists}
                    appointments={dayAppointments}
                    hours={hours}
                    slotMinutes={slotMinutes}
                    closed={closedToday}
                    colorFor={colorFor}
                    selectedId={selectedId}
                    onSelect={(a) => setSelectedId(a.id)}
                    canBookFor={canBookFor}
                    onBook={({ time, therapistId }) => openBooking({ date, time, therapistId })}
                    summaryFor={summaryFor}
                  />
                </div>
                <div className="tab:hidden">
                  {findTime ? (
                    <FindTimePanel
                      date={date}
                      therapists={visibleRoster.filter((t) => canBookFor(t.id))}
                      appointments={dayAppointments}
                      hours={hours}
                      slotMinutes={slotMinutes}
                      closed={closedToday}
                      nowMinutes={dayNow}
                      onPick={({ therapistId, time }) => { setFindTime(false); openBooking({ date, time, therapistId }); }}
                    />
                  ) : dayAppointments.length === 0 && dayGaps.length === 0 ? (
                    <EmptyDay closed={closedToday.closed} onBook={() => openBooking({ date })} onFindTime={() => setFindTime(true)} />
                  ) : (
                    <AgendaList
                      appointments={dayAppointments}
                      slotMinutes={slotMinutes}
                      colorFor={colorFor}
                      therapistNameFor={therapistNameFor}
                      showTherapist={!singleTherapist}
                      gaps={dayGaps}
                      nowMinutes={dayNow}
                      onSelect={(a) => setSelectedId(a.id)}
                      onBookGap={singleTherapist && canBookFor(singleTherapist.id) ? (time) => openBooking({ date, time, therapistId: singleTherapist.id }) : undefined}
                    />
                  )}
                </div>
              </>
            ) : singleTherapist ? (
              <>
                <div className="hidden tab:block">
                  <WeekTimeGrid
                    days={weekDays(date)}
                    today={today}
                    nowMinutes={now.minutes}
                    appointments={visibleAppointments.filter((a) => a.therapistId === singleTherapist.id)}
                    hours={hours}
                    slotMinutes={slotMinutes}
                    closedFor={closedFor}
                    colorFor={colorFor}
                    selectedId={selectedId}
                    onSelect={(a) => setSelectedId(a.id)}
                    onBook={canBookFor(singleTherapist.id) ? ({ date: day, time }) => openBooking({ date: day, time, therapistId: singleTherapist.id }) : undefined}
                    onOpenDay={(day) => setSchedule({ date: day, mode: 'day' })}
                  />
                </div>
                <div className="tab:hidden">
                  <WeekBoard date={date} today={today} byDate={byDate} closedFor={closedFor} colorFor={colorFor} therapistNameFor={therapistNameFor} showTherapist={false} onOpenDay={(day) => setSchedule({ date: day, mode: 'day' })} />
                </div>
              </>
            ) : (
              <WeekBoard date={date} today={today} byDate={byDate} closedFor={closedFor} colorFor={colorFor} therapistNameFor={therapistNameFor} showTherapist onOpenDay={(day) => setSchedule({ date: day, mode: 'day' })} />
            )}
          </div>
        </div>
      )}

      {activeView === 'requests' && canManageAll && (
        <SectionCard title={`Pending requests (${pendingRequests.length})`}>
          {pendingRequests.length === 0 ? <p className="py-6 text-center text-sm text-[var(--muted)]">No pending booking requests.</p> : (
            <div className="space-y-3">
              {pendingRequests.map((request) => (
                <div key={request.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-[var(--ink)]">{request.name} <span className="text-xs font-normal text-[var(--muted)]">· {timeAgo(request.createdAt)}</span></p>
                      <p className="text-xs text-[var(--muted)]">
                        <a href={`tel:${request.phone}`} className="text-[var(--teal)] hover:underline">{request.phone}</a>
                        {request.preferredDate ? ` · Wants ${longDate(request.preferredDate)}${request.preferredTimeText ? ` at ${request.preferredTimeText}` : ''}` : ''}
                      </p>
                      {request.preferredTherapistId && <p className="mt-1 text-xs text-[var(--muted)]">Preferred: {rosterById.get(request.preferredTherapistId)?.name ?? 'Staff'}</p>}
                      {request.notes && <p className="mt-1 text-sm text-[var(--ink)]">{request.notes}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className={btnPrimary} onClick={() => openBooking({ date: request.preferredDate ?? date, requestId: request.id, patientName: request.name, patientPhone: request.phone, therapistId: request.preferredTherapistId ?? undefined, requestNotes: request.notes ?? undefined, requestPreferredTimeText: request.preferredTimeText ?? undefined })}>Confirm</button>
                      <button type="button" className={btnSecondary} onClick={() => setDeclining({ id: request.id, name: request.name })}>Decline</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {activeView === 'history' && (
        <HistorySurface
          appointments={scopedAppointments}
          therapists={canManageAll ? roster : []}
          slotMinutes={slotMinutes}
          colorFor={colorFor}
          therapistNameFor={therapistNameFor}
          from={historyFrom}
          query={historyQuery}
          status={historyStatus}
          therapistFilter={historyTherapist}
          onQueryChange={setHistoryQuery}
          onStatusChange={setHistoryStatus}
          onTherapistChange={setHistoryTherapist}
          onLoadMore={() => setHistoryFrom((current) => addDays(current, -30))}
          onSelect={(a) => setSelectedId(a.id)}
        />
      )}

      {confirmed && (
        <div role="status" className="fixed inset-x-4 bottom-20 z-20 flex items-center justify-between gap-3 rounded-xl border border-[var(--teal)] bg-[var(--surface)] p-3 shadow-lg sm:bottom-4 sm:left-auto sm:max-w-md">
          <p className="text-sm text-[var(--ink)]">
            <strong>{confirmed.patientName}</strong> {confirmed.kind === 'rescheduled' ? 'moved to' : 'booked for'}{' '}
            {new Date(confirmed.scheduledAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
          </p>
          <div className="flex items-center gap-2">
            {confirmed.patientPhone && (
              <button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={() => { void bookingService.shareBookingConfirmation(clinic.id, confirmed.patientName, confirmed.patientPhone, clinic.name, confirmed.scheduledAt).catch((e) => alert(toFriendlyMessage(e))); }}>
                WhatsApp
              </button>
            )}
            <button type="button" className="text-xs font-medium text-[var(--muted)]" onClick={() => setConfirmed(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <AppointmentDetailsPanel
        appointment={selectedAppointment}
        therapistName={selectedAppointment ? therapistNameFor(selectedAppointment) : ''}
        therapistColor={selectedAppointment ? colorFor(selectedAppointment) : UNASSIGNED_COLOR}
        slotMinutes={slotMinutes}
        canManage={selectedAppointment ? canManageAppointment(selectedAppointment) : false}
        onClose={() => setSelectedId(null)}
        onReschedule={(appointment) => {
          setSelectedId(null);
          setConfirmed(null);
          setSheet({ reschedule: appointment });
        }}
      />

      <BookSlotSheet
        isOpen={sheet !== null}
        onClose={() => setSheet(null)}
        appointments={allAppointments ?? []}
        prefilledDate={sheet?.date}
        prefilledTime={sheet?.time}
        prefilledTherapistId={sheet?.therapistId}
        prefilledPatientName={sheet?.patientName}
        prefilledPatientPhone={sheet?.patientPhone}
        requestId={sheet?.requestId}
        requestNotes={sheet?.requestNotes}
        requestPreferredTimeText={sheet?.requestPreferredTimeText}
        lockTherapist={isTherapist}
        rescheduleAppointment={sheet?.reschedule}
        onBooked={(result) => {
          setConfirmed(result);
          setSchedule({ view: 'schedule', date: toLocalDateStr(new Date(result.scheduledAt)) });
        }}
      />

      <ClosedDaysSheet open={closedSheetOpen} clinicId={clinic.id} initialDate={date < today ? today : date} onClose={() => setClosedSheetOpen(false)} />

      <ConfirmDialog
        open={declining !== null}
        title="Decline this request?"
        message={declining ? `${declining.name}'s request will be removed from the list. Let them know separately if needed.` : ''}
        confirmLabel="Decline"
        destructive
        onCancel={() => setDeclining(null)}
        onConfirm={() => {
          const request = declining;
          setDeclining(null);
          if (request) void decline(request.id);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Reopen these days?"
        message={removing ? `${removing.label ?? 'Closed'} · ${rangeLabel(removing)} will be bookable again, including on your public booking page.` : ''}
        confirmLabel="Reopen"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const range = removing;
          setRemoving(null);
          if (range) void bookingService.removeClosedDates(clinic.id, range.from, range.to).catch((e) => alert(toFriendlyMessage(e)));
        }}
      />
    </div>
  );
}

function EmptyDay({ closed, onBook, onFindTime }: { closed: boolean; onBook: () => void; onFindTime: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center">
      <p className="font-medium text-[var(--ink)]">{closed ? 'Clinic closed' : 'No bookings for this day'}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">{closed ? 'You can still book if you need to.' : 'Create a booking or check free times.'}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" className={btnPrimary} onClick={onBook}>New booking</button>
        {!closed && <button type="button" className={btnSecondary} onClick={onFindTime}>Find a time</button>}
      </div>
    </div>
  );
}

/** Seven compact day cards: phone week view, and the all-therapists week on tablet. */
function WeekBoard({
  date,
  today,
  byDate,
  closedFor,
  colorFor,
  therapistNameFor,
  showTherapist,
  onOpenDay,
}: {
  date: string;
  today: string;
  byDate: Map<string, Appointment[]>;
  closedFor: (date: string) => ReturnType<typeof isClosedDay>;
  colorFor: (appointment: Appointment) => string;
  therapistNameFor: (appointment: Appointment) => string;
  showTherapist: boolean;
  onOpenDay: (date: string) => void;
}) {
  return (
    <div className="grid gap-2 tab:grid-cols-7">
      {weekDays(date).map((day) => {
        const list = (byDate.get(day) ?? []).filter((a) => a.status !== 'cancelled');
        const closed = closedFor(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => onOpenDay(day)}
            className={`min-h-20 rounded-xl border p-3 text-left hover:border-[var(--teal)] ${day === today ? 'border-[var(--teal)]' : 'border-[var(--border)]'} ${closed.closed ? 'bg-[var(--slate-light)]' : 'bg-[var(--surface)]'}`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold ${day === today ? 'text-[var(--teal)]' : 'text-[var(--ink)]'}`}>
                {new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}
              </span>
              <span className="text-xs text-[var(--muted)]">{closed.closed ? closed.label ?? 'Closed' : list.length || ''}</span>
            </div>
            {list.slice(0, 4).map((appointment) => (
              <p key={appointment.id} className="mt-1 flex items-center gap-1 truncate text-xs text-[var(--muted)]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(appointment) }} aria-hidden />
                <span className="truncate">
                  {minutesLabel(minutesOfDay(appointment.scheduledAt))} {appointment.patientName}
                  {showTherapist ? ` · ${therapistNameFor(appointment)}` : ''}
                </span>
              </p>
            ))}
            {list.length > 4 && <p className="mt-1 text-xs font-medium text-[var(--teal)]">+{list.length - 4} more</p>}
          </button>
        );
      })}
    </div>
  );
}

function HistorySurface({
  appointments,
  therapists,
  slotMinutes,
  colorFor,
  therapistNameFor,
  from,
  query,
  status,
  therapistFilter,
  onQueryChange,
  onStatusChange,
  onTherapistChange,
  onLoadMore,
  onSelect,
}: {
  appointments: Appointment[];
  /** Empty hides the therapist filter (therapist logins see only their own). */
  therapists: { id: UUID; name: string }[];
  slotMinutes: number;
  colorFor: (appointment: Appointment) => string;
  therapistNameFor: (appointment: Appointment) => string;
  from: string;
  query: string;
  status: string;
  therapistFilter: string;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onTherapistChange: (value: string) => void;
  onLoadMore: () => void;
  onSelect: (appointment: Appointment) => void;
}) {
  const rows = filterHistory(appointments, { from, query, status, therapistId: therapistFilter });
  const hasMore = appointments.some((a) => dateForAppointment(a) < from);
  return (
    <SectionCard title={`History (${rows.length})`}>
      <div className={`mb-4 grid gap-2 ${therapists.length ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <input className={inputCls} placeholder="Search name or phone" value={query} onChange={(event) => onQueryChange(event.target.value)} />
        <select className={inputCls} value={status} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="">All statuses</option>
          {(['confirmed', 'rescheduled', 'arrived', 'no_show', 'cancelled'] as const).map((candidate) => (
            <option key={candidate} value={candidate}>{APPOINTMENT_STATUS_LABEL[candidate]}</option>
          ))}
        </select>
        {therapists.length > 0 && (
          <select className={inputCls} value={therapistFilter} onChange={(event) => onTherapistChange(event.target.value)}>
            <option value="">All therapists</option>
            {therapists.map((therapist) => <option key={therapist.id} value={therapist.id}>{therapist.name}</option>)}
          </select>
        )}
      </div>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((appointment) => {
            const style = APPOINTMENT_BLOCK_STYLE[appointment.status];
            return (
              <li key={appointment.id}>
                <button
                  type="button"
                  onClick={() => onSelect(appointment)}
                  className={`flex w-full items-center gap-3 rounded-xl border-l-4 p-3 text-left ${style.fill}`}
                  style={{ borderLeftColor: colorFor(appointment) }}
                >
                  <span className="w-24 shrink-0 text-xs text-[var(--muted)]">
                    {new Date(appointment.scheduledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                    <br />
                    {minutesLabel(minutesOfDay(appointment.scheduledAt))} · {formatMinutes(appointmentMinutes(appointment, slotMinutes))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${style.text}`}>{appointment.patientName}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {therapistNameFor(appointment)} · {style.mark && <span aria-hidden>{style.mark} </span>}{APPOINTMENT_STATUS_LABEL[appointment.status]}
                    </span>
                  </span>
                  {appointment.patientId && (
                    <Link
                      to="/patients/$patientId"
                      params={{ patientId: appointment.patientId }}
                      onClick={(event) => event.stopPropagation()}
                      className="shrink-0 text-xs font-medium text-[var(--teal)] hover:underline"
                    >
                      Profile
                    </Link>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-[var(--muted)]">No appointments in this range.</p>
      )}
      {hasMore && <button type="button" className={`${btnSecondary} mt-4`} onClick={onLoadMore}>Load previous 30 days</button>}
    </SectionCard>
  );
}

