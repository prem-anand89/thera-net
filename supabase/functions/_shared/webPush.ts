const enc = new TextEncoder();

/** Copies into a fresh ArrayBuffer-backed view so WebCrypto's BufferSource typing accepts it. */
function bytes(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(u);
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', bytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bytes(data)));
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const out = new Uint8Array(length);
  let prev: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  for (let i = 1, off = 0; off < length; i++) {
    const input = new Uint8Array(prev.length + info.length + 1);
    input.set(prev, 0);
    input.set(info, prev.length);
    input[input.length - 1] = i;
    prev = await hmac(prk, input);
    out.set(prev.subarray(0, Math.min(prev.length, length - off)), off);
    off += prev.length;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** RFC 8291 aes128gcm content encoding. Returns the full request body. */
export async function encryptPayload(plaintext: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);

  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const uaKey = await crypto.subtle.importKey('raw', bytes(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256)
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, prkKey, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prkKey, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', bytes(cek), { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(nonce) }, aesKey, bytes(padded)));

  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** VAPID Authorization header (RFC 8292). `privateKeyB64` is the raw 32-byte d value, base64url. */
export async function vapidAuthHeader(
  endpoint: string,
  subject: string,
  publicKeyB64: string,
  privateKeyB64: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: nowSeconds + 12 * 3600, sub: subject })));
  const signingInput = `${header}.${claims}`;

  const pub = b64urlDecode(publicKeyB64);
  const jwk = {
    kty: 'EC', crv: 'P-256', d: privateKeyB64,
    x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33, 65)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput))
  );
  return `vapid t=${signingInput}.${b64urlEncode(sig)}, k=${publicKeyB64}`;
}
