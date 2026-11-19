import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { applyCors, corsHeaders } from '../_shared/cors.ts';
import { handleHepMedia, HEP_UPLOAD_CACHE_CONTROL, type HepMediaDeps } from '../_shared/hepMediaHandler.ts';
import { newKeySuffix } from '../_shared/hepMediaKeys.ts';
import {
  hydratePublicHepWithSignedUrls,
  mintPublicHepViewUrls,
  presignR2Url,
  UPLOAD_URL_VALID_SECONDS,
  type R2Config,
} from '../_shared/r2Presign.ts';

// Private R2 pictures for HEP. It authenticates the caller itself (verify_jwt is off in config.toml so the browser's
// CORS preflight reaches it): a staff login for uploads and previews, the patient's link + PIN for the patient page.
// Secrets (set with `supabase secrets set`): R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' } });

function r2Config(): R2Config | null {
  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const bucket = Deno.env.get('R2_BUCKET_NAME');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  return accountId && bucket && accessKeyId && secretAccessKey ? { accountId, bucket, accessKeyId, secretAccessKey } : null;
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const service = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (request) => applyCors(request, await handle(request)));

async function handle(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, reason: 'bad_request' }, 405);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }

  const config = r2Config();
  const ip = (request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const authorization = request.headers.get('Authorization');

  const deps: HepMediaDeps = {
    isStaff: async (clinicId) => {
      if (!authorization) return false;
      // The caller's own login decides; is_hep_staff reads auth.uid() from this header.
      const asUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: authorization } },
      });
      const { data, error } = await asUser.rpc('is_hep_staff', { p_clinic: clinicId });
      return !error && data === true;
    },
    publicHep: async (a) => {
      const { data, error } = await service.rpc('get_public_hep', {
        p_token: a.token, p_pin: a.pin, p_device: a.device, p_program_id: a.programId, p_reason: a.reason,
      });
      if (error || !data || typeof data !== 'object') return { ok: false, reason: 'unavailable' };
      return data as Record<string, unknown>;
    },
    ipAllowed: async () => {
      const { data, error } = await service.rpc('hep_rate_ok_ip', { p_ip: ip });
      // Fail open if the counter itself errors: the per-link limit and the PIN lockout still apply.
      return error ? true : data === true;
    },
    r2Ready: () => config !== null,
    mintGet: (keys) => mintPublicHepViewUrls({ pinVerified: true, keys, r2Config: config!, now: new Date() }),
    mintPut: (key) =>
      presignR2Url({
        config: config!, objectKey: key, method: 'PUT', expiresInSeconds: UPLOAD_URL_VALID_SECONDS, now: new Date(),
        signedHeaders: { 'Cache-Control': HEP_UPLOAD_CACHE_CONTROL },
      }),
    hydrate: (payload, allowedPrefix) => hydratePublicHepWithSignedUrls(payload, config!, allowedPrefix, new Date()),
    newSuffix: () => newKeySuffix(),
    isCurator: async (clinicId) => {
      if (!authorization) return false;
      const asUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: authorization } },
      });
      const { data, error } = await asUser.rpc('is_starter_curator', { p_clinic: clinicId });
      return !error && data === true;
    },
    copyObject: async (srcKey, dstKey) => {
      const urls = await mintPublicHepViewUrls({ pinVerified: true, keys: [srcKey], r2Config: config!, now: new Date() });
      const srcUrl = urls[srcKey];
      if (!srcUrl) throw new Error('Source media not found');
      const getRes = await fetch(srcUrl);
      if (!getRes.ok) throw new Error(`Failed reading source media (${getRes.status})`);
      const contentType = getRes.headers.get('Content-Type') || 'application/octet-stream';
      const bytes = await getRes.arrayBuffer();
      const putUrl = await presignR2Url({
        config: config!, objectKey: dstKey, method: 'PUT', expiresInSeconds: UPLOAD_URL_VALID_SECONDS, now: new Date(),
        signedHeaders: { 'Cache-Control': HEP_UPLOAD_CACHE_CONTROL },
      });
      const putRes = await fetch(putUrl, { method: 'PUT', headers: { 'Cache-Control': HEP_UPLOAD_CACHE_CONTROL, 'Content-Type': contentType }, body: bytes });
      if (!putRes.ok) throw new Error(`Failed writing copied media (${putRes.status})`);
    },
  };

  try {
    const result = await handleHepMedia(body, deps);
    return json(result.body, result.status);
  } catch (e) {
    console.error('hep-media failed:', e instanceof Error ? e.message : String(e));
    return json({ ok: false, reason: 'unavailable' }, 500);
  }
}
