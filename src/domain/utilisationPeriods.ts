import { fiscalYearOf, monthDateRange, monthName, monthsOfFiscalYear, type FyMonth } from './fiscalYear';
import { toLocalDateStr } from './schedule';

export type UtilisationGranularity = 'ytd' | '6m' | 'fy' | 'month' | 'quarter' | 'year';

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
 * Buckets to chart, oldest first: YTD, 6m, FY, or legacy monthly/quarterly/annual.
 * Always ends with the period in progress; future periods are excluded.
 */
export function utilisationBuckets(
  granularity: UtilisationGranularity,
  fyStartMonth: number,
  asOf: Date = new Date()
): UtilisationBucket[] {
  const today = toLocalDateStr(asOf);
  const currentFy = fiscalYearOf(asOf, fyStartMonth).startYear;
  let buckets: UtilisationBucket[];

  if (granularity === 'ytd') {
    buckets = [];
    const y = asOf.getFullYear();
    for (let m = 1; m <= asOf.getMonth() + 1; m++) {
      const monthObj = { year: y, month: m };
      buckets.push({
        key: `${y}-${m}`,
        label: `${monthName(m).slice(0, 3)} '${String(y).slice(2)}`,
        ...span([monthObj]),
      });
    }
  } else if (granularity === '6m') {
    buckets = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
      const m = { year: d.getFullYear(), month: d.getMonth() + 1 };
      buckets.push({
        key: `${m.year}-${m.month}`,
        label: `${monthName(m.month).slice(0, 3)} '${String(m.year).slice(2)}`,
        ...span([m]),
      });
    }
  } else if (granularity === 'fy') {
    const months = monthsOfFiscalYear(currentFy, fyStartMonth).filter(
      (m) => m.year * 12 + m.month <= asOf.getFullYear() * 12 + (asOf.getMonth() + 1)
    );
    buckets = months.map((m) => ({
      key: `${m.year}-${m.month}`,
      label: `${monthName(m.month).slice(0, 3)} '${String(m.year).slice(2)}`,
      ...span([m]),
    }));
  } else if (granularity === 'month') {
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
