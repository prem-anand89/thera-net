-- ---------------------------------------------------------------------------
-- Last-admin guard: a clinic left with zero admins has no way back into
-- Settings for anyone -- every write there is gated on is_clinic_admin(), so
-- there's no "ask an admin to fix it" path once none exist. Neither
-- guard_clinic_members_role_change() (20260816000002) nor the plain
-- members_delete policy stops the *last* admin demoting or revoking
-- themselves, or another admin revoking the only other one. This closes
-- that at the DB level, the one boundary the client-side check in
-- SettingsPage can't be raced or bypassed around.
-- ---------------------------------------------------------------------------
create or replace function public.guard_clinic_members_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_admins int;
begin
  -- Only a change that removes an admin (role change away from 'admin', or
  -- the row being deleted) needs the count below.
  if old.role <> 'admin' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' then
    return new;
  end if;

  select count(*) into remaining_admins
  from clinic_members
  where clinic_id = old.clinic_id and role = 'admin' and user_id <> old.user_id;

  if remaining_admins = 0 then
    raise exception 'This clinic must keep at least one admin.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger clinic_members_last_admin_guard_update
  before update on public.clinic_members
  for each row execute function public.guard_clinic_members_last_admin();

create trigger clinic_members_last_admin_guard_delete
  before delete on public.clinic_members
  for each row execute function public.guard_clinic_members_last_admin();
