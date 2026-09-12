import { beforeEach, describe, expect, it } from 'vitest';
import { createSettlementService } from './settlementService';
import type { Settlement, SettlementPayment } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { rupeesToPaise as rs } from '@/domain/money';

function makeFakeRepos() {
  const settlements = new Map<string, Settlement>();
  const settlementPayments = new Map<string, SettlementPayment>();
  const repos = {
    settlements: {
      getByPeriod: async (clinicId: string, year: number, month: number) =>
        [...settlements.values()].find(
          (s) => s.clinicId === clinicId && s.year === year && s.month === month
        ),
      list: async (clinicId: string) => [...settlements.values()].filter((s) => s.clinicId === clinicId),
      put: async (s: Settlement) => void settlements.set(s.id, s),
    },
    settlementPayments: {
      listByPeriod: async (clinicId: string, year: number, month: number) =>
        [...settlementPayments.values()].filter(
          (p) => p.clinicId === clinicId && p.year === year && p.month === month
        ),
      list: async (clinicId: string) =>
        [...settlementPayments.values()].filter((p) => p.clinicId === clinicId),
      put: async (p: SettlementPayment) => void settlementPayments.set(p.id, p),
      delete: async (id: string) => void settlementPayments.delete(id),
    },
  } as unknown as Repos;
  return { repos, settlements, settlementPayments };
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

  it('addPayment records each tranche as its own row, never overwriting a prior one', async () => {
    const svc = createSettlementService(fake.repos);
    await svc.addPayment('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(30000),
      receivedDate: '2026-07-01',
      notes: 'Advance',
    });
    await svc.addPayment('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(15000),
      receivedDate: '2026-07-20',
      notes: 'Final settlement',
    });
    expect(fake.settlementPayments.size).toBe(2);
    const list = await svc.listPayments('clinic-1', 2026, 6);
    expect(list.map((p) => p.notes)).toEqual(['Advance', 'Final settlement']);
  });

  it('totalReceived sums every tranche for the period, ignoring other periods', async () => {
    const svc = createSettlementService(fake.repos);
    await svc.addPayment('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(30000),
      receivedDate: '2026-07-01',
      notes: null,
    });
    await svc.addPayment('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(15000),
      receivedDate: '2026-07-20',
      notes: null,
    });
    await svc.addPayment('clinic-1', 2026, 7, {
      amountReceivedPaise: rs(99999),
      receivedDate: '2026-08-01',
      notes: null,
    });
    expect(await svc.totalReceived('clinic-1', 2026, 6)).toBe(rs(45000));
  });

  it('editPayment corrects a tranche in place — same id, no new row created', async () => {
    const svc = createSettlementService(fake.repos);
    const created = await svc.addPayment('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(30000),
      receivedDate: '2026-07-01',
      notes: 'Advance',
    });
    const edited = await svc.editPayment(created, {
      amountReceivedPaise: rs(32000),
      receivedDate: '2026-07-01',
      notes: 'Advance (corrected)',
    });
    expect(edited.id).toBe(created.id);
    expect(fake.settlementPayments.size).toBe(1);
    expect(await svc.totalReceived('clinic-1', 2026, 6)).toBe(rs(32000));
  });

  it('deletePayment removes just that tranche', async () => {
    const svc = createSettlementService(fake.repos);
    const first = await svc.addPayment('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(30000),
      receivedDate: '2026-07-01',
      notes: null,
    });
    await svc.addPayment('clinic-1', 2026, 6, {
      amountReceivedPaise: rs(15000),
      receivedDate: '2026-07-20',
      notes: null,
    });
    await svc.deletePayment(first.id);
    const remaining = await svc.listPayments('clinic-1', 2026, 6);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].amountReceivedPaise).toBe(rs(15000));
  });
});
