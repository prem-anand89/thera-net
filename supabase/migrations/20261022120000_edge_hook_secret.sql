-- Only the database may call send-push, send-agenda and notify-therapist. They run without a login check
-- (they're called by triggers and pg_cron), so until now anyone who knew the URL could make them send a push
-- or an email. Every call from the database now carries a secret header (x-hook-secret) that the functions
-- compare with their EDGE_HOOK_SECRET setting.
--
-- The secret is generated here, inside the database (Vault), so it never appears in git. After applying:
--   select decrypted_secret from vault.decrypted_secrets where name = 'edge_hook_secret';
--   supabase secrets set EDGE_HOOK_SECRET=<that value>
--   then deploy send-push, send-agenda and notify-therapist.
-- Until EDGE_HOOK_SECRET is set the functions accept calls as before, so this order never drops a notification.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'edge_hook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'edge_hook_secret',
      'Header x-hook-secret on database calls to edge functions');
  end if;
end $$;

-- Headers for a database call to an edge function. Security definer so trigger functions running as the
-- signed-in user can read the secret; nobody else can call it.
create or replace function public.edge_hook_headers() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'Content-Type', 'application/json',
    'x-hook-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'edge_hook_secret'), '')
  );
$$;
revoke execute on function public.edge_hook_headers() from public, anon, authenticated;

create or replace function public.notify_push(p_kind text, p_clinic_id uuid, p_row_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://ajzcfbgjvnxgpebowwqc.supabase.co/functions/v1/send-push',
    headers := edge_hook_headers(),
    body := jsonb_build_object('kind', p_kind, 'clinic_id', p_clinic_id, 'row_id', p_row_id)
  );
end $$;

create or replace function public.notify_push_reassigned(p_clinic_id uuid, p_row_id uuid, p_previous uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://ajzcfbgjvnxgpebowwqc.supabase.co/functions/v1/send-push',
    headers := edge_hook_headers(),
    body := jsonb_build_object('kind', 'appointment_reassigned', 'clinic_id', p_clinic_id,
                               'row_id', p_row_id, 'previous_therapist_id', p_previous)
  );
end $$;

create or replace function public.trigger_notify_therapist() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_base_url text := coalesce(
    current_setting('app.edge_function_base_url', true),
    'https://ajzcfbgjvnxgpebowwqc.supabase.co'
  );
begin
  perform net.http_post(
    url := v_base_url || '/functions/v1/notify-therapist',
    headers := edge_hook_headers(),
    body := row_to_json(NEW)::jsonb
  );
  return NEW;
end $$;

do $$
begin
  perform cron.unschedule('send-agenda');
exception when others then
  null;
end $$;
select cron.schedule(
  'send-agenda',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://ajzcfbgjvnxgpebowwqc.supabase.co/functions/v1/send-agenda',
       headers := public.edge_hook_headers(),
       body := '{}'::jsonb
     ) $$
);
