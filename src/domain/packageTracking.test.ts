import { describe, expect, it } from 'vitest';
import { daysSince, formatExpiryDate, groupOpenPackages, isStale, localToday, packageExpiresOn, packageExpiryState, packageValidityOf, STALE_PACKAGE_DAYS } from './packageTracking';
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
    clinicSplitPct: 75,
    taxPct: 10,
    tdsBasis: 'gross_bill',
    clinicSharePaise: 0,
    postTaxPaise: 0,
    tdsPaise: 0,
    partnerSharePaise: 0,
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

  it('attributes startedByTherapistId to whoever logged the earliest session, not visit insertion order', () => {
    const visits = [
      // Inserted out of date order, and with a different therapist than
      // whoever logged the actual first session — startedByTherapistId
      // must resolve by date, not by array position.
      makeVisit({ id: 'v2', visitDate: '2026-06-10', packageGroupId: 'g1', packageTotal: 5, therapistId: 'th-2' }),
      makeVisit({ id: 'v1', visitDate: '2026-06-01', packageGroupId: 'g1', packageTotal: 5, therapistId: 'th-1' }),
    ];
    const [group] = groupOpenPackages(visits);
    expect(group.startedByTherapistId).toBe('th-1');
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

describe('package expiry', () => {
  const session = (visitDate: string, packageValidityDays: number | null | undefined, deleted = false) => ({ visitDate, packageValidityDays, deleted });

  it('is the first visit date plus the days, across a month and year end', () => {
    expect(packageExpiresOn([session('2026-12-20', 30), session('2026-12-25', 30)])).toBe('2027-01-19');
  });

  it('moves when the first visit date is corrected', () => {
    expect(packageExpiresOn([session('2026-01-10', 30)])).toBe('2026-02-09');
    expect(packageExpiresOn([session('2026-01-05', 30)])).toBe('2026-02-04');
  });

  it('blank means none, including rows from before the column existed', () => {
    expect(packageExpiresOn([session('2026-01-10', null), session('2026-01-12', undefined)])).toBeNull();
  });

  it('deleting the first visit does not lose the days', () => {
    const group = [session('2026-01-01', 30, true), session('2026-01-10', 30)];
    expect(packageValidityOf(group)).toBe(30);
    expect(packageExpiresOn(group)).toBe('2026-02-09');
  });

  it('an older session without the days still takes them from one that has them', () => {
    expect(packageExpiresOn([session('2026-01-01', null), session('2026-01-10', 30)])).toBe('2026-01-31');
  });

  it('the last day is still valid; seven days out is expiring; eight is quiet', () => {
    expect(packageExpiryState('2026-03-10', '2026-03-11')).toBe('expired');
    expect(packageExpiryState('2026-03-10', '2026-03-10')).toBe('expiring');
    expect(packageExpiryState('2026-03-10', '2026-03-03')).toBe('expiring');
    expect(packageExpiryState('2026-03-10', '2026-03-02')).toBeNull();
    expect(packageExpiryState(null, '2026-03-10')).toBeNull();
  });

  it('formats dates in words and today in local time', () => {
    expect(formatExpiryDate('2026-12-12')).toBe('12 Dec');
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
