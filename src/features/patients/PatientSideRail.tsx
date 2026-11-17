import { Link } from '@tanstack/react-router';
import type { PatientProfileBackTarget } from '@/app/router';
import { Pill, btnPrimary, btnSecondary } from '@/components/ui';
import { formatDateDMY, formatDateDM } from '@/domain/fiscalYear';
import { formatAmount } from '@/domain/money';
import type { ConsultationNote, ConsultationNoteStatus, Patient } from '@/domain/types';
import type { OpenPackageRow } from '@/services/dashboardService';
import { PatientAdmissionBar } from './PatientAdmissionBar';

/** How many notes the side panel lists before collapsing the rest into a
 *  "+N older" line — the full history stays reachable by opening any note. */
const NOTE_LIST_LIMIT = 6;

const NOTE_STATUS_PILL: Record<ConsultationNoteStatus, { tone: 'green' | 'amber' | 'slate'; label: string }> = {
  draft: { tone: 'amber', label: 'Draft' },
  completed: { tone: 'green', label: 'Completed' },
  archived: { tone: 'slate', label: 'Archived' },
};

/**
 * "Needs attention" on the patient profile: sessions still waiting for a note (→ Write session notes, the batch
 * flow) and a pain report waiting on the home program (→ the Home program tab). Renders nothing when neither applies.
 * The page places it above the tabs on phones and at the top of the rail from `desktop:` up.
 */
export function NeedsAttentionCard({
  patientId,
  needsNoteVisitIds,
  canWriteNotes,
  painToReview,
  backTo,
  onReviewPain,
  className = '',
}: {
  patientId: string;
  /** Visits still flagged for a note, oldest first. */
  needsNoteVisitIds: readonly string[];
  /** Same gate the old session-notes bar had: clinical-notes access and at least one visit. */
  canWriteNotes: boolean;
  painToReview: boolean;
  backTo: PatientProfileBackTarget;
  onReviewPain: () => void;
  className?: string;
}) {
  const notesDue = canWriteNotes ? needsNoteVisitIds.length : 0;
  if (notesDue === 0 && !painToReview) return null;
  return (
    <section
      aria-label="Needs attention"
      className={`rounded-[10px] border border-[var(--amber)] bg-[var(--surface)] p-4 ${className}`}
    >
      <h3 className="mb-2.5 font-display text-sm font-semibold text-[var(--ink)]">Needs attention</h3>
      <ul className="space-y-2.5 text-sm">
        {notesDue > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[var(--ink)]">
              {notesDue} session{notesDue === 1 ? '' : 's'} need{notesDue === 1 ? 's' : ''} a note
            </span>
            <Link
              to="/patients/$patientId/notes/session-batch"
              params={{ patientId }}
              search={{ visitIds: [...needsNoteVisitIds], from: backTo }}
              className={btnPrimary}
            >
              Write session notes
            </Link>
          </li>
        )}
        {painToReview && (
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[var(--ink)]">Pain reported on the home program</span>
            <button type="button" className={btnSecondary} onClick={onReviewPain}>
              Review
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * The patient profile's rail (beside the tab content from `desktop:` up, under it on phones): the Stay card, then one
 * panel with Payments, Care plan and Clinical notes.
 */
export function PatientSideRail({
  patient,
  backTo,
  payments,
  packages,
  treatmentCountsByPackage,
  clinicalNotes,
}: {
  patient: Patient;
  backTo?: PatientProfileBackTarget;
  /** null hides the Payments card (no visits yet). */
  payments: {
    billed: number;
    collected: number;
    outstanding: number;
    billCount: number;
    onViewBills: () => void;
  } | null;
  packages: readonly OpenPackageRow[];
  treatmentCountsByPackage: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** null hides the Clinical notes card (no clinical-notes access). */
  clinicalNotes: {
    notes: ConsultationNote[];
    /** Enrollment for "View session log" / "Insurer packet", or null to hide those links. */
    sessionLogEnrollmentId: string | null;
    effectiveBack: PatientProfileBackTarget;
  } | null;
}) {
  return (
    <div className="space-y-4">
      <PatientAdmissionBar patient={patient} />
      {/* One bordered panel instead of stacked separate cards — a therapist opening a profile mid-visit wants money,
          care-plan progress and notes read together as one "where things stand" snapshot. */}
      <div className="divide-y divide-[var(--border)] rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
        {payments && <PaymentsSummarySection {...payments} />}
        <SideCard title="Care plan">
          {packages.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No open package.</p>
          ) : (
            <ul className="space-y-3">
              {packages.map((p) => {
                const pct = Math.min(100, Math.round((p.sessionsLogged / p.packageTotal) * 100));
                const counts = treatmentCountsByPackage.get(p.packageGroupId);
                return (
                  <li key={p.packageGroupId}>
                    <div className="flex items-center justify-between text-sm font-medium text-[var(--ink)]">
                      <span>{p.serviceName}</span>
                      {p.stale ? <Pill tone="amber">⚠ Stale</Pill> : p.nearingCompletion && <Pill tone="amber">Renew soon</Pill>}
                    </div>
                    <div className="my-1.5 h-2 overflow-hidden rounded-full bg-[var(--paper)]">
                      <span className="block h-full rounded-full bg-[var(--teal)]" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="font-num flex justify-between text-xs text-[var(--muted)]">
                      <span>
                        {p.sessionsLogged} of {p.packageTotal} sessions
                      </span>
                      <span>
                        last {formatDateDMY(p.lastVisitOn)} · {p.daysSinceLastVisit}d ago
                      </span>
                    </div>
                    {counts && (
                      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
                        {[...counts.entries()].map(([name, count]) => (
                          <span key={name}>
                            {name}: {count}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SideCard>
        {/* Front desk keeps read access to `notes` for the page's safety-flags banner (blood thinners, implants,
            pregnancy) — a narrow derived subset, not clinical documentation. The note list/authoring entry point is
            gated separately by canViewClinicalNotes (NoteEditorPage enforces the same gate on direct URLs). */}
        {clinicalNotes && (
          <ConsultationNotePanel
            patientId={patient.id}
            notes={clinicalNotes.notes}
            backTo={backTo}
            sessionLogEnrollmentId={clinicalNotes.sessionLogEnrollmentId}
            effectiveBack={clinicalNotes.effectiveBack}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Entry point into consultation notes — always the HEAVY editor (C5), one
 * open heavy draft per patient at a time (v1 constraint), surfaced instead
 * of offering to start a second. Deliberately ignores any open LIGHT
 * (session) draft: those surface on their own visit row instead, and
 * "Continue draft" here should never silently open a session note under a
 * button whose contract is "always heavy." Also carries the session log and
 * insurer packet links (moved here from the old session-notes bar).
 */
function ConsultationNotePanel({
  patientId,
  notes,
  backTo,
  sessionLogEnrollmentId,
  effectiveBack,
}: {
  patientId: string;
  notes: ConsultationNote[];
  backTo?: PatientProfileBackTarget;
  sessionLogEnrollmentId: string | null;
  effectiveBack: PatientProfileBackTarget;
}) {
  const draft = notes.find(
    (n) => n.status === 'draft' && (n.noteMode == null || n.noteMode === 'initial' || n.noteMode === 'followup')
  );
  const visible = notes.slice(0, NOTE_LIST_LIMIT);
  const hiddenCount = notes.length - visible.length;
  const backSearch = backTo ? { from: backTo } : undefined;

  return (
    <SideCard
      title="Clinical notes"
      action={
        <Link
          to={draft ? '/patients/$patientId/notes/$noteId' : '/patients/$patientId/notes/new'}
          params={draft ? { patientId, noteId: draft.id } : { patientId }}
          search={backSearch}
          className={btnSecondary}
        >
          {draft ? 'Continue draft' : 'New assessment'}
        </Link>
      }
    >
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No notes yet.</p>
      ) : (
        // Every note gets the same row shape — date, Initial/Follow-up/Session, status.
        <ul className="divide-y divide-[var(--border)] text-xs">
          {visible.map((n) => (
            <li key={n.id} className="py-1.5 first:pt-0 last:pb-0">
              <Link
                to="/patients/$patientId/notes/$noteId"
                params={{ patientId, noteId: n.id }}
                search={backSearch}
                className="flex items-center justify-between gap-2 hover:underline"
              >
                <span className="min-w-0">
                  <span className="font-num text-[var(--ink)]">{formatDateDM(n.updatedAt.slice(0, 10))}</span>
                  <span className="ml-1.5 text-[var(--muted)]">
                    {n.noteMode === 'session' ? 'Session' : n.noteMode === 'followup' ? 'Follow-up' : 'Initial'}
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
      {sessionLogEnrollmentId && (
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            to="/patients/$patientId/session-log/$enrollmentId"
            params={{ patientId, enrollmentId: sessionLogEnrollmentId }}
            search={{ from: effectiveBack }}
            className="text-xs font-medium text-[var(--teal)] hover:underline"
          >
            View session log
          </Link>
          <Link
            to="/patients/$patientId/insurer-packet/$enrollmentId"
            params={{ patientId, enrollmentId: sessionLogEnrollmentId }}
            search={{ from: effectiveBack }}
            className="text-xs font-medium text-[var(--teal)] hover:underline"
          >
            Insurer packet
          </Link>
        </div>
      )}
    </SideCard>
  );
}

/** One section of the rail panel — border/background live on the shared wrapper, this supplies the header + padding
 *  so Payments / Care plan / Clinical notes read as one connected panel with divider lines. */
function SideCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-[var(--ink)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Lifetime billed / collected / outstanding for this patient in the active department. */
function PaymentsSummarySection({
  billed,
  collected,
  outstanding,
  billCount,
  onViewBills,
}: {
  billed: number;
  collected: number;
  outstanding: number;
  /** Bills on the patient; 0 hides the link (the viewer cannot see bills, or there are none). */
  billCount: number;
  onViewBills: () => void;
}) {
  return (
    <SideCard title="Payments">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="min-w-0 rounded-lg border border-[var(--border)]/60 bg-[var(--paper)] p-2">
          <div className="font-num truncate text-sm font-semibold text-[var(--ink)]">{formatAmount(billed)}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">Billed</div>
        </div>
        <div className="min-w-0 rounded-lg border border-[var(--teal)]/20 bg-[var(--teal-light)]/60 p-2">
          <div className="font-num truncate text-sm font-semibold text-[var(--teal)]">{formatAmount(collected)}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--teal-strong)]">Collected</div>
        </div>
        <div
          className={`min-w-0 rounded-lg border p-2 ${outstanding > 0 ? 'border-[var(--rust)]/20 bg-[var(--rust-light)]/60' : 'border-[var(--border)]/60 bg-[var(--paper)]'}`}
        >
          <div className={`font-num truncate text-sm font-semibold ${outstanding > 0 ? 'text-[var(--rust)]' : 'text-[var(--ink)]'}`}>
            {formatAmount(outstanding)}
          </div>
          <div className={`mt-0.5 text-[10px] uppercase tracking-wide ${outstanding > 0 ? 'text-[var(--rust)]' : 'text-[var(--muted)]'}`}>
            Outstanding
          </div>
        </div>
      </div>
      {billCount > 0 && (
        <button type="button" className="mt-3 text-xs font-medium text-[var(--teal)] hover:underline" onClick={onViewBills}>
          {billCount} {billCount === 1 ? 'bill' : 'bills'} · View
        </button>
      )}
    </SideCard>
  );
}
