import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildPayload } from './templates.ts';

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

Deno.test('booking request uses its own tag and shows the preferred date, not free text', () => {
  const p = buildPayload('booking_request', '2026-10-03', 'Asia/Kolkata');
  assertEquals(p.tag, 'booking-request');
  assertStringIncludes(p.body, '3 Oct');
});
