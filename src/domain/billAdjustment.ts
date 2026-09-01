import { paiseToRupees } from '@/domain/money';

export type BillAdjustmentMode = 'none' | 'discount' | 'extra';
export type BillAdjustmentValueType = 'amount' | 'percent';

export interface BillAdjustmentInput {
  mode: BillAdjustmentMode;
  valueType: BillAdjustmentValueType;
  /** Rupees when valueType is `amount`; 0–100 when `percent`. Ignored when mode is `none`. */
  value: number;
}

/** Compute final bill from catalog price and an optional discount or extra. */
export function computeAdjustedBillPaise(
  catalogPricePaise: number,
  adjustment: BillAdjustmentInput
): number {
  const catalog = Math.max(0, catalogPricePaise);
  if (adjustment.mode === 'none' || adjustment.value <= 0 || !Number.isFinite(adjustment.value)) {
    return catalog;
  }

  const { mode, valueType, value } = adjustment;

  if (mode === 'discount') {
    if (valueType === 'percent') {
      const pct = Math.min(100, value);
      return Math.max(0, Math.round(catalog * (1 - pct / 100)));
    }
    return Math.max(0, catalog - Math.round(value * 100));
  }

  if (valueType === 'percent') {
    return Math.max(0, Math.round(catalog * (1 + value / 100)));
  }
  return Math.max(0, catalog + Math.round(value * 100));
}

/** Restore adjustment UI state from stored visit amounts (amount-based; percent is not reversible). */
export function inferBillAdjustment(
  catalogPricePaise: number,
  actualBillPaise: number
): BillAdjustmentInput {
  const delta = actualBillPaise - catalogPricePaise;
  if (delta === 0) {
    return { mode: 'none', valueType: 'amount', value: 0 };
  }
  return {
    mode: delta < 0 ? 'discount' : 'extra',
    valueType: 'amount',
    value: paiseToRupees(Math.abs(delta)),
  };
}

export function describeBillAdjustment(
  catalogPricePaise: number,
  actualBillPaise: number
): { kind: 'discount' | 'extra'; amountPaise: number } | null {
  const delta = actualBillPaise - catalogPricePaise;
  if (delta === 0) return null;
  return {
    kind: delta < 0 ? 'discount' : 'extra',
    amountPaise: Math.abs(delta),
  };
}
