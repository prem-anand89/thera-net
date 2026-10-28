import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { addDaysYmd, DEFAULT_CLINIC_TIMEZONE, localDate, zonedDayRange, zonedMidnight, zonedParts } from '../_shared/zoned.ts';
import { hookAllowed } from '../_shared/hookAuth.ts';
import { buildAgendaEmail, buildAgendaIcs, type AgendaAppointment } from './agenda.ts';
import { agendaFollowUps, AGENDA_OVERDUE_DAYS, type AgendaFollowUpPatient } from '../_shared/followUps.ts';

/**
 * Daily agenda: called every 15 minutes by pg_cron. For each clinic whose local hour is its agenda hour (8 pm by
 * default) it emails every therapist ONE list of tomorrow's appointments, with a calendar file, plus the follow-up
 * reviews they asked patients to come back for that fall due by tomorrow (up to a week overdue). agenda_log has a
 * row per therapist per day, so repeat runs inside the hour send nothing, and a failed send is retried next run.
 *
 * verify_jwt is off like the other trigger-style functions here; the x-hook-secret header (_shared/hookAuth.ts) is
 * what proves the call came from the database. The body carries nothing the function trusts.
 */
/** Clinic-local hour pushes resume after quiet hours; the overnight-requests note goes out in its first quarter hour. */
const OVERNIGHT_NUDGE_HOUR = 6;

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
  if (!hookAllowed(request)) return json({ error: 'Forbidden' }, 403);

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
    const tz = clinic.timezone || DEFAULT_CLINIC_TIMEZONE;
    // First run after quiet hours end: one note for booking requests that came in overnight (send-push counts them).
    const local = zonedParts(now, tz);
    if (local.hour === OVERNIGHT_NUDGE_HOUR && local.minute < 15) {
      await fetch(`${url}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
          'x-hook-secret': Deno.env.get('EDGE_HOOK_SECRET') ?? '',
        },
        body: JSON.stringify({ kind: 'overnight_requests', clinic_id: clinic.id, row_id: clinic.id }),
      }).catch((error) => console.error('overnight nudge failed:', error));
    }
    if (clinic.agenda_enabled === false) continue;
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

    // Reviews therapists asked patients to come back for, due by tomorrow (up to a week overdue), not yet fulfilled.
    const { data: candidateRows } = await admin
      .from('patients')
      .select('id, name, phone, follow_up_on, follow_up_set_on, follow_up_note, follow_up_therapist_id')
      .eq('clinic_id', clinic.id)
      .is('deleted_at', null)
      .not('follow_up_on', 'is', null)
      .not('follow_up_therapist_id', 'is', null)
      .lte('follow_up_on', forDate)
      .gte('follow_up_on', addDaysYmd(forDate, -AGENDA_OVERDUE_DAYS));
    const candidates = (candidateRows ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      phone: (p.phone as string | null) ?? null,
      followUpOn: p.follow_up_on as string,
      followUpSetOn: (p.follow_up_set_on as string | null) ?? null,
      followUpNote: (p.follow_up_note as string | null) ?? null,
      followUpTherapistId: p.follow_up_therapist_id as string,
    }));
    let dueFollowUps: AgendaFollowUpPatient[] = [];
    if (candidates.length) {
      const earliestSet = candidates.map((c) => c.followUpSetOn ?? c.followUpOn).sort()[0];
      const [{ data: laterVisits }, { data: laterAppointments }] = await Promise.all([
        admin.from('visits').select('patient_id, visit_date').eq('clinic_id', clinic.id).eq('deleted', false)
          .in('patient_id', candidates.map((c) => c.id)).gt('visit_date', earliestSet),
        admin.from('appointments').select('patient_id, patient_phone, scheduled_at, status').eq('clinic_id', clinic.id)
          .in('status', ['confirmed', 'rescheduled', 'arrived'])
          .gte('scheduled_at', zonedMidnight(addDaysYmd(earliestSet, 1), tz).toISOString()),
      ]);
      dueFollowUps = agendaFollowUps({
        patients: candidates,
        visits: (laterVisits ?? []).map((v) => ({ patientId: v.patient_id as string, visitDate: v.visit_date as string })),
        appointments: (laterAppointments ?? []).map((a) => ({
          patientId: (a.patient_id as string | null) ?? null,
          patientPhone: (a.patient_phone as string) ?? '',
          scheduledAtMs: new Date(a.scheduled_at as string).getTime(),
          status: a.status as string,
        })),
        forDate,
        dayStartMs: (ymd) => zonedMidnight(ymd, tz).getTime(),
      });
    }

    for (const therapist of therapists ?? []) {
      const mine: AgendaAppointment[] = (appointments ?? [])
        .filter((a) => a.therapist_id === therapist.id)
        .map((a) => ({ id: a.id, patientName: a.patient_name, startsAt: a.scheduled_at, durationMinutes: a.duration_minutes ?? 30 }));
      const myFollowUps = dueFollowUps
        .filter((f) => f.followUpTherapistId === therapist.id)
        .map((f) => ({ patientName: f.name, dueOn: f.followUpOn, note: f.followUpNote }));
      // Nothing booked and nothing to chase: no email.
      if (mine.length === 0 && myFollowUps.length === 0) continue;

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
        const input = { therapistName: therapist.name, clinicName: clinic.name, forDate, timeZone: tz, appointments: mine, followUps: myFollowUps };
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
            ...(mine.length ? { attachment: [{ content: base64Utf8(buildAgendaIcs(input, now)), name: 'tomorrow.ics' }] } : {}),
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
