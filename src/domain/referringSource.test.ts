import { describe, expect, it } from 'vitest';
import { coerceReferringSource } from './types';

describe('coerceReferringSource', () => {
  it('keeps values the patients_referring_source_check constraint allows', () => {
    expect(coerceReferringSource('hospital_referral')).toBe('hospital_referral');
    expect(coerceReferringSource('walk_in')).toBe('walk_in');
  });

  it('maps the old Edit Patient dropdown values that used to fail sync', () => {
    expect(coerceReferringSource('hospital')).toBe('hospital_referral');
    expect(coerceReferringSource('doctor')).toBe('doctor_referral');
    expect(coerceReferringSource('self')).toBe('walk_in');
    expect(coerceReferringSource('patient_referred')).toBe('word_of_mouth');
    expect(coerceReferringSource('physiotherapist')).toBe('other');
  });

  it('treats empty as unset', () => {
    expect(coerceReferringSource(null)).toBeNull();
    expect(coerceReferringSource('')).toBeNull();
    expect(coerceReferringSource('not-a-source')).toBeNull();
  });
});
