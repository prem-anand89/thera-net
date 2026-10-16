import type { Paise } from '@/domain/money';
import { hasDue, isCollected, visitDuePaise, type VisitPaymentState } from '@/domain/paymentState';

export interface SummarisedTotals {
  visitCount: number;
  bill: Paise;
  collected: Paise;
  outstanding: Paise;
  unpaidCount: number;
  state: 'dues' | 'clear' | 'no_charge';
}

export interface MinimalVisitRow {
  billPaise: Paise;
  paymentState: VisitPaymentState;
  collectedPaise?: Paise;
}

export function summariseTotals(rows: readonly MinimalVisitRow[]): SummarisedTotals {
  let bill = 0;
  let collected = 0;
  let outstanding = 0;
  let unpaidCount = 0;

  for (const r of rows) {
    bill += r.billPaise;
    const directCollected = r.collectedPaise ?? 0;
    if (isCollected(r.paymentState)) {
      collected += r.billPaise;
    } else if (r.paymentState === 'partially_collected') {
      collected += directCollected;
    }
    outstanding += visitDuePaise(r.paymentState, r.billPaise, directCollected);
    if (hasDue(r.paymentState)) {
      unpaidCount += 1;
    }
  }

  let state: 'dues' | 'clear' | 'no_charge';
  if (bill === 0) {
    state = 'no_charge';
  } else if (outstanding > 0) {
    state = 'dues';
  } else {
    state = 'clear';
  }

  return {
    visitCount: rows.length,
    bill,
    collected,
    outstanding,
    unpaidCount,
    state,
  };
}
