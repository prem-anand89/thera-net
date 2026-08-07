import { describe, expect, it } from 'vitest';
import { outcomeTrend } from './coreAssessment';

// One test per registered instrument, per the handoff's own instruction:
// "Getting this wrong renders a deteriorating patient as improving, so it
// is worth a unit test per registered instrument."
describe('outcomeTrend', () => {
  describe('PSFS — higher-is-better', () => {
    it('is improving when the score increases', () => {
      expect(outcomeTrend('higher-is-better', 4, 7)).toBe('improving');
    });
    it('is declining when the score decreases', () => {
      expect(outcomeTrend('higher-is-better', 7, 4)).toBe('declining');
    });
    it('is stable when unchanged', () => {
      expect(outcomeTrend('higher-is-better', 5, 5)).toBe('stable');
    });
  });

  describe('NRS — lower-is-better', () => {
    it('is improving when the score decreases', () => {
      expect(outcomeTrend('lower-is-better', 7, 3)).toBe('improving');
    });
    it('is declining when the score increases', () => {
      expect(outcomeTrend('lower-is-better', 3, 7)).toBe('declining');
    });
    it('is stable when unchanged', () => {
      expect(outcomeTrend('lower-is-better', 4, 4)).toBe('stable');
    });
  });
});
