import { fiscalYearOf, monthDateRange, monthName, monthsOfFiscalYear, type FyMonth } from './fiscalYear';
import { toLocalDateStr } from './schedule';

export type UtilisationGranularity = 'month' | 'quarter' | 'year';

export type UtilisationBucket = {
  key: string;
  label: string;
  /** Inclusive yyyy-mm-dd. */
  from: string;
  to: string;
};

function span(months: FyMonth[]): { from: string; to: string } {
  return { from: monthDateRange(months[0]).from, to: monthDateRange(months[months.length - 1]).to };
}

/**
 * Buckets to chart, oldest first: the last 12 calendar months, the last 4
 * fiscal quarters, or the last 3 fiscal years — always ending with the
 * period in progress. Buckets that haven't started yet are left out.
 */
export function utilisationBuckets(
  granularity: UtilisationGranularity,
  fyStartMonth: number,
  asOf: Date = new Date()
): UtilisationBucket[] {
  const today = toLocalDateStr(asOf);
  const currentFy = fiscalYearOf(asOf, fyStartMonth).startYear;
  let buckets: UtilisationBucket[];

  if (granularity === 'month') {
    buckets = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
      const m = { year: d.getFullYear(), month: d.getMonth() + 1 };
      buckets.push({
        key: `${m.year}-${m.month}`,
        label: `${monthName(m.month).slice(0, 3)} '${String(m.year).slice(2)}`,
        ...span([m]),
      });
    }
  } else if (granularity === 'quarter') {
    buckets = [];
    for (const startYear of [currentFy - 1, currentFy]) {
      const months = monthsOfFiscalYear(startYear, fyStartMonth);
      const fyLabel = fiscalYearOf(`${months[0].year}-${String(months[0].month).padStart(2, '0')}-01`, fyStartMonth).label;
      for (let q = 0; q < 4; q++) {
        buckets.push({
          key: `${startYear}-Q${q + 1}`,
          label: `Q${q + 1} ${fyLabel}`,
          ...span(months.slice(q * 3, q * 3 + 3)),
        });
      }
    }
    buckets = buckets.filter((b) => b.from <= today).slice(-4);
  } else {
    buckets = [currentFy - 2, currentFy - 1, currentFy].map((startYear) => {
      const months = monthsOfFiscalYear(startYear, fyStartMonth);
      const label = fiscalYearOf(`${months[0].year}-${String(months[0].month).padStart(2, '0')}-01`, fyStartMonth).label;
      return { key: `${startYear}`, label: `FY ${label}`, ...span(months) };
    });
  }

  return buckets.filter((b) => b.from <= today);
}
