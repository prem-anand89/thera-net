import { describe, expect, it } from 'vitest';
import {
  buildTrendMonthsInRange,
  clampFocusMonth,
  prevFyMonth,
} from './insightsTrendPeriod';

describe('insightsTrendPeriod', () => {
  it('mom returns focus and prior month', () => {
    const list = buildTrendMonthsInRange('mom', {
      fyStartMonth: 4,
      momFocus: { year: 2026, month: 3 },
    });
    expect(list).toEqual([
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ]);
  });

  it('prevFyMonth crosses year boundary', () => {
    expect(prevFyMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
  });

  it('clampFocusMonth snaps to last in range', () => {
    const range = [{ year: 2026, month: 1 }, { year: 2026, month: 2 }];
    expect(clampFocusMonth({ year: 2020, month: 5 }, range)).toEqual({ year: 2026, month: 2 });
  });
});
