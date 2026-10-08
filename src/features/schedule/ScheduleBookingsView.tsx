import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookSlotSheet, type BookedSlot } from '@/components/BookSlotSheet';
import { MiniCalendarStrip } from '@/components/MiniCalendarStrip';
import { ConfirmDialog, KebabMenu, Panel, btnPrimary, btnSecondary, menuItem } from '@/components/ui';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { toFriendlyMessage } from '@/lib/errors';
import { repos, bookingService } from '@/services';
import {
  addDays,
  addWeeks,
  appointmentMinutes,
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
  withinWorking,
  type ClosedRange,
  dayLoad,
} from '@/domain/schedule';
import type { Appointment, AppointmentRequest, UUID, WorkingHours } from '@/domain/types';
import { InstallAppBanner } from '@/components/InstallAppBanner';
import { StartVisitSheet } from '@/components/StartVisitSheet';
import { usePermissions } from '@/app/usePermissions';
import { ReminderSheet } from '@/components/schedule/ReminderSheet';
import { WorkingHoursSheet } from '@/components/schedule/WorkingHoursSheet';
import { RequestsInbox } from '@/components/schedule/RequestsInbox';
import { TherapistFilter } from '@/components/schedule/TherapistFilter';
import { HistoryView } from '@/components/schedule/HistoryView';
import { usePatientFlagContext } from '@/components/schedule/usePatientFlagContext';
import { appointmentReason, patientFlags } from '@/domain/patientFlags';
import { IconChevronLeft, IconChevronRight } from '@/components/StatIcons';
import { ScheduleTabs, type ScheduleTab } from './ScheduleTabs';
import { AgendaList } from '@/components/schedule/AgendaList';
import { AppointmentDetailsPanel } from '@/components/schedule/AppointmentDetailsPanel';
import { ClosedDaysSheet } from '@/components/schedule/ClosedDaysSheet';
import { FindTimePanel } from '@/components/schedule/FindTimePanel';
import { ScheduleRail, rangeLabel } from '@/components/schedule/ScheduleRail';
import { ResourceDayGrid, WeekTimeGrid, type GridDragOptions, type GridTherapist, type LoadSummary, type MoveTarget } from '@/components/schedule/TimeGrid';
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

/** "Thu, 1 Oct" — the phone toolbar has room for this, not the long form. */
const EMPTY_APPOINTMENTS: Appointment[] = [];

function shortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

// No display class here: callers pick `inline-flex` or `hidden tab:inline-flex`
// (a shared `inline-flex` used to override `hidden`, showing Reminders on phones).
const tabAction =
  'h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]';
const tabPrimary =
  'inline-flex h-9 items-center rounded-lg bg-[var(--teal)] px-3.5 text-sm font-medium text-white hover:bg-[var(--teal-strong)]';

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

export function ScheduleBookingsView({
  tabs,
}: {
  /** The page's tab row, rendered here so Reminders and + Book sit on its right. */
  tabs: { active: ScheduleTab; showFeedback: boolean; scheduleLabel: string };
}) {
  const clinic = useClinic();
  const navigate = useNavigate();
  const scope = useWorkspaceScope();
  const { canViewClinicalNotes } = usePermissions();
  const search = useSearch({ from: '/schedule' }) as ScheduleSearch;
  const now = useNowMinutes();
  const today = now.today;
  const view = search.view ?? 'schedule';
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
  const flagContext = usePatientFlagContext(clinic.id, allAppointments ?? EMPTY_APPOINTMENTS);
  const reasonFor = useCallback((appointment: Appointment) => appointmentReason(appointment, flagContext)?.text ?? null, [flagContext]);
  const requests = useLiveQuery(
    () => (canManageAll ? repos.appointmentRequests.listByClinic(clinic.id) : undefined),
    [canManageAll, clinic.id]
  );
  const closedDates = useLiveQuery(() => repos.clinicClosedDates.listByClinic(clinic.id), [clinic.id]);

  const roster = useMemo(
    () =>
      [...(therapists ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((therapist) => ({ id: therapist.id, name: therapist.name, active: therapist.active, phone: therapist.phone ?? null, workingHours: therapist.workingHours ?? null, color: therapistColor(therapist.id, therapist.color) })),
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

  const visibleRoster = useMemo(
    () =>
      isTherapist
        ? roster.filter((t) => t.id === myTherapistId)
        : selectedIds.length
          ? roster.filter((t) => selectedIds.includes(t.id) && (t.active !== false || dayAppointments.some((a) => a.therapistId === t.id)))
          : roster.filter((t) => t.active !== false || dayAppointments.some(a => a.therapistId === t.id)),
    [isTherapist, myTherapistId, selectedIds, roster, dayAppointments]
  );
  const singleTherapist = visibleRoster.length === 1 ? visibleRoster[0] : null;
  // Week is a real time grid only with one therapist in view (tab+); with
  // several it was a list of names the week strip already gives, so a
  // `mode=week` link falls back to Day.
  const weekAvailable = singleTherapist !== null;
  const mode = weekAvailable ? search.mode ?? 'day' : 'day';

  const closedFor = useCallback(
    (day: string) => isClosedDay(day, clinic.closedWeekdays, closedDates ?? []),
    [clinic.closedWeekdays, closedDates]
  );
  const closedToday = closedFor(date);
  const closures = useMemo(
    () => groupClosedRanges(closedDates ?? []).filter((range) => range.to >= today).slice(0, 8),
    [closedDates, today]
  );

  // Column headers + rail: how full each therapist's day is (capacity bar +
  // "3 booked, 4 slots free"). The unassigned column just counts.
  const summaryFor = useCallback(
    (therapistId: string): LoadSummary => {
      if (!therapistId) {
        const count = dayAppointments.filter((a) => a.status !== 'cancelled' && (!a.therapistId || !rosterById.has(a.therapistId))).length;
        return { text: count ? `${count} booked` : 'None', ratio: null };
      }
      const load = dayLoad(
        dayAppointments, therapistId, date, hours, slotMinutes, workingFor(therapistId, date),
        date === today ? now.minutes : undefined,
        closedFor(date).closed
      );
      return { text: load.text, ratio: load.ratio, tone: load.tone };
    },
    [dayAppointments, rosterById, slotMinutes, date, hours, workingFor, today, now.minutes, closedFor]
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
  const [pendingHoursSave, setPendingHoursSave] = useState<{
    therapistId: UUID;
    value: WorkingHours | null;
    count: number;
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null>(null);
  const handleHoursSave = useCallback(
    (value: WorkingHours | null) =>
      new Promise<void>((resolve, reject) => {
        const therapistId = hoursTherapistId;
        if (!therapistId) {
          reject(new Error('No therapist selected.'));
          return;
        }
        const todayIso = toLocalDateStr(new Date());
        const conflicts = (allAppointments ?? []).filter((a) => {
          if (a.therapistId !== therapistId || a.status === 'cancelled') return false;
          const apptDate = toLocalDateStr(new Date(a.scheduledAt));
          if (apptDate < todayIso) return false;
          const intervals = workingIntervals(value, apptDate, hours);
          return !withinWorking(intervals, minutesOfDay(a.scheduledAt), appointmentMinutes(a, slotMinutes));
        });
        if (conflicts.length === 0) {
          bookingService.setWorkingHours(therapistId, value).then(resolve, reject);
          return;
        }
        setPendingHoursSave({ therapistId, value, count: conflicts.length, resolve, reject });
      }),
    [hoursTherapistId, allAppointments, hours, slotMinutes]
  );
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
    // Everything Undo needs to put back exactly (canDrag only allows
    // confirmed / rescheduled, so the status narrows safely).
    const previous = {
      id: appointment.id,
      scheduledAt: appointment.scheduledAt,
      durationMinutes: appointmentMinutes(appointment, slotMinutes),
      therapistId: appointment.therapistId ?? null,
      status: appointment.status === 'rescheduled' ? ('rescheduled' as const) : ('confirmed' as const),
      rescheduleCount: appointment.rescheduleCount ?? 0,
      previousScheduledAt: appointment.previousScheduledAt ?? null,
    };
    const reassign = target.therapistId && target.therapistId !== appointment.therapistId ? target.therapistId : undefined;
    try {
      await bookingService.rescheduleAppointment(appointment.id, localDateTimeToIso(target.date, minutesToTime(target.start)), target.duration, reassign);
      const resized = target.start === minutesOfDay(appointment.scheduledAt) && target.date === dateForAppointment(appointment) && !reassign;
      setUndo({
        message: resized
          ? `${appointment.patientName} is now ${formatMinutes(target.duration)}.`
          : `${appointment.patientName} moved to ${minutesLabel(target.start)}${reassign ? ` with ${rosterById.get(reassign)?.name ?? 'another therapist'}` : ''}.`,
        run: () => bookingService.restoreAppointmentSlot(previous),
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
      else if (event.key === 'w' && weekAvailable) setSchedule({ mode: 'week' });
      else if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, sheet, selectedId, closedSheetOpen, reminderOpen, hoursTherapistId, setSchedule, step, weekAvailable]);

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
      const list = byDate.get(day) ?? [];
      const booked = list.filter((a) => a.status !== 'cancelled').length;
      if (closed.closed || day < today) return { closed, hasFreeTime: false, booked };
      const notBefore = day === today ? now.minutes : undefined;
      const hasFreeTime = visibleRoster.some(
        (t) => freeGaps(list, t.id, day, hours, slotMinutes, { notBefore, working: workingFor(t.id, day) }).length > 0
      );
      return { closed, hasFreeTime, booked };
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

  // Schedule / History tabs live in the page's one tab row (SchedulePage's
  // ScheduleTabs). Requests live in the inline inbox / "All requests" panel,
  // not a tab; ?view=requests (old links) opens that panel.
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
  const daySummary = liveDay.length
    ? [
        `${liveDay.length} booked`,
        upcoming ? `${upcoming} still to come` : '',
        arrived ? `${arrived} arrived` : '',
        noShow ? `${noShow} no-show` : '',
      ]
        .filter(Boolean)
        .join(', ')
    : 'Nothing booked yet';
  const closureForDate = closures.find((range) => range.from <= date && range.to >= date)
    ?? groupClosedRanges(closedDates ?? []).find((range) => range.from <= date && range.to >= date);

  return (
    <div className="space-y-4 pb-20">
      <ScheduleTabs
        {...tabs}
        actions={
          <>
            {isTherapist && myTherapistId && (
              <button type="button" className={`${tabAction} inline-flex`} onClick={() => setHoursTherapistId(myTherapistId)}>
                My hours
              </button>
            )}
            {canManageAll && (
              <button type="button" className={`${tabAction} hidden tab:inline-flex`} onClick={() => setReminderOpen(true)}>
                Reminders
              </button>
            )}
            <button type="button" className={tabPrimary} onClick={() => openBooking()}>+ Book</button>
          </>
        }
      />
      {shortcutsOpen && (
        <div role="note" className="flex items-start justify-between gap-3 rounded-lg bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">
          <span>
            <strong className="text-[var(--ink)]">Shortcuts:</strong> <kbd>t</kbd> today, <kbd>d</kbd> day, <kbd>w</kbd> week, <kbd>←</kbd> <kbd>→</kbd> previous and next, <kbd>Esc</kbd> close, <kbd>?</kbd> this help
          </span>
          <button type="button" className="font-medium text-[var(--teal)]" onClick={() => setShortcutsOpen(false)}>Close</button>
        </div>
      )}


      {activeView === 'schedule' && (
        <div className="desktop:grid desktop:grid-cols-[240px_minmax(0,1fr)] desktop:gap-6">
          <div className="hidden desktop:block">
            <ScheduleRail
              date={date}
              today={today}
              onSelectDate={(selected) => setSchedule({ date: selected })}
              dayState={dayState}
              therapists={roster.filter(t => t.active !== false).map((t) => ({ ...t, summary: summaryFor(t.id) }))}
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

            {/* One toolbar for the day: date as the headline with ‹ › and
                Today, a plain-language summary, then the view controls.
                Replaces the old header row and the chips/summary row. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <button type="button" className="hidden min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--teal)] hover:bg-[var(--paper)] tab:flex" aria-label={mode === 'day' ? 'Previous day' : 'Previous week'} onClick={() => step(-1)}>
                  <IconChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" className="hidden min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--teal)] hover:bg-[var(--paper)] tab:flex" aria-label={mode === 'day' ? 'Next day' : 'Next week'} onClick={() => step(1)}>
                  <IconChevronRight className="h-5 w-5" />
                </button>
                <div className="min-w-0 tab:ml-1">
                  <h2 className="flex items-baseline gap-2 truncate font-display text-lg font-semibold leading-tight text-[var(--ink)]">
                    {mode === 'day' ? (
                      <>
                        <span className="sm:hidden">{shortDate(date)}</span>
                        <span className="hidden sm:inline">{longDate(date)}</span>
                      </>
                    ) : (
                      `Week of ${shortDate(getWeekStart(date))}`
                    )}
                    {mode === 'day' && date === today && <span className="hidden font-sans text-xs font-medium text-[var(--teal)] sm:inline">Today</span>}
                  </h2>
                  {mode === 'day' && <p className="truncate text-xs text-[var(--muted)]">{daySummary}</p>}
                </div>
                {!(mode === 'day' ? date === today : getWeekStart(date) === getWeekStart(today)) && (
                  <button type="button" className="ml-1 min-h-9 shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]" onClick={() => setSchedule({ date: today })}>
                    Today
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canManageAll && roster.length > 1 && (
                  <div className="desktop:hidden">
                    <TherapistFilter therapists={roster.filter(t => t.active !== false)} visibleIds={selectedIds} onToggle={toggleTherapist} onShowAll={() => setTherapists([])} />
                  </div>
                )}
                {weekAvailable && (
                  <div className="hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 tab:flex" role="group" aria-label="View">
                    {(['day', 'week'] as const).map((candidate) => (
                      <button key={candidate} type="button" aria-pressed={mode === candidate} onClick={() => setSchedule({ mode: candidate })} className={`min-h-8 rounded-md px-3 text-xs font-medium ${mode === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}>
                        {candidate === 'day' ? 'Day' : 'Week'}
                      </button>
                    ))}
                  </div>
                )}
                <KebabMenu ariaLabel="More schedule options">
                  {(close) => (
                    <>
                      <button type="button" className={`${menuItem} tab:hidden`} onClick={() => { setFindTime((current) => !current); close(); }}>
                        {findTime ? 'Back to the day' : 'Find a time'}
                      </button>
                      <button type="button" className={menuItem} onClick={() => { setShowCancelled((current) => !current); close(); }}>
                        {showCancelled ? 'Hide cancelled' : 'Show cancelled'}
                      </button>
                      {canManageAll && (
                        <button type="button" className={`${menuItem} tab:hidden`} onClick={() => { setReminderOpen(true); close(); }}>
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
                            Working hours, {t.name}
                          </button>
                        ))}
                      <button type="button" className={`${menuItem} hidden pointer-fine:block`} onClick={() => { setShortcutsOpen(true); close(); }}>
                        Keyboard shortcuts
                      </button>
                    </>
                  )}
                </KebabMenu>
              </div>
            </div>

            <div className="desktop:hidden">
              <MiniCalendarStrip
                selectedDate={date}
                onSelectDate={(selected) => setSchedule({ date: selected })}
                appointmentDates={visibleAppointments.filter((a) => a.status !== 'cancelled').map(dateForAppointment)}
                closedFor={closedFor}
              />
            </div>

            {closedToday.closed && (
              <div className={`${dayAppointments.length === 0 && mode === 'day' ? 'hidden tab:flex' : 'flex'} flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--slate-light)] px-3 py-2 text-sm text-[var(--slate)]`}>
                <span>
                  <strong>
                    {closedToday.kind === 'holiday'
                      ? `Closed${closedToday.label ? ` for ${closedToday.label}` : ''}`
                      : `Closed every ${new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' })}`}
                  </strong>
                  {closedToday.kind === 'holiday' && closureForDate ? ` (${rangeLabel(closureForDate)})` : ''}. Public booking is off for this day.
                </span>
                {canManageAll && closedToday.kind === 'holiday' && closureForDate && (
                  <button type="button" className="text-xs font-medium text-[var(--rust)] hover:underline" onClick={() => setRemoving(closureForDate)}>
                    Reopen
                  </button>
                )}
              </div>
            )}

            {/* Phones always show the day (agenda); Week is tab+ only. */}
            <div className="hidden tab:block">
              {mode === 'week' && singleTherapist ? (
                <WeekTimeGrid
                  reasonFor={reasonFor}
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
              ) : (
                <ResourceDayGrid
                  reasonFor={reasonFor}
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
              )}
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
                <EmptyDay
                  closedTitle={
                    closedToday.closed
                      ? closedToday.kind === 'holiday'
                        ? `Closed${closedToday.label ? ` for ${closedToday.label}` : ''}`
                        : `Closed every ${new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' })}`
                      : null
                  }
                  onReopen={canManageAll && closedToday.kind === 'holiday' && closureForDate ? () => setRemoving(closureForDate) : undefined}
                  onBook={() => openBooking({ date })}
                  onFindTime={() => setFindTime(true)}
                />
              ) : (
                <AgendaList
                  flagContext={flagContext}
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
        <HistoryView
          appointments={scopedAppointments}
          therapists={canManageAll ? roster.filter(t => t.active !== false) : []}
          today={today}
          colorFor={colorFor}
          therapistNameFor={therapistNameFor}
          onSelect={(a) => setSelectedId(a.id)}
          flagContext={flagContext}
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
        returnTo="/schedule"
        appointment={selectedAppointment}
        therapistName={selectedAppointment ? therapistNameFor(selectedAppointment) : ''}
        therapistColor={selectedAppointment ? colorFor(selectedAppointment) : UNASSIGNED_COLOR}
        therapistPhone={selectedAppointment?.therapistId ? rosterById.get(selectedAppointment.therapistId)?.phone ?? null : null}
        attendance={selectedAttendance}
        requestNotes={selectedAppointment?.requestId ? requestById.get(selectedAppointment.requestId)?.notes ?? null : null}
        seriesLabel={seriesLabel}
        flags={selectedAppointment ? patientFlags(selectedAppointment, flagContext) : []}
        condition={selectedAppointment?.patientId ? flagContext?.conditionByPatient.get(selectedAppointment.patientId) ?? null : null}
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

      <StartVisitSheet open={startNoteFor !== null} appointment={startNoteFor} returnTo="/schedule" onClose={() => setStartNoteFor(null)} />

      <ReminderSheet
        open={reminderOpen}
        initialDate={addDays(today, 1)}
        clinicName={clinic.name}
        appointments={allAppointments ?? []}
        therapists={roster.filter(t => t.active !== false)}
        slotMinutes={slotMinutes}
        onClose={() => setReminderOpen(false)}
      />

      <WorkingHoursSheet
        open={hoursTherapistId !== null}
        therapistName={hoursTherapistId ? rosterById.get(hoursTherapistId)?.name ?? '' : ''}
        value={hoursTherapistId ? rosterById.get(hoursTherapistId)?.workingHours : null}
        clinic={{ ...hours, closedWeekdays: clinic.closedWeekdays }}
        onSave={handleHoursSave}
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
        open={pendingHoursSave !== null}
        title="Save these hours anyway?"
        message={
          pendingHoursSave
            ? `${pendingHoursSave.count} upcoming appointment${pendingHoursSave.count === 1 ? '' : 's'} fall outside these new hours. Save anyway?`
            : ''
        }
        confirmLabel="Save anyway"
        onCancel={() => {
          const pending = pendingHoursSave;
          setPendingHoursSave(null);
          pending?.reject(new Error('Not saved — adjust the hours or save again to confirm.'));
        }}
        onConfirm={() => {
          const pending = pendingHoursSave;
          setPendingHoursSave(null);
          if (pending) void bookingService.setWorkingHours(pending.therapistId, pending.value).then(pending.resolve, pending.reject);
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

/** Phone day view with nothing booked. On a closed day it is also the
 *  closed notice (the separate banner hides), so the two don't stack. */
function EmptyDay({
  closedTitle,
  onReopen,
  onBook,
  onFindTime,
}: {
  closedTitle: string | null;
  onReopen?: () => void;
  onBook: () => void;
  onFindTime: () => void;
}) {
  if (closedTitle) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--slate-light)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--ink)]">{closedTitle}</p>
          <p className="text-xs text-[var(--slate)]">
            Public booking is off. You can still book here.
            {onReopen && (
              <>
                {' '}
                <button type="button" className="font-medium text-[var(--rust)] underline" onClick={onReopen}>
                  Reopen
                </button>
              </>
            )}
          </p>
        </div>
        <button type="button" className={`${btnSecondary} shrink-0`} onClick={onBook}>Book</button>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center">
      <p className="font-medium text-[var(--ink)]">Nothing booked yet</p>
      <p className="mt-1 text-sm text-[var(--muted)]">Tap Find a time to see free slots, or book directly.</p>
      <div className="mt-3 flex justify-center gap-2">
        <button type="button" className={btnPrimary} onClick={onBook}>New booking</button>
        <button type="button" className={btnSecondary} onClick={onFindTime}>Find a time</button>
      </div>
    </div>
  );
}
