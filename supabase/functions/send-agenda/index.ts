import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { addDaysYmd, DEFAULT_CLINIC_TIMEZONE, localDate, zonedDayRange, zonedParts } from '../_shared/zoned.ts';
import { buildAgendaEmail, buildAgendaIcs, type AgendaAppointment } from './agenda.ts';

/**
 * Daily agenda: called every 15 minutes by pg_cron. For each clinic whose local hour is its agenda hour (8 pm by
 * default) it emails every therapist ONE list of tomorrow's appointments, with a calendar file. agenda_log has a
 * row per therapist per day, so repeat runs inside the hour send nothing, and a failed send is retried next run.
 *
 * verify_jwt is off like the other trigger-style functions here. The request carries nothing the function trusts:
 * it only ever does this idempotent, time-gated job.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL');
  if (!url || !serviceKey) return json({ error: 'Server configuration error' }, 500);
  if (!brevoKey || !senderEmail) return json({ skipped: 'brevo not configured' });

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const now = new Date();
  const summary = { clinics: 0, sent: 0, skipped: 0, failed: 0 };

  const { data: clinics, error: clinicsError } = await admin.from('clinics').select('id, name, timezone, agenda_hour, agenda_enabled');
  if (clinicsError) return json({ error: clinicsError.message }, 500);

  for (const clinic of clinics ?? []) {
    if (clinic.agenda_enabled === false) continue;
    const tz = clinic.timezone || DEFAULT_CLINIC_TIMEZONE;
    if (zonedParts(now, tz).hour !== (clinic.agenda_hour ?? 20)) continue;
    summary.clinics++;

    const forDate = addDaysYmd(localDate(now, tz), 1);
    const { start, end } = zonedDayRange(forDate, tz);

    const [{ data: therapists }, { data: appointments }] = await Promise.all([
      admin
        .from('therapists').select('id, name, user_id')
        .eq('clinic_id', clinic.id).eq('active', true).not('user_id', 'is', null),
      admin
        .from('appointments').select('id, therapist_id, patient_name, scheduled_at, duration_minutes')
        .eq('clinic_id', clinic.id).in('status', ['confirmed', 'rescheduled', 'arrived'])
        .gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString())
        .order('scheduled_at', { ascending: true }),
    ]);

    for (const therapist of therapists ?? []) {
      const mine: AgendaAppointment[] = (appointments ?? [])
        .filter((a) => a.therapist_id === therapist.id)
        .map((a) => ({ id: a.id, patientName: a.patient_name, startsAt: a.scheduled_at, durationMinutes: a.duration_minutes ?? 30 }));
      if (mine.length === 0) continue;

      // Claim the day first: a second run in the same hour finds the row and skips. A failed send releases it.
      const claim = await admin.from('agenda_log').insert({ therapist_id: therapist.id, for_date: forDate, clinic_id: clinic.id });
      if (claim.error) {
        if (claim.error.code === '23505') summary.skipped++;
        else {
          console.error('agenda_log insert failed:', claim.error.message);
          summary.failed++;
        }
        continue;
      }

      try {
        const { data: userData } = await admin.auth.admin.getUserById(therapist.user_id);
        const to = userData?.user?.email;
        if (!to) throw new Error('therapist login has no email');
        const input = { therapistName: therapist.name, clinicName: clinic.name, forDate, timeZone: tz, appointments: mine };
        const email = buildAgendaEmail(input);
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'api-key': brevoKey },
          body: JSON.stringify({
            sender: { email: senderEmail, name: clinic.name },
            to: [{ email: to, name: therapist.name }],
            subject: email.subject,
            htmlContent: email.html,
            textContent: email.text,
            attachment: [{ content: base64Utf8(buildAgendaIcs(input, now)), name: 'tomorrow.ics' }],
          }),
        });
        if (!response.ok) throw new Error(`Brevo ${response.status}: ${(await response.text()).slice(0, 200)}`);
        summary.sent++;
      } catch (error) {
        console.error('send-agenda failed for', therapist.id, error);
        await admin.from('agenda_log').delete().eq('therapist_id', therapist.id).eq('for_date', forDate);
        summary.failed++;
      }
    }
  }

  return json(summary);
});
