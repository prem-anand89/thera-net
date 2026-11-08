import { hasDue, visitDuePaise, type VisitPaymentState } from '@/domain/paymentState';
import type { Paise } from '@/domain/money';

export interface TodayTotalsRow {
  therapistId: string;
  billPaise: Paise;
  collectedPaise: Paise;
  paymentState: VisitPaymentState;
}

export interface TodayTotals {
  visits: number;
  billedPaise: Paise;
  /** Billed less what is still due. */
  paidPaise: Paise;
  /** Same per-visit rule as the Dues tile (`visitDuePaise`). */
  duePaise: Paise;
}

/** Visits billed, paid and due across a set of today's visits, e.g. one therapist's. */
export function todayVisitTotals(rows: readonly TodayTotalsRow[]): TodayTotals {
  let billedPaise = 0;
  let duePaise = 0;
  for (const r of rows) {
    billedPaise += r.billPaise;
    if (hasDue(r.paymentState)) duePaise += visitDuePaise(r.paymentState, r.billPaise, r.collectedPaise);
  }
  return { visits: rows.length, billedPaise, paidPaise: Math.max(0, billedPaise - duePaise), duePaise };
}

/** The therapists who have a visit in `rows`, by name, with how many. */
export function therapistsInRows(
  rows: readonly { therapistId: string; therapistName: string }[]
): { id: string; name: string; count: number }[] {
  const byId = new Map<string, { id: string; name: string; count: number }>();
  for (const r of rows) {
    const found = byId.get(r.therapistId);
    if (found) found.count += 1;
    else byId.set(r.therapistId, { id: r.therapistId, name: r.therapistName, count: 1 });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
