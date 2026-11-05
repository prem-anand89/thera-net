import { describe, expect, it } from 'vitest';
import { currencySymbol, formatAmount, formatINR, largestRemainderRupees, rupeesToPaise as rs } from './money';

describe('largestRemainderRupees', () => {
  it('splits in whole rupees by largest remainder and sums exactly', () => {
    // ₹1,300 over 1000:500 → ₹866.67 / ₹433.33 → ₹867 / ₹433.
    expect(largestRemainderRupees([rs(1000), rs(500)], rs(1300))).toEqual([rs(867), rs(433)]);
  });

  it('breaks ties toward the lower index', () => {
    expect(largestRemainderRupees([1, 1], rs(3))).toEqual([rs(2), rs(1)]);
  });

  it('never over-allocates: ₹1 over two equal shares gives ₹1 and ₹0', () => {
    expect(largestRemainderRupees([0, rs(100), rs(100)], rs(1))).toEqual([0, rs(1), 0]);
  });

  it('ranks zero weights last and gives stray paise to the next in line', () => {
    expect(largestRemainderRupees([0, rs(1), rs(1)], 250)).toEqual([0, 150, 100]);
  });

  it('splits a negative total as its absolute value', () => {
    expect(largestRemainderRupees([rs(2), rs(1)], -rs(3))).toEqual([-rs(2), -rs(1)]);
  });
});

describe('formatAmount and currencySymbol', () => {
  it('print rupees exactly as formatINR always did, whole or with paise', () => {
    for (const paise of [0, 100, 150000, 800000, 12345, 99, 100000000, -5000, -12345]) {
      expect(formatAmount(paise)).toBe(formatINR(paise));
    }
    expect(formatAmount(150000)).toBe('₹1,500');
    expect(formatAmount(150050)).toBe('₹1,500.50');
    expect(formatAmount(100000000)).toBe('₹10,00,000');
  });

  it('currencySymbol is the symbol formatAmount prints', () => {
    expect(currencySymbol()).toBe('₹');
    expect(formatAmount(100).startsWith(currencySymbol())).toBe(true);
  });
});
