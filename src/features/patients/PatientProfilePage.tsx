import { useMemo, useState, useCallback } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import type { PatientProfileBackTarget } from '@/app/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, dashboardService, consultationNoteService, invoiceService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { Pill, btnPrimary, btnSecondary } from '@/components/ui';
import { ResponsiveVisitList, type VisitCardData } from '@/components/VisitCard';
import { formatDateDMY, formatDateDM } from '@/domain/fiscalYear';
import { upcastPayload } from '@/domain/coreAssessment';
import { computeVisitPaymentState, isCollected } from '@/domain/paymentState';
import { REFERRING_SOURCE_LABELS, type ConsultationNote, type ConsultationNoteStatus } from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import { EditPatientModal } from './EditPatientModal';
import { AddPatientDetailsModal } from '@/features/visits/AddPatientDetailsModal';

/** How many notes the side panel lists before collapsing the rest into a
 *  "+N older" line — the full history stays reachable by opening any note. */
const NOTE_LIST_LIMIT = 6;

const NOTE_STATUS_PILL: Record<ConsultationNoteStatus, { tone: 'green' | 'amber' | 'slate'; label: string }> = {
  draft: { tone: 'amber', label: 'Draft' },
  completed: { tone: 'green', label: 'Completed' },
  archived: { tone: 'slate', label: 'Archived' },
};


/**
 * Patient Hub — the patient-centric home of the app. One patient's identity,
 * care plan, latest clinical note, and a unified visit/documentation
 * activity feed, all on one page.
 */
export function PatientProfilePage() {
  const clinic = useClinic();
  const { canBill, canViewClinicalNotes, isAdmin } = usePermissions();
  const { myTherapistId } = useWorkspaceScope();
  const { patientId } = useParams({ strict: false }) as { patientId: string };
  const { from: backTo } = useSearch({ strict: false }) as { from?: PatientProfileBackTarget };
  const [editOpen, setEditOpen] = useState(false);
  const [editPatientId, setEditPatientId] = useState<string | null>(null);
  const [newPatientId, setNewPatientId] = useState<string | null>(null);
  const [selectedVisitIds, setSelectedVisitIds] = useState<Set<string>>(new Set());
  const [issuingInvoice, setIssuingInvoice] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  // Package sessions already billed as part of the package's own invoice
  // show up here as ₹0 visits — real activity, but noise when someone just
  // wants the payment/invoice trail. Off by default so nothing disappears
  // without the viewer choosing it.
  const [hideZeroBilled, setHideZeroBilled] = useState(false);

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const editPatient = useLiveQuery(() => (editPatientId ? repos.patients.get(editPatientId) : undefined), [editPatientId]);
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const notes = useLiveQuery(
    () => consultationNoteService.listByPatient(clinic.id, patientId),
    [clinic.id, patientId]
  );

  const visits = useLiveQuery(
    () => repos.visits.list({ clinicId: clinic.id, patientId }),
    [clinic.id, patientId]
  );
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const treatments = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id, true), [clinic.id]);
  const invoicePayments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);
  const directPayments = useLiveQuery(() => repos.payments.list(clinic.id), [clinic.id]);

  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );
  const serviceName = useMemo(() => new Map((catalog ?? []).map((c) => [c.id, c.name])), [catalog]);
  const statusByInvoiceId = useMemo(
    () => new Map((invoicePayments ?? []).map((p) => [p.invoiceId, p.status])),
    [invoicePayments]
  );
  // Same fact-set as Ledger's payment chip (domain/paymentState.ts) — a
  // direct payment counts as collected even if the invoice's own status
  // row still says outstanding, or there's no invoice at all.
  const directPaymentByVisitId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of directPayments ?? []) {
      map.set(p.visitId, (map.get(p.visitId) ?? 0) + p.amountPaise);
    }
    return map;
  }, [directPayments]);
  const visitRows = useMemo(
    () => [...(visits ?? [])].filter((v) => !v.deleted).sort((a, b) => b.visitDate.localeCompare(a.visitDate)),
    [visits]
  );

  const patientPackages = useMemo(
    () => (openPackages ?? []).filter((p) => p.patientId === patientId),
    [openPackages, patientId]
  );

  const treatmentName = useMemo(() => new Map((treatments ?? []).map((t) => [t.id, t.name])), [treatments]);

  // How many sessions of each treatment type this package has had so far —
  // e.g. "Manual Therapy: 4 · Exercise: 6 · Kinesio Taping: 2" — derived
  // from each visit's own treatmentIds rather than a separate aggregation
  // query, since every visit for this patient is already loaded above.
  const treatmentCountsByPackage = useMemo(() => {
    const byPackage = new Map<string, Map<string, number>>();
    for (const v of visits ?? []) {
      if (v.deleted || !v.packageGroupId || !v.treatmentIds?.length) continue;
      const counts = byPackage.get(v.packageGroupId) ?? new Map<string, number>();
      for (const id of v.treatmentIds) {
        const name = treatmentName.get(id);
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      byPackage.set(v.packageGroupId, counts);
    }
    return byPackage;
  }, [visits, treatmentName]);

  // One pass over the patient's visits for all three headline money facts —
  // billed (every visit's bill, including ₹0 package sessions), collected
  // (money actually in hand: full bill when settled, the partial amount
  // when not), and outstanding (still owed). Collected + outstanding always
  // sums to billed except for partial payments, where the unpaid remainder
  // is still counted as outstanding in full (same simplification the
  // existing "outstanding" header pill has always used).
  const billingSummary = useMemo(() => {
    let totalBilled = 0;
    let totalCollected = 0;
    let outstandingBalance = 0;
    for (const v of visits ?? []) {
      if (v.deleted) continue;
      totalBilled += v.actualBillPaise;
      const state = computeVisitPaymentState(
        v.actualBillPaise,
        v.invoiceId ?? null,
        directPaymentByVisitId.get(v.id) ?? 0,
        v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
      );
      if (isCollected(state)) {
        totalCollected += v.actualBillPaise;
      } else if (state === 'partially_collected') {
        totalCollected += directPaymentByVisitId.get(v.id) ?? 0;
      }
      if (!isCollected(state) && state !== 'zero_session') outstandingBalance += v.actualBillPaise;
    }
    return { totalBilled, totalCollected, outstandingBalance };
  }, [visits, statusByInvoiceId, directPaymentByVisitId]);

  const openPackageIds = useMemo(
    () => new Set((openPackages ?? []).map((p) => p.packageGroupId)),
    [openPackages]
  );

  // `notes` (fetched above via listByPatient) already covers this
  // patient's full history including drafts — no extra query needed,
  // unlike Ledger/Workspace which join against a separate clinic-wide fetch.
  const noteByVisitId = useMemo(() => {
    const map = new Map<string, ConsultationNote>();
    for (const n of notes ?? []) {
      if (n.visitId) map.set(n.visitId, n);
    }
    return map;
  }, [notes]);

  // Which package groups have AT LEAST ONE invoiced sibling — `visits`
  // here is this one patient's full, unbounded history, so unlike
  // Ledger/Workspace (date/day-scoped) a direct scan is already accurate,
  // no need for the listByPackageGroup round-trip those pages need.
  const invoicedPackageGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of visits ?? []) {
      if (v.deleted || !v.packageGroupId || !v.invoiceId) continue;
      ids.add(v.packageGroupId);
    }
    return ids;
  }, [visits]);

  const visitCardRows: VisitCardData[] = useMemo(
    () =>
      visitRows.map((v) => ({
        visitId: v.id,
        visitDate: v.visitDate,
        patientId,
        patientName: patient?.name ?? '—',
        mrno: patient?.mrno ?? '—',
        age: patient?.age,
        sex: patient?.sex,
        condition: v.condition ?? null,
        serviceName: serviceName.get(v.serviceCatalogId) ?? '—',
        sessionIndex: v.sessionIndex ?? null,
        packageTotal: v.packageTotal ?? null,
        therapistName: therapistName.get(v.therapistId) ?? '—',
        treatmentNotes: v.treatmentNotes ?? null,
        treatmentNames: (v.treatmentIds ?? []).map((id) => treatmentName.get(id)).filter((n): n is string => !!n),
        billPaise: v.actualBillPaise,
        paymentState: computeVisitPaymentState(
          v.actualBillPaise,
          v.invoiceId ?? null,
          directPaymentByVisitId.get(v.id) ?? 0,
          v.invoiceId ? statusByInvoiceId.get(v.invoiceId) : undefined
        ),
        invoiceId: v.invoiceId ?? null,
        canRepeat: openPackageIds.has(v.packageGroupId ?? ''),
        // Pre-flight mirror of visits_delete's RLS check (is_clinic_admin or
        // is_own_therapist) — a patient's history is clinic-wide (any
        // therapist can view it), but only the visit's own therapist or an
        // admin can delete it.
        canDelete: !v.invoiceId && (isAdmin || v.therapistId === myTherapistId),
        needsNote: v.clinicalStatus === 'pending',
        canViewNotes: canViewClinicalNotes,
        consultationNoteId: noteByVisitId.get(v.id)?.id ?? null,
        noteStatus: noteByVisitId.get(v.id)?.status ?? null,
        packageInvoicePending:
          v.actualBillPaise === 0 &&
          !!v.sessionIndex &&
          !!v.packageTotal &&
          !v.invoiceId &&
          !!v.packageGroupId &&
          invoicedPackageGroupIds.has(v.packageGroupId),
      })),
    [
      visitRows,
      patientId,
      patient?.name,
      patient?.mrno,
      patient?.age,
      patient?.sex,
      serviceName,
      therapistName,
      treatmentName,
      directPaymentByVisitId,
      statusByInvoiceId,
      openPackageIds,
      isAdmin,
      myTherapistId,
      canViewClinicalNotes,
      invoicedPackageGroupIds,
      noteByVisitId,
    ]
  );

  const visibleVisitCardRows = useMemo(
    () => (hideZeroBilled ? visitCardRows.filter((r) => r.billPaise > 0) : visitCardRows),
    [visitCardRows, hideZeroBilled]
  );

  const handleVisitDelete = useCallback(async (visitId: string) => {
    if (!confirm('Delete this visit?')) return;
    try {
      const visit = await repos.visits.get(visitId);
      if (visit && !visit.invoiceId) {
        await repos.visits.softDelete(visitId);
      }
    } catch (e) {
      console.error('Failed to delete visit:', e);
    }
  }, []);

  const toggleVisitSelection = useCallback((visitId: string) => {
    setSelectedVisitIds((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) {
        next.delete(visitId);
      } else {
        next.add(visitId);
      }
      return next;
    });
  }, []);

  const handleBulkIssueInvoice = useCallback(async () => {
    if (selectedVisitIds.size === 0) return;
    setIssuingInvoice(true);
    setIssueError(null);
    try {
      await invoiceService.issueForVisits(Array.from(selectedVisitIds), 'Cash');
      setSelectedVisitIds(new Set());
    } catch (e) {
      setIssueError(toFriendlyMessage(e));
    } finally {
      setIssuingInvoice(false);
    }
  }, [selectedVisitIds]);

  // Derived from the most recent Core Assessment note's safety-history
  // fields — no separate manual entry point, since a clinician already
  // captures these in the note. Empty when no note has been assessed yet.
  const safetyFlags = useMemo(() => {
    const latest = (notes ?? []).find((n) => n.assessmentPayload);
    if (!latest?.assessmentPayload) return [];
    const payload = upcastPayload(latest.assessmentPayload);
    const flags: string[] = [];
    if (payload.history.anticoagulant.onBloodThinner) {
      flags.push('On blood thinner — caution with dry needling and manual therapy (bleeding risk)');
    }
    if (payload.history.implants.present) {
      flags.push('Implants/pacemaker — avoid electrotherapy modalities (TENS, IFC, ultrasound over the site)');
    }
    if (payload.history.pregnancyStatus === 'yes') {
      flags.push('Pregnant — avoid contraindicated modalities and positions');
    }
    return flags;
  }, [notes]);

  if (!patient) {
    return (
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-8 text-sm text-[var(--muted)]">
        Patient not found (or not yet synced).
      </div>
    );
  }

  const initials = patient.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const meta = [
    patient.age != null ? `${patient.age} yrs` : null,
    patient.sex,
    patient.phone,
  ].filter(Boolean);

  const referral = patient.referringSource
    ? [REFERRING_SOURCE_LABELS[patient.referringSource], patient.referringSourceDetail]
        .filter(Boolean)
        .join(' — ')
    : null;

  return (
    <div className="space-y-4">
      <Link to={backTo ?? '/patients'} className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]">
        ← Back
      </Link>

      {safetyFlags.length > 0 && (
        <div className="flex items-start gap-2 rounded-[10px] border border-[var(--rust)] bg-[var(--rust-light)] px-3.5 py-3 text-sm text-[var(--rust)]">
          <span className="shrink-0" aria-hidden>⚠</span>
          <div>
            <p className="font-semibold">Contraindications</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {safetyFlags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Patient identity header */}
      <section className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-[var(--teal-light)] font-display text-lg font-semibold text-[var(--teal)]">
            {initials || '?'}
          </div>
          <div className="min-w-[12rem] flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-[var(--ink)]">{patient.name}</h1>
              <button
                onClick={() => setEditOpen(true)}
                className="text-[var(--muted)] hover:text-[var(--ink)]"
                title="Edit patient"
              >
                ✎
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
              <span>
                <span className="text-[var(--muted)]/70">Patient ID</span>{' '}
                <span className="font-num">{patient.mrno}</span>
              </span>
              {meta.length > 0 && <span className="font-num">{meta.join(' · ')}</span>}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {billingSummary.outstandingBalance > 0 && (
                <span className="rounded-full bg-[var(--rust-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--rust)]">
                  ₹{(billingSummary.outstandingBalance / 100).toFixed(0)} outstanding
                </span>
              )}
              {patient.primaryCondition && (
                <span className="rounded-full bg-[var(--teal-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--teal)]">
                  {patient.primaryCondition}
                </span>
              )}
              {referral && (
                <span className="rounded-full bg-[var(--paper)] px-2.5 py-0.5 text-xs font-medium text-[var(--ink)]">
                  Ref: {referral}
                </span>
              )}
              {patient.mrnoSource === 'auto' && <Pill tone="slate">walk-in</Pill>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/visits/new" search={{ patientId }} className={btnPrimary}>
              New visit
            </Link>
          </div>
        </div>
      </section>

      {/* Both columns pin to row 1 explicitly. Without `lg:row-start-1`,
          grid auto-placement puts the side column (first in DOM, at
          col-start-2) in row 1, then finds its cursor already past column 1
          and drops the main column to row 2 — leaving a tall blank gap on
          the left and pushing Visit history below the side cards. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Side column — rendered first on mobile for proper ordering */}
        <div className="order-1 space-y-4 lg:order-none lg:col-start-2 lg:row-start-1">
          {/* One bordered panel instead of stacked separate cards — a
              therapist opening a profile mid-visit wants notes, money, and
              care-plan progress read together as one "where things stand"
              snapshot, not three disconnected boxes. */}
          <div className="divide-y divide-[var(--border)] rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            {/* Front desk keeps read access to `notes` for the safety-flags
                banner above (blood thinners, implants, pregnancy) — that's a
                narrow derived subset, not clinical documentation. The full
                note list/authoring entry point is gated separately, matching
                canViewClinicalNotes's "reception has no clinical-documentation
                need" (NoteEditorPage enforces the same gate for anyone who
                navigates to a note URL directly). */}
            {canViewClinicalNotes && <ConsultationNotePanel patientId={patientId} notes={notes ?? []} />}

            {visitRows.length > 0 && (
              <PaymentsSummarySection
                billed={billingSummary.totalBilled}
                collected={billingSummary.totalCollected}
                outstanding={billingSummary.outstandingBalance}
              />
            )}

            <SideCard title="Care plan">
              {patientPackages.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No open package.</p>
              ) : (
                <ul className="space-y-3">
                  {patientPackages.map((p) => {
                    const pct = Math.min(100, Math.round((p.sessionsLogged / p.packageTotal) * 100));
                    return (
                      <li key={p.packageGroupId}>
                        <div className="flex items-center justify-between text-sm font-medium text-[var(--ink)]">
                          <span>{p.serviceName}</span>
                          {p.stale && <Pill tone="amber">⚠ Stale</Pill>}
                        </div>
                        <div className="my-1.5 h-2 overflow-hidden rounded-full bg-[var(--paper)]">
                          <span
                            className="block h-full rounded-full bg-[var(--teal)]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="font-num flex justify-between text-xs text-[var(--muted)]">
                          <span>
                            {p.sessionsLogged} of {p.packageTotal} sessions
                          </span>
                          <span>
                            last {formatDateDMY(p.lastVisitOn)} · {p.daysSinceLastVisit}d ago
                          </span>
                        </div>
                        {treatmentCountsByPackage.get(p.packageGroupId) && (
                          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
                            {[...treatmentCountsByPackage.get(p.packageGroupId)!.entries()].map(
                              ([name, count]) => (
                                <span key={name}>
                                  {name}: {count}
                                </span>
                              )
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </SideCard>
          </div>
        </div>

        {/* Main column */}
        <div className="order-2 space-y-4 lg:order-none lg:col-start-1 lg:row-start-1">
          <div className="flex items-center justify-between">
            <SectionLabel>Visit history</SectionLabel>
            {visitRows.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={hideZeroBilled}
                  onChange={(e) => setHideZeroBilled(e.target.checked)}
                />
                Hide ₹0 visits (package sessions)
              </label>
            )}
          </div>
          {issueError && (
            <div className="rounded bg-[var(--rust-light)] p-2 text-sm text-[var(--rust)]">
              {issueError}
            </div>
          )}
          <section className="divide-y divide-[var(--border)] rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            {selectedVisitIds.size > 0 && (
              <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--teal-light)] px-4 py-2.5">
                <span className="text-sm font-medium text-[var(--teal)]">
                  {selectedVisitIds.size} selected
                </span>
                <button
                  type="button"
                  className="rounded-full bg-[var(--teal)] px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  onClick={handleBulkIssueInvoice}
                  disabled={issuingInvoice}
                >
                  {issuingInvoice ? 'Issuing...' : 'Issue invoice for selected'}
                </button>
              </div>
            )}
            {visitRows.length === 0 ? (
              <p className="p-4 text-sm text-[var(--muted)]">No visits recorded yet.</p>
            ) : visibleVisitCardRows.length === 0 ? (
              <p className="p-4 text-sm text-[var(--muted)]">
                All visits are ₹0 (package sessions) — uncheck "Hide ₹0 visits" to see them.
              </p>
            ) : (
              <div className="p-5">
                <ResponsiveVisitList
                  rows={visibleVisitCardRows}
                  showDate={true}
                  showPatient={false}
                  onInvoice={() => {}}
                  onEditPatient={(row) => setEditPatientId(row.patientId)}
                  onDelete={(row) => handleVisitDelete(row.visitId)}
                  canInvoice={canBill}
                  selection={{
                    selectedIds: selectedVisitIds,
                    onToggle: toggleVisitSelection,
                    isSelectable: (row) => !row.invoiceId && canBill,
                  }}
                />
              </div>
            )}
          </section>
        </div>
      </div>

      {patient && (
        <EditPatientModal
          patient={patient}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSave={() => {
            setEditOpen(false);
          }}
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
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Entry point into consultation notes. One open draft per patient at a
 * time (v1 constraint) — surface it instead of offering to start a second.
 */
function ConsultationNotePanel({
  patientId,
  notes,
}: {
  patientId: string;
  notes: ConsultationNote[];
}) {
  const draft = notes.find((n) => n.status === 'draft');
  const visible = notes.slice(0, NOTE_LIST_LIMIT);
  const hiddenCount = notes.length - visible.length;

  return (
    <SideCard
      title="Consultation notes"
      action={
        <Link
          to={draft ? '/patients/$patientId/notes/$noteId' : '/patients/$patientId/notes/new'}
          params={draft ? { patientId, noteId: draft.id } : { patientId }}
          className={btnSecondary}
        >
          {draft ? 'Continue draft' : 'New note'}
        </Link>
      }
    >
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No notes yet.</p>
      ) : (
        // Every note gets the same row shape — date, Initial/Follow-up,
        // status — instead of the previous "latest note is a special
        // header, older ones are bare dates" split, which gave the older
        // entries no mode and no way to tell an evaluation from a
        // follow-up without opening each one.
        <ul className="divide-y divide-[var(--border)] text-xs">
          {visible.map((n) => (
            <li key={n.id} className="py-1.5 first:pt-0 last:pb-0">
              <Link
                to="/patients/$patientId/notes/$noteId"
                params={{ patientId, noteId: n.id }}
                className="flex items-center justify-between gap-2 hover:underline"
              >
                <span className="min-w-0">
                  <span className="font-num text-[var(--ink)]">{formatDateDM(n.updatedAt.slice(0, 10))}</span>
                  <span className="ml-1.5 text-[var(--muted)]">
                    {n.noteMode === 'followup' ? 'Follow-up' : 'Initial'}
                  </span>
                </span>
                <Pill tone={NOTE_STATUS_PILL[n.status].tone}>{NOTE_STATUS_PILL[n.status].label}</Pill>
              </Link>
            </li>
          ))}
          {hiddenCount > 0 && (
            <li className="pt-1.5 text-[var(--muted)]">
              +{hiddenCount} older note{hiddenCount === 1 ? '' : 's'}
            </li>
          )}
        </ul>
      )}
    </SideCard>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]/80">
      {children}
    </div>
  );
}

/** One section of the side panel — border/background live on the shared
 *  wrapper (see the patient snapshot panel above), this just supplies the
 *  header + padding so Notes / Payments / Care plan read as one connected
 *  panel with divider lines instead of three separate boxes. */
function SideCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Lifetime billed / collected / outstanding for this patient — the
 *  header's outstanding pill only tells half the story; this gives the
 *  full picture in one glance without leaving the profile. */
function PaymentsSummarySection({
  billed,
  collected,
  outstanding,
}: {
  billed: number;
  collected: number;
  outstanding: number;
}) {
  return (
    <SideCard title="Payments">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="font-num text-sm font-semibold text-[var(--ink)]">₹{(billed / 100).toFixed(0)}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Billed</div>
        </div>
        <div>
          <div className="font-num text-sm font-semibold text-[var(--teal)]">₹{(collected / 100).toFixed(0)}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Collected</div>
        </div>
        <div>
          <div
            className={`font-num text-sm font-semibold ${outstanding > 0 ? 'text-[var(--rust)]' : 'text-[var(--ink)]'}`}
          >
            ₹{(outstanding / 100).toFixed(0)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Outstanding</div>
        </div>
      </div>
    </SideCard>
  );
}

/* -------------------------------------------------------------------------- */
