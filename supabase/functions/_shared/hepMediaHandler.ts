// The logic of the hep-media edge function, with every outside dependency passed in so it can be tested without a
// network. It has no imports on purpose (the app's TypeScript check also reads it through its tests).
//
// Actions:
//   mint_upload_urls  staff login   -> signed PUT URLs for new picture keys (the server picks the keys)
//   mint_view_urls    staff login   -> signed GET URLs for keys inside the caller's own clinic prefix
//   get_public_hep    link + PIN    -> the patient page's data with short-lived picture URLs (never the raw keys)

export const HEP_UPLOAD_CACHE_CONTROL = 'private, max-age=604800';
const MAX_VIEW_KEYS = 60;
const MAX_UPLOAD_SLOTS = 5;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface HepMediaDeps {
  /** True when the caller's login belongs to clinical staff of this clinic (public.is_hep_staff). False when there is no login. */
  isStaff: (clinicId: string) => Promise<boolean>;
  /** Calls the get_public_hep database function. It never throws on a bad PIN; it returns { ok: false, reason }. */
  publicHep: (a: { token: string; pin: string | null; device: string | null; programId: string | null; reason: string }) => Promise<Record<string, unknown>>;
  /** Per-IP rate limit for the public calls (hep_rate_ok_ip). */
  ipAllowed: () => Promise<boolean>;
  /** False when the R2 secrets are not set. Pictures are then left out and the text still works. */
  r2Ready: () => boolean;
  mintGet: (keys: string[]) => Promise<Record<string, string>>;
  mintPut: (key: string) => Promise<string>;
  /** Replaces mediaKeys with mediaUrls on the payload's items; only keys inside `allowedPrefix` are signed. */
  hydrate: (payload: { items: Array<{ mediaKeys?: string[]; [k: string]: unknown }>; [k: string]: unknown }, allowedPrefix: string) => Promise<Record<string, unknown>>;
  newSuffix: () => string;
  /** True when the caller is staff of a Starter Library curator clinic (Beyond Mechanics / Physio Clinic). */
  isCurator?: (clinicId: string) => Promise<boolean>;
  /** Server-side copy inside the private R2 bucket (used for publishing to Starter and importing into a clinic). */
  copyObject?: (srcKey: string, dstKey: string) => Promise<void>;
}

export interface HepMediaResult {
  status: number;
  body: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

function keyIsInside(clinicId: string, key: string): boolean {
  const parts = key.split('/');
  if (parts.length !== 5 || parts[0] !== 'clinics' || parts[1] !== clinicId || parts[2] !== 'exercises') return false;
  return SAFE_ID.test(parts[3]) && /^(thumb|\d)(-[a-z0-9]{8})?$/.test(parts[4]);
}

function starterKeyValid(key: string): boolean {
  const parts = key.split('/');
  if (parts.length !== 4 || parts[0] !== 'starter' || parts[1] !== 'exercises') return false;
  return SAFE_ID.test(parts[2]) && /^(thumb|\d)(-[a-z0-9]{8})?$/.test(parts[3]);
}

export async function handleHepMedia(body: unknown, deps: HepMediaDeps): Promise<HepMediaResult> {
  if (!isObject(body) || typeof body.action !== 'string') return { status: 400, body: { ok: false, reason: 'bad_request' } };

  if (body.action === 'get_public_hep') {
    const token = str(body.token, 200);
    if (!token) return { status: 400, body: { ok: false, reason: 'bad_request' } };
    if (!(await deps.ipAllowed())) return { status: 429, body: { ok: false, reason: 'busy' } };
    const result = await deps.publicHep({
      token,
      pin: str(body.pin, 20),
      device: str(body.device, 200),
      programId: str(body.programId, 64),
      reason: body.reason === 'refresh' ? 'refresh' : 'open',
    });
    // A failed PIN (wrong_pin, locked, unavailable, pin_needed, busy) is passed through with no clinic, program or picture data.
    if (result.ok !== true) return { status: 200, body: { ok: false, reason: result.reason, attemptsLeft: result.attemptsLeft } };
    const clinicId = str(result.clinicId, 64);
    const items = Array.isArray(result.items) ? (result.items as Array<{ mediaKeys?: string[] }>) : [];
    if (!clinicId || !deps.r2Ready()) {
      // No pictures (secrets missing): the patient still gets the text, and the raw keys are never sent.
      return { status: 200, body: { ...result, items: items.map(({ mediaKeys: _keys, ...rest }) => ({ ...rest, mediaUrls: [] })) } };
    }
    return { status: 200, body: await deps.hydrate({ ...result, items }, `clinics/${clinicId}/`) };
  }

  if (body.action === 'mint_upload_urls') {
    const clinicId = str(body.clinicId, 64);
    const exerciseId = str(body.exerciseId, 64);
    const slots = Array.isArray(body.slots) ? body.slots : null;
    if (!clinicId || !SAFE_ID.test(clinicId) || !exerciseId || !SAFE_ID.test(exerciseId) || !slots || slots.length === 0 || slots.length > MAX_UPLOAD_SLOTS) {
      return { status: 400, body: { ok: false, reason: 'bad_request' } };
    }
    if (!slots.every((s) => s === 'thumb' || (typeof s === 'number' && Number.isInteger(s) && s >= 0 && s <= 3))) {
      return { status: 400, body: { ok: false, reason: 'bad_request' } };
    }
    if (!(await deps.isStaff(clinicId))) return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (!deps.r2Ready()) return { status: 503, body: { ok: false, reason: 'unavailable' } };
    const uploads = await Promise.all(
      (slots as Array<number | 'thumb'>).map(async (slot) => {
        const key = `clinics/${clinicId}/exercises/${exerciseId}/${slot}-${deps.newSuffix()}`;
        return { slot, key, url: await deps.mintPut(key), headers: { 'Cache-Control': HEP_UPLOAD_CACHE_CONTROL } };
      }),
    );
    return { status: 200, body: { ok: true, uploads } };
  }

  if (body.action === 'mint_view_urls') {
    const clinicId = str(body.clinicId, 64);
    const keys = Array.isArray(body.keys) ? body.keys : null;
    if (!clinicId || !SAFE_ID.test(clinicId) || !keys || keys.length === 0 || keys.length > MAX_VIEW_KEYS || !keys.every((k) => typeof k === 'string')) {
      return { status: 400, body: { ok: false, reason: 'bad_request' } };
    }
    if (!(await deps.isStaff(clinicId))) return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (!(keys as string[]).every((k) => keyIsInside(clinicId, k))) return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (!deps.r2Ready()) return { status: 503, body: { ok: false, reason: 'unavailable' } };
    return { status: 200, body: { ok: true, urls: await deps.mintGet(keys as string[]) } };
  }

  if (body.action === 'mint_starter_view_urls') {
    const clinicId = str(body.clinicId, 64);
    const keys = Array.isArray(body.keys) ? body.keys : null;
    if (!clinicId || !SAFE_ID.test(clinicId) || !keys || keys.length === 0 || keys.length > MAX_VIEW_KEYS || !keys.every((k) => typeof k === 'string')) {
      return { status: 400, body: { ok: false, reason: 'bad_request' } };
    }
    if (!(await deps.isStaff(clinicId))) return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (!(keys as string[]).every((k) => starterKeyValid(k))) return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (!deps.r2Ready()) return { status: 503, body: { ok: false, reason: 'unavailable' } };
    return { status: 200, body: { ok: true, urls: await deps.mintGet(keys as string[]) } };
  }

  if (body.action === 'clone_to_starter') {
    const clinicId = str(body.clinicId, 64);
    const starterId = str(body.starterId, 64);
    const mediaKeys = Array.isArray(body.mediaKeys) ? body.mediaKeys : null;
    const thumbKey = body.thumbKey == null ? null : str(body.thumbKey, 200);
    if (!clinicId || !SAFE_ID.test(clinicId) || !starterId || !SAFE_ID.test(starterId) || !mediaKeys || mediaKeys.length > 4 || !mediaKeys.every((k) => typeof k === 'string')) {
      return { status: 400, body: { ok: false, reason: 'bad_request' } };
    }
    if (!deps.isCurator || !(await deps.isCurator(clinicId))) return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (!(mediaKeys as string[]).every((k) => keyIsInside(clinicId, k)) || (thumbKey && !keyIsInside(clinicId, thumbKey))) {
      return { status: 403, body: { ok: false, reason: 'forbidden' } };
    }
    if (!deps.r2Ready() || !deps.copyObject) return { status: 503, body: { ok: false, reason: 'unavailable' } };
    const newMediaKeys = await Promise.all(
      (mediaKeys as string[]).map(async (src, idx) => {
        const dst = `starter/exercises/${starterId}/${idx}-${deps.newSuffix()}`;
        await deps.copyObject!(src, dst);
        return dst;
      }),
    );
    let newThumbKey: string | null = null;
    if (thumbKey) {
      newThumbKey = `starter/exercises/${starterId}/thumb-${deps.newSuffix()}`;
      await deps.copyObject(thumbKey, newThumbKey);
    }
    return { status: 200, body: { ok: true, mediaKeys: newMediaKeys, thumbKey: newThumbKey } };
  }

  if (body.action === 'clone_from_starter') {
    const clinicId = str(body.clinicId, 64);
    const exerciseId = str(body.exerciseId, 64);
    const mediaKeys = Array.isArray(body.mediaKeys) ? body.mediaKeys : null;
    const thumbKey = body.thumbKey == null ? null : str(body.thumbKey, 200);
    if (!clinicId || !SAFE_ID.test(clinicId) || !exerciseId || !SAFE_ID.test(exerciseId) || !mediaKeys || mediaKeys.length > 4 || !mediaKeys.every((k) => typeof k === 'string')) {
      return { status: 400, body: { ok: false, reason: 'bad_request' } };
    }
    if (!(await deps.isStaff(clinicId))) return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (!(mediaKeys as string[]).every((k) => starterKeyValid(k)) || (thumbKey && !starterKeyValid(thumbKey))) {
      return { status: 403, body: { ok: false, reason: 'forbidden' } };
    }
    if (!deps.r2Ready() || !deps.copyObject) return { status: 503, body: { ok: false, reason: 'unavailable' } };
    const newMediaKeys = await Promise.all(
      (mediaKeys as string[]).map(async (src, idx) => {
        const dst = `clinics/${clinicId}/exercises/${exerciseId}/${idx}-${deps.newSuffix()}`;
        await deps.copyObject!(src, dst);
        return dst;
      }),
    );
    let newThumbKey: string | null = null;
    if (thumbKey) {
      newThumbKey = `clinics/${clinicId}/exercises/${exerciseId}/thumb-${deps.newSuffix()}`;
      await deps.copyObject(thumbKey, newThumbKey);
    }
    return { status: 200, body: { ok: true, mediaKeys: newMediaKeys, thumbKey: newThumbKey } };
  }

  return { status: 400, body: { ok: false, reason: 'bad_request' } };
}
