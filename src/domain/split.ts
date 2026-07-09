import { type Paise, roundToRupeeHalfUp } from './money';

/**
 * How the clinic's TDS figure is computed for reports:
 * - 'gross_bill': tax % of the full bill (matches the current BM/Health Valley
 *   sheet, where the hospital deducts tax before splitting)
 * - 'bm_share': tax % of the clinic's share only (spec §2 formula)
 * Both bases yield the identical clinic payout (bill × split × (1 − tax));
 * only the reported TDS and implied hospital share differ.
 */
export type TdsBasis = 'gross_bill' | 'bm_share';

export interface VisitSplit {
  bmSharePaise: Paise;
  postTaxPaise: Paise;
  tdsPaise: Paise;
  hvPaise: Paise;
}

/**
 * Revenue split for one visit. Percentages are whole-number style (75, 10),
 * matching the clinics table. Multiplications are ordered so intermediate
 * values stay integral until the single divide, avoiding float drift on
 * exact-half cases (e.g. ₹22,700 × 67.5% = ₹15,322.50 → ₹15,323).
 */
export function computeVisitSplit(
  billPaise: Paise,
  bmSplitPct: number,
  taxPct: number,
  tdsBasis: TdsBasis
): VisitSplit {
  const bmSharePaise = roundToRupeeHalfUp((billPaise * bmSplitPct) / 100);
  const postTaxPaise = roundToRupeeHalfUp((billPaise * bmSplitPct * (100 - taxPct)) / 10000);
  const tdsPaise =
    tdsBasis === 'gross_bill'
      ? roundToRupeeHalfUp((billPaise * taxPct) / 100)
      : bmSharePaise - postTaxPaise;
  const hvPaise = billPaise - postTaxPaise;
  return { bmSharePaise, postTaxPaise, tdsPaise, hvPaise };
}
