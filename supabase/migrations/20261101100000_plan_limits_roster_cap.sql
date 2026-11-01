-- How many team members without a login a plan includes (the owner plus this many on the schedule), and one place
-- for what each tier includes in numbers.
--
-- * plan_tier_defaults(tier): the DEFAULT seats / monthly visits / team-without-login for a tier. It mirrors
--   TIER_LIMITS in src/domain/plans.ts; src/domain/planLimits.parity.test.ts keeps the two equal. These are defaults
--   only: enforcement always reads the clinic's own clinic_plans row, so a tuned clinic (one Clinic+ clinic has 100
--   seats) keeps its numbers.
-- * clinic_plans.max_roster_therapists: the clinic's own limit (null = unlimited). Filled ONLY where null. Existing
--   max_members and visit_cap_per_month are never rewritten.
-- * New clinics are seeded from plan_tier_defaults('lite'). To move a clinic to another tier by hand, set its tier
--   and copy the numbers in one statement:
--     update clinic_plans cp set plan_tier = 'solo', max_members = d.max_members,
--       visit_cap_per_month = d.visit_cap_per_month, max_roster_therapists = d.max_roster_therapists
--     from plan_tier_defaults('solo') d where cp.clinic_id = '<clinic id>';
-- * enforce_roster_cap: a team member with no login (active, user_id null) can only be added or switched back on while
--   the clinic is under its limit. Nothing is deactivated automatically and visits are never blocked.
--
-- Idempotent.

alter table public.clinic_plans add column if not exists max_roster_therapists int;

create or replace function public.plan_tier_defaults(p_tier text)
returns table (max_members int, visit_cap_per_month int, max_roster_therapists int)
language sql immutable as $$
  select v.m, v.c, v.r
  from (values
    ('lite',        1,  50,           1),
    ('solo',        1,  200,          1),
    ('clinic',      5,  null::int,    3),
    ('clinic_plus', 10, null::int,    10)
  ) as v (tier, m, c, r)
  where v.tier = p_tier;
$$;

update public.clinic_plans cp
   set max_roster_therapists = (select d.max_roster_therapists from public.plan_tier_defaults(cp.plan_tier) d)
 where cp.max_roster_therapists is null;

create or replace function public.seed_default_clinic_plan()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d record;
begin
  select * into d from plan_tier_defaults('lite');
  insert into clinic_plans (clinic_id, plan_tier, status, max_members, visit_cap_per_month, max_roster_therapists)
  values (new.id, 'lite', 'active', d.max_members, d.visit_cap_per_month, d.max_roster_therapists)
  on conflict (clinic_id) do nothing;
  return new;
end $$;

create or replace function public.enforce_roster_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cap int;
  v_others int;
begin
  if not tier_enforcement_enabled() then
    return new;
  end if;
  -- Only an active row with no login counts toward the limit.
  if new.user_id is not null or not new.active then
    return new;
  end if;
  -- An edit of a row that was already active and unlinked changes nothing about the count. (The sync saves with an
  -- upsert, so this trigger also fires for plain edits of an existing therapist; counting the row twice would refuse
  -- renaming the only team member at the limit.)
  if tg_op = 'UPDATE' and old.active and old.user_id is null then
    return new;
  end if;

  select max_roster_therapists into v_cap from clinic_plans where clinic_id = new.clinic_id;
  if v_cap is null then
    return new;
  end if;

  select count(*) into v_others
    from therapists
    where clinic_id = new.clinic_id and active and user_id is null and id <> new.id;
  if v_others >= v_cap then
    raise exception 'Your plan includes % team member(s) without a login, and they are all in use. Switch one off, or upgrade, to add another.', v_cap;
  end if;
  return new;
end $$;

drop trigger if exists therapists_enforce_roster_cap on public.therapists;
create trigger therapists_enforce_roster_cap
  before insert or update of active, user_id on public.therapists
  for each row execute function public.enforce_roster_cap();
