/** The clinic timezone until a per-clinic setting exists. Edge functions run in UTC, so every
 *  server-side time MUST name a zone: without one, 9:00 AM IST is rendered as "3:30 am". */
export const DEFAULT_CLINIC_TIMEZONE = 'Asia/Kolkata';

/** "Wed, 21 Oct, 10:00 am" in the clinic's timezone, whatever zone the server runs in. */
export function formatWhen(iso: string, timeZone: string = DEFAULT_CLINIC_TIMEZONE): string {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
}
