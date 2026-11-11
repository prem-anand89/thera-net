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

/** Invisible direction marks that copy-paste from contacts apps leaves inside a number. */
const INVISIBLE = /[\u200e\u200f\u202a-\u202e]/g;

/**
 * Repairs a stored number that picked up its country code twice ("+91 +91 98765 43210", from a pasted number
 * going into a field that adds the code) or that carries the code as part of the national number (91 in front of
 * 10 digits). A real number is never touched: the second code is dropped only when the same code repeats, and a
 * leading 91 only when the "+91" number has more than 10 digits and 12 in all with that 91. Anything else comes
 * back as it was, so look-alike numbers that merely start with 91 stay as they are.
 */
export function tidyPhone(value: string): string {
  const text = value.replace(INVISIBLE, '').trim();
  const doubled = text.match(/^(\+\d{1,4})[\s-]*(\+?)(\d.*)$/);
  let code: string | null = null;
  let rest = '';
  if (doubled && doubled[2] === '+' && text.replace(/[\s-]/g, '').startsWith(doubled[1] + doubled[1])) {
    code = doubled[1];
    rest = text.slice(text.indexOf('+', 1) + doubled[1].length);
  } else {
    const plain = text.match(/^(\+91)[\s-]*(\d[\d\s-]*)$/);
    if (plain) {
      const national = plain[2].replace(/[\s-]/g, '');
      if (national.length === 12 && national.startsWith('91')) return `+91 ${national.slice(2)}`;
    }
    return text === value ? value : text;
  }
  const national = rest.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(national)) return text;
  const fixed = code === '+91' && national.length === 12 && national.startsWith('91') ? national.slice(2) : national;
  return `${code} ${fixed}`;
}

/**
 * Splits a stored phone ("+91 98765 43210", "9876543210", "+971501234567") into the picker's code and the
 * number part. A number without a "+" belongs to the default code (a leading 0, or 91 on a 12-digit
 * number, is dropped). An unknown "+" prefix is "other": the whole number stays together.
 */
export function splitPhone(value: string, defaultCode: string = DEFAULT_COUNTRY_CODE): { code: string; national: string } {
  const text = tidyPhone(value).trim();
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
  // A pasted "+91 …" into a field that already adds +91 must not store the code twice.
  return code ? tidyPhone(`${code} ${text.replace(/^0+(?=\d)/, '')}`) : text;
}
