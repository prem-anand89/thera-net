/** Time-zone helpers for edge functions. They run in UTC, so anything about "today", "tonight" or
 *  "9 AM" must be computed in the clinic's own zone through these, never with plain Date methods. */

export const DEFAULT_CLINIC_TIMEZONE = 'Asia/Kolkata';

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number };

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-21": the date in the zone. */
export function localDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The next calendar day after a YYYY-MM-DD string. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The UTC instant at which `ymd` 00:00 happens in the zone (handles half-hour offsets and DST changes). */
export function zonedMidnight(ymd: string, timeZone: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = asUtc - Date.UTC(y, m - 1, d);
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

/** [start, end) of a local day as UTC instants. */
export function zonedDayRange(ymd: string, timeZone: string): { start: Date; end: Date } {
  return { start: zonedMidnight(ymd, timeZone), end: zonedMidnight(addDaysYmd(ymd, 1), timeZone) };
}

/** True during quiet hours, e.g. 23 to 6: hour >= from, or hour < to (wraps midnight). */
export function inQuietHours(date: Date, timeZone: string, fromHour = 23, toHour = 6): boolean {
  const hour = zonedParts(date, timeZone).hour;
  return fromHour > toHour ? hour >= fromHour || hour < toHour : hour >= fromHour && hour < toHour;
}

/** "10:00 am" style clock in the zone. */
export function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
}
