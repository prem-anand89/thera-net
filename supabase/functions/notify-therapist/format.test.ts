import { assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { formatWhen } from './format.ts';

Deno.test('10:00 AM IST (04:30 UTC) is written as 10:00, not 4:30', () => {
  const when = formatWhen('2026-10-21T04:30:00Z');
  assertStringIncludes(when, '10:00');
  assertStringIncludes(when, 'Wed');
  assertStringIncludes(when, '21 Oct');
});

Deno.test('9:00 AM IST is 9:00, never the UTC 3:30', () => {
  assertStringIncludes(formatWhen('2026-10-07T03:30:00Z'), '9:00');
});

Deno.test('another clinic timezone is respected', () => {
  assertStringIncludes(formatWhen('2026-10-21T04:30:00Z', 'Asia/Dubai'), '8:30');
});
