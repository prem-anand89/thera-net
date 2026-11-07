/** "Tue, 3 Nov at 3:30 PM" in the clinic's time zone, assembled from parts so it reads the same on every browser. */
export function formatAppointmentWhen(iso: string, timeZone: string): string {
  const at = new Date(iso);
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const d = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(at);
  const t = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(at);
  const time = `${part(t, 'hour')}:${part(t, 'minute')} ${part(t, 'dayPeriod')}`;
  return `${part(d, 'weekday')}, ${part(d, 'day')} ${part(d, 'month')} at ${time}`;
}
