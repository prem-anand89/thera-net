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
  /** Reviews this therapist asked patients to come back for that fall due by `forDate`; listed under the appointments. */
  followUps?: AgendaFollowUp[];
}

export interface AgendaFollowUp {
  patientName: string;
  /** YYYY-MM-DD */
  dueOn: string;
  note: string | null;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
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
  const followUps = input.followUps ?? [];
  const k = followUps.length;
  const heading = dayHeading(input.forDate);
  const reviewsPhrase = `${k} follow-up${k === 1 ? '' : 's'} due`;
  const subject =
    n === 0
      ? `Follow-ups due: ${k}, ${heading}`
      : `Tomorrow: ${n} appointment${n === 1 ? '' : 's'}, ${heading}${k ? ` · ${reviewsPhrase}` : ''}`;
  const rows = input.appointments.map((a) => ({
    time: `${clock(a.startsAt, input.timeZone)} – ${clock(new Date(new Date(a.startsAt).getTime() + a.durationMinutes * 60_000).toISOString(), input.timeZone)}`,
    name: a.patientName,
    length: `${a.durationMinutes} min`,
  }));
  const dueLabel = (ymd: string) => (ymd < input.forDate ? `was due ${dayHeading(ymd)}` : `due ${dayHeading(ymd)}`);
  const appointmentsHtml = n
    ? `<p style="margin:0 0 16px;color:#555">${n} appointment${n === 1 ? '' : 's'} for ${escapeHtml(input.therapistName)}</p>
    <table style="border-collapse:collapse;font-size:15px">
      ${rows.map((r) => `<tr><td style="padding:6px 16px 6px 0;white-space:nowrap;color:#555">${escapeHtml(r.time)}</td><td style="padding:6px 16px 6px 0"><strong>${escapeHtml(r.name)}</strong></td><td style="padding:6px 0;color:#555">${escapeHtml(r.length)}</td></tr>`).join('')}
    </table>`
    : `<p style="margin:0 0 16px;color:#555">No appointments for ${escapeHtml(input.therapistName)}.</p>`;
  const followUpsHtml = k
    ? `<h3 style="margin:20px 0 6px">Follow-ups due (${k})</h3>
    <p style="margin:0 0 8px;color:#555">Patients you asked to come back. Message them from Workspace → Follow up.</p>
    <table style="border-collapse:collapse;font-size:15px">
      ${followUps.map((f) => `<tr><td style="padding:6px 16px 6px 0"><strong>${escapeHtml(f.patientName)}</strong></td><td style="padding:6px 16px 6px 0;color:#555;white-space:nowrap">${escapeHtml(dueLabel(f.dueOn))}</td><td style="padding:6px 0;color:#555">${escapeHtml(f.note ?? '')}</td></tr>`).join('')}
    </table>`
    : '';
  const html = `
    <h2 style="margin:0 0 4px">Tomorrow, ${escapeHtml(heading)}</h2>
    ${appointmentsHtml}${followUpsHtml}
    <p style="color:#666;font-size:12px;margin-top:20px">${escapeHtml(input.clinicName)} · via Thera.Net.${n ? ' The attached file adds the appointments to your calendar.' : ''}</p>`;
  const text = [
    `Tomorrow, ${heading}`,
    n ? `${n} appointment${n === 1 ? '' : 's'} for ${input.therapistName}` : `No appointments for ${input.therapistName}`,
    '',
    ...rows.map((r) => `${r.time}  ${r.name}  (${r.length})`),
    ...(k ? ['', `Follow-ups due (${k})`, ...followUps.map((f) => `${f.patientName}  ${dueLabel(f.dueOn)}${f.note ? `  ${f.note}` : ''}`)] : []),
  ].join('\n');
  return { subject, html, text };
}
