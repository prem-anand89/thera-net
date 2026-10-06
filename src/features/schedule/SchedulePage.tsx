import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { formatDateDMY } from '@/domain/fiscalYear';
import { addDays, toLocalDateStr } from '@/domain/schedule';
import {
  SectionCard,
  Pill,
  th,
  td,
  chipSelect,
  chipSelectChevron as chevron,
} from '@/components/ui';
import type { UUID } from '@/domain/types';
import { ScheduleBookingsView } from './ScheduleBookingsView';
import { ScheduleTabs, type ScheduleTab } from './ScheduleTabs';
import { requestsLastViewedKey, therapistAppointmentsLastViewedKey } from './scheduleSignals';

/** SVG stars, replacing the old text-glyph `★★★☆☆` — same glance-first
 *  spirit as the icon+word markers on the visit row (`VisitCard.tsx`'s
 *  `VisitFeedbackLink`), just denser since this page's whole job is
 *  showing ratings. Text glyphs render inconsistently across platforms'
 *  font fallbacks; an inline SVG looks the same everywhere. */
function StarRating({ rating }: { rating: number }) {
  const activeColor = rating === 5 ? 'fill-[var(--moss)]' : rating <= 3 ? 'fill-[var(--rust)]' : 'fill-[var(--amber)]';
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          className={`h-3.5 w-3.5 ${i < rating ? activeColor : 'fill-[var(--border)]'}`}
          aria-hidden="true"
        >
          <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      ))}
    </span>
  );
}

/** Compact stat tile for a `SectionCard` header's `action` slot — same
 *  bordered-box, label-over-value look as the shared `StatTile`
 *  (`components/ui.tsx`), but fixed-width and sized for sitting next to a
 *  title instead of `StatTile`'s dashboard-strip proportions (`flex-1`,
 *  `text-xl`/`text-2xl` value text). Not worth promoting into `ui.tsx`
 *  for a single call site. Border/text tone mirrors `StarRating`'s rating
 *  color language, so a bad 30-day average reads as a warning the same
 *  way a bad individual rating does. */
function AverageRatingTile({ averageRating }: { averageRating: number | null }) {
  const tone =
    averageRating == null
      ? 'border-[var(--border)] text-[var(--muted)]'
      : averageRating >= 4.5
        ? 'border-[var(--moss)] text-[var(--moss-strong)]'
        : averageRating >= 3
          ? 'border-[var(--amber)] text-[var(--amber)]'
          : 'border-[var(--rust)] text-[var(--rust)]';
  return (
    <div className={`shrink-0 rounded-lg border bg-[var(--surface)] px-2.5 py-1 ${tone}`}>
      <div className="text-[9px] font-medium uppercase leading-tight tracking-wide text-[var(--muted)]">
        30-day avg
      </div>
      <div className="text-sm font-semibold tabular-nums leading-tight">
        {averageRating == null ? '—' : `${averageRating.toFixed(1)} ★`}
      </div>
    </div>
  );
}

type FeedbackDateRange = 'all' | '7' | '30' | '90';
const DATE_RANGE_LABEL: Record<FeedbackDateRange, string> = {
  all: 'All time',
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
};

/** One row per `feedback_requests` row, whether or not it's been answered
 *  yet — the old list only ever showed answered ones, so a request that
 *  expired unanswered was invisible rather than flagged. */
type FeedbackRow = {
  key: UUID;
  requestId: UUID;
  therapistId: UUID;
  patient?: { id: UUID; name: string; mrno: string };
  visitDate?: string;
  dateForSort: string;
  status: 'answered' | 'awaiting' | 'expired';
  rating?: number;
  comment?: string | null;
  respondedAt?: string;
};



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
  const { myTherapistId } = useWorkspaceScope();
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
    () => [...new Set((requests ?? []).map((r) => r.visitId).filter((id): id is string => !!id))],
    [requests]
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

  const responseByRequestId = useMemo(
    () => new Map((responses ?? []).map((r) => [r.requestId, r])),
    [responses]
  );

  // One row per request, answered or not — the old list only ever showed
  // answered ones, so a request that expired unanswered was invisible
  // instead of flagged (see Phase 6.3's "Expired" pill).
  const allRows: FeedbackRow[] = useMemo(
    () =>
      (requests ?? []).map((request) => {
        const response = responseByRequestId.get(request.id);
        const visit = visitById.get(request.visitId);
        const patient = patientById.get(request.patientId);
        const status: FeedbackRow['status'] = response
          ? 'answered'
          : request.status === 'expired' || new Date(request.expiresAt) < new Date()
            ? 'expired'
            : 'awaiting';
        return {
          key: request.id,
          requestId: request.id,
          therapistId: request.therapistId,
          patient: patient ? { id: patient.id, name: patient.name, mrno: patient.mrno } : undefined,
          visitDate: visit?.visitDate,
          dateForSort: response?.createdAt ?? visit?.visitDate ?? request.updatedAt,
          status,
          rating: response?.rating,
          comment: response?.comment,
          respondedAt: response?.createdAt,
        };
      }),
    [requests, responseByRequestId, visitById, patientById]
  );

  const [therapistFilter, setTherapistFilter] = useState<UUID | ''>('');
  const [dateRange, setDateRange] = useState<FeedbackDateRange>('all');
  const [statusFilter, setStatusFilter] = useState<FeedbackRow['status'] | 'all'>('all');
  const today = toLocalDateStr(new Date());

  // Therapist + date only, status not yet applied — the status pills' own
  // counts are computed from this, same reasoning as `HistoryView`'s
  // `inRange`: "how many of each status, given the other active filters."
  const rowsBeforeStatus = useMemo(() => {
    const from = dateRange === 'all' ? null : addDays(today, -Number(dateRange));
    return allRows
      .filter((row) => !therapistFilter || row.therapistId === therapistFilter)
      .filter((row) => !from || !row.visitDate || row.visitDate >= from);
  }, [allRows, therapistFilter, dateRange, today]);

  const statusCounts = useMemo(
    () => ({
      answered: rowsBeforeStatus.filter((r) => r.status === 'answered').length,
      awaiting: rowsBeforeStatus.filter((r) => r.status === 'awaiting').length,
      expired: rowsBeforeStatus.filter((r) => r.status === 'expired').length,
    }),
    [rowsBeforeStatus]
  );

  const rows = useMemo(
    () =>
      rowsBeforeStatus
        .filter((row) => statusFilter === 'all' || row.status === statusFilter)
        .sort((a, b) => b.dateForSort.localeCompare(a.dateForSort)),
    [rowsBeforeStatus, statusFilter]
  );

  // Fixed 30-day snapshot, independent of the Date Range list filter above
  // (that one narrows what's shown; this is always "the last 30 days",
  // same convention as Reports' other 30-day metrics) — but it does follow
  // the Therapist filter, since "this therapist's average" is the useful
  // reading once one is selected.
  const averageRating = useMemo(() => {
    const cutoff = addDays(today, -30);
    const recent = (responses ?? []).filter((r) => {
      if (toLocalDateStr(new Date(r.createdAt)) < cutoff) return false;
      if (!therapistFilter) return true;
      return requestById.get(r.requestId)?.therapistId === therapistFilter;
    });
    if (recent.length === 0) return null;
    return recent.reduce((sum, r) => sum + r.rating, 0) / recent.length;
  }, [responses, requestById, therapistFilter, today]);

  // Marks every response caught up as of this visit — Workspace's "new
  // response" count reads this same key, so opening this page is what
  // clears it, not a separate per-row acknowledgement (there's no
  // in-progress/resolved state here yet, just "have I looked").
  useEffect(() => {
    if (!isAdmin) return;
    void db.meta.put({ key: requestsLastViewedKey(clinic.id), value: new Date().toISOString() });
  }, [clinic.id, isAdmin]);

  // Same idea, scoped to a plain therapist's own "new/changed appointment"
  // bell count (`useNewTherapistAppointmentCount`) — opening their own
  // schedule is what clears it.
  useEffect(() => {
    if (role !== 'therapist' || !myTherapistId) return;
    void db.meta.put({
      key: therapistAppointmentsLastViewedKey(clinic.id, myTherapistId),
      value: new Date().toISOString(),
    });
  }, [clinic.id, role, myTherapistId]);

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
          <SectionCard
            title={`Feedback (${rows.length})`}
            action={<AverageRatingTile averageRating={averageRating} />}
          >
            <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1 pr-2 sm:flex-wrap sm:pr-0">
              <select
                value={therapistFilter}
                onChange={(e) => setTherapistFilter(e.target.value as UUID | '')}
                className={chipSelect}
                style={chevron}
                aria-label="Filter by therapist"
              >
                <option value="">All therapists</option>
                {(therapists ?? []).filter((t) => t.active !== false).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as FeedbackDateRange)}
                className={chipSelect}
                style={chevron}
                aria-label="Filter by date range"
              >
                {(Object.keys(DATE_RANGE_LABEL) as FeedbackDateRange[]).map((r) => (
                  <option key={r} value={r}>
                    {DATE_RANGE_LABEL[r]}
                  </option>
                ))}
              </select>
              <span className="h-5 w-px shrink-0 bg-[var(--border)]" aria-hidden />
              <button
                type="button"
                aria-pressed={statusFilter === 'all'}
                onClick={() => setStatusFilter('all')}
                className={`min-h-9 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium ${
                  statusFilter === 'all'
                    ? 'bg-[var(--teal)] text-white'
                    : 'bg-[var(--paper)] text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                All
              </button>
              {(
                [
                  ['answered', 'Responded', 'bg-[var(--moss-light)] text-[var(--moss-strong)]', statusCounts.answered],
                  ['awaiting', 'Awaiting', 'bg-[var(--amber-light)] text-[var(--amber)]', statusCounts.awaiting],
                  ['expired', 'Expired', 'bg-[var(--slate-light)] text-[var(--slate)]', statusCounts.expired],
                ] as const
              )
                .filter(([key, , , count]) => count > 0 || statusFilter === key)
                .map(([key, label, tone, count]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={statusFilter === key}
                    onClick={() => setStatusFilter((current) => (current === key ? 'all' : key))}
                    className={`min-h-9 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium ${tone} ${
                      statusFilter === key ? 'ring-2 ring-[var(--teal)] ring-offset-1' : ''
                    }`}
                  >
                    {label} {count}
                  </button>
                ))}
              {(therapistFilter || dateRange !== 'all' || statusFilter !== 'all') && (
                <button
                  type="button"
                  className="shrink-0 whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
                  onClick={() => {
                    setTherapistFilter('');
                    setDateRange('all');
                    setStatusFilter('all');
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">
                {allRows.length === 0 ? 'No feedback requests yet.' : 'No feedback matches these filters.'}
              </p>
            ) : (
              <>
                {/* Below tab: cards on phone; table from iPad portrait up. */}
                <div className="tab:hidden space-y-2">
                  {rows.map((row) => (
                    <div
                      key={row.key}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-display text-sm font-medium text-[var(--ink)]">
                            {row.patient ? (
                              <Link
                                to="/patients/$patientId"
                                params={{ patientId: row.patient.id }}
                                className="text-[var(--teal)] hover:underline"
                              >
                                {row.patient.name}
                              </Link>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--muted)]">
                            {row.visitDate ? formatDateDMY(row.visitDate) : '—'}
                            {' · '}
                            {therapistNameById.get(row.therapistId) ?? '—'}
                          </div>
                        </div>
                        {row.status === 'answered' ? (
                          <StarRating rating={row.rating!} />
                        ) : (
                          <Pill tone={row.status === 'expired' ? 'slate' : 'amber'}>
                            {row.status === 'expired' ? 'Expired' : 'Awaiting'}
                          </Pill>
                        )}
                      </div>
                      {row.status === 'answered' && (
                        <>
                          <p className="mt-2 text-sm text-[var(--ink)]">
                            {row.comment ?? <span className="text-[var(--muted)]">No comment</span>}
                          </p>
                          <div className="mt-1 text-xs text-[var(--muted)]">
                            Responded {formatDateDMY(row.respondedAt!)}
                          </div>
                        </>
                      )}
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
                      {rows.map((row) => (
                        <tr key={row.key}>
                          <td className={td}>
                            {row.patient ? (
                              <Link
                                to="/patients/$patientId"
                                params={{ patientId: row.patient.id }}
                                className="font-medium text-[var(--teal)] hover:underline"
                              >
                                {row.patient.name}
                              </Link>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                            {row.patient && (
                              <span className="ml-1 text-xs text-[var(--muted)]">
                                {row.patient.mrno}
                              </span>
                            )}
                          </td>
                          <td className={td}>{row.visitDate ? formatDateDMY(row.visitDate) : '—'}</td>
                          <td className={td}>{therapistNameById.get(row.therapistId) ?? '—'}</td>
                          <td className={td}>
                            {row.status === 'answered' ? (
                              <StarRating rating={row.rating!} />
                            ) : (
                              <Pill tone={row.status === 'expired' ? 'slate' : 'amber'}>
                                {row.status === 'expired' ? 'Expired' : 'Awaiting'}
                              </Pill>
                            )}
                          </td>
                          <td className={`${td} max-w-xs`}>
                            {row.status === 'answered'
                              ? (row.comment ?? <span className="text-[var(--muted)]">No comment</span>)
                              : <span className="text-[var(--muted)]">—</span>}
                          </td>
                          <td className={td}>
                            {row.status === 'answered' ? formatDateDMY(row.respondedAt!) : '—'}
                          </td>
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
