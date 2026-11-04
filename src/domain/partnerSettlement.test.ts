import { describe, expect, it } from 'vitest';
import { settlementBalance, type SettlementVisit } from './partnerSettlement';

/** ₹1,000 at 75/25 with 10% tax on the clinic's share: partner ₹250, post-tax ₹675, TDS ₹75. */
const visit = (over: Partial<SettlementVisit> = {}): SettlementVisit => ({
  billPaise: 100000,
  partnerHeldPaise: 0,
  clinicHeldPaise: 0,
  partnerSharePaise: 25000,
  postTaxPaise: 67500,
  ...over,
});
const totals = { totalPartnerSharePaise: 50000, totalPostTaxPaise: 135000 }; // two such visits

describe('settlementBalance', () => {
  it('nothing crossing: exactly the usual figure, clinic collects', () => {
    const b = settlementBalance({ partnerCollects: false, ...totals, visits: [visit({ clinicHeldPaise: 100000 }), visit()] });
    expect(b).toEqual({ usualPaise: 50000, adjustmentPaise: 0, crossVisitCount: 0, crossCollectedPaise: 0, clinicPays: true, duePaise: 50000 });
  });

  it('nothing crossing: exactly the usual figure, partner collects', () => {
    const b = settlementBalance({ partnerCollects: true, ...totals, visits: [visit({ partnerHeldPaise: 100000 }), visit()] });
    expect(b).toEqual({ usualPaise: 135000, adjustmentPaise: 0, crossVisitCount: 0, crossCollectedPaise: 0, clinicPays: false, duePaise: 135000 });
  });

  it('clinic collects, but the hospital took one bill: the clinic owes less, net of what the hospital owes it', () => {
    const b = settlementBalance({ partnerCollects: false, ...totals, visits: [visit({ clinicHeldPaise: 100000 }), visit({ partnerHeldPaise: 100000 })] });
    // Clinic owes ₹250 on its visit; the hospital owes ₹675 on its visit. Net: the hospital owes ₹425.
    expect(b.adjustmentPaise).toBe(92500);
    expect(b.crossVisitCount).toBe(1);
    expect(b.crossCollectedPaise).toBe(100000);
    expect(b.clinicPays).toBe(false);
    expect(b.duePaise).toBe(42500);
  });

  it('partner collects, but one bill was paid at the clinic desk: the mirror image', () => {
    const b = settlementBalance({ partnerCollects: true, ...totals, visits: [visit({ partnerHeldPaise: 100000 }), visit({ clinicHeldPaise: 100000 })] });
    // The hospital owes ₹675 on its visit; the clinic owes ₹250 on its visit. Net: the hospital owes ₹425.
    expect(b.adjustmentPaise).toBe(92500);
    expect(b.clinicPays).toBe(false);
    expect(b.duePaise).toBe(42500);
  });

  it('the same visits come to the same answer from either usual arrangement', () => {
    const visits = [visit({ clinicHeldPaise: 100000 }), visit({ partnerHeldPaise: 100000 })];
    const a = settlementBalance({ partnerCollects: false, ...totals, visits });
    const b = settlementBalance({ partnerCollects: true, ...totals, visits });
    expect([a.clinicPays, a.duePaise]).toEqual([b.clinicPays, b.duePaise]);
  });

  it('every bill crossing flips the direction in full', () => {
    const b = settlementBalance({
      partnerCollects: false,
      totalPartnerSharePaise: 25000,
      totalPostTaxPaise: 67500,
      visits: [visit({ partnerHeldPaise: 100000 })],
    });
    expect(b.clinicPays).toBe(false);
    expect(b.duePaise).toBe(67500);
  });

  it('a part-paid visit counts by the fraction, rounded to the paisa', () => {
    const b = settlementBalance({
      partnerCollects: false,
      totalPartnerSharePaise: 25000,
      totalPostTaxPaise: 67500,
      visits: [visit({ partnerHeldPaise: 33333, clinicHeldPaise: 66667 })],
    });
    // 92,500 x 33,333 / 100,000 = 30,833.03
    expect(b.adjustmentPaise).toBe(30833);
    expect(b.clinicPays).toBe(false);
    expect(b.duePaise).toBe(5833);
  });

  it('overpayment, refunds and ₹0 bills never push it past the visit', () => {
    const over = settlementBalance({ partnerCollects: false, totalPartnerSharePaise: 25000, totalPostTaxPaise: 67500, visits: [visit({ partnerHeldPaise: 150000 })] });
    expect(over.adjustmentPaise).toBe(92500);
    const refund = settlementBalance({ partnerCollects: false, ...totals, visits: [visit({ partnerHeldPaise: -5000 })] });
    expect(refund.adjustmentPaise).toBe(0);
    const free = settlementBalance({ partnerCollects: false, ...totals, visits: [visit({ billPaise: 0, partnerHeldPaise: 100 })] });
    expect(free.adjustmentPaise).toBe(0);
  });
});
