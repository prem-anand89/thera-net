import { beforeEach, describe, expect, it } from 'vitest';
import { createSettlementService } from './settlementService';
import type { Settlement } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { rupeesToPaise as rs } from '@/domain/money';

function makeFakeRepos() {
  const settlements = new Map<string, Settlement>();
  const repos = {
    settlements: {
      getByPeriod: async (clinicId: string, year: number, month: number) =>
        [...settlements.values()].find(
          (s) => s.clinicId === clinicId && s.year === year && s.month === month
        ),
      list: async (clinicId: string) => [...settlements.values()].filter((s) => s.clinicId === clinicId),
      put: async (s: Settlement) => void settlements.set(s.id, s),
    },
  } as unknown as Repos;
  return { repos, settlements };
}

describe('settlementService', () => {
  let fake: ReturnType<typeof makeFakeRepos>;
  beforeEach(() => {
    fake = makeFakeRepos();
  });

  it('returns undefined for a period with no recorded settlement', async () => {
    const svc = createSettlementService(fake.repos);
    expect(await svc.get('clinic-1', 2026, 6)).toBeUndefined();
  });

  it('saves and round-trips a settlement for a period', async () => {
    const svc = createSettlementService(fake.repos);
    await svc.save('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(50000),
      receivedDate: '2026-07-05',
      notes: 'Bank transfer',
    });
    const found = await svc.get('clinic-1', 2026, 6);
    expect(found?.amountReceivedPaise).toBe(rs(50000));
    expect(found?.receivedDate).toBe('2026-07-05');
    expect(found?.notes).toBe('Bank transfer');
  });

  it('upserts in place for the same clinic/period rather than duplicating', async () => {
    const svc = createSettlementService(fake.repos);
    const first = await svc.save('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(40000),
      receivedDate: null,
      notes: null,
    });
    const second = await svc.save('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(45000),
      receivedDate: '2026-07-05',
      notes: 'corrected',
    });
    expect(second.id).toBe(first.id);
    expect(fake.settlements.size).toBe(1);
    expect((await svc.get('clinic-1', 2026, 6))?.amountReceivedPaise).toBe(rs(45000));
  });

  it('keeps different months/clinics as separate records', async () => {
    const svc = createSettlementService(fake.repos);
    await svc.save('clinic-1', 2026, 5, { amountReceivedPaise: rs(1000), receivedDate: null, notes: null });
    await svc.save('clinic-1', 2026, 6, { amountReceivedPaise: rs(2000), receivedDate: null, notes: null });
    expect(fake.settlements.size).toBe(2);
  });
});
