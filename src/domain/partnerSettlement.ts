import type { Paise } from './money';

/** One visit's money and shares, for visits with any payment recorded. */
export interface SettlementVisit {
  billPaise: Paise;
  /** Payments with method `partner`: the partner's counter holds this money. */
  partnerHeldPaise: Paise;
  /** Every other payment: the clinic's drawer holds this money. */
  clinicHeldPaise: Paise;
  partnerSharePaise: Paise;
  postTaxPaise: Paise;
}

export interface SettlementBalance {
  /** What the month would come to if every visit went the clinic's usual way: today's "expected" figure. */
  usualPaise: Paise;
  /** How much of that the visits settled the other way cancel. */
  adjustmentPaise: Paise;
  crossVisitCount: number;
  /** Money those visits moved the other way: shown beside the adjustment. */
  crossCollectedPaise: Paise;
  /** Who pays once both directions are netted: the clinic, or the partner. */
  clinicPays: boolean;
  /** The amount due, always positive; the direction is `clinicPays`. */
  duePaise: Paise;
}

/**
 * The partner settlement for a month, from who actually holds each visit's money.
 *
 * `partnerCollects` is only the clinic's usual arrangement, and any visit can be settled the other way. A clinic that
 * collects owes the partner its share, except on money the partner already took; there, the partner owes the clinic
 * its share instead. A partner-collecting clinic is the mirror image. Per visit, with f the fraction held the unusual
 * way, the usual total moves by f x (partner share + post-tax share): one side stops owing, the other starts.
 * Part-paid visits count by that fraction, and a month with nothing crossing is exactly the usual figure.
 */
export function settlementBalance(input: {
  partnerCollects: boolean;
  totalPartnerSharePaise: Paise;
  totalPostTaxPaise: Paise;
  visits: readonly SettlementVisit[];
}): SettlementBalance {
  const { partnerCollects, totalPartnerSharePaise, totalPostTaxPaise, visits } = input;
  const usualPaise = partnerCollects ? totalPostTaxPaise : totalPartnerSharePaise;
  let adjustmentPaise = 0;
  let crossVisitCount = 0;
  let crossCollectedPaise = 0;
  for (const v of visits) {
    const held = Math.max(0, partnerCollects ? v.clinicHeldPaise : v.partnerHeldPaise);
    if (held <= 0 || v.billPaise <= 0) continue;
    const across = Math.min(held, v.billPaise);
    adjustmentPaise += Math.round(((v.partnerSharePaise + v.postTaxPaise) * across) / v.billPaise);
    crossVisitCount += 1;
    crossCollectedPaise += across;
  }
  const net = usualPaise - adjustmentPaise;
  return {
    usualPaise,
    adjustmentPaise,
    crossVisitCount,
    crossCollectedPaise,
    clinicPays: partnerCollects ? net < 0 : net >= 0,
    duePaise: Math.abs(net),
  };
}
