import { describe, expect, it } from 'vitest';
import { cleanClinicCode, clinicCode } from './clinicCode';

describe('clinicCode', () => {
  it('takes the first letter of the first two words', () => {
    expect(clinicCode('Beyond Mechanics')).toBe('BM');
    expect(clinicCode('Laxmi physio care centre')).toBe('LP');
    expect(clinicCode('Holistic Pilates studio')).toBe('HP');
    expect(clinicCode('Nancy clinic')).toBe('NC');
    expect(clinicCode('Physioactive physiotherapy')).toBe('PP');
  });

  it('skips "&", "and", "of" and "the" and punctuation', () => {
    expect(clinicCode('Holistic physiotherapy & rehab')).toBe('HP');
    expect(clinicCode('Centre of Hope')).toBe('CH');
    expect(clinicCode('The Restore Clinic')).toBe('RC');
    expect(clinicCode('AJ -Physio,Prehab & Mobility')).toBe('AP');
    expect(clinicCode("Dr. Rao's Physio")).toBe('DR');
  });

  it('a one-word name uses its two CamelCase capitals, else its first two letters', () => {
    expect(clinicCode('TheraNet')).toBe('TN');
    expect(clinicCode('Restore')).toBe('RE');
    expect(clinicCode('AEGLE')).toBe('AE');
    expect(clinicCode('iPhysio')).toBe('IP');
  });

  it('is letters only, tolerates extra spaces and digits, and is empty when there are no letters', () => {
    expect(clinicCode('  Beyond   Mechanics  ')).toBe('BM');
    expect(clinicCode('24x7 Physio')).toBe('XP');
    expect(clinicCode('123')).toBe('');
    expect(clinicCode('')).toBe('');
    expect(clinicCode('A')).toBe('A');
  });
});

describe('cleanClinicCode', () => {
  it('keeps uppercase letters and digits, at most six', () => {
    expect(cleanClinicCode('bm/26 x')).toBe('BM26X');
    expect(cleanClinicCode('abcdefghij')).toBe('ABCDEF');
    expect(cleanClinicCode('  ')).toBe('');
  });
});
