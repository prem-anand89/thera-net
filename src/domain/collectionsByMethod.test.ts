import { describe, expect, it } from 'vitest';
import { collectionsByMethod, collectionsLine } from './collectionsByMethod';

describe('collectionsByMethod', () => {
  it('splits by method, counts advances, skips advance draw-downs and partner money', () => {
    const c = collectionsByMethod(
      [
        { method: 'cash', amountPaise: 100 },
        { method: 'upi', amountPaise: 200 },
        { method: 'upi', amountPaise: 50, advanceId: 'a1' },
        { method: 'partner', amountPaise: 900 },
        { method: 'bank', amountPaise: 30 },
      ],
      [{ method: 'card', amountPaise: 400 }]
    );
    expect(c).toEqual({ cash: 100, upi: 200, card: 400, other: 30 });
  });

  it('writes only the methods that have money', () => {
    expect(collectionsLine({ cash: 100, upi: 0, card: 400, other: 0 }, (n) => `₹${n}`)).toBe('Cash ₹100 · Card ₹400');
    expect(collectionsLine({ cash: 0, upi: 0, card: 0, other: 0 }, (n) => `₹${n}`)).toBe('');
  });
});
