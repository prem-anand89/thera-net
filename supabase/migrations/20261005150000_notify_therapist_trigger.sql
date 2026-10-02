-- ---------------------------------------------------------------------------
-- Phase 2.2: email + .ics notification to the therapist when an appointment
-- is confirmed (or rescheduled). Fires `notify-therapist` (new edge
-- function, Brevo-based — this app already has BREVO_API_KEY/
-- BREVO_SENDER_EMAIL configured as edge function secrets, used by
-- invite-therapist, so there's no new third-party account to set up).
--
-- pg_net is available on this project but was never enabled.
--
-- No Authorization header: notify-therapist is deployed with verify_jwt
-- off, same as invite-therapist and brevo-mailer (the only other
-- trigger/webhook-style functions here) — see that function's own doc
-- comment for why a bearer token would have been security theater, not
-- real access control, for this specific call.
--
-- The function URL is read from `app.edge_function_base_url` with a
-- fallback to this project's own URL, rather than hardcoded outright, so
-- a local `supabase start` or a future staging project can point this
-- trigger elsewhere via `alter database ... set app.edge_function_base_url
-- = '...'` without a code change. Production needs no such step — the
-- fallback already matches this project.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

create or replace function public.trigger_notify_therapist()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_base_url text := coalesce(
    current_setting('app.edge_function_base_url', true),
    'https://ajzcfbgjvnxgpebowwqc.supabase.co'
  );
begin
  perform net.http_post(
    url := v_base_url || '/functions/v1/notify-therapist',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := row_to_json(NEW)::jsonb
  );
  return NEW;
end $$;

drop trigger if exists on_appointment_confirmed on public.appointments;
create trigger on_appointment_confirmed
  after insert or update of status, scheduled_at on public.appointments
  for each row
  -- Evaluated as a row filter before the function is invoked at all —
  -- cheaper than invoking the function just to no-op on every unrelated
  -- row. therapist_id is still re-checked inside notify-therapist itself
  -- (payload.therapist_id), since that function is also exactly what a
  -- future second trigger source would call into.
  when (NEW.status = 'confirmed' and NEW.therapist_id is not null)
  execute function public.trigger_notify_therapist();
