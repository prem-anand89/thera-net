import { describe, expect, it } from 'vitest';
import { createReportService } from './reportService';
import type { Repos, VisitFilter } from '@/repositories/types';
import { clinicShareLabels, type Therapist, type Visit } from '@/domain/types';
import { roundToRupeeHalfUp, rupeesToPaise as rs } from '@/domain/money';

const CLINIC = 'clinic-1';
const PREM = 'th-prem';
const AISH = 'th-aish';

function makeFakeRepos(visitList: Visit[]) {
  const therapists: Therapist[] = [
    { id: PREM, clinicId: CLINIC, name: 'Prem', active: true, updatedAt: '' },
    { id: AISH, clinicId: CLINIC, name: 'Aishwarya', active: true, updatedAt: '' },
  ];
  const repos = {
    therapists: { list: async () => therapists },
    visits: {
      list: async (f: VisitFilter) =>
        visitList.filter((v) => v.clinicId === f.clinicId && (!f.from || v.visitDate >= f.from) && (!f.to || v.visitDate <= f.to)),
      listByPackageGroup: async (groupId: string) =>
        visitList.filter((v) => v.packageGroupId === groupId && !v.deleted),
    },
  } as unknown as Repos;
  return repos;
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
  };
}

const JULY = { year: 2026, month: 7 };

describe('reportService.monthly — therapist split', () => {
  it('shifts sharedPaise from primary to assistant, netting to zero, rounded to whole rupees', async () => {
    const repos = makeFakeRepos([
      visit({ therapistId: PREM, actualBillPaise: rs(5400), sharedTherapistId: AISH, sharedPct: 33.33 }),
    ]);
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    const prem = report.rows.find((r) => r.therapistId === PREM)!;
    const aish = report.rows.find((r) => r.therapistId === AISH)!;
    const shared = roundToRupeeHalfUp((rs(5400) * 33.33) / 100);
    expect(shared).toBe(rs(1800)); // whole-rupee clean number, not ₹1799.82
    expect(prem.sharedPaise).toBe(-shared);
    expect(aish.sharedPaise).toBe(shared);
    expect(report.total.sharedPaise).toBe(0);
  });

  it('shifts netPostTaxPaise using Post-Tax BM as the base, not the bill-based Shared amount', async () => {
    const repos = makeFakeRepos([
      visit({ therapistId: PREM, actualBillPaise: rs(5400), postTaxPaise: rs(3645), sharedTherapistId: AISH, sharedPct: 33.33 }),
    ]);
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    const prem = report.rows.find((r) => r.therapistId === PREM)!;
    const aish = report.rows.find((r) => r.therapistId === AISH)!;
    const netShift = roundToRupeeHalfUp((rs(3645) * 33.33) / 100);
    const billBasedShift = Math.abs(prem.sharedPaise);
    expect(netShift).not.toBe(billBasedShift); // different base (Post-Tax BM vs. bill) yields a different amount
    expect(prem.netPostTaxPaise).toBe(rs(3645) - netShift);
    expect(aish.netPostTaxPaise).toBe(netShift);
    expect(report.total.netPostTaxPaise).toBe(report.total.postTaxPaise);
  });

  it('leaves every billed column identical whether or not a split is set', async () => {
    const withSplit = await createReportService(
      makeFakeRepos([visit({ sharedTherapistId: AISH, sharedPct: 33.33 })])
    ).monthly(CLINIC, JULY);
    const without = await createReportService(makeFakeRepos([visit({})])).monthly(CLINIC, JULY);
    // The primary therapist row and the total row must reconcile identically —
    // splits never move the billed figures the hospital audits.
    for (const key of ['billPaise', 'bmSharePaise', 'tdsPaise', 'postTaxPaise', 'hvPaise'] as const) {
      expect(withSplit.total[key]).toBe(without.total[key]);
    }
  });

  it('gives an assist-only therapist a row even with no visits of their own', async () => {
    const repos = makeFakeRepos([
      visit({ therapistId: PREM, sharedTherapistId: AISH, sharedPct: 50 }),
    ]);
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    const aish = report.rows.find((r) => r.therapistId === AISH)!;
    expect(aish).toBeDefined();
    expect(aish.visitCount).toBe(0);
    expect(aish.billPaise).toBe(0);
    expect(aish.sharedPaise).toBe(rs(2700));
    expect(aish.netPostTaxPaise).toBe(roundToRupeeHalfUp(rs(3645) / 2));
  });

  it('reports zero shared and unchanged Net for a month with no splits', async () => {
    const repos = makeFakeRepos([visit({}), visit({ therapistId: AISH })]);
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    expect(report.rows.every((r) => r.sharedPaise === 0)).toBe(true);
    expect(report.total.sharedPaise).toBe(0);
    for (const r of report.rows) expect(r.netPostTaxPaise).toBe(r.postTaxPaise);
    expect(report.total.netPostTaxPaise).toBe(report.total.postTaxPaise);
  });
});

describe('reportService.monthly — netPostTaxPaise package attribution', () => {
  it("leaves a non-package visit's Post-Tax BM attribution unchanged", async () => {
    const repos = makeFakeRepos([
      visit({ therapistId: PREM, actualBillPaise: rs(5400), postTaxPaise: rs(3645) }),
    ]);
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    const prem = report.rows.find((r) => r.therapistId === PREM)!;
    expect(prem.netPostTaxPaise).toBe(rs(3645));
    expect(report.total.netPostTaxPaise).toBe(rs(3645));
  });

  it("splits a package's Post-Tax BM evenly across the therapists who actually ran its sessions", async () => {
    const groupId = 'pkg-1';
    const repos = makeFakeRepos([
      // Session 1: billed (and Post-Tax BM'd) for the whole 3-session
      // package, logged by Prem.
      visit({
        id: 'v1',
        therapistId: PREM,
        visitDate: '2026-07-01',
        actualBillPaise: rs(6000),
        postTaxPaise: rs(6000),
        packageGroupId: groupId,
        packageTotal: 3,
        sessionIndex: 1,
      }),
      // Sessions 2-3: ₹0 continuations, run by Aishwarya.
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
      visit({
        id: 'v3',
        therapistId: AISH,
        visitDate: '2026-07-15',
        actualBillPaise: 0,
        postTaxPaise: 0,
        packageGroupId: groupId,
        packageTotal: 3,
        sessionIndex: 3,
      }),
    ]);
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    const prem = report.rows.find((r) => r.therapistId === PREM)!;
    const aish = report.rows.find((r) => r.therapistId === AISH)!;
    // ₹6000 / 3 sessions = ₹2000 each; Prem ran 1, Aishwarya ran 2.
    expect(prem.netPostTaxPaise).toBe(rs(2000));
    expect(aish.netPostTaxPaise).toBe(rs(4000));
    // Attribution redistributes rows only — the clinic-wide total always
    // stays exactly what was actually billed and split this period.
    expect(report.total.netPostTaxPaise).toBe(report.total.postTaxPaise);
    expect(report.total.netPostTaxPaise).toBe(rs(6000));
    // The actual billed figures are untouched — still 100% on the billing visit.
    expect(prem.billPaise).toBe(rs(6000));
    expect(aish.billPaise).toBe(0);
  });

  it("keeps an in-progress package's un-logged share with the biller instead of dropping it", async () => {
    // The bug this guards against: a 3-session, ₹1500 package with only 2
    // sessions logged used to divide by the declared total (3) but only
    // ever assign shares to the sessions actually in the group, silently
    // leaving the 3rd slot's ₹500 unattributed to anyone. The fix: the
    // biller keeps everything not explicitly claimed by another
    // therapist's logged session — including the not-yet-logged share.
    const groupId = 'pkg-4';
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
      // Session 2, run by a different therapist. Session 3 hasn't happened
      // yet — it doesn't exist as a visit at all.
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
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    const prem = report.rows.find((r) => r.therapistId === PREM)!;
    const aish = report.rows.find((r) => r.therapistId === AISH)!;
    // ₹1500 / 3 = ₹500 per session. Aishwarya logged 1 session → ₹500.
    // Prem billed it and keeps the rest — ₹1000, not just his own ₹500 —
    // because session 3's share hasn't been claimed by anyone yet.
    expect(aish.netPostTaxPaise).toBe(rs(500));
    expect(prem.netPostTaxPaise).toBe(rs(1000));
    // Nothing vanishes: every rupee of this period's total lands on some row.
    expect(prem.netPostTaxPaise + aish.netPostTaxPaise).toBe(report.total.netPostTaxPaise);
  });

  it('distributes an uneven package total in whole rupees with zero rounding drift', async () => {
    const groupId = 'pkg-3';
    const repos = makeFakeRepos([
      visit({
        id: 'v1',
        therapistId: PREM,
        visitDate: '2026-07-01',
        actualBillPaise: rs(100),
        postTaxPaise: rs(100),
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
      visit({
        id: 'v3',
        therapistId: AISH,
        visitDate: '2026-07-15',
        actualBillPaise: 0,
        postTaxPaise: 0,
        packageGroupId: groupId,
        packageTotal: 3,
        sessionIndex: 3,
      }),
    ]);
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    const prem = report.rows.find((r) => r.therapistId === PREM)!;
    const aish = report.rows.find((r) => r.therapistId === AISH)!;
    // ₹100 / 3 = ₹33.33 — not evenly divisible into whole rupees. Each
    // other-therapist session gets a whole-rupee floor share (₹33); the
    // biller (v1) keeps whatever's left, ₹34 — not an independently
    // rounded (and therefore drifting) share of their own.
    expect(prem.netPostTaxPaise).toBe(rs(34));
    expect(aish.netPostTaxPaise).toBe(rs(66));
    expect(prem.netPostTaxPaise + aish.netPostTaxPaise).toBe(rs(100));
  });

  it('resolves a package spanning two report periods via listByPackageGroup', async () => {
    const groupId = 'pkg-2';
    const repos = makeFakeRepos([
      // Billed in June — outside this report's July window.
      visit({
        id: 'v1',
        therapistId: PREM,
        visitDate: '2026-06-28',
        actualBillPaise: rs(4500),
        postTaxPaise: rs(4500),
        packageGroupId: groupId,
        packageTotal: 3,
        sessionIndex: 1,
      }),
      // Session run in July by a different therapist. Only 2 of the
      // package's 3 sessions have been logged so far — attribution still
      // divides by the declared packageTotal (3), not the 2 logged.
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
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    // Only v2 is inside July's window, but its attribution still reflects
    // the whole package's ₹4500 Post-Tax BM (not ₹0, and not something
    // derived only from what's visible in this month).
    const aish = report.rows.find((r) => r.therapistId === AISH)!;
    expect(aish.netPostTaxPaise).toBe(roundToRupeeHalfUp(rs(4500) / 3));
    expect(report.rows.find((r) => r.therapistId === PREM)).toBeUndefined(); // Prem's visit is outside this month
  });

  it('leaves a single-session (non-package) visit unaffected by attribution', async () => {
    const repos = makeFakeRepos([
      visit({
        therapistId: PREM,
        actualBillPaise: rs(2200),
        postTaxPaise: rs(1980),
        packageGroupId: null,
        packageTotal: null,
      }),
    ]);
    const report = await createReportService(repos).monthly(CLINIC, JULY);
    const prem = report.rows.find((r) => r.therapistId === PREM)!;
    expect(prem.netPostTaxPaise).toBe(rs(1980));
    expect(report.total.netPostTaxPaise).toBe(rs(1980));
  });
});

describe('reportService.toCsv — configurable share labels', () => {
  it('defaults the share columns to Clinic/Partner', async () => {
    const report = await createReportService(makeFakeRepos([visit({})])).monthly(CLINIC, JULY);
    const header = createReportService(makeFakeRepos([])).toCsv(report).split('\n')[0];
    expect(header).toContain('"Clinic Share"');
    expect(header).toContain('"Post Tax Clinic"');
    expect(header).toContain('"Partner Share"');
  });

  it('renders the clinic-configured labels when provided', async () => {
    const report = await createReportService(makeFakeRepos([visit({})])).monthly(CLINIC, JULY);
    const header = createReportService(makeFakeRepos([]))
      .toCsv(report, { labels: { own: 'ZM', partner: 'CityHosp' } })
      .split('\n')[0];
    expect(header).toContain('"ZM Share"');
    expect(header).toContain('"Post Tax ZM"');
    expect(header).toContain('"CityHosp Share"');
  });

  it('drops the split columns in simple (non-hospital) mode', async () => {
    const report = await createReportService(makeFakeRepos([visit({})])).monthly(CLINIC, JULY);
    const header = createReportService(makeFakeRepos([]))
      .toCsv(report, { hospitalSplit: false, therapistSplit: false })
      .split('\n')[0];
    expect(header).toBe('"Therapist","Bill Amount","Net","Visits","Patients"');
  });
});

describe('clinicShareLabels', () => {
  it('defaults to Clinic/Partner when unset or blank', () => {
    expect(clinicShareLabels({ ownShareLabel: null, partnerShareLabel: undefined })).toEqual({ own: 'Clinic', partner: 'Partner' });
    expect(clinicShareLabels({ ownShareLabel: '  ', partnerShareLabel: '' })).toEqual({ own: 'Clinic', partner: 'Partner' });
  });

  it('uses configured labels, trimmed', () => {
    expect(clinicShareLabels({ ownShareLabel: ' ZM ', partnerShareLabel: 'CH' })).toEqual({ own: 'ZM', partner: 'CH' });
  });
});
