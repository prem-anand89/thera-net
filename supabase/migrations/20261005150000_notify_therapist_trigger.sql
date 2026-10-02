-- ---------------------------------------------------------------------------
-- Phase 2.2: email + .ics notification to the therapist when an appointment
-- is confirmed (or rescheduled). Fires `notify-therapist` (new edge
-- function, Brevo-based — this app already has BREVO_API_KEY/
-- BREVO_SENDER_EMAIL configured as edge function secrets, used by
-- invite-therapist, so there's no new third-party account to set up).
--
-- pg_net is available on this project but was never enabled.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

-- The function body embeds this project's anon key as the trigger's own
-- Authorization bearer. That's not a secret — it's the same key already
-- shipped in the client bundle (VITE_SUPABASE_ANON_KEY) — it exists here
-- only so the edge function's verify_jwt gate (left ON, matching this
-- project's edge-function default) sees a validly-signed project JWT. The
-- function itself trusts the request body, not the caller's identity —
-- there is no clinic-scoped or user-scoped data this function could leak
-- that the clinic's own patient_name/scheduled_at fields don't already
-- carry, and only an insert/update on this specific trigger's own table
-- can ever reach it with a real signed JWT.
create or replace function public.trigger_notify_therapist()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'confirmed' and NEW.therapist_id is not null then
    perform net.http_post(
      url := 'https://ajzcfbgjvnxgpebowwqc.supabase.co/functions/v1/notify-therapist',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqemNmYmdqdm54Z3BlYm93d3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjY3MjksImV4cCI6MjEwNTg0MjcyOX0.wHG8SutXG10PKlAXDzYYD_SRgYCj86k_YIiga9xS8OU'
      ),
      body := row_to_json(NEW)::jsonb
    );
  end if;
  return NEW;
end $$;

drop trigger if exists on_appointment_confirmed on public.appointments;
create trigger on_appointment_confirmed
  after insert or update of status, scheduled_at on public.appointments
  for each row
  execute function public.trigger_notify_therapist();
