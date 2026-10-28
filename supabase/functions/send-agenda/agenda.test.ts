import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildAgendaEmail, buildAgendaIcs, dayHeading } from './agenda.ts';

const input = {
  therapistName: 'Kiran Balla',
  clinicName: 'Physio Clinic',
  forDate: '2026-10-22',
  timeZone: 'Asia/Kolkata',
  appointments: [
    { id: 'a1', patientName: 'Ananya Rao', startsAt: '2026-10-22T03:30:00Z', durationMinutes: 60 }, // 9:00 IST
    { id: 'a2', patientName: 'Aaron <b>', startsAt: '2026-10-22T05:30:00Z', durationMinutes: 45 }, // 11:00 IST
  ],
};

Deno.test('subject counts the appointments and names the day', () => {
  assertEquals(buildAgendaEmail(input).subject, 'Tomorrow: 2 appointments, Thu, 22 Oct');
  assertEquals(buildAgendaEmail({ ...input, appointments: [input.appointments[0]] }).subject, 'Tomorrow: 1 appointment, Thu, 22 Oct');
});

Deno.test('times are written in the clinic zone, not UTC', () => {
  const { html, text } = buildAgendaEmail(input);
  assertStringIncludes(html, '9:00 am');
  assertStringIncludes(text, '11:00 am');
  assertEquals(text.includes('3:30'), false);
});

Deno.test('patient names are escaped in the HTML body', () => {
  assertStringIncludes(buildAgendaEmail(input).html, 'Aaron &lt;b&gt;');
});

Deno.test('one calendar file holds an event per appointment, with the same UID as the single invite', () => {
  const ics = buildAgendaIcs(input, new Date('2026-10-21T14:30:00Z'));
  assertEquals(ics.split('BEGIN:VEVENT').length - 1, 2);
  assertStringIncludes(ics, 'UID:a1@thera.net');
  assertStringIncludes(ics, 'DTSTART:20261022T033000Z');
  assertStringIncludes(ics, 'DTEND:20261022T043000Z');
});

Deno.test('a date heading is the date it names', () => {
  assertEquals(dayHeading('2026-10-22'), 'Thu, 22 Oct');
});

Deno.test('semicolons and commas in a patient name are escaped in the calendar file', () => {
  const ics = buildAgendaIcs({ ...input, appointments: [{ ...input.appointments[0], patientName: 'Rao; Anil, Jr' }] }, new Date('2026-10-21T14:30:00Z'));
  assertStringIncludes(ics, 'SUMMARY:Appointment: Rao\\; Anil\\, Jr');
});

Deno.test('follow-ups are listed under the appointments and counted in the subject', () => {
  const withFollowUps = {
    ...input,
    followUps: [
      { patientName: 'Kavin <P>', dueOn: '2026-10-22', note: 'reassess knee' },
      { patientName: 'Meera', dueOn: '2026-10-19', note: null },
    ],
  };
  const { subject, html, text } = buildAgendaEmail(withFollowUps);
  assertEquals(subject, 'Tomorrow: 2 appointments, Thu, 22 Oct · 2 follow-ups due');
  assertStringIncludes(html, 'Follow-ups due (2)');
  assertStringIncludes(html, 'Kavin &lt;P&gt;');
  assertStringIncludes(html, 'due Thu, 22 Oct');
  assertStringIncludes(html, 'was due Mon, 19 Oct');
  assertStringIncludes(text, 'Meera  was due Mon, 19 Oct');
  assertStringIncludes(text, 'reassess knee');
});

Deno.test('a therapist with follow-ups but no appointments still gets an email, without a calendar claim', () => {
  const only = { ...input, appointments: [], followUps: [{ patientName: 'Kavin', dueOn: '2026-10-22', note: null }] };
  const { subject, html } = buildAgendaEmail(only);
  assertEquals(subject, 'Follow-ups due: 1, Thu, 22 Oct');
  assertStringIncludes(html, 'No appointments for Kiran Balla');
  assertEquals(html.includes('attached file'), false);
});

Deno.test('with no follow-ups the email is exactly as before', () => {
  assertEquals(buildAgendaEmail(input).subject, 'Tomorrow: 2 appointments, Thu, 22 Oct');
  assertEquals(buildAgendaEmail(input).html.includes('Follow-ups'), false);
});
