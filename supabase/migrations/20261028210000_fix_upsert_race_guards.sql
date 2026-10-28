-- Fix for upsert (INSERT ... ON CONFLICT DO UPDATE) race guards on visits:
--
-- Background:
-- When Supabase client sync pushes an edit to an existing visit, it executes an upsert
-- (`insert ... on conflict (id) do update`). In PostgreSQL, BEFORE INSERT triggers fire
-- on every upsert statement before the conflict check occurs.
--
-- 1. `enforce_package_session_limit()`:
--    Previously counted all visits where `package_group_id = new.package_group_id and not deleted`.
--    When editing or re-saving the final session (e.g. session 3 of a 3-session package), the row
--    already exists in the database. The count was 3, and since `3 >= 3`, the trigger raised:
--    "This package already has 3 of 3 sessions logged -- nothing left to add."
--    This blocked sync from saving legitimate edits to the final package session.
--    Fix: exclude the row itself via `and id != new.id`.
--
-- 2. `enforce_clinic_plan_on_visit_insert()`:
--    Similarly, when a clinic is at its monthly visit cap, an upsert to edit an existing visit
--    would count the row itself if `id != new.id` is not present, failing with plan limit exceeded.
--    Fix: exclude the row itself via `and id != new.id`.
--
-- Idempotent: safe to re-run.

create or replace function public.enforce_package_session_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_existing int;
begin
  if new.package_group_id is not null and new.package_total is not null and new.package_total > 0 then
    select count(*) into v_existing
      from visits
      where package_group_id = new.package_group_id
        and id != new.id
        and not deleted;
    if v_existing >= new.package_total then
      raise exception 'This package already has % of % sessions logged -- nothing left to add.', v_existing, new.package_total;
    end if;
  end if;
  return new;
end $$;

create or replace function public.enforce_clinic_plan_on_visit_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cap int;
  v_buffer int;
  v_month_count int;
begin
  if not is_enforcement_enabled(new.clinic_id) then
    return new;
  end if;

  select cp.visit_cap_per_month into v_cap
    from clinics c
    join clinic_plans cp on cp.id = c.plan_id
    where c.id = new.clinic_id;

  v_buffer := get_plan_buffer(new.clinic_id);

  if v_cap is not null then
    select count(*) into v_month_count
      from visits
      where clinic_id = new.clinic_id
        and id != new.id
        and not deleted
        and date_trunc('month', visit_date) = date_trunc('month', new.visit_date);
    if v_month_count >= v_cap + v_buffer then
      raise exception 'this clinic''s plan allows % visits/month, and the buffer above that is also used up -- upgrade to log more', v_cap;
    end if;
  end if;

  return new;
end $$;
