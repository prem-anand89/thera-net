import { beforeEach, describe, expect, it } from 'vitest';
import { createConsultationNoteService } from './consultationNoteService';
import type { ConsultationNote } from '@/domain/types';
import type { Repos } from '@/repositories/types';

function makeFakeRepos() {
  const notes = new Map<string, ConsultationNote>();
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
      put: async (n: ConsultationNote) => void notes.set(n.id, n),
    },
  } as unknown as Repos;
  return { repos, notes };
}

describe('consultationNoteService', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('creates a new draft when the patient has none', async () => {
    const svc = createConsultationNoteService(fake.repos);
    const note = await svc.startOrContinueDraft('clinic-1', 'pat-1', 'ther-1');
    expect(note.status).toBe('draft');
    expect(note.patientId).toBe('pat-1');
    expect(fake.notes.size).toBe(1);
  });

  it('returns the existing open draft instead of creating a second one', async () => {
    const svc = createConsultationNoteService(fake.repos);
    const first = await svc.startOrContinueDraft('clinic-1', 'pat-1', 'ther-1');
    const second = await svc.startOrContinueDraft('clinic-1', 'pat-1', 'ther-1');
    expect(second.id).toBe(first.id);
    expect(fake.notes.size).toBe(1);
  });

  it('autosaves text/session-count changes to a draft', async () => {
    const svc = createConsultationNoteService(fake.repos);
    const note = await svc.startOrContinueDraft('clinic-1', 'pat-1', 'ther-1');
    const saved = await svc.saveDraft(note, {
      notesText: 'Patient reports improved ROM.',
      authorizedSessionCount: 6,
      visitId: 'visit-1',
    });
    expect(saved.notesText).toBe('Patient reports improved ROM.');
    expect(saved.authorizedSessionCount).toBe(6);
    expect(saved.visitId).toBe('visit-1');
  });

  it('refuses to autosave a note that is not a draft', async () => {
    const svc = createConsultationNoteService(fake.repos);
    const note = await svc.startOrContinueDraft('clinic-1', 'pat-1', 'ther-1');
    const completed = await svc.setStatus(note, 'completed');
    await expect(
      svc.saveDraft(completed, { notesText: 'edit', authorizedSessionCount: null, visitId: null })
    ).rejects.toThrow(/draft/);
  });

  it('transitions draft -> completed -> archived', async () => {
    const svc = createConsultationNoteService(fake.repos);
    const note = await svc.startOrContinueDraft('clinic-1', 'pat-1', 'ther-1');
    const completed = await svc.setStatus(note, 'completed');
    expect(completed.status).toBe('completed');
    const archived = await svc.setStatus(completed, 'archived');
    expect(archived.status).toBe('archived');
  });

  it('lists a patient\'s notes most-recently-updated first', async () => {
    const svc = createConsultationNoteService(fake.repos);
    const a = await svc.startOrContinueDraft('clinic-1', 'pat-1', 'ther-1');
    await svc.setStatus(a, 'completed');
    await new Promise((r) => setTimeout(r, 2));
    const b = await svc.startOrContinueDraft('clinic-1', 'pat-1', 'ther-1');
    const list = await svc.listByPatient('clinic-1', 'pat-1');
    expect(list.map((n) => n.id)).toEqual([b.id, a.id]);
  });
});
