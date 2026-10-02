import { describe, expect, it } from 'vitest';
import { computeVisitSplit } from './split';
import { rupeesToPaise as rs } from './money';

// Vectors taken directly from the Beyond Mechanics / Health Valley FY26-27
// sheets — these numbers must match the hospital's report exactly.
describe('computeVisitSplit', () => {
  it('matches the charges sheet for a ₹800 consultation (gross_bill basis)', () => {
    const s = computeVisitSplit(rs(800), 75, 10, 'gross_bill');
    // postTaxPaise/tdsPaise are the two figures verified directly against
    // the hospital's own sheet — unchanged by the hvPaise/bmSharePaise fix
    // below. TDS comes off the ₹800 gross first (₹80), leaving ₹720; the
    // clinic's real cash is 75% of THAT remainder.
    expect(s.postTaxPaise).toBe(rs(540));
    expect(s.tdsPaise).toBe(rs(80)); // sheet's TDS column: 10% of gross
    // hvPaise/bmSharePaise previously computed the 75/25 split on the
    // untaxed ₹800 (hvPaise=200, bmSharePaise=600) as if tax hadn't
    // already been taken off the shared pool — double-counting the TDS on
    // top of an untaxed hospital share and overstating total payout by
    // ₹20 (540+80+200=820, not 800). Corrected: the hospital's 25% comes
    // from the same post-tax ₹720 remainder the clinic's 75% does.
    expect(s.hvPaise).toBe(rs(180)); // 25% of the ₹720 post-tax remainder
    expect(s.bmSharePaise).toBe(rs(620)); // postTaxPaise + tdsPaise, by construction
    expect(s.postTaxPaise + s.tdsPaise + s.hvPaise).toBe(rs(800)); // now actually reconciles
  });

  it('reports TDS on the BM share only under bm_share basis', () => {
    const s = computeVisitSplit(rs(800), 75, 10, 'bm_share');
    expect(s.bmSharePaise).toBe(rs(600));
    expect(s.postTaxPaise).toBe(rs(540)); // payout identical under both bases
    expect(s.tdsPaise).toBe(rs(60));
  });

  it('matches the May monthly summary (₹59,400)', () => {
    const s = computeVisitSplit(rs(59400), 75, 10, 'gross_bill');
    expect(s.postTaxPaise).toBe(rs(40095));
    expect(s.tdsPaise).toBe(rs(5940));
    expect(s.bmSharePaise).toBe(rs(46035)); // postTaxPaise + tdsPaise (was 44550 pre-fix)
    expect(s.hvPaise).toBe(rs(13365)); // 25% of the ₹53,460 post-tax remainder
    expect(s.postTaxPaise + s.tdsPaise + s.hvPaise).toBe(rs(59400));
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
    expect(s.postTaxPaise).toBe(rs(760));
    expect(s.tdsPaise).toBe(rs(50));
    // ₹1000 − ₹50 TDS = ₹950 remainder; hospital's 20% of that, not of
    // the untaxed ₹1000 (which would again double-count the TDS).
    expect(s.hvPaise).toBe(rs(190));
    expect(s.bmSharePaise).toBe(rs(810)); // postTaxPaise + tdsPaise
    expect(s.postTaxPaise + s.tdsPaise + s.hvPaise).toBe(rs(1000));
  });

  // Not Beyond Mechanics' own rates — a different hypothetical clinic, to
  // confirm the fix is a general property of the formula, not something
  // tuned to one partnership's 75%/10%.
  it('reconciles for any split/tax combination under gross_bill, not just Beyond Mechanics rates', () => {
    const s = computeVisitSplit(rs(5000), 60, 15, 'gross_bill');
    expect(s.tdsPaise).toBe(rs(750)); // 15% of the ₹5,000 gross
    expect(s.postTaxPaise).toBe(rs(2550)); // 60% of the ₹4,250 post-tax remainder
    expect(s.hvPaise).toBe(rs(1700)); // the other 40% of that same remainder
    expect(s.postTaxPaise + s.tdsPaise + s.hvPaise).toBe(rs(5000));
  });

  // Same bill/split/tax as above, but the OTHER real-world arrangement —
  // split first, each side handles its own tax. A clinic whose partnership
  // works this way (rather than the hospital withholding TDS up front) is
  // unaffected by the gross_bill fix above.
  it('bm_share basis reconciles independently of the gross_bill fix, for the same numbers', () => {
    const s = computeVisitSplit(rs(5000), 60, 15, 'bm_share');
    expect(s.bmSharePaise).toBe(rs(3000)); // 60% of gross, split before any tax
    expect(s.postTaxPaise).toBe(rs(2550)); // clinic's own 60% slice, taxed
    expect(s.tdsPaise).toBe(rs(450)); // bmSharePaise - postTaxPaise, by construction
    expect(s.hvPaise).toBe(rs(2000)); // hospital's 40% — never taxed in this model
    expect(s.bmSharePaise).toBe(s.postTaxPaise + s.tdsPaise);
    expect(s.bmSharePaise + s.hvPaise).toBe(rs(5000));
  });
});
