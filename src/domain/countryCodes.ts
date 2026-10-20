export type CountryCode = { code: string; flag: string; name: string };

/** Country codes offered next to a phone number. An empty code means "other": the number is typed in full with a +. */
export const COUNTRY_CODES: CountryCode[] = [
  { code: '+91', flag: '🇮🇳', name: 'India' },
  { code: '+1', flag: '🇺🇸', name: 'US / Canada' },
  { code: '+44', flag: '🇬🇧', name: 'UK' },
  { code: '+61', flag: '🇦🇺', name: 'Australia' },
  { code: '+971', flag: '🇦🇪', name: 'UAE' },
  { code: '', flag: '🌍', name: 'Other (type full number)' },
];

/** The clinic's default code until a per-clinic setting exists. */
export const DEFAULT_COUNTRY_CODE = '+91';

const KNOWN_CODES = COUNTRY_CODES.map((c) => c.code).filter(Boolean).sort((a, b) => b.length - a.length);

/**
 * Splits a stored phone ("+91 98765 43210", "9876543210", "+971501234567") into the picker's code and the
 * number part. A number without a "+" belongs to the default code (a leading 0, or 91 on a 12-digit
 * number, is dropped). An unknown "+" prefix is "other": the whole number stays together.
 */
export function splitPhone(value: string, defaultCode: string = DEFAULT_COUNTRY_CODE): { code: string; national: string } {
  const text = value.trim();
  if (!text) return { code: defaultCode, national: '' };
  if (text.startsWith('+')) {
    const compact = text.replace(/[\s\-()]/g, '');
    const known = KNOWN_CODES.find((code) => compact.startsWith(code));
    if (known) return { code: known, national: compact.slice(known.length) };
    return { code: '', national: text };
  }
  let digits = text.replace(/[\s\-()]/g, '');
  const bare = defaultCode.replace(/\D/g, '');
  if (defaultCode === '+91' && digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (bare && digits.startsWith(bare) && digits.length - bare.length >= 10) digits = digits.slice(bare.length);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return { code: defaultCode, national: digits };
}

/** The stored form: "+91 9876543210"; empty when no number was typed. Other: the typed number as is. */
export function joinPhone(code: string, national: string): string {
  const text = national.trim();
  if (!text) return '';
  return code ? `${code} ${text.replace(/^0+(?=\d)/, '')}` : text;
}
