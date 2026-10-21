import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { hookAllowed } from './hookAuth.ts';

const call = (secret?: string) =>
  new Request('https://x/functions/v1/send-push', { method: 'POST', headers: secret === undefined ? {} : { 'x-hook-secret': secret } });

Deno.test('with no secret configured every call is accepted', () => {
  assertEquals(hookAllowed(call(), ''), true);
  assertEquals(hookAllowed(call('anything'), ''), true);
});

Deno.test('with a secret configured only the matching header is accepted', () => {
  assertEquals(hookAllowed(call('abc123'), 'abc123'), true);
  assertEquals(hookAllowed(call('abc124'), 'abc123'), false);
  assertEquals(hookAllowed(call('abc'), 'abc123'), false);
  assertEquals(hookAllowed(call(), 'abc123'), false);
});
