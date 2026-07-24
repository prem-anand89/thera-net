import type { ConsultationNote, ConsultationNoteStatus, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';

/**
 * Draft/complete/archive transitions for consultation notes. One open draft
 * per patient at a time (v1 constraint, avoids orphaned half-written
 * drafts): starting a new note returns the existing draft instead of
 * creating a second one.
 */
export function createConsultationNoteService(repos: Repos) {
  return {
    get: (id: UUID) => repos.consultationNotes.get(id),
    listByPatient: (clinicId: UUID, patientId: UUID) =>
      repos.consultationNotes.listByPatient(clinicId, patientId),

    /** Returns the patient's open draft if one exists, otherwise creates one. */
    async startOrContinueDraft(
      clinicId: UUID,
      patientId: UUID,
      therapistId: UUID,
      visitId: UUID | null = null
    ): Promise<ConsultationNote> {
      const existing = await repos.consultationNotes.getOpenDraft(clinicId, patientId);
      if (existing) return existing;

      const note: ConsultationNote = {
        id: crypto.randomUUID(),
        clinicId,
        patientId,
        therapistId,
        visitId,
        authorizedSessionCount: null,
        notesText: null,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      };
      await repos.consultationNotes.put(note);
      return note;
    },

    /** Autosave — draft only, no status transition. */
    async saveDraft(
      note: ConsultationNote,
      changes: Pick<ConsultationNote, 'notesText' | 'authorizedSessionCount' | 'visitId'>
    ): Promise<ConsultationNote> {
      if (note.status !== 'draft') {
        throw new Error('Only a draft note can be autosaved');
      }
      const updated: ConsultationNote = {
        ...note,
        ...changes,
        updatedAt: new Date().toISOString(),
      };
      await repos.consultationNotes.put(updated);
      return updated;
    },

    async setStatus(note: ConsultationNote, status: ConsultationNoteStatus): Promise<ConsultationNote> {
      const updated: ConsultationNote = { ...note, status, updatedAt: new Date().toISOString() };
      await repos.consultationNotes.put(updated);
      return updated;
    },
  };
}
