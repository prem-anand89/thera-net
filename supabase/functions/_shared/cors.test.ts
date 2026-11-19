import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { allowedOrigin, allowedOrigins, applyCors, DEFAULT_ALLOWED_ORIGINS } from './cors.ts';

const req = (origin?: string) => new Request('https://x/functions/v1/f', { method: 'POST', headers: origin ? { Origin: origin } : {} });
const ok = () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

Deno.test('an allowed origin is echoed back and the response varies by origin', () => {
  const res = applyCors(req('https://thera-net-three.vercel.app'), ok(), DEFAULT_ALLOWED_ORIGINS);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://thera-net-three.vercel.app');
  assertEquals(res.headers.get('Vary'), 'Origin');
  assertEquals(res.headers.get('Content-Type'), 'application/json');
  assertEquals(res.status, 200);
});

Deno.test('another website, or no origin, gets no allow-origin header (not even the old wildcard)', () => {
  assertEquals(applyCors(req('https://evil.example'), ok(), DEFAULT_ALLOWED_ORIGINS).headers.get('Access-Control-Allow-Origin'), null);
  assertEquals(applyCors(req(), ok(), DEFAULT_ALLOWED_ORIGINS).headers.get('Access-Control-Allow-Origin'), null);
});

Deno.test('a near-miss origin is refused', () => {
  assertEquals(allowedOrigin(req('https://thera-net-three.vercel.app.evil.example'), DEFAULT_ALLOWED_ORIGINS), null);
  assertEquals(allowedOrigin(req('http://thera-net-three.vercel.app'), DEFAULT_ALLOWED_ORIGINS), null);
});

Deno.test('the ALLOWED_ORIGINS secret replaces the defaults; blanks and trailing slashes are tidied', () => {
  assertEquals(allowedOrigins('https://app.example.com/, https://b.example.com ,'), ['https://app.example.com', 'https://b.example.com']);
  assertEquals(allowedOrigins(''), DEFAULT_ALLOWED_ORIGINS);
});

Deno.test('a preflight response keeps its status and allowed methods', () => {
  const pre = new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  const res = applyCors(req('http://localhost:5173'), pre, DEFAULT_ALLOWED_ORIGINS);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});
