import { useEffect, useMemo } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { formatDateDMY } from '@/domain/fiscalYear';
import { SectionCard, th, td } from '@/components/ui';
import { requestsLastViewedKey } from './requestsSignals';

/** Filled/empty star string for a 1–5 rating — same glance-first spirit as
 *  the icon+word markers on the visit row (`VisitCard.tsx`'s
 *  `VisitFeedbackLink`), just denser since this page's whole job is
 *  showing ratings. */
function ratingStars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/**
 * Patient Communications, Slice 2: admin-only list of every feedback
 * response with its rating and comment — the page HANDOFF-patient-comms.md
 * calls "Requests → Feedback", the only place any of that content is
 * visible anywhere in the app (front desk/therapists see a request's
 * status on the visit row, never the response itself — RLS enforces the
 * same boundary server-side). "Bookings" is a later slice; this page
 * carries the tab shape now so it has somewhere to land without another
 * page/route rework, same "coming later, not hidden" precedent as
 * MorePage's placeholder before this replaced it.
 */
export function RequestsPage() {
  const clinic = useClinic();
  const { isAdmin } = usePermissions();
  const search = useSearch({ from: '/requests' });
  const tab = search.tab ?? 'feedback';

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
    () => (isAdmin ? repos.therapists.list(clinic.id, true) : undefined),
    [clinic.id, isAdmin]
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

  if (!isAdmin) {
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
        <span className="border-b-2 border-[var(--teal)] px-1 pb-2 text-sm font-medium text-[var(--teal)]">
          Feedback
        </span>
        <span
          className="px-1 pb-2 text-sm text-[var(--muted)]"
          title="Patient booking requests — a later phase of this module"
        >
          Bookings <span className="text-xs">(coming later)</span>
        </span>
      </div>

      {tab === 'feedback' &&
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
    </div>
  );
}
