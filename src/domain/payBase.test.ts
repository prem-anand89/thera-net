import { describe, expect, it } from 'vitest';
import { attributionMovements, payBaseByTherapist, type PayBaseInput } from './payBase';
import type { UUID, Visit, VisitCredit, VisitItem } from './types';
import { roundToRupeeHalfUp, rupeesToPaise as rs } from './money';

const PREM = 'th-prem';
const AISH = 'th-aish';
const RAVI = 'th-ravi';
const FROM = '2026-07-01';
const TO = '2026-07-31';

function visit(over: Partial<Visit>): Visit {
  const bill = over.actualBillPaise ?? rs(5400);
  return {
    id: crypto.randomUUID(),
    clinicId: 'clinic-1',
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

/**
 * Mirrors reportService: the in-window visits plus every package group any of them belongs to, and
 * the service lines / revenue shares of every visit involved (empty = a visit without lines).
 */
function input(
  inWindow: Visit[],
  all: Visit[] = inWindow,
  lines: { items?: VisitItem[]; credits?: VisitCredit[]; splitEnabled?: boolean } = {},
): PayBaseInput {
  const packageGroups = new Map<UUID, Visit[]>();
  for (const v of inWindow) {
    if (v.packageGroupId && !packageGroups.has(v.packageGroupId)) {
      packageGroups.set(v.packageGroupId, all.filter((g) => g.packageGroupId === v.packageGroupId));
    }
  }
  const byVisit = <T extends { visitId: UUID }>(rows: T[] = []) => {
    const m = new Map<UUID, T[]>();
    for (const r of rows) m.set(r.visitId, [...(m.get(r.visitId) ?? []), r]);
    return m;
  };
  return {
    visits: inWindow,
    packageGroups,
    items: byVisit(lines.items),
    credits: byVisit(lines.credits),
    splitEnabled: lines.splitEnabled,
    from: FROM,
    to: TO,
  };
}

let seq = 0;
function item(visitId: UUID, over: Partial<VisitItem>): VisitItem {
  seq += 1;
  return {
    id: `item-${String(seq).padStart(4, '0')}`,
    clinicId: 'clinic-1',
    visitId,
    position: seq,
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
  };
}

function credit(visitId: UUID, therapistId: UUID, amountPaise: number, over: Partial<VisitCredit> = {}): VisitCredit {
  return { id: crypto.randomUUID(), clinicId: 'clinic-1', visitId, therapistId, amountPaise, deleted: false, updatedAt: '', ...over };
}

/** A 3-session ₹3,000 package billed by Prem on the 1st; sessions 2 and 3 at ₹0. */
function package3(group: string, s2: Partial<Visit>, s3: Partial<Visit>): Visit[] {
  const pkg = { packageGroupId: group, packageTotal: 3 };
  return [
    visit({ ...pkg, id: `${group}-1`, sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(3000), clinicSharePaise: rs(2250), postTaxPaise: rs(2025) }),
    visit({ ...pkg, id: `${group}-2`, sessionIndex: 2, visitDate: '2026-07-08', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0, tdsPaise: 0, partnerSharePaise: 0, ...s2 }),
    visit({ ...pkg, id: `${group}-3`, sessionIndex: 3, visitDate: '2026-07-15', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0, tdsPaise: 0, partnerSharePaise: 0, ...s3 }),
  ];
}

function sums(visits: Visit[]) {
  return {
    grossPaise: visits.reduce((s, v) => s + v.actualBillPaise, 0),
    clinicSharePaise: visits.reduce((s, v) => s + v.clinicSharePaise, 0),
    postTaxPaise: visits.reduce((s, v) => s + v.postTaxPaise, 0),
  };
}

function totalOf(base: ReturnType<typeof payBaseByTherapist>) {
  const t = { grossPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 };
  for (const b of base.values()) {
    t.grossPaise += b.grossPaise;
    t.clinicSharePaise += b.clinicSharePaise;
    t.postTaxPaise += b.postTaxPaise;
  }
  return t;
}

describe('payBase', () => {
  it('single visit credits the primary only', () => {
    const v = visit({ therapistId: PREM });
    expect(attributionMovements(input([v]))).toEqual([]);
    const base = payBaseByTherapist(input([v]));
    expect([...base.keys()]).toEqual([PREM]);
    expect(base.get(PREM)).toEqual({ grossPaise: rs(5400), clinicSharePaise: rs(4050), postTaxPaise: rs(3645) });
  });

  it('legacy shared 30% moves gross and post-tax exactly as reportService did', () => {
    const v = visit({ id: 'v1', therapistId: PREM, actualBillPaise: rs(5399), postTaxPaise: rs(3643), sharedTherapistId: AISH, sharedPct: 30 });
    const gross = roundToRupeeHalfUp((rs(5399) * 30) / 100);
    const postTax = roundToRupeeHalfUp((rs(3643) * 30) / 100);
    const [m] = attributionMovements(input([v]));
    expect(m).toMatchObject({ mechanism: 'manual_split', visitId: 'v1', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: gross, postTaxPaise: postTax });
    const base = payBaseByTherapist(input([v]));
    expect(base.get(PREM)!.grossPaise).toBe(rs(5399) - gross);
    expect(base.get(AISH)!.grossPaise).toBe(gross);
    expect(base.get(PREM)!.postTaxPaise).toBe(rs(3643) - postTax);
    expect(base.get(AISH)!.postTaxPaise).toBe(postTax);
  });

  it('legacy shared also moves clinic share by the same pct', () => {
    const v = visit({ therapistId: PREM, clinicSharePaise: rs(4049), sharedTherapistId: AISH, sharedPct: 30 });
    const clinic = roundToRupeeHalfUp((rs(4049) * 30) / 100);
    const [m] = attributionMovements(input([v]));
    expect(m.clinicSharePaise).toBe(clinic);
    const base = payBaseByTherapist(input([v]));
    expect(base.get(PREM)!.clinicSharePaise).toBe(rs(4049) - clinic);
    expect(base.get(AISH)!.clinicSharePaise).toBe(clinic);
  });

  it('package session by another therapist moves floor(postTax/100/total)*100', () => {
    const visits = package3('g1', { therapistId: AISH }, { therapistId: PREM });
    const share = Math.floor(rs(2025) / 100 / 3) * 100; // ₹675
    const clinicShare = Math.floor(rs(2250) / 100 / 3) * 100; // ₹750
    const movements = attributionMovements(input(visits));
    expect(movements).toEqual([
      { mechanism: 'package_attribution', visitId: 'g1-2', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: 0, clinicSharePaise: clinicShare, postTaxPaise: share },
    ]);
    const base = payBaseByTherapist(input(visits));
    expect(base.get(AISH)).toEqual({ grossPaise: 0, clinicSharePaise: clinicShare, postTaxPaise: share });
    expect(base.get(PREM)).toEqual({ grossPaise: rs(3000), clinicSharePaise: rs(2250) - clinicShare, postTaxPaise: rs(2025) - share });
  });

  it('shared and package on the same group together', () => {
    // The billing session itself is shared 50% with Ravi; session 2 is Aish's.
    const visits = package3('g2', { therapistId: AISH }, { therapistId: PREM, visitDate: '2026-08-02' });
    visits[0] = { ...visits[0], sharedTherapistId: RAVI, sharedPct: 50 };
    const inWindow = visits.filter((v) => v.visitDate <= TO);
    const movements = attributionMovements(input(inWindow, visits));
    expect(movements.map((m) => [m.mechanism, m.fromTherapistId, m.toTherapistId])).toEqual([
      ['manual_split', PREM, RAVI],
      ['package_attribution', PREM, AISH],
    ]);
    const base = payBaseByTherapist(input(inWindow, visits));
    const split = roundToRupeeHalfUp(rs(2025) / 2);
    const share = Math.floor(rs(2025) / 100 / 3) * 100;
    expect(base.get(RAVI)!.postTaxPaise).toBe(split);
    expect(base.get(AISH)!.postTaxPaise).toBe(share);
    expect(base.get(PREM)!.postTaxPaise).toBe(rs(2025) - split - share);
  });

  it('totals are invariant', () => {
    const visits = [
      ...package3('g3', { therapistId: AISH }, { therapistId: RAVI }),
      visit({ therapistId: AISH, actualBillPaise: rs(1234), clinicSharePaise: rs(925), postTaxPaise: rs(833), sharedTherapistId: PREM, sharedPct: 33.33 }),
      visit({ therapistId: RAVI }),
    ];
    const base = payBaseByTherapist(input(visits));
    expect(totalOf(base)).toEqual(sums(visits));
  });

  it('sessions outside [from,to] move nothing', () => {
    // Billed by Prem in June; Aish's session lands in July, Ravi's in August.
    // The July input carries the whole group (as reportService fetches it),
    // yet only the July session moves money.
    const visits = package3('g4', { therapistId: AISH }, { therapistId: RAVI, visitDate: '2026-08-10' });
    visits[0] = { ...visits[0], visitDate: '2026-06-28' };
    const inWindow = visits.filter((v) => v.visitDate >= FROM && v.visitDate <= TO);
    const movements = attributionMovements(input(inWindow, visits));
    expect(movements.map((m) => m.visitId)).toEqual(['g4-2']);
    expect(movements.some((m) => m.toTherapistId === RAVI)).toBe(false);
    // And with nothing in the window, nothing moves at all.
    expect(attributionMovements(input([], visits))).toEqual([]);
  });

  describe('service lines and revenue shares', () => {
    /** Assessment ₹1,000 (Prem) + dry needling ₹500 (Aish), billed ₹1,300 → nets ₹867 / ₹433. */
    function twoLineVisit(over: Partial<Visit> = {}) {
      const v = visit({ id: 'lv1', therapistId: PREM, actualBillPaise: rs(1300), clinicSharePaise: rs(975), postTaxPaise: rs(878), ...over });
      const items = [
        item('lv1', { pricePaise: rs(1000) }),
        item('lv1', { pricePaise: rs(500), assistingTherapistId: AISH }),
      ];
      return { v, items };
    }

    it("a visit with lines moves the assistant's share on all three bases", () => {
      const { v, items } = twoLineVisit();
      const credits = [credit('lv1', PREM, rs(867)), credit('lv1', AISH, rs(433))];
      const movements = attributionMovements(input([v], [v], { items, credits }));
      // Clinic share ₹975 × 433/1300 = ₹324.75 and Post-Tax ₹878 × 433/1300 = ₹292.43, whole rupees by
      // largest remainder across the visit's shares (Prem ₹650.25 / ₹585.57): Aish ₹325 and ₹292.
      expect(movements).toEqual([
        { mechanism: 'line_share', visitId: 'lv1', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: rs(433), clinicSharePaise: rs(325), postTaxPaise: rs(292) },
      ]);
      const base = payBaseByTherapist(input([v], [v], { items, credits }));
      expect(base.get(PREM)).toEqual({ grossPaise: rs(867), clinicSharePaise: rs(650), postTaxPaise: rs(586) });
      expect(base.get(AISH)).toEqual({ grossPaise: rs(433), clinicSharePaise: rs(325), postTaxPaise: rs(292) });
      expect(totalOf(base)).toEqual(sums([v]));
    });

    it('credit rows replace the legacy split on the same visit', () => {
      const { v, items } = twoLineVisit({ sharedTherapistId: RAVI, sharedPct: 50 });
      const credits = [credit('lv1', PREM, rs(867)), credit('lv1', AISH, rs(433))];
      const movements = attributionMovements(input([v], [v], { items, credits }));
      expect(movements.map((m) => [m.mechanism, m.toTherapistId])).toEqual([['line_share', AISH]]);
    });

    it('a visit with lines but every share on the primary moves nothing', () => {
      const { v } = twoLineVisit();
      const items = [item('lv1', { pricePaise: rs(1000) }), item('lv1', { pricePaise: rs(500) })];
      const credits = [credit('lv1', PREM, rs(1300))];
      expect(attributionMovements(input([v], [v], { items, credits }))).toEqual([]);
    });

    it('deleted credit rows are ignored (the visit falls back to its legacy split)', () => {
      const { v, items } = twoLineVisit({ sharedTherapistId: RAVI, sharedPct: 50 });
      const credits = [credit('lv1', PREM, rs(867), { deleted: true }), credit('lv1', AISH, rs(433), { deleted: true })];
      const movements = attributionMovements(input([v], [v], { items, credits }));
      expect(movements.map((m) => [m.mechanism, m.toTherapistId])).toEqual([['manual_split', RAVI]]);
    });

    it('several assistants: post-tax shares always sum to the visit', () => {
      const v = visit({ id: 'lv2', therapistId: PREM, actualBillPaise: rs(200), clinicSharePaise: rs(1), postTaxPaise: rs(1) });
      const credits = [credit('lv2', PREM, 0), credit('lv2', AISH, rs(100)), credit('lv2', RAVI, rs(100))];
      const base = payBaseByTherapist(input([v], [v], { credits }));
      expect(totalOf(base)).toEqual(sums([v]));
      for (const b of base.values()) expect(b.postTaxPaise).toBeGreaterThanOrEqual(0);
    });

    it("credits that don't add up are repaired and flagged", () => {
      const { v, items } = twoLineVisit();
      // Rows sum to ₹1,500 against a ₹1,300 bill → recomputed from the lines: ₹867 / ₹433.
      const credits = [credit('lv1', PREM, rs(1000)), credit('lv1', AISH, rs(500))];
      const movements = attributionMovements(input([v], [v], { items, credits }));
      expect(movements).toEqual([
        { mechanism: 'line_share', visitId: 'lv1', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: rs(433), clinicSharePaise: rs(325), postTaxPaise: rs(292), repaired: true },
      ]);
      expect(totalOf(payBaseByTherapist(input([v], [v], { items, credits })))).toEqual(sums([v]));
      // Split off: the repair puts every rupee on the primary, so nothing moves.
      expect(attributionMovements(input([v], [v], { items, credits, splitEnabled: false }))).toEqual([]);
    });

    it('consultation billed with a package does not leak into session shares', () => {
      const pkg = { packageGroupId: 'gc', packageTotal: 3 };
      // Session 1: consultation ₹500 + 3-session package ₹3,000 → bill ₹3,500.
      const v1 = visit({ ...pkg, id: 'gc-1', sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(3500), clinicSharePaise: rs(2625), postTaxPaise: rs(2362) });
      const v2 = visit({ ...pkg, id: 'gc-2', sessionIndex: 2, therapistId: AISH, visitDate: '2026-07-08', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const items = [
        item('gc-1', { pricePaise: rs(500) }),
        item('gc-1', { pricePaise: rs(3000), isPackageLine: true }),
        item('gc-2', { pricePaise: 0, isPackageLine: true }),
      ];
      const credits = [credit('gc-1', PREM, rs(3500)), credit('gc-2', AISH, 0)];
      const movements = attributionMovements(input([v1, v2], [v1, v2], { items, credits }));
      // Base = the package line's share of Post-Tax: ₹2,362 × 3000/3500 = ₹2,024.57 → ₹2,025; ÷ 3 → ₹675
      // (the whole visit's ₹2,362 would have given ₹787). Clinic share ₹2,625 × 3000/3500 = ₹2,250 → ₹750.
      expect(movements).toEqual([
        { mechanism: 'package_attribution', visitId: 'gc-2', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: 0, clinicSharePaise: rs(750), postTaxPaise: rs(675) },
      ]);
    });

    it('an add-on on a continuation does not make it the billing visit', () => {
      const pkg = { packageGroupId: 'ga', packageTotal: 3 };
      const v1 = visit({ ...pkg, id: 'ga-1', sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(3000), clinicSharePaise: rs(2250), postTaxPaise: rs(2025) });
      // Session 2 by Aish with a ₹4,000 add-on: a bigger bill than the package itself.
      const v2 = visit({ ...pkg, id: 'ga-2', sessionIndex: 2, therapistId: AISH, visitDate: '2026-07-08', actualBillPaise: rs(4000), clinicSharePaise: rs(3000), postTaxPaise: rs(2700) });
      const v3 = visit({ ...pkg, id: 'ga-3', sessionIndex: 3, therapistId: PREM, visitDate: '2026-07-15', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const items = [
        item('ga-1', { pricePaise: rs(3000), isPackageLine: true }),
        item('ga-2', { pricePaise: 0, isPackageLine: true }),
        item('ga-2', { pricePaise: rs(4000) }),
        item('ga-3', { pricePaise: 0, isPackageLine: true }),
      ];
      const credits = [credit('ga-1', PREM, rs(3000)), credit('ga-2', AISH, rs(4000)), credit('ga-3', PREM, 0)];
      const all = [v1, v2, v3];
      const movements = attributionMovements(input(all, all, { items, credits }));
      expect(movements).toEqual([
        { mechanism: 'package_attribution', visitId: 'ga-2', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: 0, clinicSharePaise: rs(750), postTaxPaise: rs(675) },
      ]);
    });

    it("package biller is the package line's deliverer", () => {
      const pkg = { packageGroupId: 'gb', packageTotal: 3 };
      // Prem's visit, but Aish delivered (and holds) the ₹3,000 package.
      const v1 = visit({ ...pkg, id: 'gb-1', sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(3000), clinicSharePaise: rs(2250), postTaxPaise: rs(2025) });
      // Session 2: Prem's visit, Ravi ran the session. Session 3: Ravi's visit, Aish ran the session.
      const v2 = visit({ ...pkg, id: 'gb-2', sessionIndex: 2, therapistId: PREM, visitDate: '2026-07-08', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const v3 = visit({ ...pkg, id: 'gb-3', sessionIndex: 3, therapistId: RAVI, visitDate: '2026-07-15', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const items = [
        item('gb-1', { pricePaise: rs(3000), isPackageLine: true, assistingTherapistId: AISH }),
        item('gb-2', { pricePaise: 0, isPackageLine: true, assistingTherapistId: RAVI }),
        item('gb-3', { pricePaise: 0, isPackageLine: true, assistingTherapistId: AISH }),
      ];
      const credits = [credit('gb-1', PREM, 0), credit('gb-1', AISH, rs(3000)), credit('gb-2', PREM, 0), credit('gb-3', RAVI, 0)];
      const all = [v1, v2, v3];
      const movements = attributionMovements(input(all, all, { items, credits }));
      expect(movements).toEqual([
        { mechanism: 'line_share', visitId: 'gb-1', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: rs(3000), clinicSharePaise: rs(2250), postTaxPaise: rs(2025) },
        { mechanism: 'package_attribution', visitId: 'gb-2', fromTherapistId: AISH, toTherapistId: RAVI, grossPaise: 0, clinicSharePaise: rs(750), postTaxPaise: rs(675) },
      ]);
      const base = payBaseByTherapist(input(all, all, { items, credits }));
      expect(base.get(PREM)).toEqual({ grossPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      expect(base.get(AISH)!.postTaxPaise).toBe(rs(2025) - rs(675));
      expect(totalOf(base)).toEqual(sums(all));
    });

    it('package billed with split off (everything on the primary) keeps the primary as biller', () => {
      const pkg = { packageGroupId: 'gs', packageTotal: 3 };
      const v1 = visit({ ...pkg, id: 'gs-1', sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(3000), clinicSharePaise: rs(2250), postTaxPaise: rs(2025) });
      const v2 = visit({ ...pkg, id: 'gs-2', sessionIndex: 2, therapistId: AISH, visitDate: '2026-07-08', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const items = [
        item('gs-1', { pricePaise: rs(3000), isPackageLine: true, assistingTherapistId: AISH }),
        item('gs-2', { pricePaise: 0, isPackageLine: true }),
      ];
      const credits = [credit('gs-1', PREM, rs(3000)), credit('gs-2', AISH, 0)];
      const all = [v1, v2];
      const expected = [
        { mechanism: 'package_attribution', visitId: 'gs-2', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: 0, clinicSharePaise: rs(750), postTaxPaise: rs(675) },
      ];
      expect(attributionMovements(input(all, all, { items, credits, splitEnabled: false }))).toEqual(expected);
      // The biller follows the stored shares, not the live setting: switching split on later changes nothing.
      expect(attributionMovements(input(all, all, { items, credits, splitEnabled: true }))).toEqual(expected);
    });

    it('stored shares give the package to the assistant: still the biller after split is switched off', () => {
      const pkg = { packageGroupId: 'gh', packageTotal: 3 };
      const v1 = visit({ ...pkg, id: 'gh-1', sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(3000), clinicSharePaise: rs(2250), postTaxPaise: rs(2025) });
      const v2 = visit({ ...pkg, id: 'gh-2', sessionIndex: 2, therapistId: RAVI, visitDate: '2026-07-08', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const items = [
        item('gh-1', { pricePaise: rs(3000), isPackageLine: true, assistingTherapistId: AISH }),
        item('gh-2', { pricePaise: 0, isPackageLine: true }),
      ];
      const credits = [credit('gh-1', PREM, 0), credit('gh-1', AISH, rs(3000)), credit('gh-2', RAVI, 0)];
      const all = [v1, v2];
      const on = attributionMovements(input(all, all, { items, credits, splitEnabled: true }));
      const off = attributionMovements(input(all, all, { items, credits, splitEnabled: false }));
      expect(off).toEqual(on);
      expect(off.find((m) => m.mechanism === 'package_attribution')).toMatchObject({ fromTherapistId: AISH, toTherapistId: RAVI, postTaxPaise: rs(675) });
      expect(payBaseByTherapist(input(all, all, { items, credits, splitEnabled: false }))).toEqual(
        payBaseByTherapist(input(all, all, { items, credits, splitEnabled: true }))
      );
    });

    it('split off: a session stays with its visit primary even when the package line names an assistant', () => {
      const pkg = { packageGroupId: 'gr', packageTotal: 3 };
      const v1 = visit({ ...pkg, id: 'gr-1', sessionIndex: 1, therapistId: RAVI, visitDate: '2026-07-01', actualBillPaise: rs(3000), clinicSharePaise: rs(2250), postTaxPaise: rs(2025) });
      const v2 = visit({ ...pkg, id: 'gr-2', sessionIndex: 2, therapistId: PREM, visitDate: '2026-07-08', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const items = [
        item('gr-1', { pricePaise: rs(3000), isPackageLine: true }),
        item('gr-2', { pricePaise: 0, isPackageLine: true, assistingTherapistId: AISH }),
      ];
      const credits = [credit('gr-1', RAVI, rs(3000)), credit('gr-2', PREM, 0)];
      const all = [v1, v2];
      const off = attributionMovements(input(all, all, { items, credits, splitEnabled: false }));
      expect(off.map((m) => [m.mechanism, m.fromTherapistId, m.toTherapistId])).toEqual([['package_attribution', RAVI, PREM]]);
      expect(off.some((m) => m.toTherapistId === AISH)).toBe(false);
      // Split on: the session's runner is the package line's deliverer.
      const on = attributionMovements(input(all, all, { items, credits, splitEnabled: true }));
      expect(on.map((m) => [m.mechanism, m.fromTherapistId, m.toTherapistId])).toEqual([['package_attribution', RAVI, AISH]]);
    });

    it('credit rows without a row for the primary are repaired and flagged', () => {
      const v = visit({ id: 'np', therapistId: PREM, actualBillPaise: rs(1300), clinicSharePaise: rs(975), postTaxPaise: rs(878) });
      const items = [item('np', { pricePaise: rs(1000) }), item('np', { pricePaise: rs(500), assistingTherapistId: AISH })];
      // Sums to the bill, but no primary row.
      const credits = [credit('np', AISH, rs(1300))];
      expect(attributionMovements(input([v], [v], { items, credits }))).toEqual([
        { mechanism: 'line_share', visitId: 'np', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: rs(433), clinicSharePaise: rs(325), postTaxPaise: rs(292), repaired: true },
      ]);
    });

    it('a group whose visits all have lines but no priced package line attributes nothing', () => {
      const pkg = { packageGroupId: 'gz', packageTotal: 3 };
      const v1 = visit({ ...pkg, id: 'gz-1', sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(500), clinicSharePaise: rs(375), postTaxPaise: rs(338) });
      const v2 = visit({ ...pkg, id: 'gz-2', sessionIndex: 2, therapistId: AISH, visitDate: '2026-07-08', actualBillPaise: rs(800), clinicSharePaise: rs(600), postTaxPaise: rs(540) });
      const items = [
        item('gz-1', { pricePaise: 0, isPackageLine: true }),
        item('gz-1', { pricePaise: rs(500) }),
        item('gz-2', { pricePaise: 0, isPackageLine: true }),
        item('gz-2', { pricePaise: rs(800) }),
      ];
      const credits = [credit('gz-1', PREM, rs(500)), credit('gz-2', AISH, rs(800))];
      const all = [v1, v2];
      expect(attributionMovements(input(all, all, { items, credits }))).toEqual([]);
    });

    it('mixed group: a billing visit without lines keeps the max-bill rule over an add-on continuation', () => {
      const pkg = { packageGroupId: 'gm', packageTotal: 3 };
      const v1 = visit({ ...pkg, id: 'gm-1', sessionIndex: 1, therapistId: PREM, visitDate: '2026-07-01', actualBillPaise: rs(3000), clinicSharePaise: rs(2250), postTaxPaise: rs(2025) });
      const v2 = visit({ ...pkg, id: 'gm-2', sessionIndex: 2, therapistId: AISH, visitDate: '2026-07-08', actualBillPaise: rs(4000), clinicSharePaise: rs(3000), postTaxPaise: rs(2700) });
      const v3 = visit({ ...pkg, id: 'gm-3', sessionIndex: 3, therapistId: RAVI, visitDate: '2026-07-15', actualBillPaise: 0, clinicSharePaise: 0, postTaxPaise: 0 });
      const items = [item('gm-2', { pricePaise: 0, isPackageLine: true }), item('gm-2', { pricePaise: rs(4000) })];
      const credits = [credit('gm-2', AISH, rs(4000))];
      const all = [v1, v2, v3];
      const movements = attributionMovements(input(all, all, { items, credits }));
      expect(movements.map((m) => [m.mechanism, m.visitId, m.fromTherapistId, m.toTherapistId, m.postTaxPaise])).toEqual([
        ['package_attribution', 'gm-2', PREM, AISH, rs(675)],
        ['package_attribution', 'gm-3', PREM, RAVI, rs(675)],
      ]);
    });
  });
});

describe('a helper given part of a package session', () => {
  const share = (therapistId: UUID, pct: number) => ({ sessionShareTherapistId: therapistId, sessionSharePct: pct });
  const itemsFor = (g: string, s2: Partial<VisitItem>, s3: Partial<VisitItem> = {}) => [
    item(`${g}-1`, { pricePaise: rs(3000), isPackageLine: true }),
    item(`${g}-2`, { pricePaise: 0, isPackageLine: true, ...s2 }),
    item(`${g}-3`, { pricePaise: 0, isPackageLine: true, ...s3 }),
  ];
  const credits = (g: string) => [credit(`${g}-1`, PREM, rs(3000)), credit(`${g}-2`, PREM, 0), credit(`${g}-3`, PREM, 0)];

  it("the biller ran the session and a colleague helped: the helper's part comes off the session share", () => {
    const all = package3('hp', {}, {});
    const movements = attributionMovements(input(all, all, { items: itemsFor('hp', share(AISH, 40)), credits: credits('hp') }));
    expect(movements).toEqual([
      { mechanism: 'package_attribution', visitId: 'hp-2', fromTherapistId: PREM, toTherapistId: AISH, grossPaise: 0, clinicSharePaise: rs(300), postTaxPaise: rs(270), sessionSharePct: 40, packageRole: 'helper' },
    ]);
  });

  it('a colleague ran it and another helped: the runner keeps the rest, both paid by the biller', () => {
    const all = package3('hq', { therapistId: AISH }, {});
    const items = itemsFor('hq', { assistingTherapistId: AISH, ...share(RAVI, 30) });
    const movements = attributionMovements(input(all, all, { items, credits: credits('hq') }));
    const to = (id: UUID) => movements.find((m) => m.toTherapistId === id)!;
    expect(to(RAVI).postTaxPaise).toBe(rs(203)); // 30% of ₹675 = ₹202.50 → ₹203
    expect(to(AISH).postTaxPaise).toBe(rs(675) - rs(203));
    expect(movements.every((m) => m.fromTherapistId === PREM)).toBe(true);
    const base = payBaseByTherapist(input(all, all, { items, credits: credits('hq') }));
    expect(totalOf(base)).toEqual(sums(all));
  });

  it("a part given back to the biller changes nothing for the biller, the runner keeps the rest", () => {
    const all = package3('hr', { therapistId: AISH }, {});
    const items = itemsFor('hr', { assistingTherapistId: AISH, ...share(PREM, 25) });
    const movements = attributionMovements(input(all, all, { items, credits: credits('hr') }));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ toTherapistId: AISH, postTaxPaise: rs(675) - rs(169) });
  });

  it('is ignored when the clinic split is off, and a part with nothing to give moves nothing', () => {
    const all = package3('hs', {}, {});
    expect(attributionMovements(input(all, all, { items: itemsFor('hs', share(AISH, 40)), credits: credits('hs'), splitEnabled: false }))).toEqual([]);
  });

  it('a session with no part is unchanged', () => {
    const all = package3('ht', { therapistId: AISH }, {});
    const movements = attributionMovements(input(all, all, { items: itemsFor('ht', { assistingTherapistId: AISH }), credits: credits('ht') }));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ toTherapistId: AISH, postTaxPaise: rs(675) });
  });
});
