-- ---------------------------------------------------------------------------
-- Member display name: what the app shows for "who's signed in" instead of
-- raw email, and what a member picks for themselves rather than an admin
-- assigning it sight-unseen. Deliberately a separate column from the
-- existing `title` (20260815000001) -- title is an unused-so-far job label
-- ("Lead Physiotherapist"), this is the everyday name shown in the header
-- and sign-out menu. For a therapist, this starts out mirroring
-- `therapists.name` (what the visit/note therapist picker already shows)
-- since that name has to exist the moment they're invited for the roster
-- to be usable, before the invited person has ever logged in to pick their
-- own -- but the two can drift apart afterward (therapists.name is the
-- roster label, clinic_members.display_name is personal to the login).
-- ---------------------------------------------------------------------------
alter table public.clinic_members add column display_name text;

update public.clinic_members cm
set display_name = t.name
from public.therapists t
where t.user_id = cm.user_id and t.clinic_id = cm.clinic_id and cm.display_name is null;

-- ---------------------------------------------------------------------------
-- A member may update their own row (today only an admin could touch any
-- clinic_members row at all -- members_update requires is_clinic_admin).
-- Self-service is scoped to "my own row" by user_id in both USING and CHECK;
-- the trigger below is what actually stops a self-update from also
-- reassigning role, since RLS alone only sees column values, not which
-- columns changed.
-- ---------------------------------------------------------------------------
create policy members_update_self on public.clinic_members
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.guard_clinic_members_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not is_clinic_admin(old.clinic_id) then
    raise exception 'Only a clinic admin can change a member''s role';
  end if;
  return new;
end;
$$;

create trigger clinic_members_role_guard
  before update on public.clinic_members
  for each row execute function public.guard_clinic_members_role_change();

-- ---------------------------------------------------------------------------
-- list_clinic_members_with_email gains display_name in its result --
-- CREATE OR REPLACE can't change a function's return columns, so this has
-- to be dropped and recreated rather than replaced in place.
-- ---------------------------------------------------------------------------
drop function if exists public.list_clinic_members_with_email(uuid);

create function public.list_clinic_members_with_email(p_clinic_id uuid)
returns table(user_id uuid, email text, role text, display_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;
  return query
    select cm.user_id, u.email::text, cm.role, cm.display_name
    from clinic_members cm
    join auth.users u on u.id = cm.user_id
    where cm.clinic_id = p_clinic_id
    order by u.email;
end $$;
