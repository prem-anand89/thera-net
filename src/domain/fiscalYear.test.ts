import { describe, expect, it } from 'vitest';
import {
  fiscalYearOf,
  monthsOfFiscalYear,
  monthDateRange,
  pacingMonthDateRange,
  projectMonthly,
  fiscalYearDateRange,
  fiscalYearToDateRange,
  currentWeekRange,
  formatDateDMY,
  formatDateDM,
} from './fiscalYear';
import { formatInvoiceNo } from './invoiceNumber';
import { effectivePricePerSession } from './types';
import { rupeesToPaise as rs } from './money';

describe('fiscalYearOf (April–March)', () => {
  it('puts April 2026 in FY 26-27', () => {
    expect(fiscalYearOf('2026-04-01')).toEqual({ startYear: 2026, label: '26-27' });
  });
  it('puts March 2026 in FY 25-26', () => {
    expect(fiscalYearOf('2026-03-31')).toEqual({ startYear: 2025, label: '25-26' });
  });
  it('puts March 2027 in FY 26-27', () => {
    expect(fiscalYearOf('2027-03-15').label).toBe('26-27');
  });
  it('respects a different fy_start_month', () => {
    expect(fiscalYearOf('2026-03-31', 1).label).toBe('26-27'); // calendar-year clinic
  });
});

describe('monthsOfFiscalYear', () => {
  it('runs Apr 2026 → Mar 2027 for FY 26-27', () => {
    const months = monthsOfFiscalYear(2026, 4);
    expect(months[0]).toEqual({ year: 2026, month: 4 });
    expect(months[11]).toEqual({ year: 2027, month: 3 });
    expect(months).toHaveLength(12);
  });
});

describe('monthDateRange', () => {
  it('covers whole months including leap February', () => {
    expect(monthDateRange({ year: 2028, month: 2 })).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });
});

describe('pacingMonthDateRange', () => {
  it('clips the prior month to the same elapsed day count', () => {
    expect(pacingMonthDateRange({ year: 2026, month: 10 }, new Date(2026, 9, 8))).toEqual({
      from: '2026-09-01',
      to: '2026-09-08',
    });
  });
  it('clamps to the prior month\'s last day when it is shorter (March MTD vs February)', () => {
    expect(pacingMonthDateRange({ year: 2026, month: 3 }, new Date(2026, 2, 31))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
  it('clamps correctly for a leap February as the prior month', () => {
    expect(pacingMonthDateRange({ year: 2028, month: 3 }, new Date(2028, 2, 30))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });
  it('rolls over the year when the current month is January', () => {
    expect(pacingMonthDateRange({ year: 2027, month: 1 }, new Date(2027, 0, 5))).toEqual({
      from: '2026-12-01',
      to: '2026-12-05',
    });
  });
  it('handles day 1 of the month', () => {
    expect(pacingMonthDateRange({ year: 2026, month: 10 }, new Date(2026, 9, 1))).toEqual({
      from: '2026-09-01',
      to: '2026-09-01',
    });
  });
});

describe('projectMonthly', () => {
  it('extrapolates the daily average across the full month', () => {
    expect(projectMonthly(8000, 8, 31)).toBeCloseTo(31000, 5);
  });
  it('returns 0 for day 0 instead of dividing by zero', () => {
    expect(projectMonthly(0, 0, 30)).toBe(0);
  });
});

describe('fiscalYearDateRange', () => {
  it('spans the whole FY, Apr 2026 through Mar 2027', () => {
    expect(fiscalYearDateRange(2026, 4)).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
    });
  });
  it('respects a different fy_start_month', () => {
    expect(fiscalYearDateRange(2026, 1)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });
});

describe('fiscalYearToDateRange', () => {
  it('spans FY start through the given asOf date', () => {
    expect(fiscalYearToDateRange(2026, 4, new Date(2026, 7, 21))).toEqual({
      from: '2026-04-01',
      to: '2026-08-21',
    });
  });
  it('clamps to the FY start when asOf is before the FY begins', () => {
    expect(fiscalYearToDateRange(2026, 4, new Date(2026, 2, 15))).toEqual({
      from: '2026-04-01',
      to: '2026-04-01',
    });
  });
});

describe('currentWeekRange', () => {
  it('spans Monday through Sunday for a mid-week date', () => {
    expect(currentWeekRange(new Date(2026, 7, 19))).toEqual({
      from: '2026-08-17',
      to: '2026-08-23',
    });
  });
  it('treats Monday itself as the start of its own week', () => {
    expect(currentWeekRange(new Date(2026, 7, 24))).toEqual({
      from: '2026-08-24',
      to: '2026-08-30',
    });
  });
});

describe('formatDateDMY', () => {
  it('formats an ISO date as DD/MM/YY', () => {
    expect(formatDateDMY('2026-07-05')).toBe('05/07/26');
  });
  it('formats a full ISO timestamp by taking just the date part', () => {
    expect(formatDateDMY('2026-07-05T00:00:00.000Z')).toBe('05/07/26');
  });
});

describe('formatDateDM', () => {
  it('formats an ISO date as DD/MM, dropping the year', () => {
    expect(formatDateDM('2026-07-05')).toBe('05/07');
  });
  it('formats a full ISO timestamp by taking just the date part', () => {
    expect(formatDateDM('2026-07-05T00:00:00.000Z')).toBe('05/07');
  });
});

describe('formatInvoiceNo', () => {
  it('formats BM/26-27/0001', () => {
    expect(formatInvoiceNo('BM', '26-27', 1)).toBe('BM/26-27/0001');
    expect(formatInvoiceNo('BM', '26-27', 123)).toBe('BM/26-27/0123');
  });
});

describe('effectivePricePerSession', () => {
  it('derives ₹733/session for Physiotherapy 3 Days (₹2,200 ÷ 3)', () => {
    expect(effectivePricePerSession({ basePricePaise: rs(2200), sessionCount: 3 })).toBe(73333);
  });
  it('is the base price for single sessions', () => {
    expect(effectivePricePerSession({ basePricePaise: rs(800), sessionCount: 1 })).toBe(rs(800));
  });
});
