import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserTimezone, countryCodeForTimezone, canonicalTimezone, timezoneGroups, clinicCountryCode, clinicCurrencyCode, clinicTaxRegime, clinicTimezone, CURRENCY_CODES, isGstIndia, TAX_REGIMES, isValidTimezone, regionSummary, timezoneHint } from './clinicRegion';

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

describe('currency and tax regime (stored only)', () => {
  it('are rupees and GST until set, for a missing clinic, an empty value or one we do not know', () => {
    for (const c of [undefined, null, {}, { currencyCode: '', taxRegime: '' }, { currencyCode: 'XYZ', taxRegime: 'VAT' }, { currencyCode: null, taxRegime: null }]) {
      expect(clinicCurrencyCode(c)).toBe('INR');
      expect(clinicTaxRegime(c)).toBe('GST_IN');
      expect(isGstIndia(c)).toBe(true);
    }
  });
  it('read what the clinic has set, from the same lists as the database check', () => {
    expect(clinicCurrencyCode({ currencyCode: 'GBP' })).toBe('GBP');
    expect(clinicTaxRegime({ taxRegime: 'NO_TAX' })).toBe('NO_TAX');
    expect(isGstIndia({ taxRegime: 'GENERIC_TAX' })).toBe(false);
    expect([...CURRENCY_CODES]).toEqual(['INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD', 'CAD', 'SGD']);
    expect([...TAX_REGIMES]).toEqual(['GST_IN', 'GENERIC_TAX', 'NO_TAX']);
  });
});

describe('time zone choices', () => {
  it('turns old browser names into the current ones, and leaves the rest alone', () => {
    expect(canonicalTimezone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(canonicalTimezone('Asia/Katmandu')).toBe('Asia/Kathmandu');
    expect(canonicalTimezone('Asia/Dubai')).toBe('Asia/Dubai');
  });
  it('the short list starts with India, has no duplicates and every zone is one this browser can format', () => {
    const groups = timezoneGroups('Asia/Kolkata', false);
    const zones = groups.flatMap((g) => g.zones.map((z) => z.zone));
    expect(groups[0].zones[0].zone).toBe('Asia/Kolkata');
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones.length).toBeLessThan(80);
    for (const z of zones) expect(isValidTimezone(z)).toBe(true);
  });
  it('always includes the clinic\'s own zone, even one outside the short list', () => {
    const groups = timezoneGroups('Africa/Windhoek', false);
    expect(groups[0].region).toBe('Current');
    expect(groups[0].zones[0].zone).toBe('Africa/Windhoek');
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

describe('browserTimezone', () => {
  afterEach(() => vi.restoreAllMocks());
  const mockZone = (tz: string | undefined) =>
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => ({ resolvedOptions: () => ({ timeZone: tz }) })) as never);
  it('is null for UTC and Etc zones', () => {
    mockZone('UTC');
    expect(browserTimezone()).toBeNull();
    mockZone('Etc/GMT+5');
    expect(browserTimezone()).toBeNull();
  });
  it('is null when empty or throwing', () => {
    mockZone(undefined);
    expect(browserTimezone()).toBeNull();
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => {
      throw new Error('no');
    }) as never);
    expect(browserTimezone()).toBeNull();
  });
  it('maps an old name to the current one', () => {
    mockZone('Asia/Calcutta');
    expect(browserTimezone()).toBe('Asia/Kolkata');
  });
});

describe('countryCodeForTimezone', () => {
  it('maps sure zones only', () => {
    expect(countryCodeForTimezone('Asia/Dubai')).toBe('+971');
    expect(countryCodeForTimezone('Asia/Kolkata')).toBe('+91');
    expect(countryCodeForTimezone('America/New_York')).toBeNull();
    expect(countryCodeForTimezone(null)).toBeNull();
  });
});
