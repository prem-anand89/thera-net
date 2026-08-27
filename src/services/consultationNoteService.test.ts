import { beforeEach, describe, expect, it } from 'vitest';
import { createConsultationNoteService } from './consultationNoteService';
import type { ConsultationNote, PatientModuleEnrollment, Visit } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import type { CoreAssessmentPayload } from '@/domain/coreAssessment';
import { emptyPayload } from '@/domain/coreAssessment';
import type { SessionNotePayload } from '@/domain/sessionNote';
import { emptySessionPayload } from '@/domain/sessionNote';

function makeFakeRepos() {
  const notes = new Map<string, ConsultationNote>();
  const enrollments = new Map<string, PatientModuleEnrollment>();
  const visits = new Map<string, Visit>();
  const repos = {
    consultationNotes: {
      get: async (id: string) => notes.get(id),
      listByPatient: async (clinicId: string, patientId: string) =>
        [...notes.values()]
          .filter((n) => n.clinicId === clinicId && n.patientId === patientId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      listByClinic: async (clinicId: string) =>
        [...notes.values()].filter((n) => n.clinicId === clinicId),
      getOpenDraft: async (
        clinicId: string,
        patientId: string,
        modes: string[],
        visitId?: string | null
      ) =>
        [...notes.values()].find(
          (n) =>
            n.clinicId === clinicId &&
            n.patientId === patientId &&
            n.status === 'draft' &&
            modes.includes(n.noteMode ?? 'initial') &&
            (visitId == null || n.visitId === visitId)
        ),
      listByEnrollment: async (enrollmentId: string) =>
        [...notes.values()]
          .filter((n) => n.enrollmentId === enrollmentId)
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
      put: async (n: ConsultationNote) => void notes.set(n.id, n),
    },
    patientModuleEnrollments: {
      get: async (id: string) => enrollments.get(id),
      listByPatient: async (
        clinicId: string,
        patientId: string,
        moduleType: PatientModuleEnrollment['moduleType']
      ) =>
        [...enrollments.values()]
          .filter(
            (e) =>
              e.clinicId === clinicId && e.patientId === patientId && e.moduleType === moduleType
          )
          .sort((a, b) => a.enrolledAt.localeCompare(b.enrolledAt)),
      getActive: async (
        clinicId: string,
        patientId: string,
        moduleType: PatientModuleEnrollment['moduleType']
      ) =>
        [...enrollments.values()].find(
          (e) =>
            e.clinicId === clinicId &&
            e.patientId === patientId &&
            e.moduleType === moduleType &&
            e.status === 'active'
        ),
      put: async (e: PatientModuleEnrollment) => void enrollments.set(e.id, e),
    },
    visits: {
      get: async (id: string) => visits.get(id),
      put: async (v: Visit) => void visits.set(v.id, v),
    },
  } as unknown as Repos;
  return { repos, notes, enrollments, visits };
}

function seedVisit(visits: Map<string, Visit>, id: string, overrides: Partial<Visit> = {}): Visit {
  const visit = {
    id,
    clinicId: 'clinic-1',
    patientId: 'pat-1',
    therapistId: 'ther-1',
    visitDate: '2026-01-01',
    condition: null,
    treatmentNotes: null,
    serviceCatalogId: 'svc-1',
    catalogPricePaise: 0,
    actualBillPaise: 0,
    adjustmentPaise: 0,
    adjustmentReason: null,
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    bmSplitPct: 100,
    taxPct: 0,
    tdsBasis: 'gross_bill',
    bmSharePaise: 0,
    postTaxPaise: 0,
    tdsPaise: 0,
    hvPaise: 0,
    invoiceId: null,
    pendingPaymentNote: null,
    deleted: false,
    clinicalStatus: 'pending',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Visit;
  visits.set(id, visit);
  return visit;
}

describe('consultationNoteService', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it("lists a patient's notes most-recently-updated first", async () => {
    const svc = createConsultationNoteService(fake.repos);
    const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
    const a = await svc.saveAssessment(
      {
        clinicId: 'clinic-1',
        patientId: 'pat-1',
        therapistId: 'ther-1',
        visitId: null,
        enrollmentId: enrollment.id,
        noteMode: 'initial',
        authorizedSessionCount: null,
      },
      emptyPayload(),
      'completed'
    );
    await new Promise((r) => setTimeout(r, 2));
    const b = await svc.saveAssessment(
      {
        clinicId: 'clinic-1',
        patientId: 'pat-1',
        therapistId: 'ther-1',
        visitId: null,
        enrollmentId: enrollment.id,
        noteMode: 'followup',
        authorizedSessionCount: null,
      },
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
      const mode = await svc.heavyModeFor(enrollment.id);
      expect(mode).toBe('initial');
    });

    it('a later note under the same enrollment is Follow-up', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      await svc.saveAssessment(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: null,
          enrollmentId: enrollment.id,
          noteMode: 'initial',
          authorizedSessionCount: null,
        },
        emptyPayload(),
        'completed'
      );
      const mode = await svc.heavyModeFor(enrollment.id);
      expect(mode).toBe('followup');
    });

    it('an abandoned draft initial does not count — the next note is still Initial', async () => {
      // Tightened behavior (Billing & Notes Rebuild Phase 2): only a
      // *completed* heavy note promotes the enrollment past 'initial'.
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      await svc.saveAssessment(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: null,
          enrollmentId: enrollment.id,
          noteMode: 'initial',
          authorizedSessionCount: null,
        },
        emptyPayload(),
        'draft'
      );
      const mode = await svc.heavyModeFor(enrollment.id);
      expect(mode).toBe('initial');
    });

    it('saveAssessment writes the payload plus its derived scalar fields', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      const payload: CoreAssessmentPayload = {
        ...emptyPayload(),
        painProfile: {
          ...emptyPayload().painProfile,
          nrs: { current: 6, best: null, worst: null },
        },
        functionalStatus: {
          activities: [
            { label: 'Climbing stairs', baseline: 4, baselineDate: '2026-01-01', current: 7 },
          ],
        },
        freeNotes: 'Tolerated session well.',
      };
      const saved = await svc.saveAssessment(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: null,
          enrollmentId: enrollment.id,
          noteMode: 'initial',
          authorizedSessionCount: null,
        },
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

  describe('saveSessionNote: light SOAP note', () => {
    it('writes the payload plus its derived scalar fields', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      const payload: SessionNotePayload = {
        ...emptySessionPayload(enrollment.id),
        subjective: { painNrs: 4, oneLiner: 'Tolerated session well.' },
        intervention: { treatments: ['Ultrasound'] },
        assessment: 'improving',
        plan: 'continue',
      };
      const saved = await svc.saveSessionNote(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: null,
          enrollmentId: enrollment.id,
          authorizedSessionCount: null,
        },
        payload,
        'draft'
      );
      expect(saved.noteMode).toBe('session');
      expect(saved.nrsScore).toBe(4);
      expect(saved.psfsMean).toBeNull();
      expect(saved.redFlagCount).toBe(0);
      expect(saved.notesText).toBe('Tolerated session well.');
      expect(saved.assessmentPayload).toEqual(payload);
      expect(saved.enrollmentId).toBe(enrollment.id);
    });

    it('falls back notesText to null when there is no one-liner', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      const saved = await svc.saveSessionNote(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: null,
          enrollmentId: enrollment.id,
          authorizedSessionCount: null,
        },
        emptySessionPayload(enrollment.id),
        'draft'
      );
      expect(saved.notesText).toBeNull();
    });

    it('marks a linked visit documented only when completed, same as saveAssessment', async () => {
      seedVisit(fake.visits, 'visit-1');
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      const note = await svc.saveSessionNote(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: 'visit-1',
          enrollmentId: enrollment.id,
          authorizedSessionCount: null,
        },
        emptySessionPayload(enrollment.id),
        'completed'
      );
      const visit = fake.visits.get('visit-1')!;
      expect(visit.clinicalStatus).toBe('documented');
      expect(visit.consultationNoteId).toBe(note.id);
    });

    it('leaves the visit pending while the session note is still a draft', async () => {
      seedVisit(fake.visits, 'visit-1');
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      await svc.saveSessionNote(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: 'visit-1',
          enrollmentId: enrollment.id,
          authorizedSessionCount: null,
        },
        emptySessionPayload(enrollment.id),
        'draft'
      );
      const visit = fake.visits.get('visit-1')!;
      expect(visit.clinicalStatus).toBe('pending');
      expect(visit.consultationNoteId).toBeUndefined();
    });
  });

  describe('closing the loop with a linked visit', () => {
    it('marks the visit documented when a note tied to it is completed', async () => {
      seedVisit(fake.visits, 'visit-1');
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      const note = await svc.saveAssessment(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: 'visit-1',
          enrollmentId: enrollment.id,
          noteMode: 'initial',
          authorizedSessionCount: null,
        },
        emptyPayload(),
        'completed'
      );
      const visit = fake.visits.get('visit-1')!;
      expect(visit.clinicalStatus).toBe('documented');
      expect(visit.consultationNoteId).toBe(note.id);
    });

    it('leaves the visit pending while the note is still a draft', async () => {
      seedVisit(fake.visits, 'visit-1');
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      await svc.saveAssessment(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: 'visit-1',
          enrollmentId: enrollment.id,
          noteMode: 'initial',
          authorizedSessionCount: null,
        },
        emptyPayload(),
        'draft'
      );
      const visit = fake.visits.get('visit-1')!;
      expect(visit.clinicalStatus).toBe('pending');
      expect(visit.consultationNoteId).toBeUndefined();
    });

    it('does nothing to the visit table when the note has no linked visit', async () => {
      const svc = createConsultationNoteService(fake.repos);
      const enrollment = await svc.getOrCreateActiveEnrollment('clinic-1', 'pat-1');
      await svc.saveAssessment(
        {
          clinicId: 'clinic-1',
          patientId: 'pat-1',
          therapistId: 'ther-1',
          visitId: null,
          enrollmentId: enrollment.id,
          noteMode: 'initial',
          authorizedSessionCount: null,
        },
        emptyPayload(),
        'completed'
      );
      expect(fake.visits.size).toBe(0);
    });
  });
});
