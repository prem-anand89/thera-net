import { beforeEach, describe, expect, it } from 'vitest';
import { createExpectedVisitsService } from './expectedVisitsService';
import type { ExpectedVisit } from '@/domain/types';
import type { Repos } from '@/repositories/types';

function makeFakeRepos() {
  const entries = new Map<string, ExpectedVisit>();
  const repos = {
    expectedVisits: {
      listForDate: async (clinicId: string, visitDate: string) =>
        [...entries.values()]
          .filter((e) => e.clinicId === clinicId && e.visitDate === visitDate)
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
      put: async (e: ExpectedVisit) => void entries.set(e.id, e),
    },
  } as unknown as Repos;
  return { repos, entries };
}

describe('expectedVisitsService', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('adds an entry linked to an existing patient', async () => {
    const svc = createExpectedVisitsService(fake.repos);
    const entry = await svc.add({ clinicId: 'clinic-1', patientId: 'pat-1', timeNote: 'Around 4pm' });
    expect(entry.status).toBe('expected');
    expect(entry.patientId).toBe('pat-1');
    expect(entry.patientName).toBeNull();
  });

  it('adds a free-text entry for a not-yet-registered visitor', async () => {
    const svc = createExpectedVisitsService(fake.repos);
    const entry = await svc.add({ clinicId: 'clinic-1', patientName: 'Walk-in Ramesh', timeNote: 'Morning' });
    expect(entry.patientId).toBeNull();
    expect(entry.patientName).toBe('Walk-in Ramesh');
  });

  it('lists only today\'s entries for the clinic', async () => {
    const svc = createExpectedVisitsService(fake.repos);
    await svc.add({ clinicId: 'clinic-1', patientName: 'A', timeNote: '', visitDate: '2026-08-07' });
    await svc.add({ clinicId: 'clinic-1', patientName: 'B', timeNote: '', visitDate: '2026-08-06' });
    await svc.add({ clinicId: 'clinic-2', patientName: 'C', timeNote: '', visitDate: '2026-08-07' });
    const list = await svc.listForToday('clinic-1', '2026-08-07');
    expect(list.map((e) => e.patientName)).toEqual(['A']);
  });

  it('transitions expected -> arrived and expected -> no-show', async () => {
    const svc = createExpectedVisitsService(fake.repos);
    const entry = await svc.add({ clinicId: 'clinic-1', patientName: 'A', timeNote: '' });
    const arrived = await svc.setStatus(entry, 'arrived');
    expect(arrived.status).toBe('arrived');
    const noShow = await svc.setStatus(entry, 'no-show');
    expect(noShow.status).toBe('no-show');
  });
});
