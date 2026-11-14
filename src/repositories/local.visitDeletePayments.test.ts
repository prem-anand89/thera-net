import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Payment, Visit } from '@/domain/types';

/**
 * Deleting a visit must take the money recorded against it with it. Payments have no "deleted" flag, so a payment
 * left behind kept counting in the Daybook and the collected totals for a visit nobody could see any more.
 */

const visit = (id: string, over: Partial<Visit> = {}): Visit =>
  ({
    id, clinicId: 'c1', patientId: 'p1', therapistId: 't1', visitDate: '2026-11-12', condition: null, treatmentNotes: null,
    serviceCatalogId: 's1', catalogPricePaise: 150000, actualBillPaise: 150000, adjustmentPaise: 0, adjustmentReason: null,
    sessionIndex: null, packageTotal: null, packageGroupId: null, clinicSplitPct: 100, taxPct: 0, tdsBasis: 'gross_bill',
    clinicSharePaise: 150000, postTaxPaise: 150000, tdsPaise: 0, partnerSharePaise: 0, invoiceId: null, pendingPaymentNote: null,
    deleted: false, clinicalStatus: 'pending', updatedAt: '2026-11-12T00:00:00.000Z', ...over,
  }) as Visit;

const payment = (id: string, visitId: string): Payment => ({
  id, clinicId: 'c1', visitId, amountPaise: 150000, method: 'upi', receivedDate: '2026-11-12', notes: null, updatedAt: '2026-11-12T00:00:00.000Z',
});

describe('repos.visits.softDelete and payments', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let repos: (typeof import('./local'))['repos'];

  beforeEach(async () => {
    const dbMod = await import('@/lib/db');
    const localMod = await import('./local');
    db = dbMod.db;
    repos = localMod.repos;
    await Promise.all([db.visits.clear(), db.payments.clear(), db.outbox.clear()]);
  });

  it('removes that visit\'s payments from this device, and leaves other visits\' payments alone', async () => {
    await db.visits.bulkPut([visit('v1'), visit('v2')]);
    await db.payments.bulkPut([payment('pay1', 'v1'), payment('pay2', 'v1'), payment('pay3', 'v2')]);

    await repos.visits.softDelete('v1');

    expect((await db.visits.get('v1'))?.deleted).toBe(true);
    expect((await db.payments.toArray()).map((p) => p.id)).toEqual(['pay3']);
  });

  it('drops those payments\' queued uploads, so a never-synced payment is not sent for a deleted visit', async () => {
    await db.visits.put(visit('v1'));
    await db.payments.bulkPut([payment('pay1', 'v1'), payment('pay2', 'other-visit')]);
    await db.outbox.bulkAdd([
      { table: 'payments', rowId: 'pay1', ts: 1 },
      { table: 'payments', rowId: 'pay2', ts: 2 },
    ]);

    await repos.visits.softDelete('v1');

    const queued = (await db.outbox.toArray()).filter((e) => e.table === 'payments').map((e) => e.rowId);
    expect(queued).toEqual(['pay2']);
    expect((await db.outbox.toArray()).some((e) => e.table === 'visits' && e.rowId === 'v1')).toBe(true);
  });

  it('a visit with no payments still deletes', async () => {
    await db.visits.put(visit('v1'));
    await repos.visits.softDelete('v1');
    expect((await db.visits.get('v1'))?.deleted).toBe(true);
  });

  it('an invoiced visit still cannot be deleted, and keeps its payments', async () => {
    await db.visits.put(visit('v1', { invoiceId: 'inv1' }));
    await db.payments.put(payment('pay1', 'v1'));
    await expect(repos.visits.softDelete('v1')).rejects.toThrow(/issued invoice/);
    expect(await db.payments.count()).toBe(1);
  });
});
