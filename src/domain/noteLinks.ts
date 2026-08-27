import type { ConsultationNote, PatientModuleEnrollment, UUID } from '@/domain/types';

/** Join consultation notes to visits for list UIs. A visit-linked note wins
 *  — this lookup stays mode-blind, since a visit has at most one note
 *  regardless of kind, no ambiguity there.
 *
 *  When the visit still needs documentation and has no linked note, the
 *  patientDraft fallback surfaces an open draft with no visit yet (v1: one
 *  draft per patient) so "+ Note" becomes "Edit" instead of starting a
 *  second note. That fallback is heavy-only: a light session note always
 *  carries a visitId (see SessionNoteEditorPage), so it can never
 *  legitimately be "a draft with no visit yet" — without this filter, an
 *  open session draft for a *different* visit could surface here as if it
 *  belonged to this one. */
export function noteForVisit(
  notes: readonly ConsultationNote[],
  visitId: UUID,
  patientId: UUID,
  needsNote: boolean
): Pick<ConsultationNote, 'id' | 'status'> | null {
  const linked = notes.find((n) => n.visitId === visitId);
  if (linked) return { id: linked.id, status: linked.status };
  if (!needsNote) return null;
  const patientDraft = notes.find(
    (n) =>
      n.patientId === patientId &&
      n.status === 'draft' &&
      (n.noteMode == null || n.noteMode === 'initial' || n.noteMode === 'followup')
  );
  return patientDraft ? { id: patientDraft.id, status: patientDraft.status } : null;
}

/**
 * Per-patient C8 gate ("can a light session note be written for this
 * patient's current episode?"), derived in-memory from an already-loaded
 * clinic-wide notes list and enrollments list — no per-row/per-patient DB
 * call. Mirrors consultationNoteService.sessionNotesAllowed's single-
 * enrollment logic (true only once a completed heavy note exists), batched
 * across every patient with an active enrollment at once, for list UIs
 * (Ledger, Workspace, Patient Profile) building many VisitCardData rows
 * from data they already hold in memory.
 */
export function sessionNotesAllowedByPatient(
  notes: readonly ConsultationNote[],
  enrollments: readonly PatientModuleEnrollment[]
): Map<UUID, boolean> {
  const hasCompletedHeavyByEnrollment = new Set<UUID>();
  for (const n of notes) {
    if (!n.enrollmentId) continue;
    if (n.status !== 'completed') continue;
    if (n.noteMode !== 'initial' && n.noteMode !== 'followup') continue;
    hasCompletedHeavyByEnrollment.add(n.enrollmentId);
  }
  const result = new Map<UUID, boolean>();
  for (const e of enrollments) {
    if (e.status !== 'active') continue;
    result.set(e.patientId, hasCompletedHeavyByEnrollment.has(e.id));
  }
  return result;
}
