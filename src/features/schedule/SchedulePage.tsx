import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { formatDateDMY } from '@/domain/fiscalYear';
import { SectionCard, th, td } from '@/components/ui';
import { ScheduleBookingsView } from './ScheduleBookingsView';
import { ScheduleTabs, type ScheduleTab } from './ScheduleTabs';
import { requestsLastViewedKey } from './scheduleSignals';

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




/**
 * Patient Communications, Slice 2+5: admin-only Feedback (every response
 * with its rating and comment) and admin+front_desk Bookings (pending
 * booking requests → confirm into a scheduled appointment; reschedule/
 * no-show/cancel from there). "Bookings" is front_desk's primary reason
 * to be on this page at all (HANDOFF-patient-comms.md's role table) — the
 * doc's own resolved note says a front_desk viewer on `?tab=feedback`
 * gets redirected to Bookings, not shown a disabled tab.
 */
export function SchedulePage() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { isAdmin, role } = usePermissions();
  const canSeeBookings = isAdmin || role === 'front_desk';
  const search = useSearch({ from: '/schedule' });
  const tab = search.tab ?? 'bookings';
  const activeTab: ScheduleTab = tab === 'feedback' ? 'feedback' : search.view === 'history' ? 'history' : 'schedule';

  // Per the doc's own resolved note: front_desk hitting ?tab=feedback
  // lands on Bookings instead, not a disabled/hidden state.
  useEffect(() => {
    if (!isAdmin && tab === 'feedback') {
      void navigate({ to: '/schedule', search: { tab: 'bookings' }, replace: true });
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

  // Admin-only originally (the Feedback tab's own patient link); broadened
  // to canSeeBookings too so front_desk gets it for the Confirm form's
  // "link to existing patient" picker below.
  const patients = useLiveQuery(
    () => (isAdmin || canSeeBookings ? repos.patients.list(clinic.id) : undefined),
    [clinic.id, isAdmin, canSeeBookings]
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


  // Marks every response caught up as of this visit — Workspace's "new
  // response" count reads this same key, so opening this page is what
  // clears it, not a separate per-row acknowledgement (there's no
  // in-progress/resolved state here yet, just "have I looked").
  useEffect(() => {
    if (!isAdmin) return;
    void db.meta.put({ key: requestsLastViewedKey(clinic.id), value: new Date().toISOString() });
  }, [clinic.id, isAdmin]);

  // Therapists get their own schedule only — no Feedback / Bookings tab row.
  if (!isAdmin && !canSeeBookings) {
    return (
      <ScheduleBookingsView tabs={{ active: activeTab, showFeedback: false, scheduleLabel: 'My schedule' }} />
    );
  }

  return (
    <div className="space-y-3">
      {/* Schedule / History render the tab row themselves (with Reminders
          and + Book on its right); Feedback gets the plain row. */}
      {tab === 'feedback' && <ScheduleTabs active={activeTab} showFeedback={isAdmin} scheduleLabel="Schedule" />}

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
              <>
                {/* Below tab: cards on phone; table from iPad portrait up. */}
                <div className="tab:hidden space-y-2">
                  {rows.map(({ response, request, visit, patient }) => (
                    <div
                      key={response.id}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-display text-sm font-medium text-[var(--ink)]">
                            {patient ? (
                              <Link
                                to="/patients/$patientId"
                                params={{ patientId: patient.id }}
                                className="text-[var(--teal)] hover:underline"
                              >
                                {patient.name}
                              </Link>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--muted)]">
                            {visit ? formatDateDMY(visit.visitDate) : '—'}
                            {request && <> · {therapistNameById.get(request.therapistId) ?? '—'}</>}
                          </div>
                        </div>
                        <span className="text-[var(--amber)]" title={`${response.rating} of 5`}>
                          {ratingStars(response.rating)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--ink)]">
                        {response.comment ?? (
                          <span className="text-[var(--muted)]">No comment</span>
                        )}
                      </p>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        Responded {formatDateDMY(response.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden tab:block overflow-x-auto">
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
                              <span className="ml-1 text-xs text-[var(--muted)]">
                                {patient.mrno}
                              </span>
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
              </>
            )}
          </SectionCard>
        ))}

      {tab === 'bookings' && <ScheduleBookingsView tabs={{ active: activeTab, showFeedback: isAdmin, scheduleLabel: 'Schedule' }} />}
    </div>
  );
}
