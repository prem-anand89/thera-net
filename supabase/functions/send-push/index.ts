import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { encryptPayload, vapidAuthHeader } from '../_shared/webPush.ts';
import { buildPayload, type PushKind } from './templates.ts';

const CLINIC_TZ = 'Asia/Kolkata';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface SendRequest {
  kind: PushKind;
  clinic_id: string;
  row_id: string;
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

/** Resolves recipients from the source row. The caller supplies only ids; the payload is built from the row. */
async function resolveRecipients(req: SendRequest): Promise<{ userIds: string[]; when: string | null }> {
  if (req.kind.startsWith('appointment_')) {
    const { data: appt } = await admin
      .from('appointments').select('scheduled_at, therapist_id')
      .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    if (!appt?.therapist_id) return { userIds: [], when: null };
    const { data: therapist } = await admin
      .from('therapists').select('user_id').eq('id', appt.therapist_id).maybeSingle();
    return { userIds: therapist?.user_id ? [therapist.user_id] : [], when: appt.scheduled_at };
  }

  if (req.kind === 'booking_request') {
    const { data: reqRow } = await admin
      .from('appointment_requests').select('preferred_date')
      .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    const { data: members } = await admin
      .from('clinic_members').select('user_id')
      .eq('clinic_id', req.clinic_id).in('role', ['admin', 'front_desk']);
    return { userIds: (members ?? []).map((m) => m.user_id), when: reqRow?.preferred_date ?? null };
  }

  const { data: fb } = await admin
    .from('feedback_responses').select('rating')
    .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
  if (!fb || fb.rating > 2) return { userIds: [], when: null };
  const { data: admins } = await admin
    .from('clinic_members').select('user_id').eq('clinic_id', req.clinic_id).eq('role', 'admin');
  return { userIds: (admins ?? []).map((m) => m.user_id), when: null };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const body = (await request.json()) as SendRequest;
  const { userIds, when } = await resolveRecipients(body);
  if (userIds.length === 0) return json({ sent: 0, removed: 0 }, 200);

  const { data: subs } = await admin
    .from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds);
  if (!subs?.length) return json({ sent: 0, removed: 0 }, 200);

  const payload = JSON.stringify(buildPayload(body.kind, when, CLINIC_TZ));
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const subject = Deno.env.get('VAPID_SUBJECT')!;

  const results = await Promise.allSettled(
    subs.map(async (s) => {
      const [bodyBytes, authHeader] = await Promise.all([
        encryptPayload(payload, s.p256dh, s.auth),
        vapidAuthHeader(s.endpoint, subject, publicKey, privateKey),
      ]);
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'high',
        },
        body: new Uint8Array(bodyBytes),
      });
      return { id: s.id, status: res.status };
    })
  );

  const gone: string[] = [];
  let sent = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.status === 201) sent++;
    if (r.value.status === 404 || r.value.status === 410) gone.push(r.value.id);
  }
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);

  return json({ sent, removed: gone.length }, 200);
});
