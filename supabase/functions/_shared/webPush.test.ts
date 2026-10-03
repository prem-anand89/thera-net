import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { encryptPayload, vapidAuthHeader } from './webPush.ts';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.test('encryptPayload output has the aes128gcm header with a 65-byte ephemeral key', async () => {
  const sub = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', sub.publicKey)));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload('{"title":"hi"}', p256dh, b64url(authSecret));
  assertExists(body);
  assertEquals(body[20], 65);
  assertEquals(body.length > 86, true);
});

Deno.test('vapidAuthHeader has t and k parameters', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const h = await vapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc', 'mailto:a@b.c', pub, jwk.d!, 1_000_000);
  assertEquals(h.startsWith('vapid t='), true);
  assertEquals(h.includes(`, k=${pub}`), true);
});

Deno.test('encryptPayload round-trips through an RFC 8291 subscriber decrypt', async () => {
  const sub = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', sub.publicKey)));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const message = '{"title":"Thera.Net","body":"Appointment confirmed at 4:00 PM"}';
  const body = await encryptPayload(message, p256dh, b64url(authSecret));

  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);

  const asKey = await crypto.subtle.importKey('raw', new Uint8Array(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.privateKey, 256));
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sub.publicKey));

  const hmacKey = async (k: Uint8Array, d: Uint8Array) =>
    new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', new Uint8Array(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new Uint8Array(d)));
  const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> => {
    const prk = await hmacKey(s, ikm);
    const t1 = await hmacKey(prk, new Uint8Array([...info, 1]));
    return t1.slice(0, len);
  };
  const enc = new TextEncoder();
  const prk = await hkdf(authSecret, ecdh, new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]), 32);
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', new Uint8Array(cek), { name: 'AES-GCM' }, false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce) }, aes, new Uint8Array(ciphertext)));
  assertEquals(padded[padded.length - 1], 2);
  assertEquals(new TextDecoder().decode(padded.slice(0, padded.length - 1)), message);
});
