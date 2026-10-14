import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { repos } from './local';
import type { Payment } from '@/domain/types';

const pay = (over: Partial<Payment>): Payment =>
  ({ id: 'p', clinicId: 'c1', visitId: 'v1', amountPaise: 100, method: 'cash', receivedDate: '2026-10-01', notes: null, updatedAt: '', ...over }) as Payment;

describe('payments indexes (Dexie v23)', () => {
  beforeEach(async () => {
    await db.payments.clear();
  });

  it('lists one advance\'s draw-downs by index', async () => {
    await db.payments.bulkPut([
      pay({ id: 'a', advanceId: 'adv-1' }),
      pay({ id: 'b', advanceId: 'adv-1' }),
      pay({ id: 'c', advanceId: 'adv-2' }),
      pay({ id: 'd' }),
    ]);
    expect((await repos.payments.listByAdvanceId('adv-1')).map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('lists a clinic\'s payments for one day by the compound index', async () => {
    await db.payments.bulkPut([
      pay({ id: 'a', receivedDate: '2026-10-01' }),
      pay({ id: 'b', receivedDate: '2026-10-02' }),
      pay({ id: 'c', clinicId: 'c2', receivedDate: '2026-10-01' }),
    ]);
    expect((await repos.payments.listByDate('c1', '2026-10-01')).map((p) => p.id)).toEqual(['a']);
  });
});
