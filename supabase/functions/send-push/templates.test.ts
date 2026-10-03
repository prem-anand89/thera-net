import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildBookingRequestPayload, buildPayload, sanitizePatientName, sanitizeSlotLabel } from './templates.ts';

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
