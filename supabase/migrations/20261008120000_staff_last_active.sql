-- Staff "Active today" presence. A member's own client pings this once per
-- device per day (throttled client-side via Dexie's db.meta, namespaced by
-- both clinic and user id so one staff member's ping on a shared device
-- can never suppress another's); the Team Directory shows a simple
-- "Active today" badge from it — no finer granularity, since a once-daily
-- write can't honestly support "N minutes ago".

alter table public.clinic_members
  add column if not exists last_active_at timestamptz;

-- Narrow by construction: no id parameter to spoof, so a caller can only
-- ever touch their own (clinic_id, user_id) row.
create or replace function public.touch_last_active(p_clinic_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clinic_members
    set last_active_at = now()
    where clinic_id = p_clinic_id and user_id = auth.uid();
end $$;

revoke execute on function public.touch_last_active(uuid) from public, anon;
grant execute on function public.touch_last_active(uuid) to authenticated;

-- list_clinic_members_with_email: also expose last_active_at for the Team
-- Directory's "Active today" badge.
drop function if exists public.list_clinic_members_with_email(uuid);

create function public.list_clinic_members_with_email(p_clinic_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  display_name text,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  require_password_setup boolean,
  last_active_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;

  return query
    select
      cm.user_id,
      u.email::text,
      cm.role,
      cm.display_name,
      u.invited_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      coalesce((u.raw_user_meta_data->>'require_password_setup')::boolean, false),
      cm.last_active_at
    from public.clinic_members cm
    join auth.users u on u.id = cm.user_id
    where cm.clinic_id = p_clinic_id
    order by u.email;
end;
$$;

revoke execute on function public.list_clinic_members_with_email(uuid) from anon;
