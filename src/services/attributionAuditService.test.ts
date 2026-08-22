import { describe, expect, it } from 'vitest';
import { createAttributionAuditService } from './attributionAuditService';
import type { Repos, VisitFilter } from '@/repositories/types';
import type { Visit } from '@/domain/types';
import { rupeesToPaise as rs } from '@/domain/money';

const CLINIC = 'clinic-1';
const PREM = 'th-prem';
const AISH = 'th-aish';

function makeFakeRepos(visitList: Visit[]) {
  return {
    visits: {
      list: async (f: VisitFilter) =>
        visitList.filter((v) => v.clinicId === f.clinicId && (!f.from || v.visitDate >= f.from) && (!f.to || v.visitDate <= f.to)),
      listByPackageGroup: async (groupId: string) =>
        visitList.filter((v) => v.packageGroupId === groupId && !v.deleted),
    },
  } as unknown as Repos;
}

function visit(over: Partial<Visit>): Visit {
  const bill = over.actualBillPaise ?? rs(5400);
  return {
    id: crypto.randomUUID(),
    clinicId: CLINIC,
    patientId: 'pat-1',
    therapistId: PREM,
    visitDate: '2026-07-04',
    condition: null,
    treatmentNotes: null,
    serviceCatalogId: 'svc-1',
    catalogPricePaise: bill,
    actualBillPaise: bill,
    adjustmentPaise: 0,
    adjustmentReason: null,
    sessionIndex: null,
    packageTotal: null,
    packageGroupId: null,
    bmSplitPct: 75,
    taxPct: 10,
    tdsBasis: 'gross_bill',
    bmSharePaise: rs(4050),
    postTaxPaise: rs(3645),
    tdsPaise: rs(540),
    hvPaise: rs(1350),
    invoiceId: null,
    deleted: false,
    updatedAt: '',
    ...over,
  } as Visit;
}

const JULY = { year: 2026, month: 7 };

describe('attributionAuditService.monthly', () => {
  it('emits one entry per manual split, gross and post-tax both from the visit', async () => {
    const repos = makeFakeRepos([
      visit({
        id: 'v1',
        therapistId: PREM,
        actualBillPaise: rs(5400),
        postTaxPaise: rs(3645),
        sharedTherapistId: AISH,
        sharedPct: 33.33,
      }),
    ]);
    const entries = await createAttributionAuditService(repos).monthly(CLINIC, JULY);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      mechanism: 'manual_split',
      visitId: 'v1',
      fromTherapistId: PREM,
      toTherapistId: AISH,
    });
    expect(entries[0].grossPaise).toBe(Math.round((rs(5400) * 33.33) / 100 / 100 + 0.5) * 100);
    expect(entries[0].postTaxPaise).toBeGreaterThan(0);
  });

  it('emits one entry per in-window package-attribution sibling, with null gross', async () => {
    const groupId = 'pkg-1';
    const repos = makeFakeRepos([
      visit({
        id: 'v1',
        therapistId: PREM,
        visitDate: '2026-07-01',
        actualBillPaise: rs(1500),
        postTaxPaise: rs(1500),
        packageGroupId: groupId,
        packageTotal: 3,
        sessionIndex: 1,
      }),
      visit({
        id: 'v2',
        therapistId: AISH,
        visitDate: '2026-07-08',
        actualBillPaise: 0,
        postTaxPaise: 0,
        packageGroupId: groupId,
        packageTotal: 3,
        sessionIndex: 2,
      }),
    ]);
    const entries = await createAttributionAuditService(repos).monthly(CLINIC, JULY);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      mechanism: 'package_attribution',
      visitId: 'v2',
      fromTherapistId: PREM,
      toTherapistId: AISH,
      grossPaise: null,
      postTaxPaise: rs(500),
      packageGroupId: groupId,
    });
  });

  it('excludes a package sibling outside the requested month', async () => {
    const groupId = 'pkg-2';
    const repos = makeFakeRepos([
      visit({
        id: 'v1',
        therapistId: PREM,
        visitDate: '2026-06-28',
        actualBillPaise: rs(1500),
        postTaxPaise: rs(1500),
        packageGroupId: groupId,
        packageTotal: 3,
        sessionIndex: 1,
      }),
      visit({
        id: 'v2',
        therapistId: AISH,
        visitDate: '2026-07-03',
        actualBillPaise: 0,
        postTaxPaise: 0,
        packageGroupId: groupId,
        packageTotal: 3,
        sessionIndex: 2,
      }),
    ]);
    // June's own audit list should show nothing — the billing visit itself
    // never generates an entry (it doesn't move money to itself), and
    // July's session is outside June's window.
    const juneEntries = await createAttributionAuditService(repos).monthly(CLINIC, { year: 2026, month: 6 });
    expect(juneEntries).toHaveLength(0);
    const julyEntries = await createAttributionAuditService(repos).monthly(CLINIC, JULY);
    expect(julyEntries).toHaveLength(1);
    expect(julyEntries[0].visitId).toBe('v2');
  });

  it('returns an empty list for a month with no splits or package attribution', async () => {
    const repos = makeFakeRepos([visit({})]);
    const entries = await createAttributionAuditService(repos).monthly(CLINIC, JULY);
    expect(entries).toEqual([]);
  });
});
