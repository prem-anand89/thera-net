-- ---------------------------------------------------------------------------
-- Patient Communications, Phase 9 (scaffold): WhatsApp Business Cloud API
-- credential storage. Every send action in this module today opens the
-- staff member's own WhatsApp via a share sheet -- this table is the first
-- step toward the "optional later" server-side send path the handoff doc
-- describes, built ahead of the user actually having real Meta credentials
-- so turning it on later is a config step, not a code change.
--
-- access_token is a real secret (a Meta permanent/system-user access
-- token). This table carries NO select policy for any client role at
-- all -- only service_role (used exclusively inside the
-- send-whatsapp-template Edge Function) can ever read it. Two RPCs below
-- give the client everything it legitimately needs (write, and a masked
-- status read) without ever exposing the token itself.
-- ---------------------------------------------------------------------------
create table public.clinic_whatsapp_config (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  phone_number_id text,
  access_token text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.clinic_whatsapp_config enable row level security;
-- Deliberately no select policy — see comment above.

create trigger clinic_whatsapp_config_set_updated_at
  before update on public.clinic_whatsapp_config
  for each row execute function public.set_updated_at();

-- p_access_token = null leaves the currently stored token untouched, so
-- re-saving the phone number ID or flipping `enabled` doesn't force
-- re-entering the secret every time. An empty string clears it.
create or replace function public.set_whatsapp_config(
  p_clinic_id uuid,
  p_phone_number_id text,
  p_access_token text,
  p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_clinic_admin(p_clinic_id) then
    raise exception 'Not authorized.';
  end if;

  insert into clinic_whatsapp_config (clinic_id, phone_number_id, access_token, enabled, updated_by)
  values (p_clinic_id, p_phone_number_id, p_access_token, p_enabled, auth.uid())
  on conflict (clinic_id) do update
    set phone_number_id = excluded.phone_number_id,
        access_token = coalesce(p_access_token, clinic_whatsapp_config.access_token),
        enabled = excluded.enabled,
        updated_by = excluded.updated_by;
end $$;

create or replace function public.get_whatsapp_config_status(p_clinic_id uuid)
returns table (enabled boolean, phone_number_id text, has_token boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not is_clinic_admin(p_clinic_id) then
    raise exception 'Not authorized.';
  end if;

  return query
    select c.enabled, c.phone_number_id, (c.access_token is not null and c.access_token <> '')
    from clinic_whatsapp_config c
    where c.clinic_id = p_clinic_id;
end $$;

revoke execute on function public.set_whatsapp_config(uuid, text, text, boolean) from public, anon;
revoke execute on function public.get_whatsapp_config_status(uuid) from public, anon;
grant execute on function public.set_whatsapp_config(uuid, text, text, boolean) to authenticated;
grant execute on function public.get_whatsapp_config_status(uuid) to authenticated;
