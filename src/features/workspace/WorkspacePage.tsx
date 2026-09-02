import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, feedbackService, bookingService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import {
  clinicBillingConfig,
  type ConsultationNote,
  type FeedbackRequest,
  type FeedbackResponse,
  type Visit,
} from '@/domain/types';
import { noteForVisit } from '@/domain/noteLinks';
import { toFriendlyMessage } from '@/lib/errors';
import type { TodayVisitRow } from '@/services/dashboardService';
import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from '@/domain/appointmentStatus';
import {
  btnPrimary,
  SectionCard,
  StatTile,
  Pill,
  PackageThread,
  th,
  thNum,
  td,
  tdNum,
} from '@/components/ui';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
import {
  useNewFeedbackResponseCount,
  useGoogleReviewEligibleRequestIds,
} from '@/features/requests/requestsSignals';
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { SplitModal } from '@/components/SplitModal';
import { TherapistComparisonCard } from '@/components/TherapistComparisonCard';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { AddPatientDetailsModal } from '@/features/visits/AddPatientDetailsModal';
import { EditVisitModal } from '@/features/visits/EditVisitModal';
import { FirstWeekSetupLink } from '@/features/settings/FirstWeekChecklist';

/** What the invoice-issuance modal needs, independent of which card opened it. */
type InvoicingTarget = IssueInvoiceTarget;

function todayRowToCardData(
  row: TodayVisitRow,
  openPackageGroupIds: Set<string>,
  isAdmin: boolean,
  myTherapistId: string | undefined,
  canViewClinicalNotes: boolean,
  therapistSplit: boolean,
  treatmentName: Map<string, string>,
  invoicedSiblingGroupIds: Set<string>,
  consultationNotes: ConsultationNote[] | undefined,
  enablePatientComms: boolean,
  feedbackRequestByVisitId: Map<string, FeedbackRequest>,
  responseByRequestId: Map<string, FeedbackResponse>,
  googleReviewEligibleIds: Set<string>,
  googleReviewUrl: string | null
): VisitCardData {
  const canModify = isAdmin || row.therapistId === myTherapistId;
  const linkedNote = noteForVisit(
    consultationNotes ?? [],
    row.visitId,
    row.patientId,
    row.needsNote
  );
  const feedbackRequest = feedbackRequestByVisitId.get(row.visitId);
  return {
    visitId: row.visitId,
    therapistId: row.therapistId,
    visitDate: new Date().toISOString().slice(0, 10),
    patientId: row.patientId,
    patientName: row.patientName,
    patientPhone: row.phone,
    mrno: row.mrno,
    age: row.age,
    sex: row.sex,
    condition: row.condition,
    canEdit: canModify,
    serviceName: row.serviceName,
    sessionIndex: row.sessionIndex,
    packageTotal: row.packageTotal,
    therapistName: row.therapistName,
    treatmentNotes: row.treatmentNotes,
    treatmentNames: row.treatmentIds
      .map((id) => treatmentName.get(id))
      .filter((n): n is string => !!n),
    billPaise: row.billPaise,
    paymentState: row.paymentState,
    invoiceId: row.invoiceId,
    collectedPaise: row.collectedPaise,
    issuedAt: row.issuedAt,
    canRepeat: Boolean(row.packageGroupId && openPackageGroupIds.has(row.packageGroupId)),
    canSplit: therapistSplit && row.billPaise > 0 && canModify,
    hasSplit: Boolean(row.sharedTherapistId),
    sharedPct: row.sharedPct,
    sharedTherapistName: row.sharedTherapistName,
    // Pre-flight mirror of visits_delete's RLS check (is_clinic_admin or
    // is_own_therapist). front_desk is never either, so this always comes
    // out false for them — matching RLS, which rejects their delete too.
    canDelete: !row.invoiceId && canModify,
    needsNote: row.needsNote,
    canViewNotes: canViewClinicalNotes,
    consultationNoteId: linkedNote?.id ?? null,
    noteStatus: linkedNote?.status ?? null,
    canAskForFeedback: enablePatientComms && canModify,
    feedbackRequest: feedbackRequest
      ? {
          id: feedbackRequest.id,
          status: feedbackRequest.status,
          token: feedbackRequest.token,
          updatedAt: feedbackRequest.updatedAt,
          // Admin gets it for free off the synced rating; front_desk (no
          // rating available at all, see feedbackRequest field's own doc
          // comment) falls back to the role-blind eligibility RPC result.
          googleReviewEligible: isAdmin
            ? (responseByRequestId.get(feedbackRequest.id)?.rating ?? 0) >= 4
            : googleReviewEligibleIds.has(feedbackRequest.id),
        }
      : null,
    googleReviewUrl,
    packageInvoicePending:
      row.billPaise === 0 &&
      !!row.sessionIndex &&
      !!row.packageTotal &&
      !row.invoiceId &&
      !!row.packageGroupId &&
      invoicedSiblingGroupIds.has(row.packageGroupId),
  };
}

export function WorkspacePage() {
  const clinic = useClinic();
  const scope = useWorkspaceScope();
  const { canBill, canViewClinicalNotes, canEditSettings } = usePermissions();
  const { therapistSplit } = clinicBillingConfig(clinic);
  // Patient Communications, Slice 2 — "something arrived" surface per the
  // handoff doc's own question table: admin-only (feedback content is
  // admin-only at RLS too), gated on the module being on.
  const newFeedbackCount = useNewFeedbackResponseCount(
    clinic.id,
    canEditSettings && (clinic.enablePatientComms ?? false)
  );
  // Front-desk-only fallback for the Google review nudge — admin doesn't
  // need this (derives eligibility from the synced rating instead), so
  // skip the RPC call entirely for them.
  const googleReviewEligibleIds = useGoogleReviewEligibleRequestIds(
    clinic.id,
    !canEditSettings && (clinic.enablePatientComms ?? false)
  );
  // Patient Communications, Slice 5 — "Expected today" (appointments) and
  // the pending-booking-requests banner. Scoped the same way "Seen today"
  // already is: clinic-wide for admin/front_desk, own-therapist otherwise
  // (scope.scopeTherapistId already resolves to undefined for the
  // clinic-wide roles — see useWorkspaceScope's own doc comment).
  const todayAppointmentsList = useLiveQuery(
    () =>
      clinic.enablePatientComms
        ? dashboardService.todayAppointments(clinic.id, new Date(), scope.scopeTherapistId)
        : undefined,
    [clinic.id, clinic.enablePatientComms, scope.scopeTherapistId]
  );
  const canManageBookings = scope.isClinicWideView;
  const pendingRequestCount = useLiveQuery(
    () =>
      canManageBookings && clinic.enablePatientComms
        ? dashboardService.pendingAppointmentRequestCount(clinic.id)
        : undefined,
    [clinic.id, clinic.enablePatientComms, canManageBookings]
  );
  const [invoicing, setInvoicing] = useState<InvoicingTarget | null>(null);
  const [takingPayment, setTakingPayment] = useState<VisitCardData | null>(null);
  const [editPatientId, setEditPatientId] = useState<string | null>(null);
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [, setVisitEditError] = useState<string | null>(null);
  const [newPatientId, setNewPatientId] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<Visit | null>(null);
  const [pkgStatusFilter, setPkgStatusFilter] = useState<'open' | 'stale' | 'all'>('open');
  // Defaults on for anyone with a linked therapist record — admin included,
  // since in most solo/small clinics the admin *is* the primary therapist.
  // Role plays no part here: only whether this login has a `therapists` row
  // to scope to.
  const [pkgMineOnly, setPkgMineOnly] = useState(true);

  // Staff (therapist) tier sees only their own visits in the today-scoped
  // stats and Seen today (one shared query drives both); admin sees the
  // whole clinic. While role hasn't resolved yet ('unknown'), useWorkspaceScope
  // defaults to the narrower staff-scoped view rather than flashing
  // clinic-wide data.
  const today = useLiveQuery(
    () => dashboardService.todayWorklist(clinic.id, new Date(), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  // Clinic-wide for admin/front_desk, scoped to just this therapist's own
  // visits otherwise — matches "Collected today" above, which already
  // scopes the same way via scope.scopeTherapistId.
  const monthlyNew = useLiveQuery(
    () => dashboardService.monthlyNewCounts(clinic.id, new Date(), scope.scopeTherapistId),
    [clinic.id, scope.scopeTherapistId]
  );
  // Clinic-wide open-packages list — feeds both the "My open packages" stat
  // tile and the Packages panel below, so fetched once regardless of role.
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const myOpenPackageCount = useMemo(
    () => (openPackages ?? []).filter((p) => p.startedByTherapistId === scope.myTherapistId).length,
    [openPackages, scope.myTherapistId]
  );
  const openPackageGroupIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
  );
  const filteredPackages = useMemo(() => {
    let rows = openPackages ?? [];
    if (pkgMineOnly && scope.myTherapistId)
      rows = rows.filter((p) => p.startedByTherapistId === scope.myTherapistId);
    if (pkgStatusFilter !== 'all')
      rows = rows.filter((p) => p.stale === (pkgStatusFilter === 'stale'));
    return rows;
  }, [openPackages, pkgMineOnly, scope.myTherapistId, pkgStatusFilter]);

  const editPatient = useLiveQuery(
    () => (editPatientId ? repos.patients.get(editPatientId) : undefined),
    [editPatientId]
  );
  // Only needed for the split dialog's "assisting therapist" picker — cheap
  // to skip entirely for a clinic that hasn't turned the feature on.
  const therapists = useLiveQuery(
    () => (therapistSplit ? repos.therapists.list(clinic.id, true) : undefined),
    [clinic.id, therapistSplit]
  );
  const treatments = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id, true), [clinic.id]);
  const treatmentName = useMemo(
    () => new Map((treatments ?? []).map((t) => [t.id, t.name])),
    [treatments]
  );

  // Draft notes never get written back onto the visit row itself (only a
  // completed note does), so showing draft-vs-completed status per visit
  // needs a real join against the notes table — see the identical note in
  // LedgerPage.tsx. Skipped for a viewer who can't see notes anyway.
  const consultationNotes = useLiveQuery(
    () => (canViewClinicalNotes ? repos.consultationNotes.listByClinic(clinic.id) : undefined),
    [clinic.id, canViewClinicalNotes]
  );
  // Patient Communications, Slice 1 — same bulk-fetch-and-map shape as
  // consultationNotes above, see the identical note in LedgerPage.tsx.
  const feedbackRequests = useLiveQuery(
    () => (clinic.enablePatientComms ? repos.feedbackRequests.listByClinic(clinic.id) : undefined),
    [clinic.id, clinic.enablePatientComms]
  );
  const feedbackRequestByVisitId = useMemo(() => {
    const map = new Map<string, FeedbackRequest>();
    for (const r of feedbackRequests ?? []) {
      // Same "most recently updated wins" tie-break as the repo's own
      // getByVisitId — a visit can have more than one row over time (an
      // old expired/responded one plus a fresh pending one after
      // re-asking).
      const existing = map.get(r.visitId);
      if (!existing || r.updatedAt > existing.updatedAt) map.set(r.visitId, r);
    }
    return map;
  }, [feedbackRequests]);
  // Slice 3 — same reasoning as the identical fetch in LedgerPage.tsx: the
  // Google-review nudge needs the rating, which lives in feedback_responses.
  const feedbackResponses = useLiveQuery(
    () => (clinic.enablePatientComms ? repos.feedbackResponses.listByClinic(clinic.id) : undefined),
    [clinic.id, clinic.enablePatientComms]
  );
  const responseByRequestId = useMemo(
    () => new Map((feedbackResponses ?? []).map((r) => [r.requestId, r])),
    [feedbackResponses]
  );
  // A ₹0 package continuation logged today whose OWN invoiceId is null —
  // check the full package group (unbounded by "today") for an invoiced
  // sibling, so a session trailing an already-issued invoice gets flagged
  // instead of just silently showing no lock icon with nothing explaining
  // why. Same dedupe-and-fetch-per-group shape as packageAttributionDeltas.
  const candidatePendingGroupIds = useMemo(
    () => [
      ...new Set(
        (today?.visits ?? [])
          .filter(
            (v) =>
              v.billPaise === 0 &&
              v.sessionIndex &&
              v.packageTotal &&
              !v.invoiceId &&
              v.packageGroupId
          )
          .map((v) => v.packageGroupId!)
      ),
    ],
    [today]
  );
  const invoicedSiblingGroupIds = useLiveQuery(async () => {
    const result = new Set<string>();
    await Promise.all(
      candidatePendingGroupIds.map(async (groupId) => {
        const group = await repos.visits.listByPackageGroup(groupId);
        if (group.some((v) => v.invoiceId)) result.add(groupId);
      })
    );
    return result;
  }, [candidatePendingGroupIds]);

  function openInvoiceFor(data: VisitCardData) {
    setInvoicing({
      visitId: data.visitId,
      patientId: data.patientId,
      patientLabel: data.patientName,
      serviceLabel: data.serviceName,
      isPackage: data.packageTotal != null,
      alreadyCollected: data.paymentState === 'collected_no_receipt',
    });
  }

  const therapistNameById = new Map((therapists ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)]">Workspace</h1>
          {canEditSettings && <FirstWeekSetupLink clinicId={clinic.id} />}
        </div>
        <Link to="/visits/new" className={`${btnPrimary} hidden text-center sm:inline-flex`}>
          + New visit
        </Link>
      </div>

      {scope.isUnlinkedTherapist && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">
            Link your login
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Today’s visits and packages aren’t showing because this login isn’t linked to a
            therapist record yet. Ask your admin to set it from Settings → Team → Linked login.
          </p>
        </section>
      )}

      {newFeedbackCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--teal)] bg-[var(--teal-light)] px-4 py-3">
          <p className="text-sm text-[var(--ink)]">
            {newFeedbackCount} new feedback response{newFeedbackCount === 1 ? '' : 's'}.
          </p>
          <Link
            to="/requests"
            search={{ tab: 'feedback' }}
            className="whitespace-nowrap text-sm font-medium text-[var(--teal)] hover:underline"
          >
            See all →
          </Link>
        </div>
      )}

      {!!pendingRequestCount && pendingRequestCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--teal)] bg-[var(--teal-light)] px-4 py-3">
          <p className="text-sm text-[var(--ink)]">
            {pendingRequestCount} new booking request{pendingRequestCount === 1 ? '' : 's'}.
          </p>
          <Link
            to="/requests"
            search={{ tab: 'bookings' }}
            className="whitespace-nowrap text-sm font-medium text-[var(--teal)] hover:underline"
          >
            See all →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Collected today" value={formatINR(today?.collectedPaise ?? 0)} />
        <StatTile label="New patients this month" value={monthlyNew?.newPatients ?? 0} />
        {scope.myTherapistId ? (
          <StatTile
            label="My open packages"
            value={openPackages === undefined ? '—' : myOpenPackageCount}
          />
        ) : (
          <StatTile label="Packages this month" value={monthlyNew?.newPackages ?? 0} />
        )}
      </div>

      {clinic.enablePatientComms && (
        <SectionCard
          title={
            todayAppointmentsList && todayAppointmentsList.length === 1
              ? 'Expected today (1)'
              : `Expected today (${todayAppointmentsList?.length ?? 0})`
          }
        >
          {!todayAppointmentsList || todayAppointmentsList.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No appointments confirmed for today.</p>
          ) : (
            <>
              {/* Below tab: pill cards on phone; table from iPad portrait up. */}
              <div className="tab:hidden space-y-2">
                {todayAppointmentsList.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-display text-sm font-medium text-[var(--ink)]">
                          {a.patientId ? (
                            <Link
                              to="/patients/$patientId"
                              params={{ patientId: a.patientId }}
                              search={{ from: '/workspace' }}
                              className="text-[var(--teal)] hover:underline"
                            >
                              {a.patientName}
                            </Link>
                          ) : (
                            a.patientName
                          )}
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          {new Date(a.scheduledAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {a.therapistName && <> · {a.therapistName}</>}
                        </div>
                      </div>
                      <Pill tone={APPOINTMENT_STATUS_TONE[a.status]}>
                        {APPOINTMENT_STATUS_LABEL[a.status]}
                      </Pill>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(a.status === 'confirmed' || a.status === 'rescheduled') && (
                        <button
                          type="button"
                          className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                          onClick={() =>
                            void bookingService
                              .markAppointmentArrived(a.id)
                              .catch((e) => alert(toFriendlyMessage(e)))
                          }
                        >
                          Mark arrived
                        </button>
                      )}
                      {canManageBookings &&
                        (a.status === 'confirmed' || a.status === 'rescheduled') && (
                          <button
                            type="button"
                            className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:bg-[var(--paper)]"
                            onClick={() =>
                              void bookingService
                                .markAppointmentNoShow(a.id)
                                .catch((e) => alert(toFriendlyMessage(e)))
                            }
                          >
                            No-show
                          </button>
                        )}
                      {canManageBookings &&
                        (a.status === 'confirmed' || a.status === 'rescheduled') && (
                          <button
                            type="button"
                            className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--rust)] hover:bg-[var(--paper)]"
                            onClick={() => {
                              if (!confirm('Cancel this appointment?')) return;
                              void bookingService
                                .cancelAppointment(a.id)
                                .catch((e) => alert(toFriendlyMessage(e)));
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      {!a.visitId && a.status !== 'cancelled' && a.status !== 'no_show' && (
                        <Link
                          to="/visits/new"
                          search={{
                            appointmentId: a.id,
                            prefillName: a.patientName,
                            prefillPhone: a.patientPhone,
                          }}
                          className="rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                        >
                          Create visit
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden tab:block overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border)]">
                  <thead className="bg-[var(--paper)]">
                    <tr>
                      <th className={th}>Time</th>
                      <th className={th}>Patient</th>
                      <th className={th}>Therapist</th>
                      <th className={th}>Status</th>
                      <th className={th}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {todayAppointmentsList.map((a) => (
                      <tr key={a.id}>
                        <td className={td}>
                          {new Date(a.scheduledAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className={td}>
                          {a.patientId ? (
                            <Link
                              to="/patients/$patientId"
                              params={{ patientId: a.patientId }}
                              search={{ from: '/workspace' }}
                              className="font-medium text-[var(--teal)] hover:underline"
                            >
                              {a.patientName}
                            </Link>
                          ) : (
                            a.patientName
                          )}
                        </td>
                        <td className={td}>{a.therapistName ?? '—'}</td>
                        <td className={td}>
                          <Pill tone={APPOINTMENT_STATUS_TONE[a.status]}>
                            {APPOINTMENT_STATUS_LABEL[a.status]}
                          </Pill>
                        </td>
                        <td className={td}>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {(a.status === 'confirmed' || a.status === 'rescheduled') && (
                              <button
                                type="button"
                                className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
                                onClick={() =>
                                  void bookingService
                                    .markAppointmentArrived(a.id)
                                    .catch((e) => alert(toFriendlyMessage(e)))
                                }
                              >
                                Mark arrived
                              </button>
                            )}
                            {canManageBookings &&
                              (a.status === 'confirmed' || a.status === 'rescheduled') && (
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
                              )}
                            {canManageBookings &&
                              (a.status === 'confirmed' || a.status === 'rescheduled') && (
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
                              )}
                            {/* patientId is only ever set alongside visitId
                              (link_appointment_visit sets both together),
                              so !a.visitId here always means identity is
                              still unresolved — nothing to pre-select. */}
                            {!a.visitId && a.status !== 'cancelled' && a.status !== 'no_show' && (
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCard>
      )}

      <SectionCard title={today && today.visits.length === 1 ? "Today's visit" : "Today's visits"}>
        {!today || today.visits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No visits logged today — log one with &ldquo;+ New visit&rdquo;.
          </p>
        ) : (
          <ResponsiveVisitList
            rows={today.visits.map((row) =>
              todayRowToCardData(
                row,
                openPackageGroupIds,
                scope.isAdmin,
                scope.myTherapistId,
                canViewClinicalNotes,
                therapistSplit,
                treatmentName,
                invoicedSiblingGroupIds ?? new Set(),
                consultationNotes,
                clinic.enablePatientComms ?? false,
                feedbackRequestByVisitId,
                responseByRequestId,
                googleReviewEligibleIds,
                clinic.googleReviewUrl ?? null
              )
            )}
            showDate={false}
            showPatient={true}
            onInvoice={(row) => openInvoiceFor(row)}
            onTakePayment={(row) => setTakingPayment(row)}
            onEditPatient={(row) => setEditPatientId(row.patientId)}
            onEdit={(row) => {
              setVisitEditError(null);
              setEditingVisitId(row.visitId);
            }}
            onSplit={
              therapistSplit
                ? (row) => {
                    void repos.visits.get(row.visitId).then((v) => {
                      if (v) setSplitting(v);
                    });
                  }
                : undefined
            }
            onDelete={(row) => {
              if (confirm('Delete this visit?')) void repos.visits.softDelete(row.visitId);
            }}
            onAskForFeedback={(row) => {
              void feedbackService
                .askForFeedback(row.visitId, row.patientName, row.patientPhone ?? null, clinic.name)
                .catch((e) => alert(toFriendlyMessage(e)));
            }}
            onResendFeedback={(row) => {
              const request = feedbackRequestByVisitId.get(row.visitId);
              if (!request?.token) return;
              void feedbackService
                .resend(request, row.patientName, row.patientPhone ?? null, clinic.name)
                .catch((e) => alert(toFriendlyMessage(e)));
            }}
            onAskForGoogleReview={(row) => {
              if (!row.googleReviewUrl) return;
              void feedbackService
                .askForGoogleReview(
                  clinic.id,
                  row.patientName,
                  row.patientPhone ?? null,
                  clinic.name,
                  row.googleReviewUrl
                )
                .catch((e) => alert(toFriendlyMessage(e)));
            }}
            canInvoice={canBill}
            backTo="/workspace"
          />
        )}
      </SectionCard>

      <SectionCard title="Packages">
        <p className="mb-3 text-xs text-[var(--muted)]">
          Every patient on a package — who&rsquo;s still owed sessions, and whose package has gone
          quiet.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            {(
              [
                { key: 'open', label: 'Open' },
                { key: 'stale', label: 'Stale' },
                { key: 'all', label: 'All' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPkgStatusFilter(opt.key)}
                className="rounded-full border px-3 py-1 text-xs font-medium"
                style={{
                  background: pkgStatusFilter === opt.key ? 'var(--teal-light)' : 'var(--surface)',
                  borderColor: pkgStatusFilter === opt.key ? 'transparent' : 'var(--border)',
                  color: pkgStatusFilter === opt.key ? 'var(--teal)' : 'var(--muted)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {scope.myTherapistId && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={pkgMineOnly}
                onChange={(e) => setPkgMineOnly(e.target.checked)}
              />
              Mine only
            </label>
          )}
          <span className="text-xs text-[var(--muted)]">
            {filteredPackages.length} package{filteredPackages.length === 1 ? '' : 's'}
          </span>
        </div>
        {filteredPackages.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            No packages match this filter.
          </p>
        ) : (
          <>
            {/* Below tab: pill cards on phone; table from iPad portrait up. */}
            <div className="tab:hidden space-y-2">
              {filteredPackages.map((p) => (
                <div
                  key={p.packageGroupId}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to="/patients/$patientId"
                      params={{ patientId: p.patientId }}
                      search={{ from: '/workspace' }}
                      className="min-w-0"
                    >
                      <div className="font-display text-sm font-medium text-[var(--ink)]">
                        {p.patientName}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{p.mrno}</div>
                    </Link>
                    <Pill tone={p.stale ? 'amber' : 'green'}>{p.stale ? 'Stale' : 'Open'}</Pill>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Pill tone="slate">{p.serviceName}</Pill>
                    <Pill tone="slate">{p.startedByTherapistName}</Pill>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-[var(--muted)]">
                      <PackageThread
                        sessionIndex={p.sessionsLogged}
                        packageTotal={p.packageTotal}
                      />
                      <span className="font-num">
                        {p.sessionsLogged}/{p.packageTotal}
                      </span>
                      <span className="ml-1">
                        Started {formatDateDM(p.startedOn)} · Last {formatDateDM(p.lastVisitOn)} (
                        {p.daysSinceLastVisit}d ago)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.stale && clinic.enablePatientComms && (
                        <button
                          type="button"
                          className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:bg-[var(--paper)]"
                          onClick={() =>
                            void feedbackService.sendStalePackageReminder(
                              clinic.id,
                              p.patientName,
                              p.phone,
                              clinic.name,
                              p.serviceName
                            )
                          }
                        >
                          Send reminder
                        </button>
                      )}
                      <Link
                        to="/visits/new"
                        search={{ repeatVisitId: p.lastVisitId }}
                        className="rounded-full bg-[var(--teal)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--teal-strong)]"
                      >
                        Log visit
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden tab:block overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--border)]">
                <thead className="bg-[var(--paper)]">
                  <tr>
                    <th className={th}>Patient</th>
                    <th className={th}>Package</th>
                    <th className={th}>Therapist</th>
                    <th className={thNum}>Sessions</th>
                    <th className={th}>Started</th>
                    <th className={th}>Last visit</th>
                    <th className={th}>Status</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredPackages.map((p) => (
                    <tr key={p.packageGroupId}>
                      <td className={td}>
                        {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                      </td>
                      <td className={td}>{p.serviceName}</td>
                      <td className={td}>{p.startedByTherapistName}</td>
                      <td className={tdNum}>
                        <span className="inline-flex items-center gap-1.5">
                          <PackageThread
                            sessionIndex={p.sessionsLogged}
                            packageTotal={p.packageTotal}
                          />
                          <span className="font-num">
                            {p.sessionsLogged}/{p.packageTotal}
                          </span>
                        </span>
                      </td>
                      <td className={td}>{formatDateDM(p.startedOn)}</td>
                      <td className={td}>
                        {formatDateDM(p.lastVisitOn)}{' '}
                        <span className="text-[var(--muted)]">({p.daysSinceLastVisit}d ago)</span>
                      </td>
                      <td className={td}>
                        <Pill tone={p.stale ? 'amber' : 'green'}>{p.stale ? 'Stale' : 'Open'}</Pill>
                      </td>
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          {p.stale && clinic.enablePatientComms && (
                            <button
                              type="button"
                              className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
                              onClick={() =>
                                void feedbackService.sendStalePackageReminder(
                                  clinic.id,
                                  p.patientName,
                                  p.phone,
                                  clinic.name,
                                  p.serviceName
                                )
                              }
                            >
                              Send reminder
                            </button>
                          )}
                          <Link
                            to="/visits/new"
                            search={{ repeatVisitId: p.lastVisitId }}
                            className="whitespace-nowrap text-xs font-medium text-[var(--teal)] hover:underline"
                          >
                            Log visit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      {/* A plain therapist can't reach the Reports nav tab (admin/front_desk
          only, decision 3) — this is the one financial-aggregate exception
          they do get (decision 4), so it surfaces here instead. Admin and
          front_desk see it on Reports instead, not here, so it never shows
          twice. */}
      {!scope.isClinicWideView && <TherapistComparisonCard />}

      {invoicing && (
        <IssueInvoiceDialog
          clinicId={clinic.id}
          target={invoicing}
          onClose={() => setInvoicing(null)}
          returnTo="/workspace"
        />
      )}

      {takingPayment && (
        <TakePaymentDialog
          clinicId={clinic.id}
          visitId={takingPayment.visitId}
          invoiceId={takingPayment.invoiceId}
          amountPaise={takingPayment.billPaise}
          visitDate={takingPayment.visitDate}
          patientLabel={takingPayment.patientName}
          mrno={takingPayment.mrno}
          patientId={takingPayment.patientId}
          onClose={() => setTakingPayment(null)}
        />
      )}

      {editingVisitId && (
        <EditVisitModal
          visitId={editingVisitId}
          onClose={() => setEditingVisitId(null)}
          setError={setVisitEditError}
        />
      )}

      {editPatientId && editPatient && (
        <EditPatientModal
          patient={editPatient}
          open={true}
          onClose={() => setEditPatientId(null)}
          onSave={() => {
            setEditPatientId(null);
          }}
        />
      )}

      {newPatientId && (
        <AddPatientDetailsModal
          patientId={newPatientId}
          onClose={() => setNewPatientId(null)}
          onOpenEdit={() => setEditPatientId(newPatientId)}
        />
      )}

      {splitting && (
        <SplitModal
          visit={splitting}
          therapists={(therapists ?? []).filter((t) => t.id !== splitting.therapistId)}
          primaryName={therapistNameById.get(splitting.therapistId) ?? '-'}
          onClose={() => setSplitting(null)}
        />
      )}
    </div>
  );
}
