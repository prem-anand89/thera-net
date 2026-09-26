-- ---------------------------------------------------------------------------
-- Brevo (SendinBlue) email configuration for custom invitation emails.
-- Stores API key and sender email per clinic to send proper "You've been
-- invited" emails instead of generic password reset emails when re-linking
-- existing accounts during team member invitations.
--
-- access_token is a real secret (Brevo API key). This table carries NO
-- select policy for any client role at all — only service_role (used
-- exclusively inside the invite-therapist Edge Function) can ever read it.
-- ---------------------------------------------------------------------------

create table public.clinic_brevo_config (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  api_key text,
  sender_email text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.clinic_brevo_config enable row level security;
-- Deliberately no select policy — see comment above.

create trigger clinic_brevo_config_set_updated_at
  before update on public.clinic_brevo_config
  for each row execute function public.set_updated_at();

-- p_api_key = null leaves the currently stored key untouched, so
-- re-saving the sender email or flipping `enabled` doesn't force
-- re-entering the API key every time. An empty string clears it.
create or replace function public.set_brevo_config(
  p_clinic_id uuid,
  p_api_key text,
  p_sender_email text,
  p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_clinic_admin(p_clinic_id) then
    raise exception 'Not authorized.';
  end if;

  insert into clinic_brevo_config (clinic_id, api_key, sender_email, enabled, updated_by)
  values (p_clinic_id, p_api_key, p_sender_email, p_enabled, auth.uid())
  on conflict (clinic_id) do update
    set api_key = coalesce(p_api_key, clinic_brevo_config.api_key),
        sender_email = p_sender_email,
        enabled = p_enabled,
        updated_by = auth.uid(),
        updated_at = now();
end $$;

create or replace function public.get_brevo_config_status(p_clinic_id uuid)
returns table (enabled boolean, sender_email text, has_api_key boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not is_clinic_admin(p_clinic_id) then
    raise exception 'Not authorized.';
  end if;

  return query
    select c.enabled, c.sender_email, (c.api_key is not null and c.api_key <> '')
    from clinic_brevo_config c
    where c.clinic_id = p_clinic_id;
end $$;

revoke execute on function public.set_brevo_config(uuid, text, text, boolean) from public, anon;
revoke execute on function public.get_brevo_config_status(uuid) from public, anon;
grant execute on function public.set_brevo_config(uuid, text, text, boolean) to authenticated;
grant execute on function public.get_brevo_config_status(uuid) to authenticated;
