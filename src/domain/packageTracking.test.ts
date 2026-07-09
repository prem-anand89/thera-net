import { describe, expect, it } from 'vitest';
import { daysSince, groupOpenPackages, isStale, STALE_PACKAGE_DAYS } from './packageTracking';
import type { Visit } from './types';

function makeVisit(overrides: Partial<Visit> & Pick<Visit, 'id' | 'visitDate'>): Visit {
  return {
    clinicId: 'clinic-1',
    patientId: 'pat-1',
    therapistId: 'th-1',
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
    bmSplitPct: 75,
    taxPct: 10,
    tdsBasis: 'gross_bill',
    bmSharePaise: 0,
    postTaxPaise: 0,
    tdsPaise: 0,
    hvPaise: 0,
    invoiceId: null,
    deleted: false,
    updatedAt: '',
    ...overrides,
  };
}

describe('groupOpenPackages', () => {
  it('excludes visits with no packageGroupId (standalone sessions)', () => {
    const visits = [makeVisit({ id: 'v1', visitDate: '2026-06-01', packageGroupId: null })];
    expect(groupOpenPackages(visits)).toEqual([]);
  });

  it('excludes deleted visits', () => {
    const visits = [
      makeVisit({ id: 'v1', visitDate: '2026-06-01', packageGroupId: 'g1', packageTotal: 3, deleted: true }),
    ];
    expect(groupOpenPackages(visits)).toEqual([]);
  });

  it('excludes a package that already has all its sessions logged', () => {
    const visits = [1, 2, 3].map((n) =>
      makeVisit({ id: `v${n}`, visitDate: `2026-06-0${n}`, packageGroupId: 'g1', packageTotal: 3 })
    );
    expect(groupOpenPackages(visits)).toEqual([]);
  });

  it('includes a package short of its total, with earliest/latest dates and progress', () => {
    const visits = [
      makeVisit({ id: 'v1', visitDate: '2026-06-01', packageGroupId: 'g1', packageTotal: 5, patientId: 'p1', serviceCatalogId: 'svc-5day' }),
      makeVisit({ id: 'v2', visitDate: '2026-06-10', packageGroupId: 'g1', packageTotal: 5 }),
      makeVisit({ id: 'v3', visitDate: '2026-06-05', packageGroupId: 'g1', packageTotal: 5 }),
    ];
    const [group] = groupOpenPackages(visits);
    expect(group).toMatchObject({
      packageGroupId: 'g1',
      patientId: 'p1',
      serviceCatalogId: 'svc-5day',
      sessionsLogged: 3,
      packageTotal: 5,
      startedOn: '2026-06-01',
      lastVisitOn: '2026-06-10',
    });
  });

  it('tracks multiple distinct open packages independently', () => {
    const visits = [
      makeVisit({ id: 'v1', visitDate: '2026-06-01', packageGroupId: 'g1', packageTotal: 3 }),
      makeVisit({ id: 'v2', visitDate: '2026-06-01', packageGroupId: 'g2', packageTotal: 7, patientId: 'p2' }),
    ];
    const groups = groupOpenPackages(visits);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.packageGroupId))).toEqual(new Set(['g1', 'g2']));
  });
});

describe('daysSince / isStale', () => {
  it('computes whole days between two dates', () => {
    expect(daysSince('2026-06-01', '2026-06-15')).toBe(14);
    expect(daysSince('2026-06-15', '2026-06-15')).toBe(0);
  });

  it('is not stale exactly at the threshold', () => {
    expect(isStale('2026-06-01', '2026-06-15', STALE_PACKAGE_DAYS)).toBe(false);
  });

  it('is not stale under the threshold', () => {
    expect(isStale('2026-06-01', '2026-06-10', STALE_PACKAGE_DAYS)).toBe(false);
  });

  it('is stale over the threshold', () => {
    expect(isStale('2026-06-01', '2026-06-16', STALE_PACKAGE_DAYS)).toBe(true);
  });
});
