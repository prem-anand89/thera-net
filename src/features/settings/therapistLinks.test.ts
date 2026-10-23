import { describe, expect, it } from 'vitest';
import type { Repos } from '@/repositories/types';
import type { ConsultationNote, Invoice, Visit, VisitCredit, VisitItem } from '@/domain/types';
import { countTherapistLinkedRecords } from './therapistLinks';

function fakeRepos(data: {
  visits?: Partial<Visit>[];
  items?: Partial<VisitItem>[];
  credits?: Partial<VisitCredit>[];
  notes?: Partial<ConsultationNote>[];
  invoices?: Partial<Invoice>[];
}) {
  return {
    visits: { list: async () => (data.visits ?? []) as Visit[] },
    visitItems: { listByClinicIncludingDeleted: async () => (data.items ?? []) as VisitItem[] },
    visitCredits: { listByClinicIncludingDeleted: async () => (data.credits ?? []) as VisitCredit[] },
    consultationNotes: { listByClinic: async () => (data.notes ?? []) as ConsultationNote[] },
    invoices: { list: async () => (data.invoices ?? []) as Invoice[] },
  } as unknown as Repos;
}

describe('countTherapistLinkedRecords', () => {
  it('counts nothing for a therapist with no history', async () => {
    const repos = fakeRepos({ visits: [{ id: 'v1', therapistId: 'other' }] });
    expect(await countTherapistLinkedRecords(repos, 'c1', 't-new')).toBe(0);
  });

  it('counts a visit the therapist only assisted on, even when the line was removed later', async () => {
    const repos = fakeRepos({
      visits: [{ id: 'v1', therapistId: 'other' }],
      items: [{ id: 'i1', visitId: 'v1', assistingTherapistId: 't-asst', deleted: true }],
    });
    expect(await countTherapistLinkedRecords(repos, 'c1', 't-asst')).toBe(1);
  });

  it('counts a visit where the therapist only holds a revenue share row', async () => {
    const repos = fakeRepos({
      visits: [{ id: 'v1', therapistId: 'other' }],
      credits: [{ id: 'c1', visitId: 'v1', therapistId: 't-share', deleted: false }],
    });
    expect(await countTherapistLinkedRecords(repos, 'c1', 't-share')).toBe(1);
  });

  it('counts each visit once however it is linked, plus notes and invoices', async () => {
    const repos = fakeRepos({
      visits: [{ id: 'v1', therapistId: 't1' }, { id: 'v2', therapistId: 'other', sharedTherapistId: 't1' }],
      items: [
        { id: 'i1', visitId: 'v2', assistingTherapistId: 't1', deleted: false },
        { id: 'i2', visitId: 'v3', assistingTherapistId: 't1', deleted: false },
      ],
      credits: [
        { id: 'c1', visitId: 'v1', therapistId: 't1', deleted: false },
        { id: 'c2', visitId: 'v3', therapistId: 't1', deleted: false },
      ],
      notes: [{ id: 'n1', therapistId: 't1' }],
      invoices: [{ id: 'inv1', therapistId: 't1' }],
    });
    // visits v1, v2, v3 + one note + one invoice
    expect(await countTherapistLinkedRecords(repos, 'c1', 't1')).toBe(5);
  });
});
