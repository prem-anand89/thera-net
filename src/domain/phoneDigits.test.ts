import { describe, expect, it } from 'vitest';
import { lastTenDigits } from './phoneDigits';

describe('lastTenDigits', () => {
  it('ignores the country code, spaces, dashes and a leading trunk 0', () => {
    for (const phone of ['+91 98765 43210', '098765-43210', '0091 9876543210', '9876543210']) {
      expect(lastTenDigits(phone)).toBe('9876543210');
    }
  });

  it('keeps short numbers whole and treats empty values as empty', () => {
    expect(lastTenDigits('12345')).toBe('12345');
    expect(lastTenDigits(null)).toBe('');
    expect(lastTenDigits(undefined)).toBe('');
  });
});
