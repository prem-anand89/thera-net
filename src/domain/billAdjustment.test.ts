import { describe, expect, it } from 'vitest';
import { computeAdjustedBillPaise, inferBillAdjustment } from './billAdjustment';
import { rupeesToPaise as rs } from '@/domain/money';

describe('computeAdjustedBillPaise', () => {
  const catalog = rs(1000);

  it('returns catalog when mode is none', () => {
    expect(computeAdjustedBillPaise(catalog, { mode: 'none', valueType: 'amount', value: 0 })).toBe(
      catalog
    );
  });

  it('applies amount discount', () => {
    expect(
      computeAdjustedBillPaise(catalog, { mode: 'discount', valueType: 'amount', value: 200 })
    ).toBe(rs(800));
  });

  it('applies percent discount', () => {
    expect(
      computeAdjustedBillPaise(catalog, { mode: 'discount', valueType: 'percent', value: 10 })
    ).toBe(rs(900));
  });

  it('caps percent discount at 100%', () => {
    expect(
      computeAdjustedBillPaise(catalog, { mode: 'discount', valueType: 'percent', value: 150 })
    ).toBe(0);
  });

  it('applies amount extra', () => {
    expect(
      computeAdjustedBillPaise(catalog, { mode: 'extra', valueType: 'amount', value: 50 })
    ).toBe(rs(1050));
  });

  it('applies percent extra', () => {
    expect(
      computeAdjustedBillPaise(catalog, { mode: 'extra', valueType: 'percent', value: 5 })
    ).toBe(rs(1050));
  });

  it('never returns negative bill', () => {
    expect(
      computeAdjustedBillPaise(catalog, { mode: 'discount', valueType: 'amount', value: 2000 })
    ).toBe(0);
  });
});

describe('inferBillAdjustment', () => {
  it('returns none when amounts match', () => {
    expect(inferBillAdjustment(rs(800), rs(800))).toEqual({
      mode: 'none',
      valueType: 'amount',
      value: 0,
    });
  });

  it('infers discount from negative delta', () => {
    expect(inferBillAdjustment(rs(1000), rs(800))).toEqual({
      mode: 'discount',
      valueType: 'amount',
      value: 200,
    });
  });

  it('infers extra from positive delta', () => {
    expect(inferBillAdjustment(rs(1000), rs(1100))).toEqual({
      mode: 'extra',
      valueType: 'amount',
      value: 100,
    });
  });
});
