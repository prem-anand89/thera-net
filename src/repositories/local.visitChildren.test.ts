import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Visit, VisitCredit, VisitItem } from '@/domain/types';

/**
 * visit_items / visit_credits repos against a real Dexie (fake-indexeddb): the version(26) indexes, the
 * outbox queueing on bulkPut, and the visit-date range that goes through the parent visits.
 */

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: crypto.randomUUID(),
    clinicId: 'clinic-1',
    patientId: 'pat-1',
    therapistId: 'ther-1',
    visitDate: '2026-06-15',
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
    clinicSplitPct: 100,
    taxPct: 0,
    tdsBasis: 'gross_bill',
    clinicSharePaise: 0,
    postTaxPaise: 0,
    tdsPaise: 0,
    partnerSharePaise: 0,
    invoiceId: null,
    deleted: false,
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<VisitItem> = {}): VisitItem {
  return {
    id: crypto.randomUUID(),
    clinicId: 'clinic-1',
    visitId: 'v-1',
    position: 0,
    serviceCatalogId: 'svc-1',
    serviceName: 'Physio session',
    catalogPricePaise: 100000,
    pricePaise: 100000,
    assistingTherapistId: null,
    durationMinutes: 45,
    isPackageLine: false,
    deleted: false,
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeCredit(overrides: Partial<VisitCredit> = {}): VisitCredit {
  return {
    id: crypto.randomUUID(),
    clinicId: 'clinic-1',
    visitId: 'v-1',
    therapistId: 'ther-1',
    amountPaise: 100000,
    deleted: false,
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('local repos: visitItems / visitCredits (real Dexie)', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let repos: (typeof import('./local'))['repos'];

  beforeEach(async () => {
    const dbMod = await import('@/lib/db');
    const localMod = await import('./local');
    db = dbMod.db;
    repos = localMod.repos;
    await Promise.all([db.visits.clear(), db.visit_items.clear(), db.visit_credits.clear(), db.outbox.clear()]);
  });

  it('bulkPut stores every line and queues each one for sync', async () => {
    const rows = [makeItem({ id: 'i-1' }), makeItem({ id: 'i-2', position: 1 })];
    await repos.visitItems.bulkPut(rows);

    expect((await db.visit_items.toArray()).map((r) => r.id).sort()).toEqual(['i-1', 'i-2']);
    const outbox = await db.outbox.toArray();
    expect(outbox.map((e) => [e.table, e.rowId]).sort()).toEqual([
      ['visit_items', 'i-1'],
      ['visit_items', 'i-2'],
    ]);
  });

  it('bulkPut with no rows writes nothing', async () => {
    await repos.visitCredits.bulkPut([]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('listByVisitIds returns only the asked visits and skips deleted rows', async () => {
    await db.visit_items.bulkPut([
      makeItem({ id: 'a', visitId: 'v-1' }),
      makeItem({ id: 'b', visitId: 'v-2' }),
      makeItem({ id: 'c', visitId: 'v-1', deleted: true }),
      makeItem({ id: 'd', visitId: 'v-3' }),
    ]);
    const rows = await repos.visitItems.listByVisitIds(['v-1', 'v-2']);
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(await repos.visitItems.listByVisitIds([])).toEqual([]);
  });

  it('listByClinic without a range returns the clinic’s live rows', async () => {
    await db.visit_credits.bulkPut([
      makeCredit({ id: 'a' }),
      makeCredit({ id: 'b', clinicId: 'clinic-2' }),
      makeCredit({ id: 'c', deleted: true }),
    ]);
    const rows = await repos.visitCredits.listByClinic('clinic-1');
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('listByClinic with a range filters by the parent visit’s date (inclusive) and skips deleted visits', async () => {
    await db.visits.bulkPut([
      makeVisit({ id: 'v-before', visitDate: '2026-06-01' }),
      makeVisit({ id: 'v-from', visitDate: '2026-06-10' }),
      makeVisit({ id: 'v-to', visitDate: '2026-06-20' }),
      makeVisit({ id: 'v-deleted', visitDate: '2026-06-15', deleted: true }),
      makeVisit({ id: 'v-other-clinic', clinicId: 'clinic-2', visitDate: '2026-06-15' }),
    ]);
    await db.visit_items.bulkPut([
      makeItem({ id: 'i-before', visitId: 'v-before' }),
      makeItem({ id: 'i-from', visitId: 'v-from' }),
      makeItem({ id: 'i-to', visitId: 'v-to' }),
      makeItem({ id: 'i-to-deleted', visitId: 'v-to', deleted: true }),
      makeItem({ id: 'i-deleted-visit', visitId: 'v-deleted' }),
      makeItem({ id: 'i-other', clinicId: 'clinic-2', visitId: 'v-other-clinic' }),
    ]);
    await db.visit_credits.bulkPut([makeCredit({ id: 'c-from', visitId: 'v-from' })]);

    const items = await repos.visitItems.listByClinic('clinic-1', { from: '2026-06-10', to: '2026-06-20' });
    expect(items.map((r) => r.id).sort()).toEqual(['i-from', 'i-to']);
    const credits = await repos.visitCredits.listByClinic('clinic-1', { from: '2026-06-10', to: '2026-06-20' });
    expect(credits.map((r) => r.id)).toEqual(['c-from']);
  });

  it('putWithChildren writes visit, lines and shares in one go and queues them in that order', async () => {
    const visit = makeVisit({ id: 'v-1' });
    await repos.visits.putWithChildren(
      visit,
      [makeItem({ id: 'i-old', deleted: true }), makeItem({ id: 'i-new', position: 1 })],
      [makeCredit({ id: 'c-1' })]
    );
    expect((await db.visits.get('v-1'))?.id).toBe('v-1');
    expect(await db.visit_items.count()).toBe(2);
    expect(await db.visit_credits.count()).toBe(1);
    const outbox = (await db.outbox.orderBy('seq').toArray()).map((e) => `${e.table}:${e.rowId}`);
    expect(outbox).toEqual(['visits:v-1', 'visit_items:i-old', 'visit_items:i-new', 'visit_credits:c-1']);
  });

  it('putWithChildren with itemsFirst queues the lines before the visit row', async () => {
    await repos.visits.putWithChildren(makeVisit({ id: 'v-1' }), [makeItem({ id: 'i-1' })], [], {
      itemsFirst: true,
    });
    const outbox = (await db.outbox.orderBy('seq').toArray()).map((e) => `${e.table}:${e.rowId}`);
    expect(outbox).toEqual(['visit_items:i-1', 'visits:v-1']);
  });

  it('countByService counts visits on the service and live lines on it, not deleted lines', async () => {
    await db.visits.bulkPut([makeVisit({ id: 'v-a', serviceCatalogId: 'svc-a' })]);
    await db.visit_items.bulkPut([
      makeItem({ id: 'l-1', visitId: 'v-a', serviceCatalogId: 'svc-a' }),
      makeItem({ id: 'l-2', visitId: 'v-a', serviceCatalogId: 'svc-extra' }),
      makeItem({ id: 'l-3', visitId: 'v-a', serviceCatalogId: 'svc-gone', deleted: true }),
    ]);
    expect(await repos.visits.countByService('svc-extra')).toBe(1); // only ever a later line
    expect(await repos.visits.countByService('svc-a')).toBe(2);
    expect(await repos.visits.countByService('svc-gone')).toBe(0);
  });
});
