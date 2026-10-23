import { notify } from '@/lib/notify';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookSlotSheet, type BookedSlot } from '@/components/BookSlotSheet';
import { MiniCalendarStrip } from '@/components/MiniCalendarStrip';
import { ConfirmDialog, Panel } from '@/components/ui';
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
  slotHoursStatus,
  displayHoursFor,
  dateForAppointment,
  type SlotHoursStatus,
  type ClosedRange,
  dayLoad,
  startStepMinutes,
} from '@/domain/schedule';
import type { Appointment, AppointmentRequest, UUID, WorkingHours } from '@/domain/types';
import { InstallAppBanner } from '@/components/InstallAppBanner';
import { StartVisitSheet } from '@/components/StartVisitSheet';
import { usePermissions } from '@/app/usePermissions';
import { ReminderSheet } from '@/components/schedule/ReminderSheet';
import { WorkingHoursSheet } from '@/components/schedule/WorkingHoursSheet';
import { ShiftRequestSheet } from '@/components/schedule/ShiftRequestSheet';
import { AssignShiftSheet } from '@/components/schedule/AssignShiftSheet';
import { RequestsInbox } from '@/components/schedule/RequestsInbox';
import { TherapistFilter } from '@/components/schedule/TherapistFilter';
import { HistoryView } from '@/components/schedule/HistoryView';
import { usePatientFlagContext } from '@/components/schedule/usePatientFlagContext';
import { usePatientDirectory } from '@/components/usePatientDirectory';
import { appointmentsOutsideHours } from './hoursConflicts';
import {
  formatThreeDayTitle,
  historyAppointments,
  nextTherapistSearchParam,
  readStoredPhoneView,
  selectedTherapistIds,
  defaultTherapistSelection,
  readStoredTherapists,
  threeDayCountLabel,
  workingTodayIds,
  writeStoredTherapists,
  threeDayDates,
  toggleTherapistSelection,
  writeStoredPhoneView,
  type PhoneView,
} from './schedulePhoneHelpers';
import { useIsPhone } from './useIsPhone';
import { isActiveAppointmentStatus } from '@/domain/appointmentStatus';
import { appointmentReason, patientFlags } from '@/domain/patientFlags';
import { matchingWaitlistEntries, timeOfDayFor } from '@/domain/waitlistMatch';
import { ScheduleTabs, type ScheduleTab } from './ScheduleTabs';
import { AppointmentDetailsPanel } from '@/components/schedule/AppointmentDetailsPanel';
import { ClosedDaysSheet } from '@/components/schedule/ClosedDaysSheet';
import { AddToWaitlistSheet } from '@/components/schedule/AddToWaitlistSheet';
import { FindTimePanel } from '@/components/schedule/FindTimePanel';
import { MiniMonth, ScheduleRail, rangeLabel } from '@/components/schedule/ScheduleRail';
import { TherapistColorSheet } from '@/components/schedule/TherapistColorPicker';
import { ResourceDayGrid, WeekTimeGrid, type GridDragOptions, type GridTherapist, type LoadSummary, type MoveTarget } from '@/components/schedule/TimeGrid';
import { MobileDayGrid, MobileThreeDayGrid } from '@/components/schedule/MobileGrids';
import { ScheduleToolbar } from '@/components/schedule/ScheduleToolbar';
import { PhoneScheduleToolbar, PhoneStatusLine } from '@/components/schedule/PhoneScheduleToolbar';
import { BookFab } from '@/components/schedule/BookFab';
import { ScheduleMenu, type ScheduleMenuItem } from '@/components/schedule/ScheduleMenu';
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
  /** Opens this appointment's details on arrival (push notification links). */
  appointment?: string;
};

type SheetState = {
  date?: string;
  time?: string;
  therapistId?: UUID;
  /** Offer only these therapists (free at the tapped time in the multi-therapist week). */
  onlyTherapistIds?: UUID[];
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
  'h-9 items-center rounded-lg bg-[var(--teal)] px-3.5 text-sm font-medium text-white hover:bg-[var(--teal-strong)]';

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
  // Staff start times (Settings → "Start times every"); the slot length stays the default length.
  const stepMinutes = startStepMinutes(clinic);
  const hours = useMemo(
    () => ({ startHour: clinic.bookingStartHour ?? 9, endHour: clinic.bookingEndHour ?? 17 }),
    [clinic.bookingStartHour, clinic.bookingEndHour]
  );

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const allAppointments = useLiveQuery(() => repos.appointments.listByClinic(clinic.id), [clinic.id]);
  const flagContext = usePatientFlagContext(clinic.id, allAppointments ?? EMPTY_APPOINTMENTS);
  const { mrnoFor } = usePatientDirectory(clinic.id);
  const reasonFor = useCallback((appointment: Appointment) => appointmentReason(appointment, flagContext)?.text ?? null, [flagContext]);
  const requests = useLiveQuery(
    () => (canManageAll ? repos.appointmentRequests.listByClinic(clinic.id) : undefined),
    [canManageAll, clinic.id]
  );
  const closedDates = useLiveQuery(() => repos.clinicClosedDates.listByClinic(clinic.id), [clinic.id]);
  const shiftAssignments = useLiveQuery(
    () => (canManageAll ? repos.therapistShiftAssignments.listByClinic(clinic.id) : undefined),
    [canManageAll, clinic.id]
  );
  const pendingShiftRequestCount = useMemo(
    () => (shiftAssignments ?? []).filter((a) => a.status === 'pending').length,
    [shiftAssignments]
  );

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

  // Admin / front desk with no therapist in the link: their saved selection (else everyone), minus
  // anyone off that day, in Day only. Display-only — it never writes the URL, so there is no history
  // entry. "Show" (or "Show all") lifts it for this session without touching the saved selection.
  const [showOffToday, setShowOffToday] = useState(false);
  const implicitSelection = useMemo(() => {
    if (!canManageAll || isTherapist || search.therapist || (search.mode ?? 'day') !== 'day' || showOffToday) return null;
    const activeIds = roster.filter((t) => t.active !== false).map((t) => t.id);
    const withAppointments = new Set(
      (allAppointments ?? [])
        .filter((a) => a.status !== 'cancelled' && a.therapistId && dateForAppointment(a) === date)
        .map((a) => a.therapistId as string)
    );
    return defaultTherapistSelection({
      savedIds: readStoredTherapists(clinic.id),
      activeIds,
      workingIds: workingTodayIds(activeIds, (id) => workingFor(id, date).length > 0, withAppointments),
    });
  }, [canManageAll, isTherapist, search.therapist, search.mode, showOffToday, roster, allAppointments, date, workingFor, clinic.id]);
  const therapistParam = search.therapist ?? (implicitSelection?.ids.length ? implicitSelection.ids.join(',') : undefined);
  const offTodayCount = implicitSelection?.offCount ?? 0;

  // Selected therapists to display in columns.
  const selectedIds = useMemo(() => {
    return selectedTherapistIds(
      scope.role,
      myTherapistId,
      therapistParam,
      roster.map((t) => t.id)
    );
  }, [scope.role, myTherapistId, therapistParam, roster]);
  const [showCancelled, setShowCancelled] = useState(false);
  const scopedAppointments = useMemo(() => allAppointments ?? [], [allAppointments]);
  const historyList = useMemo(
    () => historyAppointments(allAppointments ?? [], scope.role, myTherapistId),
    [allAppointments, scope.role, myTherapistId]
  );
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
      selectedIds.length
        ? roster.filter((t) => selectedIds.includes(t.id) && (t.active !== false || dayAppointments.some((a) => a.therapistId === t.id)))
        : roster.filter((t) => t.active !== false || dayAppointments.some((a) => a.therapistId === t.id)),
    [selectedIds, roster, dayAppointments]
  );
  const singleTherapist = visibleRoster.length === 1 ? visibleRoster[0] : null;
  // Week view is available for both single-therapist and multi-therapist (matrix) modes.
  const weekAvailable = true;
  const mode = search.mode ?? 'day';
  // Desktop's left panel (month, therapists, requests) steps aside in Week so the day columns get its width.
  const showRail = mode !== 'week';

  // Phone presentation: List · Day · 3-Day. The URL mode is untouched (Day/Week stay for tablet and desktop).
  const isPhone = useIsPhone();
  // 'list' was a separate phone view once; it is now the single-therapist Day (cards), so treat it as Day.
  const [storedPhoneView, setPhoneViewState] = useState<PhoneView>(readStoredPhoneView);
  const phoneView: PhoneView = storedPhoneView === 'list' ? 'day' : storedPhoneView;
  const setPhoneView = useCallback((next: PhoneView) => {
    setPhoneViewState(next);
    writeStoredPhoneView(next);
  }, []);
  const [threeDayPick, setThreeDayPick] = useState<string | null>(null);
  const [holdHintDismissed, setHoldHintDismissed] = useState(() => {
    try {
      return localStorage.getItem('theranet:schedule-phone-hint') === '1';
    } catch {
      return false;
    }
  });
  // Phone Day and 3-Day are always grids (Day with one therapist is one wide column).
  const showPhoneGrid = isPhone;
  const threeDays = useMemo(() => threeDayDates(date), [date]);
  // 3-Day shows one therapist: the one picked in the chip, else the viewer's own, else the first in the
  // current selection. The pick is local (the URL filter is untouched, so Day still shows everyone).
  const threeDayCandidates = roster.filter((t) => t.active !== false);
  const threeDayTherapist =
    threeDayCandidates.find((t) => t.id === threeDayPick) ??
    (isTherapist && myTherapistId ? threeDayCandidates.find((t) => t.id === myTherapistId) : undefined) ??
    visibleRoster[0] ??
    threeDayCandidates[0] ??
    null;
  const threeDayAppointments = useMemo(
    () =>
      scopedAppointments.filter(
        (a) => a.therapistId === threeDayTherapist?.id && (showCancelled || a.status !== 'cancelled') && threeDays.includes(dateForAppointment(a))
      ),
    [scopedAppointments, threeDayTherapist?.id, showCancelled, threeDays]
  );
  const bufferHours = clinic.staffBookingBufferHours ?? 3;
  const phoneHours = useMemo(() => {
    if (phoneView !== '3day') {
      return displayHoursFor({ clinicHours: hours, appointments: dayAppointments, mode: 'day', date, slotMinutes, bufferHours });
    }
    return displayHoursFor({
      clinicHours: hours,
      appointments: threeDayAppointments,
      mode: 'day',
      date,
      slotMinutes,
      bufferHours,
    });
  }, [phoneView, hours, dayAppointments, threeDayAppointments, date, slotMinutes, bufferHours]);

  const displayHours = useMemo(
    () =>
      displayHoursFor({
        clinicHours: hours,
        appointments: mode === 'week' ? visibleAppointments : dayAppointments,
        mode,
        date,
        slotMinutes,
        bufferHours,
      }),
    [hours, mode, date, visibleAppointments, dayAppointments, slotMinutes, bufferHours]
  );

  const closedFor = useCallback(
    (day: string) => isClosedDay(day, clinic.closedWeekdays, closedDates ?? []),
    [clinic.closedWeekdays, closedDates]
  );
  const closedToday = closedFor(date);
  const dayNow = date === today ? now.minutes : null;
  // Hook must run unconditionally on every render (rules-of-hooks) — kept
  // above the component's early returns below, not beside the other derived
  // day state it logically belongs with.
  const dayGaps = useMemo(() => {
    if (closedToday.closed || date < today) return [];
    const activeIds = selectedIds.length ? selectedIds : roster.map((t) => t.id);
    if (activeIds.length > 6) return []; // Don't overwhelm the mobile view if too many therapists
    return activeIds
      .flatMap((id) => {
        const t = rosterById.get(id);
        if (!t || t.active === false) return [];
        // Free time is only offered where the viewer can book (a colleague's column is view-only).
        if (!canManageAll && id !== myTherapistId) return [];
        const gaps = freeGaps(dayAppointments, id, date, hours, slotMinutes, { notBefore: dayNow ?? undefined, alignToSlots: true, alignStep: stepMinutes, minMinutes: stepMinutes, working: workingFor(id, date) });
        return gaps.map((g) => ({ ...g, therapistId: id, therapistName: t.name }));
      })
      .sort((a, b) => a.start - b.start);
  }, [closedToday.closed, date, today, selectedIds, roster, rosterById, dayAppointments, hours, slotMinutes, stepMinutes, dayNow, workingFor, canManageAll, myTherapistId]);
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

  // Admins can recolor anyone; a therapist only their own column (the server enforces the same).
  const [colorEditId, setColorEditId] = useState<string | null>(null);
  const canEditColorOf = useCallback(
    (therapistId: string) => scope.role === 'admin' || (isTherapist && therapistId === myTherapistId),
    [scope.role, isTherapist, myTherapistId]
  );
  const gridTherapists: GridTherapist[] = useMemo(() => {
    const columns: GridTherapist[] = visibleRoster.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      onPickColor: canEditColorOf(t.id) ? () => setColorEditId(t.id) : undefined,
    }));
    const orphaned = !selectedIds.length && dayAppointments.some((a) => !a.therapistId || !rosterById.has(a.therapistId));
    if (orphaned) columns.push({ id: '', name: 'Unassigned', color: UNASSIGNED_COLOR });
    return columns;
  }, [visibleRoster, selectedIds.length, dayAppointments, rosterById, canEditColorOf]);

  const weekGridTherapists: GridTherapist[] = useMemo(
    () => visibleRoster.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    [visibleRoster]
  );

  const pendingRequests = useMemo(
    () => (requests ?? []).filter((r) => r.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [requests]
  );
  const requestById = useMemo(() => new Map((requests ?? []).map((r) => [r.id, r])), [requests]);

  // Pending requests that now fit an opening on the day currently being
  // viewed — reuses the same free-gap data already computed for the phone
  // free-gap data (dayGaps), so this is live, not tied to a
  // specific cancel/reschedule event.
  const waitlistMatches = useMemo(() => {
    if (!dayGaps.length || !pendingRequests.length) return [];
    const seen = new Set<string>();
    const matches: AppointmentRequest[] = [];
    for (const gap of dayGaps) {
      for (const r of matchingWaitlistEntries(pendingRequests, { date, therapistId: gap.therapistId, timeOfDay: timeOfDayFor(gap.start) })) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          matches.push(r);
        }
      }
    }
    return matches;
  }, [dayGaps, pendingRequests, date]);
  const [dismissedWaitlistBannerDate, setDismissedWaitlistBannerDate] = useState<string | null>(null);

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A notification link (?appointment=…) opens that appointment's details once, when it is loaded.
  const openedFromLink = useRef<string | null>(null);
  useEffect(() => {
    const id = search.appointment;
    if (!id || openedFromLink.current === id) return;
    if (scopedAppointments.some((a) => a.id === id)) {
      openedFromLink.current = id;
      setSelectedId(id);
    }
  }, [search.appointment, scopedAppointments]);
  const [findTime, setFindTime] = useState(false);
  const [closedSheetOpen, setClosedSheetOpen] = useState(false);
  const [addWaitlistOpen, setAddWaitlistOpen] = useState(false);
  const [removing, setRemoving] = useState<ClosedRange | null>(null);
  const [declining, setDeclining] = useState<{ id: UUID; name: string } | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [hoursTherapistId, setHoursTherapistId] = useState<UUID | null>(null);
  // A therapist can't write hours directly (the server rejects it); "My hours"
  // opens the request sheet instead, same as the account menu.
  const [myHoursOpen, setMyHoursOpen] = useState(false);
  const [assignShiftTherapistId, setAssignShiftTherapistId] = useState<UUID | null>(null);
  const [pickingFor, setPickingFor] = useState<'shift' | 'hours' | null>(null);
  function openFor(kind: 'shift' | 'hours', id: UUID) {
    if (kind === 'shift') setAssignShiftTherapistId(id);
    else setHoursTherapistId(id);
  }
  function chooseTherapist(kind: 'shift' | 'hours') {
    const active = roster.filter((t) => t.active !== false);
    if (active.length === 1) openFor(kind, active[0].id);
    else if (singleTherapist) openFor(kind, singleTherapist.id);
    else setPickingFor(kind);
  }
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
        const conflicts = appointmentsOutsideHours({
          appointments: allAppointments ?? [],
          therapistId,
          hours: value,
          clinicHours: hours,
          slotMinutes,
          todayIso,
        });
        if (conflicts.length === 0) {
          bookingService.assignCustomHours(therapistId, value).then(() => resolve(), reject);
          return;
        }
        setPendingHoursSave({ therapistId, value, count: conflicts.length, resolve, reject });
      }),
    [hoursTherapistId, allAppointments, hours, slotMinutes]
  );
  const [startNoteFor, setStartNoteFor] = useState<Appointment | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    appointment: Appointment;
    target: MoveTarget;
    status?: SlotHoursStatus;
  } | null>(null);
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
    const nextParam = nextTherapistSearchParam(
      ids,
      roster.map((t) => t.id),
      scope.role,
      myTherapistId
    );
    setSchedule({ therapist: nextParam });
    // Admin / front desk: remember the choice on this device. "Show all" also lifts the off-today default.
    if (canManageAll && !isTherapist) {
      writeStoredTherapists(clinic.id, nextParam ? nextParam.split(',') : []);
      if (!nextParam) setShowOffToday(true);
    }
  }
  function toggleTherapist(id: UUID) {
    const next = toggleTherapistSelection(
      id,
      selectedIds,
      roster.map((t) => t.id),
      scope.role,
      myTherapistId
    );
    setTherapists(next);
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
      notify.error(toFriendlyMessage(error));
    }
  }

  const dragOptions: GridDragOptions = {
    canDrag: (appointment) =>
      (appointment.status === 'confirmed' || appointment.status === 'rescheduled') && canManageAppointment(appointment),
    onMove: (appointment, target) => {
      const isDifferentTherapist = Boolean(target.therapistId && target.therapistId !== appointment.therapistId);
      const isDifferentDate = target.date !== dateForAppointment(appointment);
      const targetTherapistId = target.therapistId ?? appointment.therapistId;
      if (targetTherapistId && !canBookFor(targetTherapistId)) return;
      const targetWorking = targetTherapistId ? workingFor(targetTherapistId, target.date) : [];
      const status = slotHoursStatus({
        minutes: target.start,
        length: target.duration,
        working: targetWorking,
        clinicHours: hours,
      });
      const isOffHours = status !== 'ok';

      if (isDifferentTherapist || isDifferentDate || isOffHours) {
        if (isDifferentTherapist && !canManageAll) return;
        setPendingMove({ appointment, target, status });
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
      if (sheet || selectedId || closedSheetOpen || reminderOpen || hoursTherapistId || myHoursOpen) return;
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
  }, [view, sheet, selectedId, closedSheetOpen, reminderOpen, hoursTherapistId, myHoursOpen, setSchedule, step, weekAvailable]);

  async function decline(requestId: UUID) {
    try {
      await bookingService.declineAppointmentRequest(requestId);
    } catch (error) {
      notify.error(toFriendlyMessage(error));
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
  const liveDay = dayAppointments.filter((a) => a.status !== 'cancelled');
  const upcoming = liveDay.filter((a) => (a.status === 'confirmed' || a.status === 'rescheduled') && (date > today || (date === today && minutesOfDay(a.scheduledAt) >= now.minutes))).length;
  const arrived = liveDay.filter((a) => a.status === 'arrived').length;
  const noShow = liveDay.filter((a) => a.status === 'no_show').length;
  const daySummary = liveDay.length
    ? [
        `${liveDay.length} booked`,
        upcoming ? `${upcoming} to come` : '',
        arrived ? `${arrived} arrived` : '',
        noShow ? `${noShow} no-show` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : 'No appointments';
  const closureForDate = closures.find((range) => range.from <= date && range.to >= date)
    ?? groupClosedRanges(closedDates ?? []).find((range) => range.from <= date && range.to >= date);

  // ---- phone (List · Day · 3-Day) ----
  const phoneTitle = phoneView === '3day' ? formatThreeDayTitle(date) : shortDate(date);
  const threeDayBooked = threeDayAppointments.filter((a) => a.status !== 'cancelled').length;
  const phoneStatusSummary =
    phoneView === '3day' ? (threeDayBooked ? `${threeDayBooked} booked` : 'No appointments') : daySummary;
  const phoneTodayDisabled = phoneView === '3day' ? threeDays.includes(today) : date === today;
  const dismissHoldHint = () => {
    setHoldHintDismissed(true);
    try {
      localStorage.setItem('theranet:schedule-phone-hint', '1');
    } catch {
      // storage unavailable: the hint just comes back next time
    }
  };

  const menuItems: ScheduleMenuItem[] = [
    // On tablet and desktop Find a time / Reminders live in the page's own controls.
    ...(isPhone
      ? [
          {
            id: 'find-time',
            label: findTime ? 'Back to schedule' : 'Find a time',
            hint: findTime ? undefined : 'Free times by therapist',
            icon: 'find' as const,
            group: 'view' as const,
            onSelect: () => setFindTime((current) => !current),
          },
        ]
      : []),
    {
      id: 'show-cancelled',
      label: showCancelled ? 'Hide cancelled' : 'Show cancelled',
      icon: 'cancelled',
      group: 'view',
      onSelect: () => setShowCancelled((current) => !current),
    },
    ...(canManageAll
      ? ([
          ...(isPhone
            ? [{ id: 'reminders', label: 'Send reminders', hint: 'WhatsApp, one tap each', icon: 'bell' as const, group: 'actions' as const, onSelect: () => setReminderOpen(true) }]
            : []),
          { id: 'waitlist', label: 'Add to waitlist', hint: 'For an earlier slot', icon: 'waitlist', group: 'actions', onSelect: () => setAddWaitlistOpen(true) },
          { id: 'closed-days', label: 'Set closed days', hint: 'Clinic holidays', icon: 'closed', group: 'manage', onSelect: () => setClosedSheetOpen(true) },
          { id: 'assign-shift', label: 'Assign shift…', hint: 'Per therapist', icon: 'shift', group: 'manage', onSelect: () => chooseTherapist('shift') },
          { id: 'working-hours', label: 'Working hours…', hint: 'Hours and breaks', icon: 'hours', group: 'manage', onSelect: () => chooseTherapist('hours') },
        ] satisfies ScheduleMenuItem[])
      : []),
    // Phones: "My hours" lives here so the tab row stays just Schedule · History.
    ...(isPhone && isTherapist && myTherapistId
      ? [{ id: 'my-hours', label: 'My hours', hint: 'View or request changes', icon: 'hours' as const, group: 'manage' as const, onSelect: () => setMyHoursOpen(true) }]
      : []),
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keys', group: 'view', desktopOnly: true, onSelect: () => setShortcutsOpen(true) },
  ];
  const moreMenu = <ScheduleMenu items={menuItems} isPhone={isPhone} />;

  return (
    <div className="space-y-4 pb-24 tab:pb-20">
      <ScheduleTabs
        {...tabs}
        actions={
          <>
            {isTherapist && myTherapistId && (
              <button type="button" className={`${tabAction} hidden tab:inline-flex`} onClick={() => setMyHoursOpen(true)}>
                My hours
              </button>
            )}
            {canManageAll && (
              <button type="button" className={`${tabAction} hidden tab:inline-flex`} onClick={() => setReminderOpen(true)}>
                Reminders
              </button>
            )}
            <button type="button" className={`${tabPrimary} hidden tab:inline-flex`} onClick={() => openBooking()}>+ Book</button>
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
        <div className={showRail ? 'desktop:grid desktop:grid-cols-[240px_minmax(0,1fr)] desktop:gap-6' : ''}>
          {showRail && <div className="hidden desktop:block">
            <ScheduleRail
              date={date}
              today={today}
              onSelectDate={(selected) => setSchedule({ date: selected })}
              dayState={dayState}
              therapists={roster.filter(t => t.active !== false).map((t) => ({ ...t, summary: summaryFor(t.id) }))}
              visibleIds={selectedIds}
              onToggleTherapist={toggleTherapist}
              onShowAll={() => setTherapists(isTherapist ? roster.map((t) => t.id) : [])}
              showTherapistToggles={roster.length > 1}
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
          </div>}

          <div className="min-w-0 space-y-3">
            <InstallAppBanner message={isTherapist ? 'Add Thera.Net to your home screen to open My schedule in one tap.' : undefined} />
            {canManageAll && (
              <div className={showRail ? 'desktop:hidden' : ''}>
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
            {isPhone ? (
              <PhoneScheduleToolbar
                view={phoneView}
                onViewChange={setPhoneView}
                filter={
                  roster.length > 1 && phoneView === '3day' ? (
                    <TherapistFilter
                      therapists={threeDayCandidates.map((t) => ({
                        ...t,
                        summary: threeDayCountLabel(scopedAppointments, t.id, threeDays, showCancelled),
                      }))}
                      visibleIds={[]}
                      onToggle={() => {}}
                      onShowAll={() => {}}
                      showLabel
                      sheet
                      single={{ selectedId: threeDayTherapist?.id ?? null, onSelect: setThreeDayPick }}
                    />
                  ) : roster.length > 1 ? (
                    <TherapistFilter
                      therapists={roster.filter((t) => t.active !== false).map((t) => ({ ...t, summary: summaryFor(t.id).text }))}
                      visibleIds={selectedIds}
                      onToggle={toggleTherapist}
                      onShowAll={() => setTherapists(isTherapist ? roster.map((t) => t.id) : [])}
                      onOnly={(id) => setTherapists([id])}
                      showLabel
                      sheet
                    />
                  ) : null
                }
                menu={moreMenu}
              />
            ) : (
              <ScheduleToolbar
                mode={mode}
                weekAvailable={weekAvailable}
                onModeChange={(next) => setSchedule({ mode: next })}
                onStep={step}
                onToday={() => setSchedule({ date: today })}
                todayDisabled={mode === 'day' ? date === today : getWeekStart(date) === getWeekStart(today)}
                headline={
                  mode === 'day'
                    ? { short: shortDate(date), long: longDate(date) }
                    : { short: `Week of ${shortDate(getWeekStart(date))}`, long: `Week of ${shortDate(getWeekStart(date))}` }
                }
                summary={daySummary}
                offCount={offTodayCount}
                offIsToday={date === today}
                onShowOff={() => setShowOffToday(true)}
                filter={
                  roster.length > 1 ? (
                    <div className={showRail ? 'desktop:hidden' : ''}>
                      <TherapistFilter
                        therapists={roster.filter((t) => t.active !== false)}
                        visibleIds={selectedIds}
                        onToggle={toggleTherapist}
                        onShowAll={() => setTherapists(isTherapist ? roster.map((t) => t.id) : [])}
                      />
                    </div>
                  ) : null
                }
                monthPicker={(close) => (
                  <MiniMonth
                    date={date}
                    today={today}
                    onSelectDate={(selected) => {
                      setSchedule({ date: selected });
                      close();
                    }}
                    dayState={dayState}
                  />
                )}
                findTimeActive={findTime}
                onToggleFindTime={() => setFindTime((current) => !current)}
                menu={moreMenu}
              />
            )}

            <div className="desktop:hidden">
              <MiniCalendarStrip
                rangeDays={isPhone && phoneView === '3day' ? threeDays : undefined}
                selectedDate={date}
                onSelectDate={(selected) => setSchedule({ date: selected })}
                appointmentDates={visibleAppointments.filter((a) => a.status !== 'cancelled').map(dateForAppointment)}
                closedFor={closedFor}
              />
            </div>
            {isPhone && (
              <PhoneStatusLine
                label={date === today && phoneView === 'day' ? 'Today' : phoneTitle}
                summary={phoneStatusSummary}
                onToday={() => setSchedule({ date: today })}
                showToday={!phoneTodayDisabled}
                offCount={phoneView === 'day' ? offTodayCount : 0}
                onShowOff={() => setShowOffToday(true)}
              />
            )}

            {closedToday.closed && (
              <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--slate-light)] px-3 py-2 text-sm text-[var(--slate)]`}>
                <span>
                  <strong>
                    {closedToday.kind === 'holiday'
                      ? `Closed${closedToday.label ? ` for ${closedToday.label}` : ''}`
                      : `Closed every ${new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' })}`}
                  </strong>
                  {closedToday.kind === 'holiday' && closureForDate ? ` (${rangeLabel(closureForDate)})` : ''}. Online booking is off.
                </span>
                {canManageAll && closedToday.kind === 'holiday' && closureForDate && (
                  <button type="button" className="text-xs font-medium text-[var(--rust)] hover:underline" onClick={() => setRemoving(closureForDate)}>
                    Reopen
                  </button>
                )}
              </div>
            )}

            {scope.role === 'admin' && pendingShiftRequestCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--teal-light)] px-3 py-2 text-sm text-[var(--teal-strong)]">
                <span>
                  <strong>{pendingShiftRequestCount}</strong> shift request{pendingShiftRequestCount === 1 ? '' : 's'} pending.
                </span>
                <Link to="/settings" search={{ tab: 'team' }} className="text-xs font-medium underline hover:no-underline">
                  Review
                </Link>
              </div>
            )}

            {mode === 'day' && waitlistMatches.length > 0 && dismissedWaitlistBannerDate !== date && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--teal-light)] px-3 py-2 text-sm text-[var(--teal-strong)]">
                <span>
                  <strong>{waitlistMatches.length} on the waitlist</strong> could fit today.
                </span>
                <span className="flex items-center gap-3">
                  <button type="button" className="text-xs font-medium underline" onClick={() => setSchedule({ view: 'requests' })}>
                    See requests
                  </button>
                  <button type="button" className="text-xs font-medium text-[var(--teal-strong)]/70 hover:text-[var(--teal-strong)]" onClick={() => setDismissedWaitlistBannerDate(date)}>
                    Dismiss
                  </button>
                </span>
              </div>
            )}

            {/* Phones: Day / 3-Day grids, or the List below. Tablet and desktop keep Day/Week. */}
            {showPhoneGrid && !findTime && (
              <div className="space-y-2">
                {!holdHintDismissed && (
                  <p className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                    <span>Tap a free time to book. Hold an appointment to move it.</span>
                    <button type="button" className="min-h-8 shrink-0 px-2 font-medium text-[var(--teal)]" onClick={dismissHoldHint}>
                      Got it
                    </button>
                  </p>
                )}
                {phoneView === 'day' ? (
                  <MobileDayGrid
                    reasonFor={reasonFor}
                    flagContext={flagContext}
                    date={date}
                    today={today}
                    nowMinutes={now.minutes}
                    therapists={gridTherapists}
                    appointments={dayAppointments}
                    hours={phoneHours}
                    slotMinutes={slotMinutes}
                    stepMinutes={stepMinutes}
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
                ) : threeDayTherapist ? (
                  <MobileThreeDayGrid
                    reasonFor={reasonFor}
                    flagContext={flagContext}
                    days={threeDays}
                    today={today}
                    nowMinutes={now.minutes}
                    appointments={threeDayAppointments}
                    hours={phoneHours}
                    slotMinutes={slotMinutes}
                    stepMinutes={stepMinutes}
                    closedFor={closedFor}
                    colorFor={colorFor}
                    selectedId={selectedId}
                    onSelect={(a) => setSelectedId(a.id)}
                    onBook={({ date: day, time }) => openBooking({ date: day, time, therapistId: threeDayTherapist.id })}
                    isColleague={!canBookFor(threeDayTherapist.id)}
                    onOpenDay={(day) => {
                      setPhoneView('day');
                      setSchedule({ date: day });
                    }}
                    workingFor={(day) => workingFor(threeDayTherapist.id, day)}
                    drag={dragOptions}
                  />
                ) : null}
              </div>
            )}
            {!isPhone && !(findTime && mode === 'day') && (
              <div className="hidden tab:block">
                {mode === 'week' ? (
                  singleTherapist ? (
                    <WeekTimeGrid
                      reasonFor={reasonFor}
                      flagContext={flagContext}
                      days={weekDays(date)}
                      today={today}
                      nowMinutes={now.minutes}
                      appointments={visibleAppointments.filter((a) => a.therapistId === singleTherapist.id)}
                      hours={displayHours}
                      slotMinutes={slotMinutes}
                      stepMinutes={stepMinutes}
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
                    <WeekTimeGrid
                      days={weekDays(date)}
                      today={today}
                      nowMinutes={now.minutes}
                      appointments={visibleAppointments}
                      hours={displayHours}
                      slotMinutes={slotMinutes}
                      stepMinutes={stepMinutes}
                      closedFor={closedFor}
                      colorFor={colorFor}
                      reasonFor={reasonFor}
                      flagContext={flagContext}
                      selectedId={selectedId}
                      onSelect={(a) => setSelectedId(a.id)}
                      onOpenDay={(day) => setSchedule({ date: day, mode: 'day' })}
                      drag={dragOptions}
                      multi={{
                        therapists: weekGridTherapists,
                        canBookFor,
                        workingForTherapist: (therapistId, day) => workingFor(therapistId, day),
                        onBookFree: ({ date: day, time, freeTherapistIds }) =>
                          openBooking({ date: day, time, onlyTherapistIds: freeTherapistIds as UUID[] }),
                      }}
                    />
                  )
                ) : (
                  <ResourceDayGrid
                    reasonFor={reasonFor}
                    flagContext={flagContext}
                    date={date}
                    today={today}
                    nowMinutes={now.minutes}
                    therapists={gridTherapists}
                    appointments={dayAppointments}
                    hours={displayHours}
                    slotMinutes={slotMinutes}
                    stepMinutes={stepMinutes}
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
            )}
            {findTime && (isPhone || mode === 'day') && (
              <FindTimePanel
                date={date}
                therapists={visibleRoster.filter((t) => canBookFor(t.id))}
                appointments={dayAppointments}
                hours={hours}
                slotMinutes={slotMinutes}
                stepMinutes={stepMinutes}
                closed={closedToday}
                nowMinutes={dayNow}
                onPick={({ therapistId, time }) => { setFindTime(false); openBooking({ date, time, therapistId }); }}
                workingFor={(therapistId) => workingFor(therapistId, date)}
              />
            )}
          </div>
        </div>
      )}

      <Panel open={requestsPanelOpen} onClose={() => setSchedule({ view: 'schedule' })} title={`Booking requests (${pendingRequests.length})`}>
        {pendingRequests.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">No requests.</p>
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
          appointments={historyList}
          therapists={canManageAll ? roster.filter(t => t.active !== false) : []}
          today={today}
          colorFor={colorFor}
          therapistNameFor={therapistNameFor}
          onSelect={(a) => setSelectedId(a.id)}
          flagContext={flagContext}
          mrnoFor={mrnoFor}
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
                Message patient
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
                Message therapist
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
        patientMrno={mrnoFor(selectedAppointment?.patientId) ?? null}
        attendance={selectedAttendance}
        requestNotes={selectedAppointment?.requestId ? requestById.get(selectedAppointment.requestId)?.notes ?? null : null}
        seriesLabel={seriesLabel}
        flags={selectedAppointment ? patientFlags(selectedAppointment, flagContext) : []}
        condition={selectedAppointment?.patientId ? flagContext?.conditionByPatient.get(selectedAppointment.patientId) ?? null : null}
        seriesFollowingCount={
          selectedAppointment?.seriesId
            ? (allAppointments ?? []).filter(
                (a) =>
                  a.seriesId === selectedAppointment.seriesId &&
                  a.scheduledAt >= selectedAppointment.scheduledAt &&
                  isActiveAppointmentStatus(a.status)
              ).length
            : undefined
        }
        onCancelSeries={
          selectedAppointment?.seriesId
            ? (appointment) =>
                void bookingService
                  .cancelAppointmentSeries(appointment.seriesId!, appointment.scheduledAt)
                  .catch((error) => notify.error(toFriendlyMessage(error)))
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

      <TherapistColorSheet
        open={colorEditId !== null}
        onClose={() => setColorEditId(null)}
        therapistName={colorEditId ? rosterById.get(colorEditId)?.name ?? 'therapist' : ''}
        value={colorEditId ? rosterById.get(colorEditId)?.color ?? '#468adb' : '#468adb'}
        takenBy={Object.fromEntries(
          roster.filter((t) => t.id !== colorEditId && t.active !== false).map((t) => [t.color.toLowerCase(), t.name])
        )}
        onSave={async (hex) => {
          const target = (therapists ?? []).find((t) => t.id === colorEditId);
          if (!target) return;
          await repos.therapists.put({ ...target, color: hex, updatedAt: new Date().toISOString() });
        }}
      />

      <BookSlotSheet
        isOpen={sheet !== null}
        onClose={() => setSheet(null)}
        appointments={allAppointments ?? []}
        prefilledDate={sheet?.date}
        prefilledTime={sheet?.time}
        prefilledTherapistId={sheet?.therapistId}
        onlyTherapistIds={sheet?.onlyTherapistIds}
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

      {myTherapistId && (
        <ShiftRequestSheet
          open={myHoursOpen}
          therapistId={myTherapistId}
          therapistName={rosterById.get(myTherapistId)?.name ?? ''}
          clinicId={clinic.id}
          currentWorkingHours={rosterById.get(myTherapistId)?.workingHours ?? null}
          clinic={{ ...hours, closedWeekdays: clinic.closedWeekdays }}
          onClose={() => setMyHoursOpen(false)}
        />
      )}

      <AssignShiftSheet
        open={assignShiftTherapistId !== null}
        therapistId={assignShiftTherapistId ?? ''}
        therapistName={assignShiftTherapistId ? rosterById.get(assignShiftTherapistId)?.name ?? '' : ''}
        clinicId={clinic.id}
        closedWeekdays={clinic.closedWeekdays}
        onClose={() => setAssignShiftTherapistId(null)}
      />

      <Panel open={pickingFor !== null} onClose={() => setPickingFor(null)} title={pickingFor === 'shift' ? 'Choose therapist' : 'Choose therapist'}>
        <ul className="divide-y divide-[var(--border)]">
          {roster.filter((t) => t.active !== false).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-1 text-left text-sm text-[var(--ink)] hover:bg-[var(--paper)]"
                onClick={() => { const kind = pickingFor; setPickingFor(null); if (kind) openFor(kind, t.id); }}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <ClosedDaysSheet open={closedSheetOpen} clinicId={clinic.id} initialDate={date < today ? today : date} onClose={() => setClosedSheetOpen(false)} />

      <AddToWaitlistSheet
        open={addWaitlistOpen}
        clinicId={clinic.id}
        initialDate={date < today ? today : date}
        therapists={roster.filter((t) => t.active !== false)}
        onClose={() => setAddWaitlistOpen(false)}
      />

      {undo && (
        <div role="status" className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-xl bg-[var(--ink)] p-3 text-sm text-white shadow-lg sm:bottom-4 sm:left-auto sm:max-w-md">
          <span>{undo.message}</span>
          <button
            type="button"
            className="min-h-9 shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--teal-light)]"
            onClick={() => {
              const action = undo;
              setUndo(null);
              void action.run().catch((error) => notify.error(toFriendlyMessage(error)));
            }}
          >
            Undo
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pendingMove !== null}
        title={
          pendingMove?.status === 'outside_clinic'
            ? 'Move outside clinic hours?'
            : pendingMove?.status === 'outside_therapist'
              ? (rosterById.get(pendingMove.target.therapistId ?? pendingMove.appointment.therapistId ?? '')?.name
                  ? `Move outside ${rosterById.get(pendingMove.target.therapistId ?? pendingMove.appointment.therapistId ?? '')!.name}'s hours?`
                  : 'Move outside working hours?')
              : pendingMove && pendingMove.target.therapistId !== pendingMove.appointment.therapistId
                ? 'Move to another therapist?'
                : 'Move to another date?'
        }
        message={
          pendingMove
            ? `${pendingMove.appointment.patientName} → ${
                pendingMove.target.therapistId !== pendingMove.appointment.therapistId
                  ? `${rosterById.get(pendingMove.target.therapistId ?? '')?.name ?? 'another therapist'}, `
                  : ''
              }${shortDate(pendingMove.target.date)}, ${minutesLabel(pendingMove.target.start)}.${
                pendingMove.status === 'outside_clinic'
                  ? ' Outside clinic hours.'
                  : pendingMove.status === 'outside_therapist'
                    ? ' Outside working hours.'
                    : ''
              }`
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
        message={declining ? `Removes ${declining.name}'s request. Message them separately if needed.` : ''}
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
        title="Save hours anyway?"
        message={
          pendingHoursSave
            ? `${pendingHoursSave.count} upcoming appointment${pendingHoursSave.count === 1 ? '' : 's'} fall outside them.`
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
          if (pending) void bookingService.assignCustomHours(pending.therapistId, pending.value).then(() => pending.resolve(), pending.reject);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Reopen these days?"
        message={removing ? `${removing.label ?? 'Closed'} · ${rangeLabel(removing)} becomes bookable again, online too.` : ''}
        confirmLabel="Reopen"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const range = removing;
          setRemoving(null);
          if (range) void bookingService.removeClosedDates(clinic.id, range.from, range.to).catch((e) => notify.error(toFriendlyMessage(e)));
        }}
      />

      {/* Phones: Book is a round floating button above the bottom nav (the tab-row button starts at `tab:`). */}
      {isPhone && activeView === 'schedule' && (
        <BookFab onClick={() => openBooking()} />
      )}
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
