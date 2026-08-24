-- Bug fix, found while testing Phase 2: clinic_plans_updated (Phase 0,
-- 20260823120001_clinic_plans.sql) used the generic set_updated_at()
-- trigger function, which unconditionally sets NEW.updated_by (and, on
-- INSERT, NEW.created_by). clinic_plans has neither column -- there was
-- never a write path through an authenticated user's own session for this
-- table (writes are service_role only), so "who last touched this row" via
-- auth.uid() was never a meaningful concept here the way it is on
-- admin-editable tables. Every UPDATE to clinic_plans failed with
-- `record "new" has no field "updated_by"` before this fix -- caught by a
-- direct SQL UPDATE during Phase 2 testing; no application code has ever
-- exercised this path (the table has had zero updates since Phase 0
-- shipped), so nothing in production was affected.
create or replace function public.set_clinic_plans_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger clinic_plans_updated on public.clinic_plans;

create trigger clinic_plans_updated before update on public.clinic_plans
  for each row execute function public.set_clinic_plans_updated_at();
