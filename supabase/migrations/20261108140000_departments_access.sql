-- Departments (OP, Home care, IP): who sees which, and who can be booked where.
-- Departments reuse the stored places: 'clinic' = OP, 'home' = Home care, 'ward' = IP.
--
-- clinic_members.departments: the departments this login sees. null = every department the clinic has (admins always see all).
-- therapists.care_locations:  the departments this person works in, so Book and New Visit offer them only there. null = all.
-- Both are display-level in this version: RLS still lets any clinic member read the data. Only an admin may change a
-- member's departments (a member can update their own row for their display name, so the guard also covers this column).
-- Empty arrays are refused (use null for "all"), and values must be known places.

alter table public.clinic_members
  add column if not exists departments text[]
    check (departments is null or (cardinality(departments) > 0 and departments <@ array['clinic', 'home', 'ward']::text[]));

alter table public.therapists
  add column if not exists care_locations text[]
    check (care_locations is null or (cardinality(care_locations) > 0 and care_locations <@ array['clinic', 'home', 'ward']::text[]));

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
  if new.departments is distinct from old.departments and not is_clinic_admin(old.clinic_id) then
    raise exception 'Only a clinic admin can change a member''s departments';
  end if;
  return new;
end;
$$;
