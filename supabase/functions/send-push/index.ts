import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { encryptPayload, vapidAuthHeader } from '../_shared/webPush.ts';
import { buildAppointmentPayload, buildBookingRequestPayload, buildOvernightRequestsPayload, buildPayload, type PushKind, type PushPayload } from './templates.ts';
import { PUSH_CATEGORY_BY_KIND, withoutOptedOut, type PushCategory } from './preferences.ts';
import { subscriptionsToRemove } from './delivery.ts';
import { DEFAULT_CLINIC_TIMEZONE, inQuietHours, localDate, zonedMidnight } from '../_shared/zoned.ts';

/** Quiet hours in the clinic's own time: nothing is pushed from 11 pm to 6 am, except changes to today's appointments. */
const QUIET_FROM_HOUR = 23;
const QUIET_TO_HOUR = 6;
/** New bookings for one therapist inside this window collapse into one "N new appointments" notification. */
const BURST_WINDOW_MS = 5 * 60 * 1000;

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

interface Resolved {
  userIds: string[];
  /** Builds the notification for one recipient, with or without the patient's name. */
  build: ((hideName: boolean) => PushPayload) | null;
  /** True for a change to an appointment that is today (clinic time): it still goes out in quiet hours. */
  sameDay: boolean;
}

const NOTHING: Resolved = { userIds: [], build: null, sameDay: false };

async function clinicTimezone(clinicId: string): Promise<string> {
  const { data } = await admin.from('clinics').select('timezone').eq('id', clinicId).maybeSingle();
  return data?.timezone || DEFAULT_CLINIC_TIMEZONE;
}

/** Resolves recipients from the source row. The caller supplies only ids; the payload is built from the row. */
async function resolveRecipients(req: SendRequest, tz: string, now: Date): Promise<Resolved> {
  if (req.kind.startsWith('appointment_')) {
    const { data: appt } = await admin
      .from('appointments').select('scheduled_at, therapist_id, patient_name')
      .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    if (!appt) return NOTHING;
    // A reassignment tells the PREVIOUS therapist; every other change tells the current one.
    const therapistId = req.kind === 'appointment_reassigned' ? req.previous_therapist_id : appt.therapist_id;
    if (!therapistId) return NOTHING;
    const { data: therapist } = await admin
      .from('therapists').select('user_id').eq('id', therapistId).eq('clinic_id', req.clinic_id).maybeSingle();
    if (!therapist?.user_id) return NOTHING;

    let recentNewCount = 1;
    if (req.kind === 'appointment_confirmed') {
      const since = new Date(now.getTime() - BURST_WINDOW_MS).toISOString();
      const { count } = await admin
        .from('appointments').select('id', { count: 'exact', head: true })
        .eq('clinic_id', req.clinic_id).eq('therapist_id', therapistId).eq('status', 'confirmed').gte('created_at', since);
      recentNewCount = Math.max(count ?? 1, 1);
    }
    const apptDate = localDate(new Date(appt.scheduled_at), tz);
    const today = localDate(now, tz);
    return {
      userIds: [therapist.user_id],
      sameDay: apptDate === today,
      build: (hideName) =>
        buildAppointmentPayload({
          kind: req.kind as Parameters<typeof buildAppointmentPayload>[0]['kind'],
          appointmentId: req.row_id,
          therapistId,
          patientName: hideName ? null : appt.patient_name,
          startsAt: appt.scheduled_at,
          localDate: apptDate,
          today,
          timeZone: tz,
          recentNewCount,
        }),
    };
  }

  if (req.kind === 'overnight_requests') {
    // Requests still pending that arrived since quiet hours began last evening (they were never pushed).
    const since = new Date(zonedMidnight(localDate(now, tz), tz).getTime() - (24 - QUIET_FROM_HOUR) * 3600_000);
    const { count } = await admin
      .from('appointment_requests').select('id', { count: 'exact', head: true })
      .eq('clinic_id', req.clinic_id).eq('status', 'pending').gte('created_at', since.toISOString());
    if (!count) return NOTHING;
    const { data: members } = await admin
      .from('clinic_members').select('user_id')
      .eq('clinic_id', req.clinic_id).in('role', ['admin', 'front_desk']);
    return { userIds: (members ?? []).map((m) => m.user_id), sameDay: false, build: () => buildOvernightRequestsPayload(count) };
  }

  if (req.kind === 'booking_request') {
    const { data: reqRow } = await admin
      .from('appointment_requests').select('name, preferred_date, preferred_time_text')
      .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
    if (!reqRow) return NOTHING;
    const { data: members } = await admin
      .from('clinic_members').select('user_id')
      .eq('clinic_id', req.clinic_id).in('role', ['admin', 'front_desk']);
    return {
      userIds: (members ?? []).map((m) => m.user_id),
      sameDay: false,
      build: (hideName) =>
        buildBookingRequestPayload({ patientName: reqRow.name, date: reqRow.preferred_date, timeLabel: reqRow.preferred_time_text }, tz, hideName),
    };
  }

  const { data: fb } = await admin
    .from('feedback_responses').select('rating')
    .eq('id', req.row_id).eq('clinic_id', req.clinic_id).maybeSingle();
  if (!fb || fb.rating > 2) return NOTHING;
  const { data: admins } = await admin
    .from('clinic_members').select('user_id').eq('clinic_id', req.clinic_id).eq('role', 'admin');
  return { userIds: (admins ?? []).map((m) => m.user_id), sameDay: false, build: () => buildPayload(req.kind, null, tz) };
}

/**
 * Drops recipients who switched this alert off in Settings (user_push_preferences). Everyone
 * is on by default, so only explicit "off" rows matter. Fails OPEN: if the lookup errors, the
 * alert is sent rather than silently lost.
 */
async function withoutSwitchedOff(userIds: string[], req: SendRequest): Promise<string[]> {
  const category = (PUSH_CATEGORY_BY_KIND as Record<string, PushCategory | undefined>)[req.kind];
  if (!category) return userIds;
  const { data, error } = await admin
    .from('user_push_preferences').select('user_id')
    .eq('clinic_id', req.clinic_id).eq('category', category).eq('enabled', false).in('user_id', userIds);
  if (error) {
    console.error('push preference lookup failed, sending anyway:', error.message);
    return userIds;
  }
  return withoutOptedOut(userIds, (data ?? []).map((r) => r.user_id as string));
}

/** People who chose to keep patient names off their notifications (an explicit "on" row; everyone else shows names). */
async function usersHidingNames(userIds: string[], clinicId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from('user_push_preferences').select('user_id')
    .eq('clinic_id', clinicId).eq('category', 'hide_patient_names').eq('enabled', true).in('user_id', userIds);
  if (error) {
    // Fail CLOSED here: when unsure, hide the name rather than show it on someone's lock screen.
    console.error('hide-names lookup failed, hiding names:', error.message);
    return new Set(userIds);
  }
  return new Set((data ?? []).map((r) => r.user_id as string));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const body = (await request.json()) as SendRequest;
  const now = new Date();
  const tz = await clinicTimezone(body.clinic_id);
  const { userIds: resolved, build, sameDay } = await resolveRecipients(body, tz, now);
  if (resolved.length === 0 || !build) return json({ sent: 0, removed: 0 }, 200);
  // Quiet hours: late-night pushes wait for the morning, except changes to today's appointments.
  if (inQuietHours(now, tz, QUIET_FROM_HOUR, QUIET_TO_HOUR) && !sameDay) return json({ sent: 0, removed: 0, quiet: true }, 200);
  const userIds = await withoutSwitchedOff(resolved, body);
  if (userIds.length === 0) return json({ sent: 0, removed: 0 }, 200);

  const [{ data: subs }, hidingNames] = await Promise.all([
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds),
    usersHidingNames(userIds, body.clinic_id),
  ]);
  if (!subs?.length) return json({ sent: 0, removed: 0 }, 200);

  // Two payloads at most: with the patient's name, and without it for people who asked to hide names.
  const withName = JSON.stringify(build(false));
  const withoutName = JSON.stringify(build(true));
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const subject = Deno.env.get('VAPID_SUBJECT')!;

  const results = await Promise.allSettled(
    subs.map(async (s) => {
      const [bodyBytes, authHeader] = await Promise.all([
        encryptPayload(hidingNames.has(s.user_id) ? withoutName : withName, s.p256dh, s.auth),
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

  const failures: { status: number; detail: string }[] = [];
  let sent = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.status === 201) sent++;
    else failures.push({ status: r.value.status, detail: r.value.detail });
  }
  const gone = subscriptionsToRemove(results.flatMap((r) => (r.status === 'fulfilled' ? [{ id: r.value.id, status: r.value.status }] : [])));
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);

  if (results.some((r) => r.status === 'rejected')) {
    failures.push({ status: 0, detail: String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).slice(0, 200) });
  }

  return json({ sent, removed: gone.length, failures }, 200);
});
