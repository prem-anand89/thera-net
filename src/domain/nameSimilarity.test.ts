import { describe, expect, it } from 'vitest';
import { DUPLICATE_NAME_THRESHOLD, nameSimilarity } from './nameSimilarity';

describe('nameSimilarity', () => {
  it('scores identical names as 1', () => {
    expect(nameSimilarity('Ramesh Kumar', 'Ramesh Kumar')).toBe(1);
  });

  it('ignores case and extra whitespace', () => {
    expect(nameSimilarity('  ramesh   KUMAR ', 'Ramesh Kumar')).toBe(1);
  });

  it('flags a one-letter typo as a likely duplicate', () => {
    expect(nameSimilarity('Ramesh Kumar', 'Ramesh Kummar')).toBeGreaterThanOrEqual(
      DUPLICATE_NAME_THRESHOLD
    );
  });

  it('flags the real imported spelling variants seen in the ledger', () => {
    expect(nameSimilarity('Sindoora Unnam', 'Sindhoora Unnam')).toBeGreaterThanOrEqual(
      DUPLICATE_NAME_THRESHOLD
    );
  });

  it('does not flag unrelated names', () => {
    expect(nameSimilarity('Ramesh Kumar', 'Aishwarya Rani')).toBeLessThan(0.5);
  });

  it('returns 0 for empty input', () => {
    expect(nameSimilarity('', 'Ramesh')).toBe(0);
    expect(nameSimilarity('   ', 'Ramesh')).toBe(0);
  });
});
