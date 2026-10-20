import { describe, expect, it } from 'vitest';
import { clinicCountryCode, clinicTimezone, isValidTimezone, timezoneHint } from './clinicRegion';

describe('clinic region', () => {
  it('defaults to India until set', () => {
    expect(clinicTimezone(undefined)).toBe('Asia/Kolkata');
    expect(clinicTimezone({ timezone: '' })).toBe('Asia/Kolkata');
    expect(clinicCountryCode({})).toBe('+91');
  });
  it('uses what the clinic has set', () => {
    expect(clinicTimezone({ timezone: 'Asia/Dubai' })).toBe('Asia/Dubai');
    expect(clinicCountryCode({ defaultCountryCode: '+971' })).toBe('+971');
  });
  it('recognises real zones and rejects made-up ones', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('India')).toBe(false);
  });
  it('describes a zone with its UTC offset', () => {
    expect(timezoneHint('Asia/Kolkata')).toContain('UTC+5:30');
  });
});
