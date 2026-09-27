import {
  fiscalYearOf,
  monthName,
  monthsOfFiscalYear,
  type FyMonth,
} from '@/domain/fiscalYear';

export type InsightsTrendPeriodMode = 'mom' | '6m' | 'ytd' | 'fy';

export function prevFyMonth(m: FyMonth): FyMonth {
  if (m.month === 1) return { year: m.year - 1, month: 12 };
  return { year: m.year, month: m.month - 1 };
}

function lastNMonths(n: number, from = new Date()): FyMonth[] {
  const months: FyMonth[] = [];
  let year = from.getFullYear();
  let month = from.getMonth() + 1;
  for (let i = 0; i < n; i++) {
    months.unshift({ year, month });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

function monthKey(m: FyMonth): number {
  return m.year * 12 + m.month;
}

export function buildTrendMonthsInRange(
  mode: InsightsTrendPeriodMode,
  opts: {
    fyStartMonth: number;
    momFocus: FyMonth;
    asOf?: Date;
  }
): FyMonth[] {
  const asOf = opts.asOf ?? new Date();
  const nowKey = asOf.getFullYear() * 12 + asOf.getMonth() + 1;
  const currentFy = fiscalYearOf(asOf, opts.fyStartMonth);

  if (mode === 'mom') {
    const focus = opts.momFocus;
    return [prevFyMonth(focus), focus];
  }
  if (mode === '6m') {
    return lastNMonths(6, asOf);
  }
  if (mode === 'ytd') {
    const months: FyMonth[] = [];
    const y = asOf.getFullYear();
    for (let m = 1; m <= asOf.getMonth() + 1; m++) months.push({ year: y, month: m });
    return months;
  }
  return monthsOfFiscalYear(currentFy.startYear, opts.fyStartMonth).filter(
    (m) => monthKey(m) <= nowKey
  );
}

export function trendPeriodLabel(
  mode: InsightsTrendPeriodMode,
  opts: { fyStartMonth: number; momFocus: FyMonth; asOf?: Date }
): string {
  const asOf = opts.asOf ?? new Date();
  const currentFy = fiscalYearOf(asOf, opts.fyStartMonth);
  if (mode === 'mom') {
    const f = opts.momFocus;
    return `${monthName(f.month)} ${f.year} vs prior month`;
  }
  if (mode === '6m') return 'last 6 months';
  if (mode === 'ytd') return `YTD ${asOf.getFullYear()}`;
  return `FY ${currentFy.label}`;
}

export function clampFocusMonth(
  focus: FyMonth,
  monthsInRange: FyMonth[]
): FyMonth {
  if (monthsInRange.length === 0) return focus;
  const keys = new Set(monthsInRange.map(monthKey));
  if (keys.has(monthKey(focus))) return focus;
  return monthsInRange[monthsInRange.length - 1];
}

export function focusMonthIndex(monthsInRange: FyMonth[], focus: FyMonth): number {
  const k = monthKey(focus);
  const i = monthsInRange.findIndex((m) => monthKey(m) === k);
  return i >= 0 ? i : Math.max(0, monthsInRange.length - 1);
}

export function parseInsightsTrendPeriodMode(raw: unknown): InsightsTrendPeriodMode {
  if (raw === 'mom' || raw === '6m' || raw === 'ytd' || raw === 'fy') return raw;
  return '6m';
}

export function parseFocusMonth(search: Record<string, unknown>, asOf = new Date()): FyMonth {
  const year = Number(search.year);
  const month = Number(search.month);
  if (year > 0 && month >= 1 && month <= 12) return { year, month };
  return { year: asOf.getFullYear(), month: asOf.getMonth() + 1 };
}

export type InsightsTrendSearch = {
  tab?: 'monthly' | 'audit' | 'performance';
  period?: InsightsTrendPeriodMode;
  year?: number;
  month?: number;
};

export function validateInsightsSearch(search: Record<string, unknown>): InsightsTrendSearch {
  const out: InsightsTrendSearch = {};
  if (search.tab === 'monthly' || search.tab === 'audit' || search.tab === 'performance') {
    out.tab = search.tab;
  }
  if (search.period != null && search.period !== '') {
    out.period = parseInsightsTrendPeriodMode(search.period);
  }
  const focus = parseFocusMonth(search);
  if (search.year != null && search.year !== '' && search.month != null && search.month !== '') {
    out.year = focus.year;
    out.month = focus.month;
  }
  return out;
}

export function trendsPrintSearch(search: Record<string, unknown>): {
  year: number;
  month: number;
  period: InsightsTrendPeriodMode;
} {
  const focus = parseFocusMonth(search);
  return {
    year: focus.year,
    month: focus.month,
    period: parseInsightsTrendPeriodMode(search.period),
  };
}
