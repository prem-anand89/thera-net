// "Add a daily reminder to my calendar" (amendment 57): a small .ics file with one daily repeating event per session.
// Floating local time, so it rings at the phone's own time. It carries the clinic name and the link, never a patient name.
export interface HepReminderOptions {
  clinicName: string;
  url: string;
  /** 'HH:MM' per session. */
  times: string[];
  /** The first day, 'YYYY-MM-DD'. */
  startDate: string;
  /** The program's last day, or null for an ongoing program (then it repeats 90 times). */
  endDate: string | null;
  /** Only for the DTSTAMP line; tests pass a fixed one. */
  now?: Date;
}

const compactDate = (iso: string) => iso.replace(/-/g, '');
const compactTime = (hhmm: string) => `${hhmm.slice(0, 2)}${hhmm.slice(3, 5)}00`;

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 characters are folded, as the format requires. */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push(line.slice(i, i + 73));
  return parts.join('\r\n ');
}

function plusMinutes(hhmm: string, minutes: number): string {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function buildHepReminderIcs(opts: HepReminderOptions): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TheraNet//Home exercises//EN', 'CALSCALE:GREGORIAN'];
  const dtstamp = stamp(opts.now ?? new Date());
  const start = compactDate(opts.startDate);
  const rule = opts.endDate ? `RRULE:FREQ=DAILY;UNTIL=${compactDate(opts.endDate)}T235959` : 'RRULE:FREQ=DAILY;COUNT=90';
  opts.times.forEach((time, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:hep-${start}-${compactTime(time)}-${i}@theranet`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${start}T${compactTime(time)}`,
      `DTEND:${start}T${compactTime(plusMinutes(time, 15))}`,
      rule,
      `SUMMARY:${escapeText(`Exercises · ${opts.clinicName}`)}`,
      `DESCRIPTION:${escapeText(`Your home exercises: ${opts.url}`)}`,
      `URL:${opts.url}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`Exercises · ${opts.clinicName}`)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
