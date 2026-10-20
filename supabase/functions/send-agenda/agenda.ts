/** Pure builders for the daily agenda email, kept apart from the handler so they can be tested without a database. */

export interface AgendaAppointment {
  id: string;
  patientName: string;
  startsAt: string; // ISO
  durationMinutes: number;
}

export interface AgendaInput {
  therapistName: string;
  clinicName: string;
  /** YYYY-MM-DD, the day the agenda is for (clinic time). */
  forDate: string;
  timeZone: string;
  appointments: AgendaAppointment[];
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\;').replace(/\n/g, '\\n');
}

function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));

/** "Wed, 22 Oct" for a calendar date (a date has no zone: formatted as the UTC date it names). */
export function dayHeading(ymd: string): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
}

/** One calendar file with an event per appointment. The UID matches the per-appointment invite, so a calendar updates the same event instead of adding a copy. */
export function buildAgendaIcs(input: AgendaInput, now: Date = new Date()): string {
  const events = input.appointments.flatMap((a) => {
    const start = new Date(a.startsAt);
    const end = new Date(start.getTime() + a.durationMinutes * 60_000);
    return [
      'BEGIN:VEVENT',
      `UID:${a.id}@thera.net`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${icsStamp(start)}`,
      `DTEND:${icsStamp(end)}`,
      `SUMMARY:${icsEscape(`Appointment: ${a.patientName}`)}`,
      `DESCRIPTION:${icsEscape(`${input.clinicName} - appointment with ${a.patientName}`)}`,
      'END:VEVENT',
    ];
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Thera.Net//Agenda//EN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

export function buildAgendaEmail(input: AgendaInput): { subject: string; html: string; text: string } {
  const n = input.appointments.length;
  const heading = dayHeading(input.forDate);
  const subject = `Tomorrow: ${n} appointment${n === 1 ? '' : 's'}, ${heading}`;
  const rows = input.appointments.map((a) => ({
    time: `${clock(a.startsAt, input.timeZone)} – ${clock(new Date(new Date(a.startsAt).getTime() + a.durationMinutes * 60_000).toISOString(), input.timeZone)}`,
    name: a.patientName,
    length: `${a.durationMinutes} min`,
  }));
  const html = `
    <h2 style="margin:0 0 4px">Tomorrow, ${escapeHtml(heading)}</h2>
    <p style="margin:0 0 16px;color:#555">${n} appointment${n === 1 ? '' : 's'} for ${escapeHtml(input.therapistName)}</p>
    <table style="border-collapse:collapse;font-size:15px">
      ${rows.map((r) => `<tr><td style="padding:6px 16px 6px 0;white-space:nowrap;color:#555">${escapeHtml(r.time)}</td><td style="padding:6px 16px 6px 0"><strong>${escapeHtml(r.name)}</strong></td><td style="padding:6px 0;color:#555">${escapeHtml(r.length)}</td></tr>`).join('')}
    </table>
    <p style="color:#666;font-size:12px;margin-top:20px">${escapeHtml(input.clinicName)} · via Thera.Net. The attached file adds all of these to your calendar.</p>`;
  const text = [`Tomorrow, ${heading}`, `${n} appointment${n === 1 ? '' : 's'} for ${input.therapistName}`, '', ...rows.map((r) => `${r.time}  ${r.name}  (${r.length})`)].join('\n');
  return { subject, html, text };
}
