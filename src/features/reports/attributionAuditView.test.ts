import { describe, expect, it } from 'vitest';
import type { AttributionEntry } from '@/services/attributionAuditService';
import { basisText, filterEntries, myBasisText, myRows, summarize, toAuditCsv } from './attributionAuditView';

const name = (id: string) => ({ a: 'Dr A', b: 'Dr B', c: 'Dr C' })[id] ?? id;
const entry = (over: Partial<AttributionEntry>): AttributionEntry => ({
  mechanism: 'package_attribution',
  visitId: 'v1',
  visitDate: '2026-11-03',
  patientId: 'p1',
  fromTherapistId: 'a',
  toTherapistId: 'b',
  grossPaise: null,
  postTaxPaise: 100000,
  packageGroupId: 'g',
  sharedPct: null,
  visitBillPaise: null,
  packageTotalPaise: 300000,
  packageSessionCount: 3,
  sessionIndex: 2,
  billingVisitDate: '2026-10-23',
  repaired: false,
  ...over,
});

describe('attribution audit view', () => {
  it('explains a package movement: session, runner, biller, price and billing date', () => {
    expect(basisText(entry({}), name)).toBe("Session 2 of 3 · run by Dr B · from Dr A's ₹3,000 package billed 23/10/26");
  });

  it('names a helper and the runner who keeps the rest', () => {
    expect(basisText(entry({ packageRole: 'helper', sessionSharePct: 40 }), name)).toContain('Dr B helped (40%)');
    expect(basisText(entry({ sessionSharePct: 40 }), name)).toContain('run by Dr B (keeps 60%)');
    expect(myBasisText(entry({ packageRole: 'helper', sessionSharePct: 40 }), name)).toContain('Dr B helped');
  });

  it('filters by a therapist who gave or received, and by patient', () => {
    const list = [entry({}), entry({ visitId: 'v2', fromTherapistId: 'c', toTherapistId: 'b', patientId: 'p2' })];
    const pn = (id: string) => (id === 'p1' ? 'Asha (W1)' : 'Ravi (W2)');
    expect(filterEntries(list, { therapistId: 'a', patientName: pn })).toHaveLength(1);
    expect(filterEntries(list, { therapistId: 'b', patientName: pn })).toHaveLength(2);
    expect(filterEntries(list, { query: 'ravi', patientName: pn })).toHaveLength(1);
  });

  it('summarises given and received per therapist; they net to zero overall', () => {
    const s = summarize([entry({}), entry({ visitId: 'v2' })]);
    const a = s.find((r) => r.therapistId === 'a')!;
    const b = s.find((r) => r.therapistId === 'b')!;
    expect(a).toMatchObject({ given: 200000, received: 0 });
    expect(b).toMatchObject({ given: 0, received: 200000 });
  });

  it('exports a CSV with quoted cells', () => {
    const csv = toAuditCsv([entry({})], name, () => 'Asha, M (W1)');
    expect(csv.split('\n')[0]).toContain('Post-tax');
    expect(csv).toContain('"Asha, M (W1)"');
  });

  it('gives a therapist only their own rows, signed, without the bill or package price', () => {
    const list = [
      entry({}),
      entry({ visitId: 'v2', fromTherapistId: 'c', toTherapistId: 'b', visitDate: '2026-11-05' }),
      entry({ visitId: 'v3', mechanism: 'line_share', fromTherapistId: 'a', toTherapistId: 'c', visitBillPaise: 230000 }),
    ];
    const mine = myRows(list, 'b');
    expect(mine.map((r) => [r.entry.visitId, r.signedPaise])).toEqual([['v2', 100000], ['v1', 100000]]);
    expect(myRows(list, 'a').map((r) => r.signedPaise)).toEqual([-100000, -100000]);
    const text = [myBasisText(list[0]!, name), myBasisText(list[2]!, name)].join(' ');
    expect(text).not.toMatch(/3,000|2,300/);
    expect(myBasisText(list[0]!, name)).toContain('Package session 2 of 3, run by Dr B');
  });
});
