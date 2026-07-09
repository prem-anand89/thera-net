-- ---------------------------------------------------------------------------
-- List a clinic's members with their login email, so Setup can offer a
-- "link this therapist to a login" picker. auth.users isn't queryable by
-- regular clients (no RLS policy exposes it via PostgREST), so this is a
-- security-definer RPC scoped to members of the requesting clinic only.
-- ---------------------------------------------------------------------------
create or replace function public.list_clinic_members_with_email(p_clinic_id uuid)
returns table (user_id uuid, email text, role text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;
  return query
    select cm.user_id, u.email::text, cm.role
    from clinic_members cm
    join auth.users u on u.id = cm.user_id
    where cm.clinic_id = p_clinic_id
    order by u.email;
end $$;

revoke execute on function public.list_clinic_members_with_email(uuid) from anon;
