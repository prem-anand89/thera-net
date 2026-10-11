import { describe, expect, it } from 'vitest';
import { utilisationBuckets } from './utilisationPeriods';

const asOf = new Date(2026, 9, 12); // 12 Oct 2026, mid fiscal Q3 of FY 26-27 (Apr start)

describe('utilisationBuckets', () => {
  it('month: the last 12 calendar months ending with the current one', () => {
    const b = utilisationBuckets('month', 4, asOf);
    expect(b).toHaveLength(12);
    expect(b[0].from).toBe('2025-11-01');
    expect(b[11]).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('quarter: the last 4 fiscal quarters, ending with the one in progress', () => {
    const b = utilisationBuckets('quarter', 4, asOf);
    expect(b.map((x) => x.label)).toEqual(['Q4 25-26', 'Q1 26-27', 'Q2 26-27', 'Q3 26-27']);
    expect(b[3]).toMatchObject({ from: '2026-10-01', to: '2026-12-31' });
    expect(b[0]).toMatchObject({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('quarter: honours a non-April fiscal-year start', () => {
    const b = utilisationBuckets('quarter', 1, asOf); // calendar-year FY
    expect(b[b.length - 1]).toMatchObject({ from: '2026-10-01', to: '2026-12-31' });
    expect(b[b.length - 1].label).toMatch(/^Q4 /);
  });

  it('year: the last 3 fiscal years', () => {
    const b = utilisationBuckets('year', 4, asOf);
    expect(b.map((x) => x.label)).toEqual(['FY 24-25', 'FY 25-26', 'FY 26-27']);
    expect(b[2]).toMatchObject({ from: '2026-04-01', to: '2027-03-31' });
  });

  it('drops buckets that have not started', () => {
    const early = new Date(2026, 3, 5); // 5 Apr 2026: only Q1 of FY 26-27 has started
    const b = utilisationBuckets('quarter', 4, early);
    expect(b[b.length - 1].label).toBe('Q1 26-27');
  });
});
