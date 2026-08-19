import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Visit } from '@/domain/types';

/**
 * Exercises visits.list() against a real Dexie/IndexedDB (via
 * fake-indexeddb), not a repo fake — the thing under test here is the
 * [clinicId+visitDate] compound-index query path itself, which an
 * in-memory Repos double can't catch a mistake in.
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
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  } as Visit;
}

describe('local repos: visits.list (real Dexie)', () => {
  let db: (typeof import('@/lib/db'))['db'];
  let repos: (typeof import('./local'))['repos'];

  beforeEach(async () => {
    // Fresh module registry per test so each gets its own in-memory
    // IndexedDB database instead of accumulating rows across tests.
    const dbMod = await import('@/lib/db');
    const localMod = await import('./local');
    db = dbMod.db;
    repos = localMod.repos;
    await db.visits.clear();
  });

  it('returns only visits within an inclusive date range, across clinics', async () => {
    await db.visits.bulkPut([
      makeVisit({ id: 'v-before', visitDate: '2026-06-01' }),
      makeVisit({ id: 'v-lower-bound', visitDate: '2026-06-10' }),
      makeVisit({ id: 'v-in-range', visitDate: '2026-06-15' }),
      makeVisit({ id: 'v-upper-bound', visitDate: '2026-06-20' }),
      makeVisit({ id: 'v-after', visitDate: '2026-06-25' }),
      makeVisit({ id: 'v-other-clinic', clinicId: 'clinic-2', visitDate: '2026-06-15' }),
    ]);

    const rows = await repos.visits.list({ clinicId: 'clinic-1', from: '2026-06-10', to: '2026-06-20' });

    expect(rows.map((v) => v.id).sort()).toEqual(['v-in-range', 'v-lower-bound', 'v-upper-bound'].sort());
  });

  it('supports an open-ended range (from only, or to only)', async () => {
    await db.visits.bulkPut([
      makeVisit({ id: 'v-jan', visitDate: '2026-01-01' }),
      makeVisit({ id: 'v-jun', visitDate: '2026-06-15' }),
      makeVisit({ id: 'v-dec', visitDate: '2026-12-31' }),
    ]);

    const fromJune = await repos.visits.list({ clinicId: 'clinic-1', from: '2026-06-01' });
    expect(fromJune.map((v) => v.id).sort()).toEqual(['v-dec', 'v-jun'].sort());

    const toJune = await repos.visits.list({ clinicId: 'clinic-1', to: '2026-06-30' });
    expect(toJune.map((v) => v.id).sort()).toEqual(['v-jan', 'v-jun'].sort());
  });

  it('excludes soft-deleted visits and applies therapist/patient filters within the date range', async () => {
    await db.visits.bulkPut([
      makeVisit({ id: 'v-deleted', visitDate: '2026-06-15', deleted: true }),
      makeVisit({ id: 'v-other-therapist', visitDate: '2026-06-15', therapistId: 'ther-2' }),
      makeVisit({ id: 'v-match', visitDate: '2026-06-15', therapistId: 'ther-1', patientId: 'pat-1' }),
    ]);

    const rows = await repos.visits.list({
      clinicId: 'clinic-1',
      from: '2026-06-01',
      to: '2026-06-30',
      therapistId: 'ther-1',
      patientId: 'pat-1',
    });

    expect(rows.map((v) => v.id)).toEqual(['v-match']);
  });

  it('falls back to a full clinic scan when no date range is given', async () => {
    await db.visits.bulkPut([
      makeVisit({ id: 'v-old', visitDate: '2020-01-01' }),
      makeVisit({ id: 'v-new', visitDate: '2026-06-15' }),
    ]);

    const rows = await repos.visits.list({ clinicId: 'clinic-1' });
    expect(rows.map((v) => v.id).sort()).toEqual(['v-new', 'v-old'].sort());
  });

  it('sorts newest visit date first, then most-recently-updated first within a date', async () => {
    await db.visits.bulkPut([
      makeVisit({ id: 'v-earlier-update', visitDate: '2026-06-15', updatedAt: '2026-06-15T08:00:00.000Z' }),
      makeVisit({ id: 'v-later-update', visitDate: '2026-06-15', updatedAt: '2026-06-15T09:00:00.000Z' }),
      makeVisit({ id: 'v-later-date', visitDate: '2026-06-16', updatedAt: '2026-06-16T00:00:00.000Z' }),
    ]);

    const rows = await repos.visits.list({ clinicId: 'clinic-1', from: '2026-06-01', to: '2026-06-30' });
    expect(rows.map((v) => v.id)).toEqual(['v-later-date', 'v-later-update', 'v-earlier-update']);
  });
});
