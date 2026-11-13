/**
 * The clinic code: a short uppercase code that starts both the Patient IDs (BM26-0001) and the invoice numbers
 * (BM/26-27/0001). Made from the clinic name when the clinic is created, then editable in Settings.
 */

/** Words that carry no initial: "Laxmi & Sons Physio" → LS, "Centre of Hope" → CH. */
const SKIP_WORDS = new Set(['and', 'of', 'the']);

/** Longest code Settings accepts. */
export const CLINIC_CODE_MAX = 6;

/**
 * Two letters: the first letter of the first two words of the name (Beyond Mechanics → BM, Laxmi physio care centre →
 * LP). One word: its two CamelCase capitals if it has them (TheraNet → TN), else its first two letters (Restore → RE).
 * Letters only, uppercase. Empty when the name has no letters, so the caller can fall back to a default.
 */
export function clinicCode(name: string): string {
  const words = name
    .split(/[\s&,\-/.]+/)
    .map((token) => token.replace(/[^A-Za-z]/g, ''))
    .filter((word) => word !== '' && !SKIP_WORDS.has(word.toLowerCase()));
  if (words.length === 0) return '';
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const word = words[0];
  const hasLower = /[a-z]/.test(word);
  const capitals = word.match(/[A-Z]/g) ?? [];
  if (hasLower && capitals.length >= 2 && word[0] === capitals[0]) return (capitals[0] + capitals[1]).toUpperCase();
  return word.slice(0, 2).toUpperCase();
}

/** What the Clinic code field accepts as typed: uppercase letters and digits only, at most {@link CLINIC_CODE_MAX}. */
export function cleanClinicCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CLINIC_CODE_MAX);
}

/** True when `code` is already clean (uppercase letters and digits) and 2 to {@link CLINIC_CODE_MAX} characters long. */
export function isValidClinicCode(code: string): boolean {
  return cleanClinicCode(code) === code && code.length >= 2 && code.length <= CLINIC_CODE_MAX;
}
