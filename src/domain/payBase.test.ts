import { describe, expect, it } from 'vitest';
import { attributionMovements, payBaseByTherapist, type PayBaseInput } from './payBase';
import type { UUID, Visit } from './types';
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

/** Mirrors reportService: the in-window visits plus every package group any of them belongs to. */
function input(inWindow: Visit[], all: Visit[] = inWindow): PayBaseInput {
  const packageGroups = new Map<UUID, Visit[]>();
  for (const v of inWindow) {
    if (v.packageGroupId && !packageGroups.has(v.packageGroupId)) {
      packageGroups.set(v.packageGroupId, all.filter((g) => g.packageGroupId === v.packageGroupId));
    }
  }
  return { visits: inWindow, packageGroups, from: FROM, to: TO };
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
});
