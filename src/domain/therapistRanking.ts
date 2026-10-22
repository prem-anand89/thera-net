export const MIN_VISITS_FOR_RANKING = 20;

export type RankMetric = 'net' | 'visits' | 'retention' | 'utilisation';

export type RankableRow = {
  therapistName: string;
  netPostTaxPaise: number;
  /** Visits the therapist delivered a service on (assisted ones included), each once. */
  patientsTreated: number;
  retentionPct: number | null;
  /** 0-1 */
  utilisation?: number | null;
};

export function metricValue(row: RankableRow, metric: RankMetric): number | null {
  switch (metric) {
    case 'net':
      return row.netPostTaxPaise;
    case 'visits':
      return row.patientsTreated;
    case 'retention':
      return row.retentionPct;
    case 'utilisation':
      return row.utilisation ?? null;
  }
}

/**
 * Who leads each column. Only therapists with enough visits are eligible
 * (a handful of visits, or a part-time schedule, would otherwise top a rate
 * column by luck), and a column needs at least two eligible therapists to
 * have a leader at all. Ties share the lead.
 */
export function columnLeaders(
  rows: RankableRow[],
  metrics: RankMetric[],
  minVisits = MIN_VISITS_FOR_RANKING
): Record<RankMetric, Set<string>> {
  const result = { net: new Set<string>(), visits: new Set<string>(), retention: new Set<string>(), utilisation: new Set<string>() };
  const eligible = rows.filter((r) => r.patientsTreated >= minVisits);
  for (const metric of metrics) {
    const scored = eligible
      .map((r) => ({ name: r.therapistName, value: metricValue(r, metric) }))
      .filter((s): s is { name: string; value: number } => s.value != null);
    if (scored.length < 2) continue;
    const best = Math.max(...scored.map((s) => s.value));
    if (best <= 0) continue;
    for (const s of scored) if (s.value === best) result[metric].add(s.name);
  }
  return result;
}
