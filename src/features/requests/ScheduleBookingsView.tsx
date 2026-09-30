import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookSlotSheet, type BookedSlot } from '@/components/BookSlotSheet';
import { MiniCalendarStrip } from '@/components/MiniCalendarStrip';
import { ConfirmDialog, KebabMenu, Panel, SectionCard, btnPrimary, btnSecondary, inputCls, menuItem } from '@/components/ui';
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
  localDateTimeToIso,
  minutesToTime,
  patientAttendance,
  workingIntervals,
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
import type { Appointment, AppointmentRequest, UUID } from '@/domain/types';
import { InstallAppBanner } from '@/components/InstallAppBanner';
import { StartVisitSheet } from '@/components/StartVisitSheet';
import { usePermissions } from '@/app/usePermissions';
import { ReminderSheet } from '@/components/schedule/ReminderSheet';
import { WorkingHoursSheet } from '@/components/schedule/WorkingHoursSheet';
import { RequestsInbox } from '@/components/schedule/RequestsInbox';
import { AgendaList } from '@/components/schedule/AgendaList';
import { AppointmentDetailsPanel } from '@/components/schedule/AppointmentDetailsPanel';
import { ClosedDaysSheet } from '@/components/schedule/ClosedDaysSheet';
import { FindTimePanel } from '@/components/schedule/FindTimePanel';
import { ScheduleRail, rangeLabel } from '@/components/schedule/ScheduleRail';
import { ResourceDayGrid, WeekTimeGrid, type GridDragOptions, type GridTherapist, type MoveTarget } from '@/components/schedule/TimeGrid';
import { UNASSIGNED_COLOR, therapistColor } from '@/components/schedule/scheduleColors';

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
  const { canViewClinicalNotes } = usePermissions();
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
        .map((therapist, index) => ({ id: therapist.id, name: therapist.name, phone: therapist.phone ?? null, workingHours: therapist.workingHours ?? null, color: therapistColor(index) })),
    [therapists]
  );
  const rosterById = useMemo(() => new Map(roster.map((t) => [t.id, t])), [roster]);
  const workingFor = useCallback(
    (therapistId: string, day: string) => workingIntervals(rosterById.get(therapistId)?.workingHours, day, hours),
    [rosterById, hours]
  );
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
  const requestById = useMemo(() => new Map((requests ?? []).map((r) => [r.id, r])), [requests]);

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findTime, setFindTime] = useState(false);
  const [closedSheetOpen, setClosedSheetOpen] = useState(false);
  const [removing, setRemoving] = useState<ClosedRange | null>(null);
  const [declining, setDeclining] = useState<{ id: UUID; name: string } | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [hoursTherapistId, setHoursTherapistId] = useState<UUID | null>(null);
  const [startNoteFor, setStartNoteFor] = useState<Appointment | null>(null);
  const [pendingMove, setPendingMove] = useState<{ appointment: Appointment; target: MoveTarget } | null>(null);
  const [undo, setUndo] = useState<{ message: string; run: () => Promise<void> } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(timer);
  }, [undo]);
  const [confirmed, setConfirmed] = useState<BookedSlot | null>(null);
  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => setConfirmed(null), 15_000);
    return () => clearTimeout(timer);
  }, [confirmed]);

  const selectedAppointment = selectedId ? scopedAppointments.find((a) => a.id === selectedId) ?? null : null;
  const seriesLabel = useMemo(() => {
    if (!selectedAppointment?.seriesId) return null;
    const members = (allAppointments ?? [])
      .filter((a) => a.seriesId === selectedAppointment.seriesId)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return `Session ${members.findIndex((a) => a.id === selectedAppointment.id) + 1} of ${members.length}`;
  }, [selectedAppointment, allAppointments]);
  const selectedAttendance = useMemo(
    () =>
      selectedAppointment
        ? patientAttendance(allAppointments ?? [], { patientId: selectedAppointment.patientId, phone: selectedAppointment.patientPhone }, new Date(), { excludeId: selectedAppointment.id })
        : null,
    [selectedAppointment, allAppointments]
  );

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

  function confirmRequest(request: AppointmentRequest) {
    openBooking({
      date: request.preferredDate && request.preferredDate >= today ? request.preferredDate : date,
      requestId: request.id,
      patientName: request.name,
      patientPhone: request.phone,
      therapistId: request.preferredTherapistId ?? undefined,
      requestNotes: request.notes ?? undefined,
      requestPreferredTimeText: request.preferredTimeText ?? undefined,
    });
  }

  const canManageAppointment = (appointment: Appointment) =>
    canManageAll || (Boolean(myTherapistId) && appointment.therapistId === myTherapistId);
  const canBookFor = (therapistId: string) => canManageAll || therapistId === myTherapistId;

  async function commitMove(appointment: Appointment, target: MoveTarget) {
    const previous = {
      at: appointment.scheduledAt,
      duration: appointmentMinutes(appointment, slotMinutes),
      therapistId: appointment.therapistId,
    };
    const reassign = target.therapistId && target.therapistId !== appointment.therapistId ? target.therapistId : undefined;
    try {
      await bookingService.rescheduleAppointment(appointment.id, localDateTimeToIso(target.date, minutesToTime(target.start)), target.duration, reassign);
      const resized = target.start === minutesOfDay(appointment.scheduledAt) && target.date === dateForAppointment(appointment) && !reassign;
      setUndo({
        message: resized
          ? `${appointment.patientName} is now ${formatMinutes(target.duration)}.`
          : `${appointment.patientName} moved to ${minutesLabel(target.start)}${reassign ? ` with ${rosterById.get(reassign)?.name ?? 'another therapist'}` : ''}.`,
        run: () =>
          bookingService.rescheduleAppointment(appointment.id, previous.at, previous.duration, reassign ? previous.therapistId ?? undefined : undefined),
      });
    } catch (error) {
      alert(toFriendlyMessage(error));
    }
  }

  const dragOptions: GridDragOptions = {
    canDrag: (appointment) =>
      (appointment.status === 'confirmed' || appointment.status === 'rescheduled') && canManageAppointment(appointment),
    onMove: (appointment, target) => {
      if (target.therapistId && target.therapistId !== appointment.therapistId) {
        if (!canManageAll) return;
        setPendingMove({ appointment, target });
      } else {
        void commitMove(appointment, target);
      }
    },
  };

  // Keyboard shortcuts (Google Calendar's): t today, d / w view, arrows move.
  useEffect(() => {
    if (view !== 'schedule') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (sheet || selectedId || closedSheetOpen || reminderOpen || hoursTherapistId) return;
      if (event.key === '?') {
        setShortcutsOpen((current) => !current);
        event.preventDefault();
        return;
      }
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
  }, [view, sheet, selectedId, closedSheetOpen, reminderOpen, hoursTherapistId, setSchedule, step]);

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
        (t) => freeGaps(list, t.id, day, hours, slotMinutes, { notBefore, working: workingFor(t.id, day) }).length > 0
      );
      return { closed, hasFreeTime };
    },
    [closedFor, today, byDate, now.minutes, visibleRoster, hours, slotMinutes, workingFor]
  );

  if (scope.role === 'unknown') {
    return <ScheduleSkeleton />;
  }
  if (isTherapist && scope.isUnlinkedTherapist) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
        Your login isn't linked to a therapist on the team yet. Ask your clinic admin to link it in
        Settings → Team, then your schedule will appear here.
      </p>
    );
  }

  // Requests live in the inline inbox / "All requests" panel, not a tab;
  // ?view=requests (old links, Workspace's banner) opens that panel.
  const views: [BookingView, string][] = [[
    'schedule', canManageAll ? 'Schedule' : 'My schedule'], ['history', 'History']];
  const activeView = view === 'requests' ? 'schedule' : view;
  const requestsPanelOpen = canManageAll && view === 'requests';
  const dayNow = date === today ? now.minutes : null;
  const dayGaps = singleTherapist && !closedToday.closed && date >= today
    ? freeGaps(dayAppointments, singleTherapist.id, date, hours, slotMinutes, { notBefore: dayNow ?? undefined, alignToSlots: true, working: workingFor(singleTherapist.id, date) })
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
          {canManageAll && (
            <button type="button" className={`${btnSecondary} hidden desktop:inline-flex desktop:items-center`} onClick={() => setReminderOpen(true)}>
              Reminders
            </button>
          )}
          <button
            type="button"
            className="hidden min-h-11 min-w-11 rounded-lg text-sm text-[var(--muted)] hover:bg-[var(--paper)] desktop:inline"
            aria-label="Keyboard shortcuts"
            aria-expanded={shortcutsOpen}
            onClick={() => setShortcutsOpen((current) => !current)}
          >
            ?
          </button>
          {isTherapist && myTherapistId && (
            <button type="button" className={btnSecondary} onClick={() => setHoursTherapistId(myTherapistId)}>
              My hours
            </button>
          )}
          <button type="button" className={btnPrimary} onClick={() => openBooking()}>+ Book</button>
        </div>
        {shortcutsOpen && (
          <div role="note" className="w-full rounded-lg bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">
            <strong className="text-[var(--ink)]">Shortcuts:</strong> <kbd>t</kbd> today · <kbd>d</kbd> day · <kbd>w</kbd> week · <kbd>←</kbd>/<kbd>→</kbd> previous/next · <kbd>Esc</kbd> close · <kbd>?</kbd> this help
          </div>
        )}
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
              onOnlyTherapist={(id) => setTherapists([id])}
              onEditHours={canManageAll ? (id) => setHoursTherapistId(id) : undefined}
              requests={
                canManageAll ? (
                  <RequestsInbox
                    variant="rail"
                    requests={pendingRequests}
                    therapistNameFor={(id) => (id ? rosterById.get(id)?.name ?? null : null)}
                    onConfirm={confirmRequest}
                    onDecline={(request) => setDeclining({ id: request.id, name: request.name })}
                    onSeeAll={() => setSchedule({ view: 'requests' })}
                    limit={3}
                  />
                ) : null
              }
            />
          </div>

          <div className="min-w-0 space-y-3">
            <InstallAppBanner message={isTherapist ? 'Open My schedule in one tap — add Thera.Net to your home screen.' : undefined} />
            {canManageAll && (
              <div className="desktop:hidden">
                <RequestsInbox
                  variant="strip"
                  requests={pendingRequests}
                  therapistNameFor={(id) => (id ? rosterById.get(id)?.name ?? null : null)}
                  onConfirm={confirmRequest}
                  onDecline={(request) => setDeclining({ id: request.id, name: request.name })}
                  onSeeAll={() => setSchedule({ view: 'requests' })}
                />
              </div>
            )}
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
                          <button type="button" className={menuItem} onClick={() => { setReminderOpen(true); close(); }}>
                            Send reminders
                          </button>
                        )}
                        {canManageAll && (
                          <button type="button" className={menuItem} onClick={() => { setClosedSheetOpen(true); close(); }}>
                            Set closed days
                          </button>
                        )}
                        {canManageAll &&
                          roster.map((t) => (
                            <button key={t.id} type="button" className={menuItem} onClick={() => { setHoursTherapistId(t.id); close(); }}>
                              Hours · {t.name}
                            </button>
                          ))}
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
                    workingFor={(therapistId) => workingFor(therapistId, date)}
                    drag={dragOptions}
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
                      workingFor={(therapistId) => workingFor(therapistId, date)}
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
                    workingFor={(day) => workingFor(singleTherapist.id, day)}
                    drag={dragOptions}
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

      <Panel open={requestsPanelOpen} onClose={() => setSchedule({ view: 'schedule' })} title={`Booking requests (${pendingRequests.length})`}>
        {pendingRequests.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">No pending booking requests.</p>
        ) : (
          <RequestsInbox
            variant="list"
            requests={pendingRequests}
            limit={pendingRequests.length}
            therapistNameFor={(id) => (id ? rosterById.get(id)?.name ?? null : null)}
            onConfirm={(request) => {
              setSchedule({ view: 'schedule' });
              confirmRequest(request);
            }}
            onDecline={(request) => setDeclining({ id: request.id, name: request.name })}
            onSeeAll={() => {}}
          />
        )}
      </Panel>

      {activeView === 'history' && (
        <HistorySurface
          appointments={scopedAppointments}
          therapists={canManageAll ? roster : []}
          today={today}
          slotMinutes={slotMinutes}
          colorFor={colorFor}
          therapistNameFor={therapistNameFor}
          onSelect={(a) => setSelectedId(a.id)}
        />
      )}

      {confirmed && (
        <div role="status" className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-[var(--teal)] bg-[var(--surface)] p-3 shadow-lg sm:bottom-4 sm:left-auto sm:max-w-md">
          <p className="text-sm text-[var(--ink)]">
            <strong>{confirmed.patientName}</strong>{' '}
            {confirmed.kind === 'rescheduled' ? 'moved to' : confirmed.sessions ? `— ${confirmed.sessions} sessions booked, first on` : 'booked for'}{' '}
            {new Date(confirmed.scheduledAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
          </p>
          <div className="flex items-center gap-2">
            {confirmed.patientPhone && (
              <button
                type="button"
                className="min-h-9 text-xs font-medium text-[var(--teal)]"
                onClick={() =>
                  bookingService.messagePatient(confirmed.kind, {
                    patientName: confirmed.patientName,
                    patientPhone: confirmed.patientPhone,
                    clinicName: clinic.name,
                    scheduledAt: confirmed.scheduledAt,
                    therapistName: rosterById.get(confirmed.therapistId)?.name,
                    sessions: confirmed.sessions,
                  })
                }
              >
                WhatsApp patient
              </button>
            )}
            {rosterById.get(confirmed.therapistId)?.phone && (
              <button
                type="button"
                className="min-h-9 text-xs font-medium text-[var(--teal)]"
                onClick={() =>
                  bookingService.messageTherapist(confirmed.kind, {
                    therapistName: rosterById.get(confirmed.therapistId)!.name,
                    therapistPhone: rosterById.get(confirmed.therapistId)!.phone,
                    patientName: confirmed.patientName,
                    scheduledAt: confirmed.scheduledAt,
                    sessions: confirmed.sessions,
                  })
                }
              >
                Notify therapist
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
        therapistPhone={selectedAppointment?.therapistId ? rosterById.get(selectedAppointment.therapistId)?.phone ?? null : null}
        attendance={selectedAttendance}
        requestNotes={selectedAppointment?.requestId ? requestById.get(selectedAppointment.requestId)?.notes ?? null : null}
        seriesLabel={seriesLabel}
        onCancelSeries={
          selectedAppointment?.seriesId
            ? (appointment) =>
                void bookingService
                  .cancelAppointmentSeries(appointment.seriesId!, appointment.scheduledAt)
                  .catch((error) => alert(toFriendlyMessage(error)))
            : undefined
        }
        slotMinutes={slotMinutes}
        canManage={selectedAppointment ? canManageAppointment(selectedAppointment) : false}
        onClose={() => setSelectedId(null)}
        onReschedule={(appointment) => {
          setSelectedId(null);
          setConfirmed(null);
          setSheet({ reschedule: appointment });
        }}
        onStartNote={
          clinic.clinicalDocsEnabled && canViewClinicalNotes
            ? (appointment) => {
                setSelectedId(null);
                setStartNoteFor(appointment);
              }
            : undefined
        }
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

      <StartVisitSheet open={startNoteFor !== null} appointment={startNoteFor} onClose={() => setStartNoteFor(null)} />

      <ReminderSheet
        open={reminderOpen}
        initialDate={addDays(today, 1)}
        clinicName={clinic.name}
        appointments={allAppointments ?? []}
        therapists={roster}
        slotMinutes={slotMinutes}
        onClose={() => setReminderOpen(false)}
      />

      <WorkingHoursSheet
        open={hoursTherapistId !== null}
        therapistName={hoursTherapistId ? rosterById.get(hoursTherapistId)?.name ?? '' : ''}
        value={hoursTherapistId ? rosterById.get(hoursTherapistId)?.workingHours : null}
        clinic={{ ...hours, closedWeekdays: clinic.closedWeekdays }}
        onSave={(value) => bookingService.setWorkingHours(hoursTherapistId!, value)}
        onClose={() => setHoursTherapistId(null)}
      />

      <ClosedDaysSheet open={closedSheetOpen} clinicId={clinic.id} initialDate={date < today ? today : date} onClose={() => setClosedSheetOpen(false)} />

      {undo && (
        <div role="status" className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-xl bg-[var(--ink)] p-3 text-sm text-white shadow-lg sm:bottom-4 sm:left-auto sm:max-w-md">
          <span>{undo.message}</span>
          <button
            type="button"
            className="min-h-9 shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--teal-light)]"
            onClick={() => {
              const action = undo;
              setUndo(null);
              void action.run().catch((error) => alert(toFriendlyMessage(error)));
            }}
          >
            Undo
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pendingMove !== null}
        title="Move to another therapist?"
        message={
          pendingMove
            ? `${pendingMove.appointment.patientName} → ${rosterById.get(pendingMove.target.therapistId ?? '')?.name ?? 'another therapist'}, ${longDate(pendingMove.target.date)} at ${minutesLabel(pendingMove.target.start)}.`
            : ''
        }
        confirmLabel="Move"
        onCancel={() => setPendingMove(null)}
        onConfirm={() => {
          const move = pendingMove;
          setPendingMove(null);
          if (move) void commitMove(move.appointment, move.target);
        }}
      />

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

function ScheduleSkeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading schedule">
      <div className="h-10 rounded-lg bg-[var(--border)]/60" />
      <div className="h-16 rounded-xl bg-[var(--border)]/50" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-14 rounded-xl bg-[var(--border)]/40" />
      ))}
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

/** Appointment history: Upcoming / Past, a date range, grouped by day, with outcome counts. */
function HistorySurface({
  appointments,
  therapists,
  today,
  slotMinutes,
  colorFor,
  therapistNameFor,
  onSelect,
}: {
  appointments: Appointment[];
  /** Empty hides the therapist filter (therapist logins see only their own). */
  therapists: { id: UUID; name: string }[];
  today: string;
  slotMinutes: number;
  colorFor: (appointment: Appointment) => string;
  therapistNameFor: (appointment: Appointment) => string;
  onSelect: (appointment: Appointment) => void;
}) {
  const [when, setWhen] = useState<'past' | 'upcoming'>('past');
  const [from, setFrom] = useState(() => addDays(today, -30));
  const [to, setTo] = useState(() => addDays(today, 30));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [therapistFilter, setTherapistFilter] = useState('');

  const noShowsByPatient = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      if (a.status !== 'no_show') continue;
      const key = a.patientId ?? a.patientPhone.replace(/\D/g, '').slice(-10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [appointments]);

  const range = when === 'past' ? { from, to: addDays(today, -1) } : { from: today, to };
  const rows = filterHistory(appointments, { from: range.from, query, status, therapistId: therapistFilter })
    .filter((a) => dateForAppointment(a) <= range.to)
    .sort((a, b) => (when === 'past' ? b.scheduledAt.localeCompare(a.scheduledAt) : a.scheduledAt.localeCompare(b.scheduledAt)));
  const groups: { date: string; rows: Appointment[] }[] = [];
  for (const row of rows) {
    const key = dateForAppointment(row);
    const last = groups[groups.length - 1];
    if (last && last.date === key) last.rows.push(row);
    else groups.push({ date: key, rows: [row] });
  }
  const counts = {
    attended: rows.filter((a) => a.status === 'arrived').length,
    noShow: rows.filter((a) => a.status === 'no_show').length,
    cancelled: rows.filter((a) => a.status === 'cancelled').length,
  };

  return (
    <SectionCard title="History">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[var(--border)] p-0.5" role="tablist" aria-label="Upcoming or past">
          {(['past', 'upcoming'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={when === candidate}
              onClick={() => setWhen(candidate)}
              className={`min-h-9 rounded-md px-3 text-xs font-medium ${when === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}
            >
              {candidate === 'past' ? 'Past' : 'Upcoming'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          {when === 'past' ? 'Since' : 'Until'}
          <input
            type="date"
            className={`${inputCls} w-auto py-1.5`}
            value={when === 'past' ? from : to}
            max={when === 'past' ? today : undefined}
            min={when === 'upcoming' ? today : undefined}
            onChange={(event) => (when === 'past' ? setFrom(event.target.value) : setTo(event.target.value))}
          />
        </label>
      </div>
      <div className={`mb-3 grid gap-2 ${therapists.length ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <input className={inputCls} placeholder="Search name or phone" aria-label="Search name or phone" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className={inputCls} aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {(['confirmed', 'rescheduled', 'arrived', 'no_show', 'cancelled'] as const).map((candidate) => (
            <option key={candidate} value={candidate}>{APPOINTMENT_STATUS_LABEL[candidate]}</option>
          ))}
        </select>
        {therapists.length > 0 && (
          <select className={inputCls} aria-label="Therapist" value={therapistFilter} onChange={(event) => setTherapistFilter(event.target.value)}>
            <option value="">All therapists</option>
            {therapists.map((therapist) => <option key={therapist.id} value={therapist.id}>{therapist.name}</option>)}
          </select>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--muted)]">
        {rows.length} appointment{rows.length === 1 ? '' : 's'}
        {when === 'past' && rows.length > 0 && ` · ${counts.attended} attended · ${counts.noShow} no-show · ${counts.cancelled} cancelled`}
      </p>
      {groups.length ? (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.date} aria-label={longDate(group.date)}>
              <h3 className="sticky top-0 mb-1.5 bg-[var(--surface)] py-1 text-xs font-semibold text-[var(--muted)]">
                {longDate(group.date)}
              </h3>
              <ul className="space-y-2">
                {group.rows.map((appointment) => {
                  const style = APPOINTMENT_BLOCK_STYLE[appointment.status];
                  const key = appointment.patientId ?? appointment.patientPhone.replace(/\D/g, '').slice(-10);
                  const noShows = noShowsByPatient.get(key) ?? 0;
                  return (
                    <li key={appointment.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(appointment)}
                        className={`flex w-full items-center gap-3 rounded-xl border-l-4 p-3 text-left ${style.fill}`}
                        style={{ borderLeftColor: colorFor(appointment) }}
                      >
                        <span className="w-16 shrink-0 text-xs text-[var(--muted)]">
                          {minutesLabel(minutesOfDay(appointment.scheduledAt))}
                          <br />
                          {formatMinutes(appointmentMinutes(appointment, slotMinutes))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-medium ${style.text}`}>
                            {appointment.patientName}
                            {noShows >= 2 && (
                              <span className="ml-1.5 rounded bg-[var(--rust-light)] px-1 text-[10px] font-medium text-[var(--rust)]" title={`${noShows} no-shows`}>
                                {noShows} no-shows
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-[var(--muted)]">
                            {therapistNameFor(appointment)} · {style.mark && <span aria-hidden>{style.mark} </span>}{APPOINTMENT_STATUS_LABEL[appointment.status]}
                          </span>
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
        <p className="py-6 text-center text-sm text-[var(--muted)]">No appointments match.</p>
      )}
    </SectionCard>
  );
}
