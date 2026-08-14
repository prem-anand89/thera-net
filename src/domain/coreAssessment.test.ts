import { describe, expect, it } from 'vitest';
import { computeBmi, computeDerivedFields, computeWaistToHeightRatio, emptyPayload, outcomeTrend } from './coreAssessment';

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

describe('computeBmi', () => {
  it('computes weight(kg) / height(m)^2, rounded to 1 decimal', () => {
    expect(computeBmi(70, 175)).toBe(22.9);
  });
  it('is null when weight is missing', () => {
    expect(computeBmi(undefined, 175)).toBeNull();
  });
  it('is null when height is missing', () => {
    expect(computeBmi(70, undefined)).toBeNull();
  });
});

describe('computeWaistToHeightRatio', () => {
  it('computes waist(cm) / height(cm), rounded to 2 decimals', () => {
    expect(computeWaistToHeightRatio(80, 175)).toBe(0.46);
  });
  it('is null when waist is missing', () => {
    expect(computeWaistToHeightRatio(undefined, 175)).toBeNull();
  });
  it('is null when height is missing', () => {
    expect(computeWaistToHeightRatio(80, undefined)).toBeNull();
  });
});

describe('computeDerivedFields', () => {
  it('reads nrsScore from painProfile.nrs.current, not Best or Worst', () => {
    const payload = { ...emptyPayload(), painProfile: { ...emptyPayload().painProfile, nrs: { current: 4, best: 1, worst: 9 } } };
    expect(computeDerivedFields(payload).nrsScore).toBe(4);
  });
});
