-- Fix clinic creation RLS issue: the trigger add_creator_as_admin() runs AFTER
-- insert, but clinic_members has RLS that requires is_clinic_admin() which fails
-- before the user is added. Solution: allow clinic_members INSERT during clinic
-- creation via a security-definer function, or relax the trigger's constraints.

-- Current state: clinics_insert allows auth.uid() is not null
-- Current issue: add_creator_as_admin trigger tries to insert to clinic_members
-- but clinic_members INSERT policy requires is_clinic_admin(clinic_id), which
-- fails because the user isn't a member yet.

-- Solution: Make add_creator_as_admin() a SECURITY DEFINER function so it can
-- bypass its own RLS policy when adding the creator.

drop trigger if exists clinics_creator_admin on public.clinics;
drop function if exists public.add_creator_as_admin();

-- Recreate as SECURITY DEFINER so it bypasses RLS for the insert
create or replace function public.add_creator_as_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into clinic_members (clinic_id, user_id, role)
    values (new.id, auth.uid(), 'admin')
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger clinics_creator_admin after insert on public.clinics
  for each row execute function public.add_creator_as_admin();

-- Verify clinics_insert policy exists and allows any authenticated user
-- (it should already be there from init.sql, but just to be sure)
-- The policy clinics_insert should check: auth.uid() is not null
