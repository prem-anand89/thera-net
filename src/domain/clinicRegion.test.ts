import { describe, expect, it } from 'vitest';
import { clinicCountryCode, clinicTimezone, isValidTimezone, regionSummary, timezoneHint } from './clinicRegion';

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

describe('regionSummary', () => {
  it('reads as one line: country, time zone and the financial year', () => {
    expect(regionSummary({ country: 'India (+91)', timezone: 'Asia/Kolkata', fyStartMonth: 4 })).toBe(
      'India (+91) · India Standard Time (UTC+5:30) · Financial year from April'
    );
  });
  it('leaves the financial year out when the month is not valid', () => {
    expect(regionSummary({ country: 'UK (+44)', timezone: 'Europe/London', fyStartMonth: 0 }, new Date('2026-01-15T00:00:00Z'))).not.toMatch(/Financial year/);
  });
});
