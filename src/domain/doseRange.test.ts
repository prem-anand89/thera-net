import { describe, expect, it } from 'vitest';
import { formatDose, isOutsideRange } from './doseRange';

describe('ranges', () => {
  it('formats a single number or a range with an en dash', () => {
    expect(formatDose(10, 15)).toBe('10–15');
    expect(formatDose(10, null)).toBe('10');
    expect(formatDose(10)).toBe('10');
    expect(formatDose(10, 10)).toBe('10');
    expect(formatDose(10, 8)).toBe('10');
  });
  it('is quiet inside the range (endpoints included) and flags below and above', () => {
    expect(isOutsideRange(12, 10, 15)).toBeNull();
    expect(isOutsideRange(10, 10, 15)).toBeNull();
    expect(isOutsideRange(15, 10, 15)).toBeNull();
    expect(isOutsideRange(7, 10, 15)).toBe('below');
    expect(isOutsideRange(18, 10, 15)).toBe('above');
  });
  it('treats a single prescribed number as its own range', () => {
    expect(isOutsideRange(10, 10)).toBeNull();
    expect(isOutsideRange(9, 10, null)).toBe('below');
    expect(isOutsideRange(11, 10, null)).toBe('above');
  });
});
