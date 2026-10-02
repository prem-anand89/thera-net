import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';

/** Mirrors the `appointments` row shape the Postgres trigger forwards via
 *  `row_to_json(NEW)` — see the `trigger_notify_therapist` migration. */
interface AppointmentPayload {
  id: string;
  clinic_id: string;
  patient_name: string;
  therapist_id: string | null;
  scheduled_at: string;
  status: string;
  duration_minutes: number | null;
}

/** Same escaping brevo-mailer's own handler applies before interpolating
 *  into htmlContent — a patient/clinic name is free-text, not something to
 *  trust unescaped into an HTML email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** `YYYYMMDDTHHMMSSZ`, the one timestamp format RFC 5545 allows for a
 *  UTC-qualified DTSTART/DTEND — `toISOString()` already gives UTC, so this
 *  is just stripping the punctuation .ics doesn't want. */
function icsTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Escapes the handful of characters RFC 5545 requires escaping in a
 *  TEXT value (SUMMARY/DESCRIPTION) — commas, semicolons, backslashes and
 *  embedded newlines, which a patient/clinic name could plausibly contain. */
function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

/** Plain `btoa` throws on any character outside Latin1 — a real risk here,
 *  since patient names routinely aren't ASCII-only. Encode to UTF-8 bytes
 *  first, same workaround MDN documents for base64-encoding Unicode text. */
function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function buildIcs(params: {
  uid: string;
  patientName: string;
  clinicName: string;
  startIso: string;
  durationMinutes: number;
}): string {
  const start = new Date(params.startIso);
  const end = new Date(start.getTime() + params.durationMinutes * 60_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Thera.Net//Appointment//EN',
    'BEGIN:VEVENT',
    `UID:${params.uid}@thera.net`,
    `DTSTAMP:${icsTimestamp(new Date().toISOString())}`,
    `DTSTART:${icsTimestamp(start.toISOString())}`,
    `DTEND:${icsTimestamp(end.toISOString())}`,
    `SUMMARY:${icsEscape(`Appointment: ${params.patientName}`)}`,
    `DESCRIPTION:${icsEscape(`${params.clinicName} — appointment with ${params.patientName}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const payload = (await req.json()) as AppointmentPayload;
    if (!payload.therapist_id) {
      // Walk-in/unassigned appointments carry no therapist to notify —
      // not an error, just nothing to do.
      return json({ skipped: 'no therapist_id' }, 200);
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
    const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Server configuration error: missing Supabase credentials' }, 500);
    }
    if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
      // Same "fail quiet, don't break the booking flow" stance as
      // invite-therapist's Brevo fallback — a missing mail config is an
      // ops gap, not a reason to surface an error to whoever triggered
      // this (nobody is waiting on this response; it's a fire-and-forget
      // trigger call).
      console.warn('BREVO_API_KEY or BREVO_SENDER_EMAIL not configured — skipping notification.');
      return json({ skipped: 'brevo not configured' }, 200);
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const [{ data: therapist }, { data: clinic }] = await Promise.all([
      serviceClient
        .from('therapists')
        .select('user_id, name')
        .eq('id', payload.therapist_id)
        .maybeSingle(),
      serviceClient.from('clinics').select('name').eq('id', payload.clinic_id).maybeSingle(),
    ]);

    if (!therapist?.user_id) {
      // Roster entry with no linked login — nobody to email.
      return json({ skipped: 'therapist has no linked login' }, 200);
    }

    const { data: userData } = await serviceClient.auth.admin.getUserById(therapist.user_id);
    const therapistEmail = userData?.user?.email;
    if (!therapistEmail) {
      return json({ skipped: 'therapist login has no email' }, 200);
    }

    const clinicName = clinic?.name ?? 'Thera.Net';
    const durationMinutes = payload.duration_minutes ?? 30;
    const when = new Date(payload.scheduled_at).toLocaleString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });

    const ics = buildIcs({
      uid: payload.id,
      patientName: payload.patient_name,
      clinicName,
      startIso: payload.scheduled_at,
      durationMinutes,
    });

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: clinicName },
        to: [{ email: therapistEmail, name: therapist.name }],
        subject: `New appointment: ${payload.patient_name} — ${when}`,
        htmlContent: `
          <h2>New appointment confirmed</h2>
          <p><strong>Patient:</strong> ${escapeHtml(payload.patient_name)}</p>
          <p><strong>When:</strong> ${when}</p>
          <p><strong>Duration:</strong> ${durationMinutes} minutes</p>
          <p style="color:#666;font-size:12px;margin-top:20px;">${escapeHtml(clinicName)} · via Thera.Net</p>
        `,
        textContent: `New appointment confirmed\n\nPatient: ${payload.patient_name}\nWhen: ${when}\nDuration: ${durationMinutes} minutes`,
        attachment: [
          {
            content: base64EncodeUtf8(ics),
            name: 'appointment.ics',
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Brevo API error: ${response.status} ${errorText}`);
      return json({ error: `Brevo API error: ${errorText}` }, 502);
    }

    return json({ success: true }, 200);
  } catch (error) {
    console.error('notify-therapist error:', error);
    return json(
      { error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      500
    );
  }
}

Deno.serve(handler);
