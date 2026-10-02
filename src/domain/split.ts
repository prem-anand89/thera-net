import { type Paise, roundToRupeeHalfUp } from './money';

/**
 * How the clinic's TDS figure is computed, and — just as importantly — in
 * what ORDER tax and the revenue split happen, which differs by real-world
 * arrangement:
 * - 'gross_bill': the partner deducts TDS off the full bill FIRST, then
 *   splits what's left (matches the Beyond Mechanics/Health Valley
 *   arrangement: "hospital billed and deducted TDS on the overall amount,
 *   and gave our 75% share from the remainder").
 * - 'bm_share': the split happens first (on the gross bill), and only the
 *   clinic's own resulting share is taxed — the partner's share is never
 *   touched by tax at all (spec §2 formula).
 * Both bases produce the identical clinic payout (bill × split × (1 − tax));
 * only how the hospital's own share and the reported TDS are derived differ,
 * because the two models disagree about which pool tax comes out of.
 */
export type TdsBasis = 'gross_bill' | 'bm_share';

export interface VisitSplit {
  /** Clinic's total nominal entitlement: postTaxPaise + tdsPaise, under
   *  either basis. Under 'bm_share' this is also a real pre-tax amount (the
   *  split happens before tax); under 'gross_bill' it's not a cash figure
   *  that's ever actually paid out at any point — tax comes off the whole
   *  bill before any split happens — it exists so this identity holds
   *  consistently across both bases. */
  bmSharePaise: Paise;
  postTaxPaise: Paise;
  tdsPaise: Paise;
  /** The partner hospital's share. bmSharePaise + hvPaise === billPaise,
   *  under either basis. */
  hvPaise: Paise;
}

/**
 * Revenue split for one visit. Percentages are whole-number style (75, 10),
 * matching the clinics table. Multiplications are ordered so intermediate
 * values stay integral until the single divide, avoiding float drift on
 * exact-half cases (e.g. ₹22,700 × 67.5% = ₹15,322.50 → ₹15,323).
 *
 * The two bases split a DIFFERENT pool, not just report tax differently:
 * - 'bm_share': split the gross bill 75/25 first (bmSharePaise = 75% of
 *   gross, hvPaise = the other 25%, neither touched by tax yet), then tax
 *   only the clinic's own 75% slice down to postTaxPaise. The hospital's
 *   25% is never taxed in this model.
 * - 'gross_bill': tax comes off the WHOLE bill first (tdsPaise = taxPct% of
 *   the gross), then the 75/25 split happens on what's left. postTaxPaise
 *   (the clinic's real cash) is `remainder × bmSplitPct`, computed as a
 *   single combined multiply-then-divide for identical rounding behavior
 *   to the bm_share path — it is NOT `bmSharePaise × (1 − tax)`, which
 *   would tax the clinic's share a second time on top of the TDS already
 *   taken from the gross pool. hvPaise is the hospital's share of that same
 *   post-tax remainder, never of the untaxed gross — getting this wrong
 *   (computing hvPaise from the gross bill instead) silently overstates the
 *   total paid out by exactly taxPct% of the hospital's share, since it
 *   then double-counts the TDS that was already deducted from the shared
 *   pool once on top of handing the hospital an untaxed 25% of the whole
 *   bill.
 */
export function computeVisitSplit(
  billPaise: Paise,
  bmSplitPct: number,
  taxPct: number,
  tdsBasis: TdsBasis
): VisitSplit {
  if (tdsBasis === 'gross_bill') {
    const tdsPaise = roundToRupeeHalfUp((billPaise * taxPct) / 100);
    const remainderPaise = billPaise - tdsPaise;
    const postTaxPaise = roundToRupeeHalfUp((remainderPaise * bmSplitPct) / 100);
    const hvPaise = remainderPaise - postTaxPaise;
    const bmSharePaise = postTaxPaise + tdsPaise;
    return { bmSharePaise, postTaxPaise, tdsPaise, hvPaise };
  }
  const bmSharePaise = roundToRupeeHalfUp((billPaise * bmSplitPct) / 100);
  const postTaxPaise = roundToRupeeHalfUp((billPaise * bmSplitPct * (100 - taxPct)) / 10000);
  const tdsPaise = bmSharePaise - postTaxPaise;
  const hvPaise = billPaise - bmSharePaise;
  return { bmSharePaise, postTaxPaise, tdsPaise, hvPaise };
}
