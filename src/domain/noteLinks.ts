import type { ConsultationNote, UUID } from '@/domain/types';

/** Join consultation notes to visits for list UIs. A visit-linked note wins;
 *  when the visit still needs documentation and the patient has an open
 *  draft with no visit yet (v1: one draft per patient), surface that draft
 *  so "+ Note" becomes "Edit" instead of starting a second note. */
export function noteForVisit(
  notes: readonly ConsultationNote[],
  visitId: UUID,
  patientId: UUID,
  needsNote: boolean
): Pick<ConsultationNote, 'id' | 'status'> | null {
  const linked = notes.find((n) => n.visitId === visitId);
  if (linked) return { id: linked.id, status: linked.status };
  if (!needsNote) return null;
  const patientDraft = notes.find((n) => n.patientId === patientId && n.status === 'draft');
  return patientDraft ? { id: patientDraft.id, status: patientDraft.status } : null;
}
