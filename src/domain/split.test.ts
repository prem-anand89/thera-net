import { describe, expect, it } from 'vitest';
import { computeVisitSplit } from './split';
import { rupeesToPaise as rs } from './money';

// Vectors taken directly from the Beyond Mechanics / Health Valley FY26-27
// sheets — these numbers must match the hospital's report exactly.
describe('computeVisitSplit', () => {
  it('matches the charges sheet for a ₹800 consultation (gross_bill basis)', () => {
    const s = computeVisitSplit(rs(800), 75, 10, 'gross_bill');
    expect(s.bmSharePaise).toBe(rs(600));
    expect(s.postTaxPaise).toBe(rs(540));
    expect(s.tdsPaise).toBe(rs(80)); // sheet's TDS column: 10% of gross
    expect(s.hvPaise).toBe(rs(260));
  });

  it('reports TDS on the BM share only under bm_share basis', () => {
    const s = computeVisitSplit(rs(800), 75, 10, 'bm_share');
    expect(s.bmSharePaise).toBe(rs(600));
    expect(s.postTaxPaise).toBe(rs(540)); // payout identical under both bases
    expect(s.tdsPaise).toBe(rs(60));
  });

  it('matches the May monthly summary (₹59,400)', () => {
    const s = computeVisitSplit(rs(59400), 75, 10, 'gross_bill');
    expect(s.bmSharePaise).toBe(rs(44550));
    expect(s.postTaxPaise).toBe(rs(40095));
    expect(s.tdsPaise).toBe(rs(5940));
  });

  it('gives ₹4,455 TDS for May under bm_share basis', () => {
    const s = computeVisitSplit(rs(59400), 75, 10, 'bm_share');
    expect(s.tdsPaise).toBe(rs(4455));
  });

  it('rounds exact halves up like the sheet (₹22,700 → ₹15,323)', () => {
    // 22,700 × 0.675 = 15,322.50 — sheet shows 15,323
    const s = computeVisitSplit(rs(22700), 75, 10, 'gross_bill');
    expect(s.postTaxPaise).toBe(rs(15323));
  });

  it('rounds ₹36,700 → ₹24,773 (Prem, May)', () => {
    const s = computeVisitSplit(rs(36700), 75, 10, 'gross_bill');
    expect(s.postTaxPaise).toBe(rs(24773));
  });

  it("matches Aishwarya's April post-tax (₹43,200 → ₹29,160)", () => {
    const s = computeVisitSplit(rs(43200), 75, 10, 'gross_bill');
    expect(s.postTaxPaise).toBe(rs(29160));
  });

  it('treats ₹0 package-continuation sessions as valid, not errors', () => {
    const s = computeVisitSplit(0, 75, 10, 'gross_bill');
    expect(s).toEqual({ bmSharePaise: 0, postTaxPaise: 0, tdsPaise: 0, hvPaise: 0 });
  });

  it('handles renegotiated rates (rate snapshots live on the visit)', () => {
    const s = computeVisitSplit(rs(1000), 80, 5, 'gross_bill');
    expect(s.bmSharePaise).toBe(rs(800));
    expect(s.postTaxPaise).toBe(rs(760));
    expect(s.tdsPaise).toBe(rs(50));
    expect(s.hvPaise).toBe(rs(240));
  });
});
