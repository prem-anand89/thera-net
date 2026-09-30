import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookSlotSheet, type BookedSlot } from '@/components/BookSlotSheet';
import { MiniCalendarStrip } from '@/components/MiniCalendarStrip';
import { Pill, SectionCard, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { toFriendlyMessage } from '@/lib/errors';
import { repos, bookingService } from '@/services';
import {
  addDays,
  appointmentStartsOnDate,
  belongsToColumn,
  countByDate,
  filterHistory,
  isUnassigned,
  generateScheduleSlots,
  getWeekStart,
  toLocalDateStr,
  weekDays,
  localDateTime,
} from '@/domain/schedule';
import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from '@/domain/appointmentStatus';
import type { Appointment, UUID } from '@/domain/types';

type BookingView = 'schedule' | 'requests' | 'history';
type ScheduleMode = 'day' | 'week';
type ScheduleSearch = {
  tab?: 'feedback' | 'bookings';
  view?: BookingView;
  mode?: ScheduleMode;
  date?: string;
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
};

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

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

export function ScheduleBookingsView() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { isAdmin, role } = usePermissions();
  const search = useSearch({ from: '/schedule' }) as ScheduleSearch;
  const today = toLocalDateStr(new Date());
  const view = search.view ?? 'schedule';
  const mode = search.mode ?? 'day';
  const date = search.date ?? today;
  const therapistFilter = search.therapist ?? '';
  const canManageBookings = isAdmin || role === 'front_desk';

  const therapists = useLiveQuery(
    () => (canManageBookings ? repos.therapists.list(clinic.id, true) : undefined),
    [canManageBookings, clinic.id]
  );
  const appointments = useLiveQuery(
    () => (canManageBookings ? repos.appointments.listByClinic(clinic.id) : undefined),
    [canManageBookings, clinic.id]
  );
  const requests = useLiveQuery(
    () => (canManageBookings ? repos.appointmentRequests.listByClinic(clinic.id) : undefined),
    [canManageBookings, clinic.id]
  );
  const therapistNameById = useMemo(
    () => new Map((therapists ?? []).map((therapist) => [therapist.id, therapist.name])),
    [therapists]
  );
  const pendingRequests = useMemo(
    () => (requests ?? []).filter((request) => request.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [requests]
  );
  const activeAppointments = useMemo(
    () => (appointments ?? []).filter((appointment) => appointment.status !== 'cancelled'),
    [appointments]
  );
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [findTime, setFindTime] = useState(false);
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

  function setSchedule(next: Partial<ScheduleSearch>) {
    void navigate({
      to: '/schedule',
      replace: true,
      search: {
        tab: 'bookings',
        view,
        mode,
        date,
        ...(therapistFilter ? { therapist: therapistFilter } : {}),
        ...next,
      },
    });
  }

  function openBooking(input: SheetState = {}) {
    setConfirmed(null);
    setSheet({ date, ...input });
  }

  async function decline(requestId: UUID) {
    if (!confirm('Decline this booking request?')) return;
    try {
      await bookingService.declineAppointmentRequest(requestId);
    } catch (error) {
      alert(toFriendlyMessage(error));
    }
  }

  if (!canManageBookings) {
    return <p className="text-sm text-[var(--muted)]">Schedule is managed by your clinic admin.</p>;
  }

  return (
    <div className="space-y-4 pb-20">
      <header className="border-b border-[var(--border)] pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-base font-semibold text-[var(--ink)]">{mode === 'day' ? longDate(date) : `Week of ${longDate(getWeekStart(date))}`}</p>
          </div>
          <button type="button" className={btnPrimary} onClick={() => openBooking()}>+ Book</button>
        </div>
        <div className="mt-3 flex justify-end">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {(['day', 'week'] as const).map((candidate) => <button key={candidate} type="button" onClick={() => setSchedule({ mode: candidate })} className={`min-h-9 rounded-md px-3 text-xs font-medium ${mode === candidate ? 'bg-[var(--teal)] text-white' : 'text-[var(--muted)]'}`}>{candidate === 'day' ? 'Day' : 'Week'}</button>)}
          </div>
        </div>
      </header>

      <nav aria-label="Booking views" className="flex gap-4 border-b border-[var(--border)]">
        {([
          ['schedule', 'Schedule'],
          ['requests', `Requests${pendingRequests.length ? ` (${pendingRequests.length})` : ''}`],
          ['history', 'History'],
        ] as const).map(([candidate, label]) => <button key={candidate} type="button" onClick={() => setSchedule({ view: candidate })} className={`min-h-11 border-b-2 px-1 text-sm font-medium ${view === candidate ? 'border-[var(--teal)] text-[var(--teal)]' : 'border-transparent text-[var(--muted)]'}`}>{label}</button>)}
      </nav>

      {view === 'schedule' && (
        <ScheduleSurface
          date={date}
          mode={mode}
          appointments={activeAppointments}
          therapists={therapists ?? []}
          therapistFilter={therapistFilter}
          therapistNameById={therapistNameById}
          findTime={findTime}
          onFindTime={() => setFindTime((current) => !current)}
          onFilter={(therapist) => setSchedule({ therapist: therapist || undefined })}
          onSelectDate={(selected) => setSchedule({ date: selected, mode: 'day' })}
          onPickDate={(selected) => setSchedule({ date: selected })}
          onBook={(input) => openBooking(input)}
          slotDuration={clinic.slotDurationMinutes || 30}
          startHour={clinic.bookingStartHour ?? 9}
          endHour={clinic.bookingEndHour ?? 17}
        />
      )}

      {view === 'requests' && (
        <SectionCard title={`Pending requests (${pendingRequests.length})`}>
          {pendingRequests.length === 0 ? <p className="py-6 text-center text-sm text-[var(--muted)]">No pending booking requests.</p> : (
            <div className="space-y-3">
              {pendingRequests.map((request) => <div key={request.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--ink)]">{request.name} <span className="text-xs font-normal text-[var(--muted)]">· {timeAgo(request.createdAt)}</span></p>
                    <p className="text-xs text-[var(--muted)]">{request.phone}{request.preferredDate ? ` · Wants ${request.preferredDate}${request.preferredTimeText ? ` at ${request.preferredTimeText}` : ''}` : ''}</p>
                    {request.preferredTherapistId && <p className="mt-1 text-xs text-[var(--muted)]">Preferred: {therapistNameById.get(request.preferredTherapistId) ?? 'Staff'}</p>}
                    {request.notes && <p className="mt-1 text-sm text-[var(--ink)]">{request.notes}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={btnPrimary} onClick={() => openBooking({ date: request.preferredDate ?? date, requestId: request.id, patientName: request.name, patientPhone: request.phone, therapistId: request.preferredTherapistId ?? undefined, requestNotes: request.notes ?? undefined, requestPreferredTimeText: request.preferredTimeText ?? undefined })}>Confirm</button>
                    <button type="button" className={btnSecondary} onClick={() => void decline(request.id)}>Decline</button>
                  </div>
                </div>
              </div>)}
            </div>
          )}
        </SectionCard>
      )}

      {view === 'history' && (
        <HistorySurface
          appointments={appointments ?? []}
          therapists={therapists ?? []}
          therapistNameById={therapistNameById}
          from={historyFrom}
          query={historyQuery}
          status={historyStatus}
          therapistFilter={historyTherapist}
          onQueryChange={setHistoryQuery}
          onStatusChange={setHistoryStatus}
          onTherapistChange={setHistoryTherapist}
          onLoadMore={() => setHistoryFrom((current) => addDays(current, -30))}
        />
      )}

      {confirmed && <div className="fixed inset-x-4 bottom-20 z-20 sm:bottom-4 sm:left-auto sm:max-w-md flex items-center justify-between gap-3 rounded-xl border border-[var(--teal)] bg-[var(--surface)] p-3 shadow-lg">
        <p className="text-sm text-[var(--ink)]"><strong>{confirmed.patientName}</strong> booked for {timeLabel(confirmed.scheduledAt)}.</p>
        <div className="flex items-center gap-2">
          {confirmed.patientPhone && <button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={() => { void bookingService.shareBookingConfirmation(clinic.id, confirmed.patientName, confirmed.patientPhone ?? null, clinic.name, confirmed.scheduledAt).catch((e) => alert(toFriendlyMessage(e))); }}>WhatsApp</button>}
          <button type="button" className="text-xs font-medium text-[var(--muted)]" onClick={() => setConfirmed(null)}>Dismiss</button>
        </div>
      </div>}
      <BookSlotSheet
        isOpen={sheet !== null}
        onClose={() => setSheet(null)}
        appointments={appointments ?? []}
        prefilledDate={sheet?.date}
        prefilledTime={sheet?.time}
        prefilledTherapistId={sheet?.therapistId}
        prefilledPatientName={sheet?.patientName}
        prefilledPatientPhone={sheet?.patientPhone}
        requestId={sheet?.requestId}
        requestNotes={sheet?.requestNotes}
        requestPreferredTimeText={sheet?.requestPreferredTimeText}
        onBooked={(result) => {
          setConfirmed(result);
          setSchedule({ view: 'schedule', mode: 'day', date: dateForAppointment({ scheduledAt: result.scheduledAt } as Appointment) });
        }}
      />
    </div>
  );
}

function ScheduleSurface({
  date, mode, appointments, therapists, therapistFilter, therapistNameById, findTime, onFindTime, onFilter, onSelectDate, onPickDate, onBook, slotDuration, startHour, endHour,
}: {
  date: string; mode: ScheduleMode; appointments: Appointment[]; therapists: { id: UUID; name: string }[]; therapistFilter: string; therapistNameById: Map<string, string>; findTime: boolean; onFindTime: () => void; onFilter: (therapist: string) => void; onSelectDate: (date: string) => void; onPickDate: (date: string) => void; onBook: (input: SheetState) => void; slotDuration: number; startHour: number; endHour: number;
}) {
  const displayedTherapists = therapistFilter ? therapists.filter((therapist) => therapist.id === therapistFilter) : therapists;
  const dayAppointments = appointments.filter((appointment) => appointmentStartsOnDate(appointment, date)).filter((appointment) => !therapistFilter || appointment.therapistId === therapistFilter).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const slots = generateScheduleSlots(slotDuration, startHour, endHour);
  const appointmentDates = appointments
    .filter((appointment) => !therapistFilter || appointment.therapistId === therapistFilter)
    .map(dateForAppointment);
  const isWeek = mode === 'week';
  const gridTherapists = displayedTherapists.length ? [...displayedTherapists] : [];
  if (dayAppointments.some((a) => isUnassigned(a, therapistNameById)) && !therapistFilter) {
    gridTherapists.push({ id: '' as UUID, name: 'Unassigned' });
  }
  if (gridTherapists.length === 0) {
    gridTherapists.push({ id: '' as UUID, name: 'No therapist' });
  }

  return <div className="space-y-4">
    <MiniCalendarStrip selectedDate={date} onSelectDate={onPickDate} appointmentDates={appointmentDates} />
    <div className="flex items-center gap-2 overflow-x-auto">
      <button type="button" className={!therapistFilter ? btnPrimary : btnSecondary} onClick={() => onFilter('')}>All therapists</button>
      {therapists.map((therapist) => <button key={therapist.id} type="button" className={therapistFilter === therapist.id ? btnPrimary : btnSecondary} onClick={() => onFilter(therapist.id)}>{therapist.name}</button>)}
      {!isWeek && <button type="button" className="ml-auto shrink-0 text-sm font-medium text-[var(--teal)]" onClick={onFindTime}>{findTime ? 'Hide times' : 'Find a time'}</button>}
    </div>

    {isWeek ? <WeekBoard date={date} appointments={appointments} therapistFilter={therapistFilter} therapistNameById={therapistNameById} counts={countByDate(appointmentDates)} onSelectDate={onSelectDate} /> : <>
      {!findTime && dayAppointments.length > 0 && <DaySummary appointments={dayAppointments} />}
      {!findTime && <div className="space-y-3">
        {dayAppointments.length === 0 ? <EmptyDay onBook={() => onBook({ date })} onFindTime={onFindTime} /> : dayAppointments.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} therapistName={appointment.therapistId ? therapistNameById.get(appointment.therapistId) ?? 'Unknown' : 'Unassigned'} />)}
      </div>}
      {findTime && <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="min-w-[680px]" style={{ display: 'grid', gridTemplateColumns: `72px repeat(${Math.max(gridTherapists.length, 1)}, minmax(180px, 1fr))` }}>
          <div className="sticky left-0 z-[1] border-b border-[var(--border)] bg-[var(--surface)] p-3 text-xs font-medium text-[var(--muted)]">Time</div>
          {gridTherapists.map((therapist) => <div key={therapist.id} className="border-b border-l border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-medium text-[var(--ink)]">{therapist.name}</div>)}
          {slots.map((slot) => <Fragment key={`time-${slot.time}`}>
            <div className="sticky left-0 z-[1] border-b border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-xs text-[var(--muted)]">{slot.label}</div>
            {gridTherapists.map((therapist) => {
              const matchesTherapist = (appointment: Appointment) => belongsToColumn(appointment, therapist.id, therapistNameById);
              const slotStart = localDateTime(date, slot.time).getTime();
              const slotEnd = slotStart + slotDuration * 60_000;
              const startsInSlot = dayAppointments.filter((appointment) => {
                if (!matchesTherapist(appointment)) return false;
                const start = new Date(appointment.scheduledAt).getTime();
                return start >= slotStart && start < slotEnd;
              });
              const isOccupied = startsInSlot.length > 0 || dayAppointments.some((appointment) => {
                if (!matchesTherapist(appointment) || appointment.status === 'cancelled') return false;
                const start = new Date(appointment.scheduledAt).getTime();
                const end = start + slotDuration * 60_000;
                return start < slotEnd && end > slotStart;
              });
              return <div key={`${slot.time}-${therapist.id}`} className="min-h-16 border-b border-l border-[var(--border)] p-1.5">
                {startsInSlot.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} therapistName={therapist.name} compact />)}
                {!isOccupied && <button type="button" onClick={() => onBook({ date, time: slot.time, therapistId: therapist.id || undefined })} className="h-full min-h-12 w-full rounded-lg text-left text-xs text-[var(--muted)] hover:bg-[var(--paper)] hover:px-2 hover:text-[var(--teal)]">+ Book</button>}
              </div>;
            })}
          </Fragment>)}
        </div>
      </div>}
    </>}
  </div>;
}

function WeekBoard({ date, appointments, therapistFilter, therapistNameById, counts, onSelectDate }: { date: string; appointments: Appointment[]; therapistFilter: string; therapistNameById: Map<string, string>; counts: Map<string, number>; onSelectDate: (date: string) => void }) {
  const days = weekDays(date);
  return <div className="grid gap-2 tab:grid-cols-7">
    {days.map((day) => {
      const dayAppointments = appointments.filter((appointment) => appointmentStartsOnDate(appointment, day) && (!therapistFilter || appointment.therapistId === therapistFilter)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      return <button key={day} type="button" onClick={() => onSelectDate(day)} className="min-h-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left hover:border-[var(--teal)]">
        <div className="flex items-center justify-between"><span className="text-sm font-semibold text-[var(--ink)]">{new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</span><span className="text-xs text-[var(--muted)]">{counts.get(day) ?? 0}</span></div>
        {dayAppointments.slice(0, 3).map((appointment) => <p key={appointment.id} className="mt-1 truncate text-xs text-[var(--muted)]">{timeLabel(appointment.scheduledAt)} · {appointment.patientName}{appointment.therapistId ? ` · ${therapistNameById.get(appointment.therapistId) ?? 'Staff'}` : ''}</p>)}
        {dayAppointments.length > 3 && <p className="mt-1 text-xs font-medium text-[var(--teal)]">+{dayAppointments.length - 3} more</p>}
      </button>;
    })}
  </div>;
}

function DaySummary({ appointments }: { appointments: Appointment[] }) {
  const upcoming = appointments.filter((a) => (a.status === 'confirmed' || a.status === 'rescheduled') && new Date(a.scheduledAt).getTime() >= Date.now()).length;
  const arrived = appointments.filter((a) => a.status === 'arrived').length;
  const noShow = appointments.filter((a) => a.status === 'no_show').length;
  return <p className="text-xs text-[var(--muted)]">{appointments.length} appointment{appointments.length === 1 ? '' : 's'}{upcoming > 0 && ` · ${upcoming} upcoming`}{arrived > 0 && ` · ${arrived} arrived`}{noShow > 0 && ` · ${noShow} no-show`}</p>;
}

function EmptyDay({ onBook, onFindTime }: { onBook: () => void; onFindTime: () => void }) {
  return <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center">
    <p className="font-medium text-[var(--ink)]">No bookings for this day</p>
    <p className="mt-1 text-sm text-[var(--muted)]">Create a booking or check available times.</p>
    <div className="mt-4 flex justify-center gap-2"><button type="button" className={btnPrimary} onClick={onBook}>New booking</button><button type="button" className={btnSecondary} onClick={onFindTime}>Find a time</button></div>
  </div>;
}

function AppointmentCard({ appointment, therapistName, compact = false }: { appointment: Appointment; therapistName: string; compact?: boolean }) {
  const clinic = useClinic();
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleValue, setRescheduleValue] = useState(() => {
    const d = new Date(appointment.scheduledAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [rescheduleBusy, setRescheduleBusy] = useState(false);

  function sendPatientBookingWhatsApp() {
    void bookingService
      .shareBookingConfirmation(
        clinic.id,
        appointment.patientName,
        appointment.patientPhone ?? null,
        clinic.name,
        appointment.scheduledAt
      )
      .catch((e) => alert(toFriendlyMessage(e)));
  }

  return <div className={compact ? 'rounded-lg border border-[var(--teal)]/20 bg-[var(--teal-light)] p-2' : 'rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3'}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-medium text-[var(--ink)]">{appointment.patientName}</p><p className="text-xs text-[var(--muted)]">{timeLabel(appointment.scheduledAt)} · {therapistName}{!compact && appointment.patientPhone && <> · <a href={`tel:${appointment.patientPhone}`} className="text-[var(--teal)] hover:underline">{appointment.patientPhone}</a></>}</p></div>
      {!compact && <Pill tone={APPOINTMENT_STATUS_TONE[appointment.status]}>{APPOINTMENT_STATUS_LABEL[appointment.status]}</Pill>}
    </div>
    
    {!compact && (
      <>
        {isRescheduling ? (
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
            <input
              type="datetime-local"
              className={inputCls}
              value={rescheduleValue}
              onChange={(e) => setRescheduleValue(e.target.value)}
            />
            <button
              type="button"
              disabled={rescheduleBusy}
              className={btnPrimary + ' text-xs py-1.5 px-3'}
              onClick={async () => {
                setRescheduleBusy(true);
                try {
                  await bookingService.rescheduleAppointment(
                    appointment.id,
                    new Date(rescheduleValue).toISOString()
                  );
                  setIsRescheduling(false);
                } catch (err) {
                  alert(toFriendlyMessage(err));
                } finally {
                  setRescheduleBusy(false);
                }
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:bg-[var(--paper)]"
              onClick={() => setIsRescheduling(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
            {(appointment.status === 'confirmed' || appointment.status === 'rescheduled') && (
              <>
                <button
                  type="button"
                  className="rounded-full border border-[var(--teal)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--teal-light)]"
                  onClick={() => void bookingService.markAppointmentArrived(appointment.id).catch((e) => alert(toFriendlyMessage(e)))}
                >
                  Mark arrived
                </button>
                {appointment.patientPhone && (
                  <button
                    type="button"
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                    onClick={sendPatientBookingWhatsApp}
                  >
                    WhatsApp
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                  onClick={() => setIsRescheduling(true)}
                >
                  Reschedule
                </button>
                <button
                  type="button"
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:bg-[var(--paper)]"
                  onClick={() =>
                    void bookingService
                      .markAppointmentNoShow(appointment.id)
                      .catch((e) => alert(toFriendlyMessage(e)))
                  }
                >
                  No-show
                </button>
                <button
                  type="button"
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--rust)] hover:bg-[var(--paper)]"
                  onClick={() => {
                    if (!confirm('Cancel this appointment?')) return;
                    void bookingService
                      .cancelAppointment(appointment.id)
                      .catch((e) => alert(toFriendlyMessage(e)));
                  }}
                >
                  Cancel
                </button>
              </>
            )}
            {!appointment.visitId && appointment.status !== 'cancelled' && appointment.status !== 'no_show' && (
              <Link
                to="/visits/new"
                search={{
                  appointmentId: appointment.id,
                  prefillName: appointment.patientName,
                  prefillPhone: appointment.patientPhone,
                  ...(appointment.patientId ? { patientId: appointment.patientId } : {}),
                }}
                className="rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
              >
                Create visit
              </Link>
            )}
            {appointment.patientId && (
              <Link to="/patients/$patientId" params={{ patientId: appointment.patientId }} className="text-xs font-medium text-[var(--teal)] hover:underline ml-auto">
                Patient profile
              </Link>
            )}
          </div>
        )}
      </>
    )}
  </div>;
}

function HistorySurface({ appointments, therapists, therapistNameById, from, query, status, therapistFilter, onQueryChange, onStatusChange, onTherapistChange, onLoadMore }: { appointments: Appointment[]; therapists: { id: UUID; name: string }[]; therapistNameById: Map<string, string>; from: string; query: string; status: string; therapistFilter: string; onQueryChange: (value: string) => void; onStatusChange: (value: string) => void; onTherapistChange: (value: string) => void; onLoadMore: () => void }) {
  const rows = filterHistory(appointments, { from, query, status, therapistId: therapistFilter });
  const hasMore = appointments.some((a) => dateForAppointment(a) < from);
  return <SectionCard title={`History (${rows.length})`}>
    <div className="mb-4 grid gap-2 sm:grid-cols-3"><input className={inputCls} placeholder="Search name or phone" value={query} onChange={(event) => onQueryChange(event.target.value)} /><select className={inputCls} value={status} onChange={(event) => onStatusChange(event.target.value)}><option value="">All statuses</option>{['confirmed', 'rescheduled', 'arrived', 'no_show', 'cancelled'].map((candidate) => <option key={candidate} value={candidate}>{APPOINTMENT_STATUS_LABEL[candidate as Appointment['status']]}</option>)}</select><select className={inputCls} value={therapistFilter} onChange={(event) => onTherapistChange(event.target.value)}><option value="">All therapists</option>{therapists.map((therapist) => <option key={therapist.id} value={therapist.id}>{therapist.name}</option>)}</select></div>
    <div className="space-y-2">{rows.length ? rows.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} therapistName={appointment.therapistId ? therapistNameById.get(appointment.therapistId) ?? 'Staff' : 'Unassigned'} />) : <p className="py-6 text-center text-sm text-[var(--muted)]">No appointments in this range.</p>}</div>
    {hasMore && <button type="button" className={`${btnSecondary} mt-4`} onClick={onLoadMore}>Load previous 30 days</button>}
  </SectionCard>;
}
