import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { formatDateDMY } from '@/domain/fiscalYear';
import { toFriendlyMessage } from '@/lib/errors';
import { SectionCard, Pill, th, td } from '@/components/ui';
import { requestsLastViewedKey } from './requestsSignals';
import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from '@/domain/appointmentStatus';
import type { UUID } from '@/domain/types';

/** Filled/empty star string for a 1–5 rating — same glance-first spirit as
 *  the icon+word markers on the visit row (`VisitCard.tsx`'s
 *  `VisitFeedbackLink`), just denser since this page's whole job is
 *  showing ratings. */
function ratingStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/** `<input type="datetime-local">` needs local-time-no-offset, unlike the
 *  ISO strings everywhere else in this app — a plain slice off
 *  toISOString() would silently shift by the browser's UTC offset. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Defaults the confirm form's datetime to the patient's own preferred
 *  date (at a plain default hour) when they gave one — still entirely
 *  editable, never auto-submitted; front desk always confirms a real
 *  time by hand. Falls back to "an hour from now" when no preference
 *  was given, same as before this had a preferredDate to work with. */
function defaultScheduledAt(preferredDate: string | null): string {
  if (preferredDate) return `${preferredDate}T10:00`;
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return toDatetimeLocalValue(d.toISOString());
}

/**
 * Patient Communications, Slice 2+5: admin-only Feedback (every response
 * with its rating and comment) and admin+front_desk Bookings (pending
 * booking requests → confirm into a scheduled appointment; reschedule/
 * no-show/cancel from there). "Bookings" is front_desk's primary reason
 * to be on this page at all (HANDOFF-patient-comms.md's role table) — the
 * doc's own resolved note says a front_desk viewer on `?tab=feedback`
 * gets redirected to Bookings, not shown a disabled tab.
 */
export function RequestsPage() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { isAdmin, role } = usePermissions();
  const canSeeBookings = isAdmin || role === 'front_desk';
  const search = useSearch({ from: '/requests' });
  const tab = search.tab ?? (isAdmin ? 'feedback' : 'bookings');

  // Per the doc's own resolved note: front_desk hitting ?tab=feedback
  // lands on Bookings instead, not a disabled/hidden state.
  useEffect(() => {
    if (!isAdmin && tab === 'feedback') {
      void navigate({ to: '/requests', search: { tab: 'bookings' }, replace: true });
    }
  }, [isAdmin, tab, navigate]);

  const responses = useLiveQuery(
    () => (isAdmin ? repos.feedbackResponses.listByClinic(clinic.id) : undefined),
    [clinic.id, isAdmin]
  );
  const requests = useLiveQuery(
    () => (isAdmin ? repos.feedbackRequests.listByClinic(clinic.id) : undefined),
    [clinic.id, isAdmin]
  );
  const requestById = useMemo(() => new Map((requests ?? []).map((r) => [r.id, r])), [requests]);

  const visitIds = useMemo(
    () => [
      ...new Set(
        (responses ?? [])
          .map((r) => requestById.get(r.requestId)?.visitId)
          .filter((id): id is string => !!id)
      ),
    ],
    [responses, requestById]
  );
  const visits = useLiveQuery(
    () => (visitIds.length ? repos.visits.listByIds(visitIds) : Promise.resolve([])),
    [visitIds]
  );
  const visitById = useMemo(() => new Map((visits ?? []).map((v) => [v.id, v])), [visits]);

  const patients = useLiveQuery(
    () => (isAdmin ? repos.patients.list(clinic.id) : undefined),
    [clinic.id, isAdmin]
  );
  const patientById = useMemo(() => new Map((patients ?? []).map((p) => [p.id, p])), [patients]);

  const therapists = useLiveQuery(
    () => (isAdmin || canSeeBookings ? repos.therapists.list(clinic.id, true) : undefined),
    [clinic.id, isAdmin, canSeeBookings]
  );
  const therapistNameById = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );
  const catalog = useLiveQuery(
    () => (canSeeBookings ? repos.catalog.list(clinic.id, true) : undefined),
    [clinic.id, canSeeBookings]
  );
  const serviceNameById = useMemo(
    () => new Map((catalog ?? []).map((s) => [s.id, s.name])),
    [catalog]
  );

  const rows = useMemo(
    () =>
      (responses ?? [])
        .map((response) => {
          const request = requestById.get(response.requestId);
          const visit = request ? visitById.get(request.visitId) : undefined;
          const patient = request ? patientById.get(request.patientId) : undefined;
          return { response, request, visit, patient };
        })
        .sort((a, b) => b.response.createdAt.localeCompare(a.response.createdAt)),
    [responses, requestById, visitById, patientById]
  );

  // Bookings tab data
  const appointmentRequests = useLiveQuery(
    () => (canSeeBookings ? repos.appointmentRequests.listByClinic(clinic.id) : undefined),
    [clinic.id, canSeeBookings]
  );
  const pendingRequests = useMemo(
    () =>
      (appointmentRequests ?? [])
        .filter((r) => r.status === 'pending')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [appointmentRequests]
  );
  const appointments = useLiveQuery(
    () => (canSeeBookings ? repos.appointments.listByClinic(clinic.id) : undefined),
    [clinic.id, canSeeBookings]
  );
  const appointmentRows = useMemo(
    () => [...(appointments ?? [])].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)),
    [appointments]
  );

  // Confirm mini-form (one open at a time)
  const [confirmingId, setConfirmingId] = useState<UUID | null>(null);
  const [confirmScheduledAt, setConfirmScheduledAt] = useState(defaultScheduledAt(null));
  const [confirmTherapistId, setConfirmTherapistId] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [justConfirmed, setJustConfirmed] = useState<{
    appointmentId: UUID;
    patientName: string;
    scheduledAt: string;
    therapistId: UUID | null;
  } | null>(null);

  // Reschedule mini-form (one open at a time)
  const [reschedulingId, setReschedulingId] = useState<UUID | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState('');
  const [rescheduleBusy, setRescheduleBusy] = useState(false);

  function startConfirm(
    requestId: UUID,
    preferredTherapistId: UUID | null,
    preferredDate: string | null
  ) {
    setConfirmingId(requestId);
    setConfirmScheduledAt(defaultScheduledAt(preferredDate));
    setConfirmTherapistId(preferredTherapistId ?? '');
    setConfirmError(null);
    setJustConfirmed(null);
  }

  async function submitConfirm(request: { id: UUID; name: string }) {
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const scheduledIso = new Date(confirmScheduledAt).toISOString();
      const appointmentId = await bookingService.confirmAppointmentRequest(
        request.id,
        scheduledIso,
        confirmTherapistId || null
      );
      setJustConfirmed({
        appointmentId,
        patientName: request.name,
        scheduledAt: scheduledIso,
        therapistId: confirmTherapistId || null,
      });
      setConfirmingId(null);
    } catch (e) {
      setConfirmError(toFriendlyMessage(e));
    }
    setConfirmBusy(false);
  }

  async function decline(requestId: UUID) {
    if (!confirm('Decline this booking request?')) return;
    try {
      await bookingService.declineAppointmentRequest(requestId);
    } catch (e) {
      alert(toFriendlyMessage(e));
    }
  }

  // Marks every response caught up as of this visit — Workspace's "new
  // response" count reads this same key, so opening this page is what
  // clears it, not a separate per-row acknowledgement (there's no
  // in-progress/resolved state here yet, just "have I looked").
  useEffect(() => {
    if (!isAdmin) return;
    void db.meta.put({ key: requestsLastViewedKey(clinic.id), value: new Date().toISOString() });
  }, [clinic.id, isAdmin]);

  if (!isAdmin && !canSeeBookings) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Requests</h1>
        <p className="text-sm text-[var(--muted)]">Requests are managed by your clinic admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Requests</h1>

      <div className="flex gap-2 border-b border-[var(--border)]">
        {isAdmin ? (
          <Link
            to="/requests"
            search={{ tab: 'feedback' }}
            className={
              tab === 'feedback'
                ? 'border-b-2 border-[var(--teal)] px-1 pb-2 text-sm font-medium text-[var(--teal)]'
                : 'px-1 pb-2 text-sm text-[var(--muted)] hover:text-[var(--ink)]'
            }
          >
            Feedback
          </Link>
        ) : (
          <span className="px-1 pb-2 text-sm text-[var(--muted)]" title="Admin only">
            Feedback
          </span>
        )}
        <Link
          to="/requests"
          search={{ tab: 'bookings' }}
          className={
            tab === 'bookings'
              ? 'border-b-2 border-[var(--teal)] px-1 pb-2 text-sm font-medium text-[var(--teal)]'
              : 'px-1 pb-2 text-sm text-[var(--muted)] hover:text-[var(--ink)]'
          }
        >
          Bookings
        </Link>
      </div>

      {tab === 'feedback' &&
        isAdmin &&
        (!clinic.enablePatientComms ? (
          <p className="text-sm text-[var(--muted)]">
            Patient communications is off — turn it on in Settings to start collecting feedback.
          </p>
        ) : (
          <SectionCard title={`Feedback (${rows.length})`}>
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">
                No feedback responses yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Patient</th>
                      <th className={th}>Visit</th>
                      <th className={th}>Therapist</th>
                      <th className={th}>Rating</th>
                      <th className={th}>Comment</th>
                      <th className={th}>Responded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {rows.map(({ response, request, visit, patient }) => (
                      <tr key={response.id}>
                        <td className={td}>
                          {patient ? (
                            <Link
                              to="/patients/$patientId"
                              params={{ patientId: patient.id }}
                              className="font-medium text-[var(--teal)] hover:underline"
                            >
                              {patient.name}
                            </Link>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                          {patient && (
                            <span className="ml-1 text-xs text-[var(--muted)]">{patient.mrno}</span>
                          )}
                        </td>
                        <td className={td}>{visit ? formatDateDMY(visit.visitDate) : '—'}</td>
                        <td className={td}>
                          {request ? (therapistNameById.get(request.therapistId) ?? '—') : '—'}
                        </td>
                        <td className={td}>
                          <span className="text-[var(--amber)]" title={`${response.rating} of 5`}>
                            {ratingStars(response.rating)}
                          </span>
                        </td>
                        <td className={`${td} max-w-xs`}>
                          {response.comment ?? (
                            <span className="text-[var(--muted)]">No comment</span>
                          )}
                        </td>
                        <td className={td}>{formatDateDMY(response.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        ))}

      {tab === 'bookings' &&
        (!clinic.enablePatientComms ? (
          <p className="text-sm text-[var(--muted)]">
            Patient communications is off — turn it on in Settings to accept booking requests.
          </p>
        ) : (
          <div className="space-y-4">
            <SectionCard title={`Pending requests (${pendingRequests.length})`}>
              {pendingRequests.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">
                  No pending booking requests.
                </p>
              ) : (
                <div className="space-y-2">
                  {pendingRequests.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-display text-sm font-medium text-[var(--ink)]">
                            {r.name}
                          </div>
                          <div className="text-xs text-[var(--muted)]">
                            {r.phone}
                            {r.email && <> · {r.email}</>}
                          </div>
                          {r.serviceCatalogId && (
                            <div className="text-xs text-[var(--muted)]">
                              {serviceNameById.get(r.serviceCatalogId) ?? '—'}
                            </div>
                          )}
                          {r.notes && (
                            <div className="mt-0.5 text-xs text-[var(--ink)]">{r.notes}</div>
                          )}
                          {r.preferredTherapistId && (
                            <div className="text-xs text-[var(--muted)]">
                              Preferred: {therapistNameById.get(r.preferredTherapistId) ?? '—'}
                            </div>
                          )}
                          {r.preferredDate && (
                            <div className="text-xs text-[var(--muted)]">
                              Wants: {formatDateDMY(r.preferredDate)}
                              {r.preferredTimeText && <> · {r.preferredTimeText}</>}
                            </div>
                          )}
                          {!r.preferredDate && r.preferredTimeText && (
                            <div className="text-xs text-[var(--muted)]">
                              &ldquo;{r.preferredTimeText}&rdquo;
                            </div>
                          )}
                        </div>
                        {confirmingId !== r.id && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                              onClick={() =>
                                startConfirm(r.id, r.preferredTherapistId, r.preferredDate)
                              }
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:bg-[var(--paper)]"
                              onClick={() => void decline(r.id)}
                            >
                              Decline
                            </button>
                          </div>
                        )}
                      </div>

                      {confirmingId === r.id && (
                        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
                          <label className="block">
                            <span className="mb-1 block text-xs text-[var(--muted)]">
                              Scheduled for
                            </span>
                            <input
                              type="datetime-local"
                              className="rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-1.5 text-sm text-[var(--ink)]"
                              value={confirmScheduledAt}
                              onChange={(e) => setConfirmScheduledAt(e.target.value)}
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-[var(--muted)]">
                              Therapist
                            </span>
                            <select
                              className="rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-1.5 text-sm text-[var(--ink)]"
                              value={confirmTherapistId}
                              onChange={(e) => setConfirmTherapistId(e.target.value)}
                            >
                              <option value="">No preference</option>
                              {(therapists ?? []).map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={confirmBusy}
                            className="rounded-full bg-[var(--teal)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                            onClick={() => void submitConfirm(r)}
                          >
                            {confirmBusy ? 'Confirming…' : 'Confirm appointment'}
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] hover:bg-[var(--paper)]"
                            onClick={() => setConfirmingId(null)}
                          >
                            Cancel
                          </button>
                          {confirmError && (
                            <p className="w-full text-xs text-[var(--rust)]">{confirmError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {justConfirmed && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--teal)] bg-[var(--teal-light)] px-4 py-3">
                <p className="text-sm text-[var(--ink)]">
                  Appointment confirmed for {justConfirmed.patientName}.
                </p>
                <button
                  type="button"
                  className="whitespace-nowrap rounded-full border border-[var(--teal)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-white"
                  onClick={() =>
                    void bookingService
                      .shareBookingConfirmation(
                        justConfirmed.patientName,
                        clinic.name,
                        justConfirmed.scheduledAt
                      )
                      .catch((e) => alert(toFriendlyMessage(e)))
                  }
                >
                  Send confirmation
                </button>
                {justConfirmed.therapistId && (
                  <button
                    type="button"
                    className="whitespace-nowrap rounded-full border border-[var(--teal)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-white"
                    onClick={() =>
                      void bookingService
                        .shareTherapistNotify(
                          therapistNameById.get(justConfirmed.therapistId!) ?? 'the therapist',
                          justConfirmed.patientName,
                          justConfirmed.scheduledAt
                        )
                        .catch((e) => alert(toFriendlyMessage(e)))
                    }
                  >
                    Notify therapist
                  </button>
                )}
                <button
                  type="button"
                  className="ml-auto text-xs text-[var(--muted)] hover:underline"
                  onClick={() => setJustConfirmed(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

            <SectionCard title={`Appointments (${appointmentRows.length})`}>
              {appointmentRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">No appointments yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                    <thead>
                      <tr>
                        <th className={th}>When</th>
                        <th className={th}>Patient</th>
                        <th className={th}>Therapist</th>
                        <th className={th}>Status</th>
                        <th className={th}></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {appointmentRows.map((a) => (
                        <tr key={a.id}>
                          <td className={td}>
                            {formatDateDMY(a.scheduledAt)}{' '}
                            <span className="text-[var(--muted)]">
                              {new Date(a.scheduledAt).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </td>
                          <td className={td}>
                            {a.patientId ? (
                              <Link
                                to="/patients/$patientId"
                                params={{ patientId: a.patientId }}
                                className="font-medium text-[var(--teal)] hover:underline"
                              >
                                {a.patientName}
                              </Link>
                            ) : (
                              a.patientName
                            )}
                          </td>
                          <td className={td}>
                            {a.therapistId ? (therapistNameById.get(a.therapistId) ?? '—') : '—'}
                          </td>
                          <td className={td}>
                            <Pill tone={APPOINTMENT_STATUS_TONE[a.status]}>
                              {APPOINTMENT_STATUS_LABEL[a.status]}
                            </Pill>
                          </td>
                          <td className={td}>
                            {reschedulingId === a.id ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="datetime-local"
                                  className="rounded-[8px] border border-[var(--border)] bg-[var(--paper)] p-1 text-xs text-[var(--ink)]"
                                  value={rescheduleValue}
                                  onChange={(e) => setRescheduleValue(e.target.value)}
                                />
                                <button
                                  type="button"
                                  disabled={rescheduleBusy}
                                  className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
                                  onClick={() => {
                                    setRescheduleBusy(true);
                                    void bookingService
                                      .rescheduleAppointment(
                                        a.id,
                                        new Date(rescheduleValue).toISOString()
                                      )
                                      .catch((e) => alert(toFriendlyMessage(e)))
                                      .finally(() => {
                                        setRescheduleBusy(false);
                                        setReschedulingId(null);
                                      });
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="whitespace-nowrap text-xs text-[var(--muted)] hover:underline"
                                  onClick={() => setReschedulingId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {(a.status === 'confirmed' || a.status === 'rescheduled') && (
                                  <>
                                    <button
                                      type="button"
                                      className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
                                      onClick={() => {
                                        setReschedulingId(a.id);
                                        setRescheduleValue(toDatetimeLocalValue(a.scheduledAt));
                                      }}
                                    >
                                      Reschedule
                                    </button>
                                    <button
                                      type="button"
                                      className="whitespace-nowrap text-xs font-medium text-[var(--muted)] hover:underline"
                                      onClick={() =>
                                        void bookingService
                                          .markAppointmentNoShow(a.id)
                                          .catch((e) => alert(toFriendlyMessage(e)))
                                      }
                                    >
                                      No-show
                                    </button>
                                    <button
                                      type="button"
                                      className="whitespace-nowrap text-xs font-medium text-[var(--rust)] hover:underline"
                                      onClick={() => {
                                        if (!confirm('Cancel this appointment?')) return;
                                        void bookingService
                                          .cancelAppointment(a.id)
                                          .catch((e) => alert(toFriendlyMessage(e)));
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                )}
                                {/* Same condition as Workspace's "Expected
                                    today" — an appointment marked arrived
                                    manually (no visit yet) still needs a
                                    way to reach New Visit once it's no
                                    longer "today" and has dropped off that
                                    list; without this it was unreachable. */}
                                {!a.visitId &&
                                  a.status !== 'cancelled' &&
                                  a.status !== 'no_show' && (
                                    <Link
                                      to="/visits/new"
                                      search={{
                                        appointmentId: a.id,
                                        prefillName: a.patientName,
                                        prefillPhone: a.patientPhone,
                                      }}
                                      className="whitespace-nowrap rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                                    >
                                      Create visit
                                    </Link>
                                  )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        ))}
    </div>
  );
}
