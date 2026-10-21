import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildBookingRequestPayload, buildOvernightRequestsPayload, buildPayload, sanitizePatientName, sanitizeSlotLabel } from './templates.ts';

Deno.test('appointment payload shows clinic-local time and no patient data', () => {
  const p = buildPayload('appointment_confirmed', '2026-10-03T10:30:00Z', 'Asia/Kolkata');
  assertStringIncludes(p.body, '4:00 pm');
  assertEquals(p.tag, 'appointment');
  assertEquals(p.url, '/schedule?tab=bookings');
});

Deno.test('low rating payload routes to feedback tab and carries no rating or count', () => {
  const p = buildPayload('low_rating_feedback', null, 'Asia/Kolkata');
  assertEquals(p.url, '/schedule?tab=feedback');
  assertEquals(/\d/.test(p.body), false);
});

Deno.test('booking request shows patient name, date, and slot time', () => {
  const p = buildBookingRequestPayload({ patientName: 'Priya Sharma', date: '2026-10-03', timeLabel: '10:00 AM' }, 'Asia/Kolkata');
  assertEquals(p.tag, 'booking-request');
  assertEquals(p.body, 'Priya Sharma · 3 Oct · 10:00 AM');
});

Deno.test('booking request without a chosen time omits the time segment', () => {
  const p = buildBookingRequestPayload({ patientName: 'Ravi', date: '2026-10-03', timeLabel: null }, 'Asia/Kolkata');
  assertEquals(p.body, 'Ravi · 3 Oct');
});

Deno.test('a non-slot time value is dropped rather than pushed', () => {
  assertEquals(sanitizeSlotLabel('Call me after 5, my number is 98…'), null);
  assertEquals(sanitizeSlotLabel('10:00 AM'), '10:00 AM');
});

Deno.test('patient name is stripped of control characters and capped', () => {
  assertEquals(sanitizePatientName('Ana\nTest\u0007'), 'AnaTest');
  assertEquals(sanitizePatientName('x'.repeat(200)).length, 60);
});

Deno.test('booking request with no preferred date shows name only, never an invalid date', () => {
  const p = buildBookingRequestPayload({ patientName: 'Ravi', date: null, timeLabel: '10:00 AM' }, 'Asia/Kolkata');
  assertEquals(p.body, 'Ravi · 10:00 AM');
});

Deno.test('reassigned payload tells the previous therapist the appointment moved', () => {
  const p = buildPayload('appointment_reassigned', '2026-10-03T10:30:00Z', 'Asia/Kolkata');
  assertStringIncludes(p.body, 'moved to another therapist');
  assertStringIncludes(p.body, '4:00 pm');
});

import { buildAppointmentPayload, relativeDayLabel } from './templates.ts';

const base = {
  appointmentId: '11111111-1111-1111-1111-111111111111',
  therapistId: 'thr-1',
  patientName: 'Ananya Rao',
  startsAt: '2026-10-21T04:30:00Z', // 10:00 in India
  localDate: '2026-10-21',
  today: '2026-10-20',
  timeZone: 'Asia/Kolkata',
};

Deno.test('a new appointment says what happened, who and when, in clinic time', () => {
  const p = buildAppointmentPayload({ ...base, kind: 'appointment_confirmed' });
  assertEquals(p.title, 'New appointment');
  assertEquals(p.body, 'Ananya Rao · Tomorrow, 10:00 am');
});

Deno.test('tapping opens that day with the appointment selected', () => {
  const p = buildAppointmentPayload({ ...base, kind: 'appointment_rescheduled' });
  assertEquals(p.url, '/schedule?tab=bookings&view=schedule&mode=day&date=2026-10-21&appointment=11111111-1111-1111-1111-111111111111');
});

Deno.test('hiding names leaves the time and no name', () => {
  const p = buildAppointmentPayload({ ...base, kind: 'appointment_cancelled', patientName: null });
  assertEquals(p.title, 'Appointment cancelled');
  assertEquals(p.body, 'Tomorrow, 10:00 am');
});

Deno.test('a burst of new bookings shares one tag and reads as a count', () => {
  const a = buildAppointmentPayload({ ...base, kind: 'appointment_confirmed', recentNewCount: 3 });
  const b = buildAppointmentPayload({ ...base, kind: 'appointment_confirmed', appointmentId: '22222222-2222-2222-2222-222222222222', recentNewCount: 3 });
  assertEquals(a.title, '3 new appointments');
  assertEquals(a.body, 'Latest: Ananya Rao · Tomorrow, 10:00 am');
  assertEquals(a.tag, b.tag);
  assertEquals(a.renotify, true);
});

Deno.test('moves and cancellations each keep their own notification', () => {
  const a = buildAppointmentPayload({ ...base, kind: 'appointment_cancelled' });
  const b = buildAppointmentPayload({ ...base, kind: 'appointment_cancelled', appointmentId: '22222222-2222-2222-2222-222222222222' });
  assertEquals(a.tag === b.tag, false);
});

Deno.test('relative day labels', () => {
  assertEquals(relativeDayLabel('2026-10-20', '2026-10-20'), 'Today');
  assertEquals(relativeDayLabel('2026-10-21', '2026-10-20'), 'Tomorrow');
  assertStringIncludes(relativeDayLabel('2026-10-25', '2026-10-20'), '25 Oct');
});

Deno.test('a request date reads as the date it names, not shifted by the server zone', () => {
  const p = buildBookingRequestPayload({ patientName: 'Meera', date: '2026-10-21', timeLabel: '9:00 AM' }, 'Asia/Kolkata');
  assertStringIncludes(p.body, '21 Oct');
  assertEquals(buildBookingRequestPayload({ patientName: 'Meera', date: null, timeLabel: null }, 'Asia/Kolkata', true).body, '');
});

Deno.test('the overnight note counts the requests and says so in the singular', () => {
  assertEquals(buildOvernightRequestsPayload(1).body, '1 new booking request came in overnight');
  assertEquals(buildOvernightRequestsPayload(3).body, '3 new booking requests came in overnight');
});
