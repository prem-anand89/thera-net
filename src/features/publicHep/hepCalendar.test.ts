import { describe, expect, it } from 'vitest';
import { buildHepReminderIcs } from './hepCalendar';

const base = { clinicName: 'Sunrise Physiotherapy', url: 'https://app.example/p/abc123', startDate: '2026-11-14', now: new Date('2026-11-14T03:00:00Z') };

describe('buildHepReminderIcs', () => {
  it('builds one daily VEVENT per time with UNTIL on the end date, or COUNT=90 when ongoing', () => {
    const ended = buildHepReminderIcs({ ...base, times: ['08:00', '18:00'], endDate: '2026-11-27' });
    expect(ended.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ended).toContain('DTSTART:20261114T080000');
    expect(ended).toContain('DTSTART:20261114T180000');
    expect(ended.match(/RRULE:FREQ=DAILY;UNTIL=20261127T235959/g)).toHaveLength(2);
    const ongoing = buildHepReminderIcs({ ...base, times: ['08:00'], endDate: null });
    expect(ongoing).toContain('RRULE:FREQ=DAILY;COUNT=90');
    expect(ongoing).not.toContain('UNTIL');
  });

  it('keeps the time floating (no Z, no time zone) so it rings at the phone\'s own time', () => {
    const ics = buildHepReminderIcs({ ...base, times: ['08:00'], endDate: null });
    expect(ics).toMatch(/DTSTART:20261114T080000\r\n/);
    expect(ics).not.toContain('TZID');
  });

  it('contains the clinic name and the link but never a patient name', () => {
    const ics = buildHepReminderIcs({ ...base, times: ['13:00'], endDate: null });
    expect(ics).toContain('SUMMARY:Exercises · Sunrise Physiotherapy');
    expect(ics).toContain('https://app.example/p/abc123');
    expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true);
  });

  it('escapes commas and semicolons in the clinic name', () => {
    const ics = buildHepReminderIcs({ ...base, clinicName: 'Care, Cure; Co', times: ['08:00'], endDate: null });
    expect(ics).toContain('SUMMARY:Exercises · Care\\, Cure\\; Co');
  });
});
