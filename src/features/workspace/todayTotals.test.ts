import { describe, expect, it } from 'vitest';
import { therapistsInRows, todayVisitTotals, type TodayTotalsRow } from './todayTotals';

const row = (over: Partial<TodayTotalsRow>): TodayTotalsRow => ({
  therapistId: 't1',
  billPaise: 100000,
  collectedPaise: 0,
  paymentState: 'paid',
  ...over,
});

describe('todayVisitTotals', () => {
  it('is all zero for no visits', () => {
    expect(todayVisitTotals([])).toEqual({ visits: 0, billedPaise: 0, paidPaise: 0, duePaise: 0 });
  });

  it('adds billed, and owes the whole bill when nothing was taken', () => {
    const t = todayVisitTotals([
      row({ billPaise: 100000, paymentState: 'paid' }),
      row({ billPaise: 50000, paymentState: 'uninvoiced' }),
      row({ billPaise: 30000, paymentState: 'outstanding' }),
    ]);
    expect(t).toEqual({ visits: 3, billedPaise: 180000, paidPaise: 100000, duePaise: 80000 });
  });

  it('owes only the rest of a part-paid visit', () => {
    const t = todayVisitTotals([row({ billPaise: 100000, collectedPaise: 40000, paymentState: 'partially_collected' })]);
    expect(t).toMatchObject({ billedPaise: 100000, paidPaise: 40000, duePaise: 60000 });
  });

  it('counts a free package session as a visit worth nothing', () => {
    const t = todayVisitTotals([row({ billPaise: 0, paymentState: 'zero_session' })]);
    expect(t).toEqual({ visits: 1, billedPaise: 0, paidPaise: 0, duePaise: 0 });
  });
});

describe('therapistsInRows', () => {
  it('lists each therapist once with a count, by name', () => {
    const rows = [
      { therapistId: 'b', therapistName: 'Ravi' },
      { therapistId: 'a', therapistName: 'Asha' },
      { therapistId: 'b', therapistName: 'Ravi' },
    ];
    expect(therapistsInRows(rows)).toEqual([
      { id: 'a', name: 'Asha', count: 1 },
      { id: 'b', name: 'Ravi', count: 2 },
    ]);
  });
});
