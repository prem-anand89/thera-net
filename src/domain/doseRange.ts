// Ranges instead of one number ("10 to 15 reps"), and what the patient actually did (amendments 42 and 43).

/** "10", or "10–15" (an en dash) when there is an upper number above the lower one. */
export function formatDose(value: number, max?: number | null): string {
  return max != null && max > value ? `${value}–${max}` : String(value);
}

/**
 * Compares what a patient did with the prescription. A single number is its own range. Inside the range, endpoints
 * included, returns null; below it 'below' ("Did less"); above it 'above' ("Did more").
 */
export function isOutsideRange(actual: number, min: number, max?: number | null): 'below' | 'above' | null {
  const upper = max != null && max >= min ? max : min;
  if (actual < min) return 'below';
  if (actual > upper) return 'above';
  return null;
}
