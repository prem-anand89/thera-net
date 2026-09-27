import { describe, expect, it } from 'vitest';
import { monthOverMonthDelta, monthOverMonthPct, monthOverMonthPctSeries } from './chartTrendMath';

describe('chartTrendMath', () => {
  it('monthOverMonthPct returns null when previous is zero', () => {
    expect(monthOverMonthPct(100, 0)).toBeNull();
  });

  it('monthOverMonthDelta skips first month', () => {
    expect(monthOverMonthDelta([0, 10, 15])).toEqual([null, 10, 5]);
  });

  it('monthOverMonthPctSeries matches pairwise pct', () => {
    expect(monthOverMonthPctSeries([100, 150])).toEqual([null, 50]);
  });
});
