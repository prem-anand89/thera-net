/** First letters of up to two name words, skipping a leading honorific —
 *  "Dr. Prem Anand" -> "PA", "Ritu" -> "R". Purely decorative (the avatar
 *  circle in the account menu trigger), so a plain '?' fallback for an
 *  empty/unparseable name is fine — nothing downstream depends on it. */
export function initialsFor(name: string): string {
  const words = name
    .replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
