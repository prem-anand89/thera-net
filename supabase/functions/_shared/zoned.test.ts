import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { addDaysYmd, formatClock, inQuietHours, localDate, zonedDayRange, zonedParts } from './zoned.ts';

Deno.test('04:30 UTC is 10:00 in India, same day', () => {
  const p = zonedParts(new Date('2026-10-21T04:30:00Z'), 'Asia/Kolkata');
  assertEquals([p.hour, p.minute], [10, 0]);
  assertEquals(localDate(new Date('2026-10-21T04:30:00Z'), 'Asia/Kolkata'), '2026-10-21');
});

Deno.test('late UTC evening is already the next day in India', () => {
  assertEquals(localDate(new Date('2026-10-21T20:00:00Z'), 'Asia/Kolkata'), '2026-10-22');
});

Deno.test('a local day in India (UTC+5:30) runs 18:30 UTC to 18:30 UTC', () => {
  const { start, end } = zonedDayRange('2026-10-22', 'Asia/Kolkata');
  assertEquals(start.toISOString(), '2026-10-21T18:30:00.000Z');
  assertEquals(end.toISOString(), '2026-10-22T18:30:00.000Z');
});

Deno.test('a day in New York across the autumn clock change is 25 hours', () => {
  const { start, end } = zonedDayRange('2026-11-01', 'America/New_York');
  assertEquals((end.getTime() - start.getTime()) / 3_600_000, 25);
});

Deno.test('addDaysYmd crosses month ends', () => {
  assertEquals(addDaysYmd('2026-10-31', 1), '2026-11-01');
  assertEquals(addDaysYmd('2026-12-31', 1), '2027-01-01');
});

Deno.test('quiet hours 11 pm to 6 am wrap midnight', () => {
  const at = (h: number) => new Date(`2026-10-21T${String(h).padStart(2, '0')}:00:00+05:30`);
  assertEquals([22, 23, 0, 5, 6, 12].map((h) => inQuietHours(at(h), 'Asia/Kolkata')), [false, true, true, true, false, false]);
});

Deno.test('clock is formatted in the clinic zone', () => {
  assertEquals(formatClock('2026-10-21T04:30:00Z', 'Asia/Kolkata'), '10:00 am');
});
