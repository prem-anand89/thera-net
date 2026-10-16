import { describe, expect, it } from 'vitest';
import { summariseTotals, type MinimalVisitRow } from './ledgerTotals';

describe('summariseTotals', () => {
  it('handles empty rows', () => {
    expect(summariseTotals([])).toEqual({
      visitCount: 0,
      bill: 0,
      collected: 0,
      outstanding: 0,
      unpaidCount: 0,
      state: 'no_charge',
    });
  });

  it('identifies state: clear when all visits are fully collected', () => {
    const rows: MinimalVisitRow[] = [
      { billPaise: 100000, paymentState: 'paid' },
      { billPaise: 50000, paymentState: 'collected_no_receipt' },
    ];
    const res = summariseTotals(rows);
    expect(res).toEqual({
      visitCount: 2,
      bill: 150000,
      collected: 150000,
      outstanding: 0,
      unpaidCount: 0,
      state: 'clear',
    });
    expect(res.bill).toBe(res.collected + res.outstanding);
  });

  it('identifies state: dues when visits have outstanding or uninvoiced amounts', () => {
    const rows: MinimalVisitRow[] = [
      { billPaise: 100000, paymentState: 'paid' },
      { billPaise: 60000, paymentState: 'outstanding' },
      { billPaise: 40000, paymentState: 'uninvoiced' },
    ];
    const res = summariseTotals(rows);
    expect(res).toEqual({
      visitCount: 3,
      bill: 200000,
      collected: 100000,
      outstanding: 100000,
      unpaidCount: 2,
      state: 'dues',
    });
    expect(res.bill).toBe(res.collected + res.outstanding);
  });

  it('correctly splits partially_collected visits and preserves bill invariant', () => {
    const rows: MinimalVisitRow[] = [
      { billPaise: 100000, paymentState: 'partially_collected', collectedPaise: 30000 },
      { billPaise: 50000, paymentState: 'paid' },
    ];
    const res = summariseTotals(rows);
    expect(res).toEqual({
      visitCount: 2,
      bill: 150000,
      collected: 80000,
      outstanding: 70000,
      unpaidCount: 1,
      state: 'dues',
    });
    expect(res.bill).toBe(res.collected + res.outstanding);
  });

  it('identifies state: no_charge for package sessions or zero-bill visits', () => {
    const rows: MinimalVisitRow[] = [
      { billPaise: 0, paymentState: 'zero_session' },
      { billPaise: 0, paymentState: 'zero_session' },
    ];
    const res = summariseTotals(rows);
    expect(res).toEqual({
      visitCount: 2,
      bill: 0,
      collected: 0,
      outstanding: 0,
      unpaidCount: 0,
      state: 'no_charge',
    });
    expect(res.bill).toBe(res.collected + res.outstanding);
  });
});
