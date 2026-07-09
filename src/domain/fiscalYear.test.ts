import { describe, expect, it } from 'vitest';
import { fiscalYearOf, monthsOfFiscalYear, monthDateRange, formatDateDMY } from './fiscalYear';
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

describe('formatDateDMY', () => {
  it('formats an ISO date as DD/MM/YY', () => {
    expect(formatDateDMY('2026-07-05')).toBe('05/07/26');
  });
  it('formats a full ISO timestamp by taking just the date part', () => {
    expect(formatDateDMY('2026-07-05T00:00:00.000Z')).toBe('05/07/26');
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
