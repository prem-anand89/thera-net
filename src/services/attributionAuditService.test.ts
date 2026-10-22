import { describe, expect, it } from 'vitest';
import { createAttributionAuditService } from './attributionAuditService';
import type { Repos, VisitFilter } from '@/repositories/types';
import type { Clinic, Visit, VisitCredit, VisitItem } from '@/domain/types';
import { rupeesToPaise as rs } from '@/domain/money';

const CLINIC = 'clinic-1';
const PREM = 'th-prem';
const AISH = 'th-aish';

function makeFakeRepos(
  visitList: Visit[],
  lines: { items?: VisitItem[]; credits?: VisitCredit[]; clinic?: Partial<Clinic> } = {},
) {
  const ofVisits = <T extends { visitId: string; deleted: boolean }>(rows: T[] = []) => ({
    listByVisitIds: async (ids: string[]) => rows.filter((r) => ids.includes(r.visitId) && !r.deleted),
  });
  return {
    visits: {
      list: async (f: VisitFilter) =>
        visitList.filter((v) => v.clinicId === f.clinicId && (!f.from || v.visitDate >= f.from) && (!f.to || v.visitDate <= f.to)),
      listByPackageGroup: async (groupId: string) =>
        visitList.filter((v) => v.packageGroupId === groupId && !v.deleted),
    },
    visitItems: ofVisits(lines.items),
    visitCredits: ofVisits(lines.credits),
    clinics: { get: async () => ({ id: CLINIC, ...lines.clinic }) },
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
    clinicSplitPct: 75,
    taxPct: 10,
    tdsBasis: 'gross_bill',
    clinicSharePaise: rs(4050),
    postTaxPaise: rs(3645),
    tdsPaise: rs(540),
    partnerSharePaise: rs(1350),
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
    expect(entries[0].sharedPct).toBe(33.33);
    expect(entries[0].visitBillPaise).toBe(rs(5400));
    expect(entries[0].packageTotalPaise).toBeNull();
    expect(entries[0].packageSessionCount).toBeNull();
    expect(entries[0].sessionIndex).toBeNull();
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
    expect(entries[0].sharedPct).toBeNull();
    expect(entries[0].visitBillPaise).toBeNull();
    // Basis for the ₹500 that moved: the ₹1500 package's declared 3
    // sessions, and this is session 2 of it — not a bare unexplained figure.
    expect(entries[0].packageTotalPaise).toBe(rs(1500));
    expect(entries[0].packageSessionCount).toBe(3);
    expect(entries[0].sessionIndex).toBe(2);
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

  describe('service lines and revenue shares', () => {
    const lineItem = (visitId: string, over: Partial<VisitItem>): VisitItem => ({
      id: `${visitId}-${over.position ?? 0}`,
      clinicId: CLINIC,
      visitId,
      position: 0,
      serviceCatalogId: 'svc-1',
      serviceName: 'Service',
      catalogPricePaise: over.pricePaise ?? 0,
      pricePaise: 0,
      assistingTherapistId: null,
      durationMinutes: null,
      isPackageLine: false,
      deleted: false,
      updatedAt: '',
      ...over,
    });
    const share = (visitId: string, therapistId: string, amountPaise: number): VisitCredit => ({
      id: `${visitId}-${therapistId}`,
      clinicId: CLINIC,
      visitId,
      therapistId,
      amountPaise,
      deleted: false,
      updatedAt: '',
    });
    const twoLines = (visitId: string) => [
      lineItem(visitId, { position: 0, pricePaise: rs(1000) }),
      lineItem(visitId, { position: 1, pricePaise: rs(500), assistingTherapistId: AISH }),
    ];

    it('shows a revenue share as a line_share entry with the visit bill', async () => {
      const v = visit({ id: 'lv1', therapistId: PREM, actualBillPaise: rs(1300), clinicSharePaise: rs(975), postTaxPaise: rs(878) });
      const repos = makeFakeRepos([v], { items: twoLines('lv1'), credits: [share('lv1', PREM, rs(867)), share('lv1', AISH, rs(433))] });
      const entries = await createAttributionAuditService(repos).monthly(CLINIC, JULY);
      expect(entries).toEqual([
        {
          mechanism: 'line_share',
          visitId: 'lv1',
          visitDate: '2026-07-04',
          patientId: 'pat-1',
          fromTherapistId: PREM,
          toTherapistId: AISH,
          grossPaise: rs(433),
          postTaxPaise: rs(292),
          packageGroupId: null,
          sharedPct: null,
          visitBillPaise: rs(1300),
          packageTotalPaise: null,
          packageSessionCount: null,
          sessionIndex: null,
          repaired: false,
        },
      ]);
    });

    it("flags shares that didn't add up as repaired", async () => {
      const v = visit({ id: 'lv2', therapistId: PREM, actualBillPaise: rs(1300), clinicSharePaise: rs(975), postTaxPaise: rs(878) });
      const repos = makeFakeRepos([v], { items: twoLines('lv2'), credits: [share('lv2', PREM, rs(1000)), share('lv2', AISH, rs(500))] });
      const entries = await createAttributionAuditService(repos).monthly(CLINIC, JULY);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ mechanism: 'line_share', grossPaise: rs(433), repaired: true });
    });

    it("reports a package's price as its package line, not the whole billing visit", async () => {
      const pkg = { packageGroupId: 'gc', packageTotal: 3 };
      const v1 = visit({ ...pkg, id: 'gc-1', sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(3500), clinicSharePaise: rs(2625), postTaxPaise: rs(2362) });
      const v2 = visit({ ...pkg, id: 'gc-2', sessionIndex: 2, therapistId: AISH, visitDate: '2026-07-08', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const items = [
        lineItem('gc-1', { position: 0, pricePaise: rs(500) }),
        lineItem('gc-1', { position: 1, pricePaise: rs(3000), isPackageLine: true }),
        lineItem('gc-2', { position: 0, pricePaise: 0, isPackageLine: true }),
      ];
      const repos = makeFakeRepos([v1, v2], { items, credits: [share('gc-1', PREM, rs(3500)), share('gc-2', AISH, 0)] });
      const entries = await createAttributionAuditService(repos).monthly(CLINIC, JULY);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        mechanism: 'package_attribution',
        visitId: 'gc-2',
        fromTherapistId: PREM,
        toTherapistId: AISH,
        postTaxPaise: rs(675),
        packageTotalPaise: rs(3000),
        packageSessionCount: 3,
        sessionIndex: 2,
      });
    });
  });
});
