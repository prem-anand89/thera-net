-- ---------------------------------------------------------------------------
-- admin_delete_clinic: permanently remove a clinic and all cascaded data.
-- Mirrors admin_wipe_clinic_data's trigger-disable pattern — invoices and
-- visits have immutability guards that block DELETE even when the parent
-- clinic row is removed via ON DELETE CASCADE.
--
-- list_clinic_members_with_email: add auth.users invite/sign-in timestamps
-- so Settings → Team can show Pending vs Active without a separate status
-- column (pending = never signed in; active = last_sign_in_at is set).
-- ---------------------------------------------------------------------------

create or replace function public.admin_delete_clinic(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_clinic_admin(p_clinic_id) then
    raise exception 'only clinic admins can delete a clinic';
  end if;

  if not exists (select 1 from clinics where id = p_clinic_id) then
    raise exception 'clinic not found';
  end if;

  alter table public.invoices disable trigger invoices_immutable;
  alter table public.visits disable trigger visits_protect_invoiced;

  begin
    delete from public.clinics where id = p_clinic_id;
  exception
    when others then
      alter table public.visits enable trigger visits_protect_invoiced;
      alter table public.invoices enable trigger invoices_immutable;
      raise;
  end;

  alter table public.visits enable trigger visits_protect_invoiced;
  alter table public.invoices enable trigger invoices_immutable;
end;
$$;

revoke execute on function public.admin_delete_clinic(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Member list with login status for Team → Logins.
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
  email_confirmed_at timestamptz
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
      u.email_confirmed_at
    from public.clinic_members cm
    join auth.users u on u.id = cm.user_id
    where cm.clinic_id = p_clinic_id
    order by u.email;
end;
$$;

revoke execute on function public.list_clinic_members_with_email(uuid) from anon;
