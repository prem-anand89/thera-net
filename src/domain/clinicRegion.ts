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

/**
 * Old names some browsers still list (Chrome offers "Asia/Calcutta", not "Asia/Kolkata"), mapped to the current name.
 * The database knows both; the app stores and shows the current one so a zone has exactly one name.
 */
const TIMEZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Dacca': 'Asia/Dhaka',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Pacific/Samoa': 'Pacific/Pago_Pago',
};

/** The current name for a zone (an old browser name becomes the modern one; anything else is unchanged). */
export function canonicalTimezone(zone: string): string {
  return TIMEZONE_ALIASES[zone] ?? zone;
}

/**
 * The browser's time zone under its current name, or null when it is empty, throws, or is a placeholder (UTC, GMT,
 * Etc/*: VPNs and misconfigured phones report these), so the database default applies instead.
 */
export function browserTimezone(): string | null {
  try {
    const raw = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!raw) return null;
    const zone = canonicalTimezone(raw);
    if (zone === 'UTC' || zone === 'GMT' || zone.startsWith('Etc/')) return null;
    return zone;
  } catch {
    return null;
  }
}

/** Phone country codes we are sure of, by time zone. Anything not listed is left to the database default. */
const COUNTRY_CODE_BY_TIMEZONE: Record<string, string> = {
  'Asia/Kolkata': '+91',
  'Asia/Dubai': '+971',
  'Asia/Singapore': '+65',
  'Asia/Kathmandu': '+977',
  'Asia/Colombo': '+94',
  'Asia/Dhaka': '+880',
  'Europe/London': '+44',
  'Australia/Sydney': '+61',
  'Australia/Melbourne': '+61',
};

/** The phone country code for a time zone when it is certain, else null. */
export function countryCodeForTimezone(tz: string | null): string | null {
  return tz ? (COUNTRY_CODE_BY_TIMEZONE[tz] ?? null) : null;
}

export type TimezoneChoice = { zone: string; label: string };
export type TimezoneGroup = { region: string; zones: TimezoneChoice[] };

/** The zones a clinic is likely to be in, by region, with a plain place name. India first. */
const COMMON_TIMEZONES: { region: string; zones: [string, string][] }[] = [
  { region: 'India and neighbours', zones: [['Asia/Kolkata', 'India'], ['Asia/Colombo', 'Sri Lanka'], ['Asia/Dhaka', 'Bangladesh'], ['Asia/Kathmandu', 'Nepal'], ['Asia/Karachi', 'Pakistan']] },
  { region: 'Middle East', zones: [['Asia/Dubai', 'UAE'], ['Asia/Muscat', 'Oman'], ['Asia/Riyadh', 'Saudi Arabia'], ['Asia/Qatar', 'Qatar'], ['Asia/Kuwait', 'Kuwait'], ['Asia/Bahrain', 'Bahrain'], ['Asia/Jerusalem', 'Israel']] },
  { region: 'South-East and East Asia', zones: [['Asia/Singapore', 'Singapore'], ['Asia/Kuala_Lumpur', 'Malaysia'], ['Asia/Bangkok', 'Thailand'], ['Asia/Jakarta', 'Indonesia (Jakarta)'], ['Asia/Manila', 'Philippines'], ['Asia/Ho_Chi_Minh', 'Vietnam'], ['Asia/Hong_Kong', 'Hong Kong'], ['Asia/Shanghai', 'China'], ['Asia/Tokyo', 'Japan'], ['Asia/Seoul', 'South Korea']] },
  { region: 'Europe', zones: [['Europe/London', 'United Kingdom'], ['Europe/Dublin', 'Ireland'], ['Europe/Paris', 'France'], ['Europe/Berlin', 'Germany'], ['Europe/Madrid', 'Spain'], ['Europe/Rome', 'Italy'], ['Europe/Amsterdam', 'Netherlands'], ['Europe/Zurich', 'Switzerland'], ['Europe/Athens', 'Greece'], ['Europe/Istanbul', 'Turkey'], ['Europe/Moscow', 'Russia (Moscow)']] },
  { region: 'Africa', zones: [['Africa/Cairo', 'Egypt'], ['Africa/Lagos', 'Nigeria'], ['Africa/Accra', 'Ghana'], ['Africa/Nairobi', 'Kenya'], ['Africa/Johannesburg', 'South Africa']] },
  { region: 'Americas', zones: [['America/New_York', 'US Eastern'], ['America/Chicago', 'US Central'], ['America/Denver', 'US Mountain'], ['America/Los_Angeles', 'US Pacific'], ['America/Toronto', 'Canada (Toronto)'], ['America/Vancouver', 'Canada (Vancouver)'], ['America/Mexico_City', 'Mexico'], ['America/Sao_Paulo', 'Brazil (São Paulo)'], ['America/Argentina/Buenos_Aires', 'Argentina']] },
  { region: 'Australia and Pacific', zones: [['Australia/Sydney', 'Australia (Sydney, Melbourne)'], ['Australia/Brisbane', 'Australia (Brisbane)'], ['Australia/Adelaide', 'Australia (Adelaide)'], ['Australia/Perth', 'Australia (Perth)'], ['Pacific/Auckland', 'New Zealand']] },
  { region: 'Other', zones: [['UTC', 'UTC (no daylight saving)']] },
];

/** "UTC+5:30" for a zone right now, or '' when it cannot be formatted. */
export function timezoneOffsetLabel(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
    return part ? part.replace('GMT', 'UTC') : '';
  } catch {
    return '';
  }
}

const choice = (zone: string, place: string, at: Date): TimezoneChoice => {
  const offset = timezoneOffsetLabel(zone, at);
  return { zone, label: offset ? `${place} (${offset})` : place };
};

/** Every zone this browser knows, once each under its current name, minus `skip`; for "Show all time zones". */
function otherTimezones(skip: Set<string>): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return [...new Set(all.map(canonicalTimezone))].filter((z) => !skip.has(z)).sort();
}

/**
 * What the time zone picker offers. The short list by region (about 55 zones) by default; `showAll` adds the rest of
 * the browser's zones, grouped by continent. The clinic's current zone is always present, even when it is neither
 * (so a saved value is never silently replaced).
 */
export function timezoneGroups(current: string, showAll: boolean, at: Date = new Date()): TimezoneGroup[] {
  const now = canonicalTimezone(current);
  const groups: TimezoneGroup[] = COMMON_TIMEZONES.map((g) => ({ region: g.region, zones: g.zones.map(([zone, place]) => choice(zone, place, at)) }));
  const listed = new Set(groups.flatMap((g) => g.zones.map((z) => z.zone)));
  if (showAll) {
    const rest = otherTimezones(listed);
    const byContinent = new Map<string, TimezoneChoice[]>();
    for (const zone of rest) {
      const continent = zone.split('/')[0];
      const place = zone.split('/').slice(1).join(' / ').replace(/_/g, ' ');
      byContinent.set(continent, [...(byContinent.get(continent) ?? []), choice(zone, place || zone, at)]);
    }
    for (const [continent, zones] of byContinent) groups.push({ region: continent, zones });
    for (const z of rest) listed.add(z);
  }
  if (now && !listed.has(now)) groups.unshift({ region: 'Current', zones: [choice(now, now.replace(/_/g, ' '), at)] });
  return groups;
}

/** Zones to offer in a picker, flat (the full browser list, current names); kept for callers that want a plain list. */
export function timezoneOptions(): string[] {
  const common = COMMON_TIMEZONES.flatMap((g) => g.zones.map(([zone]) => zone));
  return [...common, ...otherTimezones(new Set(common))];
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
