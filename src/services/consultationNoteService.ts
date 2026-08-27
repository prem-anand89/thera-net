import type {
  ConsultationNote,
  ConsultationNoteStatus,
  PatientModuleEnrollment,
  UUID,
} from '@/domain/types';
import type { Repos } from '@/repositories/types';
import type { CoreAssessmentPayload } from '@/domain/coreAssessment';
import { computeDerivedFields } from '@/domain/coreAssessment';
import type { SessionNotePayload } from '@/domain/sessionNote';
import { computeSessionDerivedFields } from '@/domain/sessionNote';

// Core Assessment reuses the existing 'consultation_notes' module rather than
// introducing a new module key — see docs/CORE-ASSESSMENT-PORT-PLAN.md §3.
const CONSULTATION_NOTES_MODULE: PatientModuleEnrollment['moduleType'] = 'consultation_notes';

/**
 * Core Assessment note read/write, keyed off the patient's active
 * enrollment (episode of care) rather than a freestanding draft — see
 * docs/CORE-ASSESSMENT-PORT-PLAN.md.
 */
export function createConsultationNoteService(repos: Repos) {
  /**
   * Initial vs. follow-up for the HEAVY editor only — tightened to require
   * a *completed* heavy note, not just "any note exists" (the old, looser
   * check). An abandoned draft no longer counts as "the episode has
   * started" — a therapist who starts an Initial, abandons it as a draft,
   * and starts fresh gets 'initial' again, not 'followup'. Deliberate
   * behavior change, forward-only (never touches already-saved notes'
   * stored noteMode) — see Billing & Notes Rebuild Phase 2 plan.
   * Defined as a closure, not an object method, so sessionNotesAllowed
   * below can call it directly without relying on `this`.
   */
  async function heavyModeFor(enrollmentId: UUID): Promise<'initial' | 'followup'> {
    const notes = await repos.consultationNotes.listByEnrollment(enrollmentId);
    const hasCompletedHeavy = notes.some(
      (n) => n.status === 'completed' && (n.noteMode === 'initial' || n.noteMode === 'followup')
    );
    return hasCompletedHeavy ? 'followup' : 'initial';
  }

  return {
    get: (id: UUID) => repos.consultationNotes.get(id),
    listByPatient: (clinicId: UUID, patientId: UUID) =>
      repos.consultationNotes.listByPatient(clinicId, patientId),

    /**
     * The enrollment (episode of care) a new Core Assessment note should
     * attach to: the active one if it exists, otherwise a freshly created
     * one. The first note written against a freshly created enrollment is
     * Initial; every later note in the same enrollment is Follow-up (see
     * heavyModeFor below).
     */
    async getOrCreateActiveEnrollment(
      clinicId: UUID,
      patientId: UUID
    ): Promise<PatientModuleEnrollment> {
      const existing = await repos.patientModuleEnrollments.getActive(
        clinicId,
        patientId,
        CONSULTATION_NOTES_MODULE
      );
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

    heavyModeFor,

    /**
     * C8's gate: a light session note can only be written once a completed
     * heavy (initial/follow-up) assessment exists for this enrollment.
     * Derived from heavyModeFor rather than a second independent query —
     * the two facts are the same underlying check, kept in one place so
     * they can't drift apart if edited separately later.
     */
    async sessionNotesAllowed(enrollmentId: UUID): Promise<boolean> {
      const mode = await heavyModeFor(enrollmentId);
      return mode === 'followup';
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

      // Closes the loop with the "needs a note" signal visitService.create
      // opens: a note completed against a visit clears that visit's pending
      // flag. A draft save deliberately does not — the note isn't finished
      // yet, so the visit should keep prompting until it is.
      if (status === 'completed' && full.visitId) {
        const visit = await repos.visits.get(full.visitId);
        if (visit) {
          await repos.visits.put({
            ...visit,
            clinicalStatus: 'documented',
            consultationNoteId: full.id,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      return full;
    },

    /**
     * Payload-aware save for a light session (SOAP) note — draft or
     * completed. A sibling to saveAssessment, not a replacement: it
     * duplicates saveAssessment's ~12-line visit-status-clearing tail
     * rather than extracting a shared helper, so saveAssessment's own body
     * stays completely untouched — see Billing & Notes Rebuild Phase 2 plan
     * for why that trade was made deliberately (a shared-tail extraction
     * would mean editing saveAssessment to call it).
     */
    async saveSessionNote(
      note: {
        id?: UUID;
        clinicId: UUID;
        patientId: UUID;
        therapistId: UUID;
        visitId: UUID | null;
        enrollmentId: UUID;
        authorizedSessionCount: number | null;
      },
      payload: SessionNotePayload,
      status: ConsultationNoteStatus
    ): Promise<ConsultationNote> {
      const derived = computeSessionDerivedFields(payload);
      const full: ConsultationNote = {
        id: note.id ?? crypto.randomUUID(),
        clinicId: note.clinicId,
        patientId: note.patientId,
        therapistId: note.therapistId,
        visitId: note.visitId,
        enrollmentId: note.enrollmentId,
        authorizedSessionCount: note.authorizedSessionCount,
        notesText: payload.subjective.oneLiner || null,
        assessmentPayload: payload as unknown as Record<string, unknown>,
        noteMode: 'session',
        nrsScore: derived.nrsScore,
        // No PSFS, no red-flag screening in a session note by design (C4).
        // redFlagCount is `not null` at the DB layer — write 0 literally,
        // never omit it or leave it null.
        psfsMean: null,
        redFlagCount: 0,
        status,
        updatedAt: new Date().toISOString(),
      };
      await repos.consultationNotes.put(full);

      // Duplicated from saveAssessment on purpose — see doc comment above.
      if (status === 'completed' && full.visitId) {
        const visit = await repos.visits.get(full.visitId);
        if (visit) {
          await repos.visits.put({
            ...visit,
            clinicalStatus: 'documented',
            consultationNoteId: full.id,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      return full;
    },
  };
}
