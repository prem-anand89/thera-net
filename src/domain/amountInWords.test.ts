import { describe, expect, it } from 'vitest';
import { amountInWords } from './amountInWords';

describe('amountInWords', () => {
  it('handles zero', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });

  it('handles a plain rupee amount with no paise', () => {
    expect(amountInWords(50000)).toBe('Rupees Five Hundred Only');
  });

  it('handles paise', () => {
    expect(amountInWords(50050)).toBe('Rupees Five Hundred and Fifty Paise Only');
  });

  it('uses Indian grouping: thousand', () => {
    expect(amountInWords(1_230_000)).toBe('Rupees Twelve Thousand Three Hundred Only');
  });

  it('uses Indian grouping: lakh', () => {
    expect(amountInWords(2_50_000_00)).toBe('Rupees Two Lakh Fifty Thousand Only');
  });

  it('uses Indian grouping: crore', () => {
    expect(amountInWords(1_23_45_678_00)).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only'
    );
  });

  it('handles teens correctly', () => {
    expect(amountInWords(1900_00)).toBe('Rupees One Thousand Nine Hundred Only');
  });
});
