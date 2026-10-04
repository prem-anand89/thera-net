import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { encryptPayload, vapidAuthHeader } from '../_shared/webPush.ts';
import { buildBookingRequestPayload, buildPayload, type PushKind, type PushPayload } from './templates.ts';

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
  previous_therapist_id?: string | null;
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

/** Resolves recipients from the source row. The caller supplies only ids; the payload is built from the row. */
async function resolveRecipients(req: SendRequest): Promise<{ userIds: string[]; payload: PushPayload | null }> {
  if (req.kind === 'appointment_reassigned') {
    if (!req.previous_therapist_id) return { userIds: [], payload: null };
    const { data: appt } = await admin
      .from('appointments').select('scheduled_at')
      .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    const { data: previous } = await admin
      .from('therapists').select('user_id')
      .eq('id', req.previous_therapist_id).eq('clinic_id', req.clinic_id).maybeSingle();
    if (!appt || !previous?.user_id) return { userIds: [], payload: null };
    return {
      userIds: [previous.user_id],
      payload: buildPayload(req.kind, appt.scheduled_at, CLINIC_TZ),
    };
  }

  if (req.kind.startsWith('appointment_')) {
    const { data: appt } = await admin
      .from('appointments').select('scheduled_at, therapist_id')
      .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    if (!appt?.therapist_id) return { userIds: [], payload: null };
    const { data: therapist } = await admin
      .from('therapists').select('user_id').eq('id', appt.therapist_id).maybeSingle();
    return {
      userIds: therapist?.user_id ? [therapist.user_id] : [],
      payload: buildPayload(req.kind, appt.scheduled_at, CLINIC_TZ),
    };
  }

  if (req.kind === 'booking_request') {
    const { data: reqRow } = await admin
      .from('appointment_requests').select('name, preferred_date, preferred_time_text')
      .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    if (!reqRow) return { userIds: [], payload: null };
    const { data: members } = await admin
      .from('clinic_members').select('user_id')
      .eq('clinic_id', req.clinic_id).in('role', ['admin', 'front_desk']);
    const payload = buildBookingRequestPayload(
      { patientName: reqRow.name, date: reqRow.preferred_date, timeLabel: reqRow.preferred_time_text },
      CLINIC_TZ
    );
    return { userIds: (members ?? []).map((m) => m.user_id), payload };
  }

  const { data: fb } = await admin
    .from('feedback_responses').select('rating')
    .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
  if (!fb || fb.rating > 2) return { userIds: [], payload: null };
  const { data: admins } = await admin
    .from('clinic_members').select('user_id').eq('clinic_id', req.clinic_id).eq('role', 'admin');
  return { userIds: (admins ?? []).map((m) => m.user_id), payload: buildPayload(req.kind, null, CLINIC_TZ) };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const body = (await request.json()) as SendRequest;
  const { userIds, payload } = await resolveRecipients(body);
  if (userIds.length === 0 || !payload) return json({ sent: 0, removed: 0 }, 200);

  const { data: subs } = await admin
    .from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', userIds);
  if (!subs?.length) return json({ sent: 0, removed: 0 }, 200);

  const payloadJson = JSON.stringify(payload);
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const subject = Deno.env.get('VAPID_SUBJECT')!;

  const results = await Promise.allSettled(
    subs.map(async (s) => {
      const [bodyBytes, authHeader] = await Promise.all([
        encryptPayload(payloadJson, s.p256dh, s.auth),
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
      const detail = res.status === 201 ? '' : (await res.text()).slice(0, 200);
      return { id: s.id, status: res.status, detail };
    })
  );

  const gone: string[] = [];
  const failures: { status: number; detail: string }[] = [];
  let sent = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.status === 201) sent++;
    else failures.push({ status: r.value.status, detail: r.value.detail });
    if (r.value.status === 404 || r.value.status === 410) gone.push(r.value.id);
  }
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);

  if (results.some((r) => r.status === 'rejected')) {
    failures.push({ status: 0, detail: String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).slice(0, 200) });
  }

  return json({ sent, removed: gone.length, failures }, 200);
});
