/**
 * Similarity score in [0, 1] between two names, for duplicate-patient
 * warnings: 1 = identical after normalization, 0 = nothing in common.
 * Normalized Levenshtein — small and dependency-free; MRNO remains the
 * true identifier, this only catches typo-level near-misses at creation.
 */
export function nameSimilarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x.length || !y.length) return 0;
  if (x === y) return 1;
  const distance = levenshtein(x, y);
  return 1 - distance / Math.max(x.length, y.length);
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const insertOrDelete = Math.min(prev[j], prev[j - 1]) + 1;
      const substitute = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1);
      diagonal = prev[j];
      prev[j] = Math.min(insertOrDelete, substitute);
    }
  }
  return prev[b.length];
}

export const DUPLICATE_NAME_THRESHOLD = 0.85;
