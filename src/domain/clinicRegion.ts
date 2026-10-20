import { CLINIC_TIMEZONE } from './publicBookingDays';
import { DEFAULT_COUNTRY_CODE } from './countryCodes';

/** The clinic's time zone, India until it has been set. */
export function clinicTimezone(clinic: { timezone?: string | null } | null | undefined): string {
  return clinic?.timezone || CLINIC_TIMEZONE;
}

/** The clinic's default phone country code, +91 until it has been set. */
export function clinicCountryCode(clinic: { defaultCountryCode?: string | null } | null | undefined): string {
  return clinic?.defaultCountryCode || DEFAULT_COUNTRY_CODE;
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
