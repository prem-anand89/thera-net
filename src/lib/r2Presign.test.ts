// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildExerciseMediaKey, buildExerciseThumbKey, isKeyForClinic, newKeySuffix, parseExerciseMediaKey, validateMediaKeysForClinic } from './r2MediaKeys';
import {
  hydratePublicHepWithSignedUrls,
  mintPublicHepViewUrls,
  presignR2Url,
  signPresignedUrl,
  startOfWindow,
} from '../../supabase/functions/_shared/r2Presign';

const R2 = {
  accountId: 'acc123',
  bucket: 'theranet-hep-private',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

describe('SigV4 signer', () => {
  it("matches Amazon's published presigned-URL example byte for byte", async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = await signPresignedUrl({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 's3',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      method: 'GET',
      expiresInSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('builds an R2 URL (path style, region auto) and signs a Cache-Control header into an upload URL', async () => {
    const url = await presignR2Url({
      config: R2,
      objectKey: 'clinics/c-1/exercises/ex-1/0-ab12cd34',
      method: 'PUT',
      expiresInSeconds: 900,
      now: new Date('2026-11-13T10:00:00Z'),
      signedHeaders: { 'Cache-Control': 'private, max-age=604800' },
    });
    expect(url.startsWith('https://acc123.r2.cloudflarestorage.com/theranet-hep-private/clinics/c-1/exercises/ex-1/0-ab12cd34?')).toBe(true);
    expect(url).toContain('X-Amz-SignedHeaders=cache-control%3Bhost');
    expect(url).toContain('X-Amz-Expires=900');
    expect(url).toContain('%2F20261113%2Fauto%2Fs3%2Faws4_request');
    // a different header value means a different signature (the header really is signed)
    const other = await presignR2Url({
      config: R2, objectKey: 'clinics/c-1/exercises/ex-1/0-ab12cd34', method: 'PUT', expiresInSeconds: 900,
      now: new Date('2026-11-13T10:00:00Z'), signedHeaders: { 'Cache-Control': 'no-store' },
    });
    expect(other.split('X-Amz-Signature=')[1]).not.toBe(url.split('X-Amz-Signature=')[1]);
  });

  it('never puts the secret key in the URL', async () => {
    const url = await presignR2Url({ config: R2, objectKey: 'clinics/c-1/exercises/ex-1/0', method: 'GET' });
    expect(url).not.toContain(R2.secretAccessKey);
    expect(url).not.toContain('wJalrXUtnFEMI');
  });
});

describe('signed picture URLs (amendment 76)', () => {
  const keys = ['clinics/c-1/exercises/ex-1/0'];

  it('never returns a URL when the PIN check failed', async () => {
    expect(await mintPublicHepViewUrls({ pinVerified: false, keys, r2Config: R2 })).toEqual({});
  });

  it('gives the same URL inside a 30-minute window and a different one in the next', async () => {
    const a = await mintPublicHepViewUrls({ pinVerified: true, keys, r2Config: R2, now: new Date('2026-11-13T10:02:00Z') });
    const b = await mintPublicHepViewUrls({ pinVerified: true, keys, r2Config: R2, now: new Date('2026-11-13T10:28:59Z') });
    const c = await mintPublicHepViewUrls({ pinVerified: true, keys, r2Config: R2, now: new Date('2026-11-13T10:31:00Z') });
    expect(a[keys[0]]).toBe(b[keys[0]]);
    expect(a[keys[0]]).not.toBe(c[keys[0]]);
    expect(a[keys[0]]).toContain('X-Amz-Expires=3600');
  });

  it('startOfWindow rounds down to the window', () => {
    expect(startOfWindow(new Date('2026-11-13T10:47:12Z'), 30).toISOString()).toBe('2026-11-13T10:30:00.000Z');
  });

  it('hydrates the payload: signed mediaUrls replace mediaKeys, and a foreign clinic key is never signed', async () => {
    const payload = {
      ok: true,
      items: [
        { id: 'i1', title: 'Wall Slides', mediaKeys: ['clinics/c-1/exercises/ex-1/0', 'clinics/c-1/exercises/ex-1/1'] },
        { id: 'i2', title: 'Other clinic picture', mediaKeys: ['clinics/c-2/exercises/ex-9/0'] },
        { id: 'i3', title: 'Text only', mediaKeys: [] },
      ],
    };
    const out = await hydratePublicHepWithSignedUrls(payload, R2, 'clinics/c-1/', new Date('2026-11-13T10:00:00Z'));
    const [a, b, c] = out.items as Array<Record<string, unknown>>;
    expect(a.mediaKeys).toBeUndefined();
    expect((a.mediaUrls as string[]).length).toBe(2);
    expect((a.mediaUrls as string[])[0]).toContain('https://acc123.r2.cloudflarestorage.com/theranet-hep-private/clinics/c-1/exercises/ex-1/0');
    expect(b.mediaKeys).toBeUndefined();
    expect(b.mediaUrls).toEqual([]);
    expect(c.mediaUrls).toEqual([]);
  });
});

describe('HEP picture keys', () => {
  it('builds keys scoped to the clinic and exercise, with an optional random suffix', () => {
    expect(buildExerciseMediaKey('c-1', 'ex-9', 0)).toBe('clinics/c-1/exercises/ex-9/0');
    expect(buildExerciseMediaKey('c-1', 'ex-9', 2, 'ab12cd34')).toBe('clinics/c-1/exercises/ex-9/2-ab12cd34');
    expect(buildExerciseThumbKey('c-1', 'ex-9', 'ab12cd34')).toBe('clinics/c-1/exercises/ex-9/thumb-ab12cd34');
    expect(newKeySuffix()).toMatch(/^[a-z0-9]{8}$/);
    expect(newKeySuffix()).not.toBe(newKeySuffix());
  });

  it('accepts none, one GIF or 1 to 4 photos in order, and rejects another clinic, another exercise or a wrong order', () => {
    const k = (i: number, e = 'ex-1', c = 'c-1') => `clinics/${c}/exercises/${e}/${i}`;
    expect(validateMediaKeysForClinic('c-1', 'none', [])).toBe(true);
    expect(validateMediaKeysForClinic('c-1', 'none', [k(0)])).toBe(false);
    expect(validateMediaKeysForClinic('c-1', 'gif', [k(0)])).toBe(true);
    expect(validateMediaKeysForClinic('c-1', 'gif', [k(0, 'ex-1', 'c-2')])).toBe(false);
    expect(validateMediaKeysForClinic('c-1', 'stills', [k(0)])).toBe(true);
    expect(validateMediaKeysForClinic('c-1', 'stills', [k(0), k(1), k(2)])).toBe(true);
    expect(validateMediaKeysForClinic('c-1', 'stills', [k(0), k(2)])).toBe(false);
    expect(validateMediaKeysForClinic('c-1', 'stills', [k(0), k(1, 'ex-2')])).toBe(false);
    expect(validateMediaKeysForClinic('c-1', 'stills', ['clinics/c-1/exercises/ex-1/0-ab12cd34', 'clinics/c-1/exercises/ex-1/1-ef56gh78'])).toBe(true);
    expect(validateMediaKeysForClinic('c-1', 'stills', [k(0), 'clinics/c-1/exercises/ex-1/thumb'])).toBe(false);
  });

  it('refuses path tricks and foreign prefixes', () => {
    expect(parseExerciseMediaKey('clinics/c-1/exercises/../c-2/0')).toBeNull();
    expect(parseExerciseMediaKey('clinics/c-1/exercises/ex-1/0/extra')).toBeNull();
    expect(parseExerciseMediaKey('clinics/c-1/exercises/ex 1/0')).toBeNull();
    expect(parseExerciseMediaKey('clinics/c-1/exercises/ex-1/9')).not.toBeNull(); // slot count is checked by validateMediaKeysForClinic
    expect(isKeyForClinic('c-1', 'clinics/c-1/exercises/ex-1/thumb-ab12cd34')).toBe(true);
    expect(isKeyForClinic('c-1', 'clinics/c-2/exercises/ex-1/0')).toBe(false);
    expect(isKeyForClinic('c-1', 'clinics/c-1/other/ex-1/0')).toBe(false);
  });
});
