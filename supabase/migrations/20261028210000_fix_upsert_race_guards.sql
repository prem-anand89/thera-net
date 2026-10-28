-- Editing a saved visit must not trip the "new visit" guards.
--
-- The sync pushes a visit with an upsert (INSERT ... ON CONFLICT DO UPDATE), and Postgres fires BEFORE INSERT
-- triggers on the proposed row before it looks for the conflict. So a plain edit of an existing visit ran the
-- two guards below as if it were a brand-new visit, and each counted the visit itself:
--
-- 1. enforce_package_session_limit: package of 3 with 3 sessions logged -> editing any of them (for example adding a
--    service to the last session from the post-save Edit button) counted 3 >= 3 and failed the sync with
--    "This package already has 3 of 3 sessions logged -- nothing left to add."
-- 2. enforce_clinic_plan_on_visit_insert: a clinic sitting at its monthly cap plus buffer could not sync an edit
--    to any visit that month, for the same reason.
--
-- Both now leave the row itself out of the count (id <> new.id). A genuinely new session still counts every
-- other row, so the race they exist for (two offline devices each adding the last session) is still caught.
-- Everything else in both functions is unchanged from 20261005170000 and 20260824000000.
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
        and id <> new.id
        and not deleted;
    if v_existing >= new.package_total then
      raise exception 'This package already has % of % sessions logged -- nothing left to add.', v_existing, new.package_total;
    end if;
  end if;
  return new;
end $$;

create or replace function public.enforce_clinic_plan_on_visit_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_cap int;
  v_month_count int;
  v_buffer int := 20;
begin
  if not tier_enforcement_enabled() then
    return new;
  end if;

  select status, visit_cap_per_month into v_status, v_cap
    from clinic_plans where clinic_id = new.clinic_id;

  if v_status is not null and v_status <> 'active' then
    raise exception 'this clinic''s plan is read-only -- new visits cannot be added until payment resumes';
  end if;

  if v_cap is not null then
    select count(*) into v_month_count
      from visits
      where clinic_id = new.clinic_id
        and id <> new.id
        and not deleted
        and date_trunc('month', visit_date) = date_trunc('month', new.visit_date);
    if v_month_count >= v_cap + v_buffer then
      raise exception 'this clinic''s plan allows % visits/month, and the buffer above that is also used up -- upgrade to log more', v_cap;
    end if;
  end if;

  return new;
end $$;
