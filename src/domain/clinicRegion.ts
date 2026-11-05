import { CLINIC_TIMEZONE } from './publicBookingDays';
import { DEFAULT_COUNTRY_CODE } from './countryCodes';
import { MONTH_NAMES } from './fiscalYear';

/** The clinic's time zone, India until it has been set. */
export function clinicTimezone(clinic: { timezone?: string | null } | null | undefined): string {
  return clinic?.timezone || CLINIC_TIMEZONE;
}

/** The clinic's default phone country code, +91 until it has been set. */
export function clinicCountryCode(clinic: { defaultCountryCode?: string | null } | null | undefined): string {
  return clinic?.defaultCountryCode || DEFAULT_COUNTRY_CODE;
}

/** Currencies a clinic may be set to (mirrors the `clinics.currency_code` check). */
export const CURRENCY_CODES = ['INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD', 'CAD', 'SGD'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** Tax regimes a clinic may be set to (mirrors the `clinics.tax_regime` check). */
export const TAX_REGIMES = ['GST_IN', 'GENERIC_TAX', 'NO_TAX'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** The clinic's currency, INR until it has been set (or when the stored value is not one we know). Stored only for now. */
export function clinicCurrencyCode(clinic: { currencyCode?: string | null } | null | undefined): CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(clinic?.currencyCode ?? '') ? (clinic!.currencyCode as CurrencyCode) : 'INR';
}

/** The clinic's tax regime, GST_IN until it has been set (or when the stored value is not one we know). Stored only for now. */
export function clinicTaxRegime(clinic: { taxRegime?: string | null } | null | undefined): TaxRegime {
  return (TAX_REGIMES as readonly string[]).includes(clinic?.taxRegime ?? '') ? (clinic!.taxRegime as TaxRegime) : 'GST_IN';
}

/** True for India's GST: the regime every screen and invoice assumes today. */
export function isGstIndia(clinic: { taxRegime?: string | null } | null | undefined): boolean {
  return clinicTaxRegime(clinic) === 'GST_IN';
}

/** True when `zone` is a time zone this browser knows (the server re-checks against Postgres). */
export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Zones to offer in a picker: the browser's full list when it has one, else a short common list. */
export function timezoneOptions(): string[] {
  const common = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Kathmandu', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];
  const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
  return all && all.length ? all : common;
}

/** "India Standard Time (UTC+5:30)" style hint for a zone, or the bare name if it cannot be formatted. */
export function timezoneHint(zone: string, at: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'long' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
    const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
    return [name, offset ? `(${offset.replace('GMT', 'UTC')})` : ''].filter(Boolean).join(' ');
  } catch {
    return zone;
  }
}

/** The Region card's one line: "India (+91) · India Standard Time (UTC+5:30) · Financial year from April". */
export function regionSummary(input: { country: string; timezone: string; fyStartMonth: number }, at: Date = new Date()): string {
  const month = MONTH_NAMES[input.fyStartMonth - 1];
  return [input.country, timezoneHint(input.timezone, at), month ? `Financial year from ${month}` : ''].filter(Boolean).join(' · ');
}
