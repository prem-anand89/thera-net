-- ---------------------------------------------------------------------------
-- list_clinic_members_with_email: expose require_password_setup from
-- auth.users metadata so Settings → Team can treat "opened invite link but
-- never chose a password" as Pending (last_sign_in_at alone is set once the
-- invite link establishes a session).
-- ---------------------------------------------------------------------------

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
  require_password_setup boolean
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
      coalesce((u.raw_user_meta_data->>'require_password_setup')::boolean, false)
    from public.clinic_members cm
    join auth.users u on u.id = cm.user_id
    where cm.clinic_id = p_clinic_id
    order by u.email;
end;
$$;

revoke execute on function public.list_clinic_members_with_email(uuid) from anon;
