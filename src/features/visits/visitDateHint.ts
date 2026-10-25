export interface VisitDateHint {
  text: string;
  /** A date in the future is probably a slip of the finger. */
  tone: 'muted' | 'warn';
}

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/**
 * The small line under the New Visit date: nothing for today, "Yesterday" / "3 days ago" for the past, and
 * a warning for a future date. Both arguments are local `YYYY-MM-DD` dates.
 */
export function visitDateHint(visitDate: string, today: string): VisitDateHint | null {
  const v = dayNumber(visitDate);
  const t = dayNumber(today);
  if (v === null || t === null || v === t) return null;
  const diff = t - v;
  if (diff === 1) return { text: 'Yesterday', tone: 'muted' };
  if (diff > 1) return { text: `${diff} days ago`, tone: 'muted' };
  return {
    text: diff === -1 ? 'Tomorrow — check the date' : `In ${-diff} days — check the date`,
    tone: 'warn',
  };
}
