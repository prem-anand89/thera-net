/** Month-over-month % change; null when prior is zero (same rule as KPI strip). */
export function monthOverMonthPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Per-index delta vs prior entry; index 0 is always null. */
export function monthOverMonthDelta(values: number[]): (number | null)[] {
  return values.map((v, i) => (i === 0 ? null : v - values[i - 1]));
}

export function monthOverMonthPctSeries(values: number[]): (number | null)[] {
  return values.map((v, i) => (i === 0 ? null : monthOverMonthPct(v, values[i - 1])));
}
