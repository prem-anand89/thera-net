// Edge-only. Signs short-lived Cloudflare R2 (S3-compatible) URLs with AWS Signature V4, using Web Crypto only.
// SECURITY: R2_SECRET_ACCESS_KEY and the signing code live ONLY here and in hep-media/index.ts. Never import this file
// from browser code and never put the secret in a VITE_* variable.

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface R2PresignOptions {
  config: R2Config;
  objectKey: string;
  method: 'GET' | 'PUT';
  expiresInSeconds?: number;
  now?: Date;
  /** Headers the caller MUST send with the request, signed into the URL (for example Cache-Control on an upload). */
  signedHeaders?: Record<string, string>;
}

const enc = new TextEncoder();

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(message));
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(message: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(message)));
}

/** RFC 3986 percent-encoding, as SigV4 requires (encodeURIComponent leaves !'()* alone). */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SigV4PresignInput {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  host: string;
  /** The URL path, already built from the bucket and key (segments are encoded here). */
  path: string;
  method: 'GET' | 'PUT';
  expiresInSeconds: number;
  now: Date;
  signedHeaders?: Record<string, string>;
}

/** The generic SigV4 query-string presigner. Tested against Amazon's published example. */
export async function signPresignedUrl(i: SigV4PresignInput): Promise<string> {
  const stamp = i.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const extra = Object.entries(i.signedHeaders ?? {})
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .filter(([k]) => k !== 'host');
  const headers = [...extra, ['host', i.host] as const].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedNames = headers.map(([k]) => k).join(';');

  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${i.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(i.expiresInSeconds)],
    ['X-Amz-SignedHeaders', signedNames],
  ];
  query.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = query.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join('&');
  const canonicalPath = i.path.split('/').map((seg) => (seg === '' ? '' : rfc3986(seg))).join('/');

  const canonicalRequest = [
    i.method,
    canonicalPath,
    canonicalQuery,
    headers.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedNames,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonicalRequest)].join('\n');
  const kDate = await hmac(enc.encode(`AWS4${i.secretAccessKey}`), date);
  const kRegion = await hmac(kDate, i.region);
  const kService = await hmac(kRegion, i.service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));
  return `https://${i.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Start of the current N-minute window (UTC), so presigned GET URLs are identical within a window (amendment 76). */
export function startOfWindow(now: Date, minutes: number): Date {
  const ms = minutes * 60 * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export async function presignR2Url({
  config,
  objectKey,
  method,
  expiresInSeconds = 900,
  now = new Date(),
  signedHeaders,
}: R2PresignOptions): Promise<string> {
  return signPresignedUrl({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: 'auto',
    service: 's3',
    host: `${config.accountId}.r2.cloudflarestorage.com`,
    path: `/${config.bucket}/${objectKey.replace(/^\/+/, '')}`,
    method,
    expiresInSeconds,
    now,
    signedHeaders,
  });
}

/** Minutes a signed picture URL keeps the same text (so the browser cache works) and how long it stays valid. */
export const VIEW_URL_WINDOW_MINUTES = 30;
export const VIEW_URL_VALID_SECONDS = 3600;
export const UPLOAD_URL_VALID_SECONDS = 900;
export const UPLOAD_CACHE_CONTROL = 'private, max-age=604800';

/** Signed GET URLs for keys, only after the PIN (or a staff login) has been checked by the caller. */
export async function mintPublicHepViewUrls(opts: {
  pinVerified: boolean;
  keys: string[];
  r2Config: R2Config;
  now?: Date;
}): Promise<Record<string, string>> {
  if (!opts.pinVerified || opts.keys.length === 0) return {};
  const signedAt = startOfWindow(opts.now ?? new Date(), VIEW_URL_WINDOW_MINUTES);
  const entries = await Promise.all(
    Array.from(new Set(opts.keys)).map(
      async (key) =>
        [
          key,
          await presignR2Url({
            config: opts.r2Config,
            objectKey: key,
            method: 'GET',
            expiresInSeconds: VIEW_URL_VALID_SECONDS,
            now: signedAt,
          }),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/**
 * Replaces each item's raw `mediaKeys` with signed `mediaUrls` and strips the keys before the patient page sees them.
 * Only keys inside `allowedPrefix` (the payload's own clinic) are ever signed, so a mis-saved key can't reach another
 * clinic's pictures.
 */
export async function hydratePublicHepWithSignedUrls<
  T extends { items: Array<{ mediaKeys?: string[]; [k: string]: unknown }>; [k: string]: unknown },
>(payload: T, r2Config: R2Config, allowedPrefix: string, now?: Date) {
  const keys: string[] = [];
  for (const item of payload.items ?? []) for (const k of item.mediaKeys ?? []) if (k && k.startsWith(allowedPrefix) && !k.includes('..')) keys.push(k);
  const signed = await mintPublicHepViewUrls({ pinVerified: true, keys, r2Config, now });
  return {
    ...payload,
    items: (payload.items ?? []).map(({ mediaKeys, ...rest }) => ({
      ...rest,
      mediaUrls: (mediaKeys ?? []).map((k) => signed[k]).filter(Boolean) as string[],
    })),
  };
}
