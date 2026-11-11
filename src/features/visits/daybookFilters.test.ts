import { describe, expect, it } from 'vitest';
import { methodMatchesFilter } from './daybookFilters';

describe('methodMatchesFilter', () => {
  it('All passes everything', () => {
    for (const m of ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'partner']) {
      expect(methodMatchesFilter(m, 'all')).toBe(true);
    }
  });
  it('a named mode matches only itself', () => {
    expect(methodMatchesFilter('upi', 'upi')).toBe(true);
    expect(methodMatchesFilter('cash', 'upi')).toBe(false);
  });
  it('Other is bank transfer and cheque, never the named modes', () => {
    expect(methodMatchesFilter('bank_transfer', 'other')).toBe(true);
    expect(methodMatchesFilter('cheque', 'other')).toBe(true);
    for (const m of ['cash', 'upi', 'card', 'partner']) expect(methodMatchesFilter(m, 'other')).toBe(false);
  });
});
