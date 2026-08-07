import { beforeEach, describe, expect, it } from 'vitest';
import { createConsultationNoteService } from './consultationNoteService';
import type { ConsultationNote, PatientModuleEnrollment } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import type { CoreAssessmentPayload } from '@/domain/coreAssessment';
import { emptyPayload } from '@/domain/coreAssessment';

function makeFakeRepos() {
  const notes = new Map<string, ConsultationNote>();
  const enrollments = new Map<string, PatientModuleEnrollment>();
  const repos = {
    consultationNotes: {
      get: async (id: string) => notes.get(id),
      listByPatient: async (clinicId: string, patientId: string) =>
        [...notes.values()]
          .filter((n) => n.clinicId === clinicId && n.patientId === patientId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      listByClinic: async (clinicId: string) =>
        [...notes.values()].filter((n) => n.clinicId === clinicId),
      getOpenDraft: async (clinicId: string, patientId: string) =>
        [...notes.values()].find(
          (n) => n.clinicId === clinicId && n.patientId === patientId && n.status === 'draft'
        ),
      listByEnrollment: async (enrollmentId: string) =>
        [...notes.values()]
          .filter((n) => n.enrollmentId === enrollmentId)
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
      put: async (n: ConsultationNote) => void notes.set(n.id, n),
    },
    patientModuleEnrollments: {
      get: async (id: string) => enrollments.get(id),
      listByPatient: async (clinicId: string, patientId: string, moduleType: PatientModuleEnrollment['moduleType']) =>
        [...enrollments.values()]
          .filter((e) => e.clinicId === clinicId && e.patientId === patientId && e.moduleType === moduleType)
          .sort((a, b) => a.enrolledAt.localeCompare(b.enrolledAt)),
      getActive: async (clinicId: string, patientId: string, moduleType: PatientModuleEnrollment['moduleType']) =>
        [...enrollments.values()].find(
          (e) => e.clinicId === clinicId && e.patientId === patientId && e.moduleType === moduleType && e.status === 'active'
        ),
      put: async (e: PatientModuleEnrollment) => void enrollments.set(e.id, e),
    },
  } as unknown as Repos;
  return { repos, notes, enrollments };
}

describe('consultationNoteService', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('lists a patient\'s notes most-recently-updated first', async () => {
    const svc = createConsultationNoteService(fake.repos);
    const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
    const a = await svc.saveAssessment(
      { clinicId: 'clinic-1', patientId: 'pat-1', therapistId: 'ther-1', visitId: null, enrollmentId: enrollment.id, noteMode: 'initial', authorizedSessionCount: null },
      emptyPayload(),
      'completed'
    );
    await new Promise((r) => setTimeout(r, 2));
    const b = await svc.saveAssessment(
      { clinicId: 'clinic-1', patientId: 'pat-1', therapistId: 'ther-1', visitId: null, enrollmentId: enrollment.id, noteMode: 'followup', authorizedSessionCount: null },
      emptyPayload(),
      'draft'
    );
    const list = await svc.listByPatient('clinic-1', 'pat-1');
    expect(list.map((n) => n.id)).toEqual([b.id, a.id]);
  });

  describe('Core Assessment: enrollment + payload', () => {
    it('creates a new active enrollment when the patient has none', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      expect(enrollment.status).toBe('active');
      expect(enrollment.moduleType).toBe('consultation_notes');
      expect(fake.enrollments.size).toBe(1);
    });

    it('reuses the existing active enrollment instead of creating a second one', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const first = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      const second = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      expect(second.id).toBe(first.id);
      expect(fake.enrollments.size).toBe(1);
    });

    it('the first note under a fresh enrollment is Initial', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      const mode = await svc.noteModeFor(enrollment.id);
      expect(mode).toBe('initial');
    });

    it('a later note under the same enrollment is Follow-up', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      await svc.saveAssessment(
        { clinicId: 'clinic-1', patientId: 'pat-1', therapistId: 'ther-1', visitId: null, enrollmentId: enrollment.id, noteMode: 'initial', authorizedSessionCount: null },
        emptyPayload(),
        'completed'
      );
      const mode = await svc.noteModeFor(enrollment.id);
      expect(mode).toBe('followup');
    });

    it('saveAssessment writes the payload plus its derived scalar fields', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      const payload: CoreAssessmentPayload = {
        ...emptyPayload(),
        painProfile: { ...emptyPayload().painProfile, nrs: 6 },
        functionalStatus: { activities: [{ label: 'Climbing stairs', baseline: 4, baselineDate: '2026-01-01', current: 7 }] },
        freeNotes: 'Tolerated session well.',
      };
      const saved = await svc.saveAssessment(
        { clinicId: 'clinic-1', patientId: 'pat-1', therapistId: 'ther-1', visitId: null, enrollmentId: enrollment.id, noteMode: 'initial', authorizedSessionCount: null },
        payload,
        'draft'
      );
      expect(saved.nrsScore).toBe(6);
      expect(saved.psfsMean).toBe(7);
      expect(saved.redFlagCount).toBe(0);
      expect(saved.notesText).toBe('Tolerated session well.');
      expect(saved.assessmentPayload).toEqual(payload);
      expect(saved.enrollmentId).toBe(enrollment.id);
    });
  });
});
