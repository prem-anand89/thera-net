import type { ConsultationNote, ConsultationNoteStatus, PatientModuleEnrollment, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import type { CoreAssessmentPayload } from '@/domain/coreAssessment';
import { computeDerivedFields } from '@/domain/coreAssessment';

// Core Assessment reuses the existing 'consultation_notes' module rather than
// introducing a new module key — see docs/CORE-ASSESSMENT-PORT-PLAN.md §3.
const CONSULTATION_NOTES_MODULE: PatientModuleEnrollment['moduleType'] = 'consultation_notes';

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

    /**
     * The enrollment (episode of care) a new Core Assessment note should
     * attach to: the active one if it exists, otherwise a freshly created
     * one. The first note written against a freshly created enrollment is
     * Initial; every later note in the same enrollment is Follow-up (see
     * noteModeFor below).
     */
    async getOrCreateActiveEnrollment(clinicId: UUID, patientId: UUID): Promise<PatientModuleEnrollment> {
      const existing = await repos.patientModuleEnrollments.getActive(clinicId, patientId, CONSULTATION_NOTES_MODULE);
      if (existing) return existing;
      const enrollment: PatientModuleEnrollment = {
        id: crypto.randomUUID(),
        clinicId,
        patientId,
        moduleType: CONSULTATION_NOTES_MODULE,
        status: 'active',
        enrolledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await repos.patientModuleEnrollments.put(enrollment);
      return enrollment;
    },

    async noteModeFor(enrollmentId: UUID): Promise<'initial' | 'followup'> {
      const notes = await repos.consultationNotes.listByEnrollment(enrollmentId);
      return notes.length === 0 ? 'initial' : 'followup';
    },

    /** Payload-aware save for a Core Assessment note — draft or completed. */
    async saveAssessment(
      note: {
        id?: UUID;
        clinicId: UUID;
        patientId: UUID;
        therapistId: UUID;
        visitId: UUID | null;
        enrollmentId: UUID;
        noteMode: 'initial' | 'followup';
        authorizedSessionCount: number | null;
      },
      payload: CoreAssessmentPayload,
      status: ConsultationNoteStatus
    ): Promise<ConsultationNote> {
      const derived = computeDerivedFields(payload);
      const full: ConsultationNote = {
        id: note.id ?? crypto.randomUUID(),
        clinicId: note.clinicId,
        patientId: note.patientId,
        therapistId: note.therapistId,
        visitId: note.visitId,
        enrollmentId: note.enrollmentId,
        authorizedSessionCount: note.authorizedSessionCount,
        notesText: payload.freeNotes || null,
        assessmentPayload: payload as unknown as Record<string, unknown>,
        noteMode: note.noteMode,
        nrsScore: derived.nrsScore,
        psfsMean: derived.psfsMean,
        redFlagCount: derived.redFlagCount,
        status,
        updatedAt: new Date().toISOString(),
      };
      await repos.consultationNotes.put(full);
      return full;
    },

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
        // Enrollment/payload wiring lands in a later step (see
        // docs/CORE-ASSESSMENT-PORT-PLAN.md §4.4) — a plain draft today has
        // no assessment payload, same as before this type extension.
        enrollmentId: null,
        assessmentPayload: null,
        noteMode: null,
        nrsScore: null,
        psfsMean: null,
        redFlagCount: 0,
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
