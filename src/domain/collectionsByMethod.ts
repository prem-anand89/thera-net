import { isCashInHand } from './paymentMethods';

export interface CollectionsByMethod {
  cash: number;
  upi: number;
  card: number;
  /** Bank, cheque and anything else that reached the clinic. */
  other: number;
}

/**
 * What reached the clinic, by how it was paid. Money the partner collected is not in the clinic's hands, so it is
 * left out, as in the Daybook's total. Payments against an advance are skipped (the advance was counted when it came in).
 */
export function collectionsByMethod(
  payments: readonly { method: string; amountPaise: number; advanceId?: string | null }[],
  advances: readonly { method: string; amountPaise: number }[]
): CollectionsByMethod {
  const out: CollectionsByMethod = { cash: 0, upi: 0, card: 0, other: 0 };
  const add = (method: string, amountPaise: number) => {
    if (!isCashInHand(method as Parameters<typeof isCashInHand>[0])) return;
    if (method === 'cash' || method === 'upi' || method === 'card') out[method] += amountPaise;
    else out.other += amountPaise;
  };
  for (const p of payments) if (!p.advanceId) add(p.method, p.amountPaise);
  for (const a of advances) add(a.method, a.amountPaise);
  return out;
}

/** "Cash ₹1,000 · UPI ₹500", leaving out methods with nothing; empty text when nothing was collected. */
export function collectionsLine(c: CollectionsByMethod, format: (paise: number) => string): string {
  return (
    [
      ['Cash', c.cash],
      ['UPI', c.upi],
      ['Card', c.card],
      ['Other', c.other],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${format(n)}`)
    .join(' · ');
}
