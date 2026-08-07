import type { ConsultationNote, ConsultationNoteStatus, PatientModuleEnrollment, UUID } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import type { CoreAssessmentPayload } from '@/domain/coreAssessment';
import { computeDerivedFields } from '@/domain/coreAssessment';

// Core Assessment reuses the existing 'consultation_notes' module rather than
// introducing a new module key — see docs/CORE-ASSESSMENT-PORT-PLAN.md §3.
const CONSULTATION_NOTES_MODULE: PatientModuleEnrollment['moduleType'] = 'consultation_notes';

/**
 * Core Assessment note read/write, keyed off the patient's active
 * enrollment (episode of care) rather than a freestanding draft — see
 * docs/CORE-ASSESSMENT-PORT-PLAN.md.
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
  };
}
