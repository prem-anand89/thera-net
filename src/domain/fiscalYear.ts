/** Fiscal-year helpers. BM runs April→March (fyStartMonth = 4); configurable per clinic. */

export interface FiscalYear {
  /** Calendar year the FY starts in, e.g. 2026 for FY 26-27 */
  startYear: number;
  /** Two-digit label used in invoice numbers and reports, e.g. "26-27" */
  label: string;
}

function two(n: number): string {
  return String(n % 100).padStart(2, '0');
}

export function fiscalYearOf(date: Date | string, fyStartMonth = 4): FiscalYear {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00`) : date;
  const startYear = d.getMonth() + 1 >= fyStartMonth ? d.getFullYear() : d.getFullYear() - 1;
  return { startYear, label: `${two(startYear)}-${two(startYear + 1)}` };
}

export interface FyMonth {
  year: number;
  /** 1-12 */
  month: number;
}

/** The 12 calendar months of a fiscal year, in FY order (e.g. Apr 2026 … Mar 2027). */
export function monthsOfFiscalYear(startYear: number, fyStartMonth = 4): FyMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m0 = fyStartMonth - 1 + i;
    return { year: startYear + Math.floor(m0 / 12), month: (m0 % 12) + 1 };
  });
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1];
}

/** First/last ISO dates (yyyy-mm-dd) of a calendar month, for visit_date range filters. */
export function monthDateRange({ year, month }: FyMonth): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/** ISO date (or timestamp) to display format, e.g. "2026-07-05" -> "05/07/26". */
export function formatDateDMY(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

/** First/last ISO dates of the Monday–Sunday calendar week containing `asOf`. */
export function currentWeekRange(asOf: Date = new Date()): { from: string; to: string } {
  const d = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  // getDay(): 0=Sun..6=Sat; shift so Monday is the start of the week.
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { from: iso(monday), to: iso(sunday) };
}
