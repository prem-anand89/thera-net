-- Founder operations, used from Supabase Studio only. Never add this schema to the API's exposed schemas.
create schema if not exists platform_admin;
revoke all on schema platform_admin from public, anon, authenticated;

-- 1. Payment ledger. No FK to clinics: payment history must survive deleting a clinic.
create table platform_admin.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  clinic_name text not null,
  plan_tier text not null check (plan_tier in ('lite', 'solo', 'clinic', 'clinic_plus')),
  amount_paise bigint not null check (amount_paise >= 0),
  payment_method text not null check (payment_method in ('upi', 'card', 'bank_transfer', 'cash', 'waived')),
  payment_reference text,
  paid_on date not null,
  valid_until date not null,
  duration_days int not null check (duration_days > 0),
  notes text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  created_by text not null default current_user,
  check ((voided_at is null) = (void_reason is null))
);
create index subscription_payments_clinic_idx
  on platform_admin.subscription_payments (clinic_id, valid_until desc) where voided_at is null;

-- 2. Audit of every clinic_plans change, however it was made.
create table platform_admin.clinic_plans_audit (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  operation text not null,
  old_tier text, new_tier text,
  old_status text, new_status text,
  old_limits jsonb, new_limits jsonb,
  changed_at timestamptz not null default now(),
  changed_by_user uuid,        -- null from Studio
  changed_by_role text not null
);

create or replace function platform_admin.log_clinic_plan_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
declare
  o public.clinic_plans := case when tg_op = 'INSERT' then null else old end;
  n public.clinic_plans := case when tg_op = 'DELETE' then null else new end;
begin
  insert into platform_admin.clinic_plans_audit (
    clinic_id, operation, old_tier, new_tier, old_status, new_status, old_limits, new_limits,
    changed_by_user, changed_by_role
  ) values (
    coalesce(n.clinic_id, o.clinic_id), tg_op, o.plan_tier, n.plan_tier, o.status, n.status,
    case when o.clinic_id is null then null else jsonb_build_object(
      'max_members', o.max_members, 'visit_cap_per_month', o.visit_cap_per_month,
      'max_roster_therapists', o.max_roster_therapists) end,
    case when n.clinic_id is null then null else jsonb_build_object(
      'max_members', n.max_members, 'visit_cap_per_month', n.visit_cap_per_month,
      'max_roster_therapists', n.max_roster_therapists) end,
    auth.uid(), session_user
  );
  return null; -- AFTER trigger
end $$;

drop trigger if exists clinic_plans_audit_log on public.clinic_plans;
create trigger clinic_plans_audit_log
  after insert or update or delete on public.clinic_plans
  for each row execute function platform_admin.log_clinic_plan_change();

-- A clinic's "today" in its own time zone.
create or replace function platform_admin.clinic_today(p_clinic_id uuid) returns date
language sql stable set search_path = pg_catalog, public as $$
  select (now() at time zone c.timezone)::date from public.clinics c where c.id = p_clinic_id
$$;

-- 3. Change tier. Custom limits (different from the current tier's default) are kept;
-- default limits move to the new tier's default. p_status null = leave the status alone.
create or replace function platform_admin.set_clinic_tier(
  p_clinic_id uuid,
  p_tier text,
  p_status text default null,
  p_preserve_custom_limits boolean default true
) returns void
language plpgsql set search_path = pg_catalog, public, platform_admin as $$
declare
  nd record; od record; cur public.clinic_plans;
begin
  select * into nd from public.plan_tier_defaults(p_tier);
  if not found then raise exception 'Unknown tier "%"', p_tier; end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id) then
    raise exception 'No clinic with id %', p_clinic_id;
  end if;

  select * into cur from public.clinic_plans where clinic_id = p_clinic_id for update;
  if not found then
    insert into public.clinic_plans (clinic_id, plan_tier, status, max_members, visit_cap_per_month, max_roster_therapists)
    values (p_clinic_id, p_tier, coalesce(p_status, 'active'), nd.max_members, nd.visit_cap_per_month, nd.max_roster_therapists);
    return;
  end if;

  select * into od from public.plan_tier_defaults(cur.plan_tier);
  update public.clinic_plans set
    plan_tier = p_tier,
    status = coalesce(p_status, cur.status),
    max_members = case when p_preserve_custom_limits and cur.max_members is distinct from od.max_members
                       then cur.max_members else nd.max_members end,
    visit_cap_per_month = case when p_preserve_custom_limits and cur.visit_cap_per_month is distinct from od.visit_cap_per_month
                       then cur.visit_cap_per_month else nd.visit_cap_per_month end,
    max_roster_therapists = case when p_preserve_custom_limits and cur.max_roster_therapists is distinct from od.max_roster_therapists
                       then cur.max_roster_therapists else nd.max_roster_therapists end
  where clinic_id = p_clinic_id;
end $$;

-- 4. Record a payment and activate the plan, atomically. Extends from the current validity if still running.
create or replace function platform_admin.record_subscription_payment(
  p_clinic_id uuid,
  p_tier text,
  p_amount_paise bigint,
  p_payment_method text,
  p_payment_reference text default null,
  p_duration_days int default 30,
  p_notes text default null
) returns uuid
language plpgsql set search_path = pg_catalog, public, platform_admin as $$
declare
  v_id uuid; v_name text; v_today date; v_last date;
begin
  select name into v_name from public.clinics where id = p_clinic_id for update;
  if not found then raise exception 'No clinic with id %', p_clinic_id; end if;
  if p_duration_days is null or p_duration_days <= 0 then raise exception 'Duration must be above 0 days'; end if;
  v_today := platform_admin.clinic_today(p_clinic_id);

  select max(valid_until) into v_last from platform_admin.subscription_payments
   where clinic_id = p_clinic_id and voided_at is null and valid_until >= v_today;

  insert into platform_admin.subscription_payments (
    clinic_id, clinic_name, plan_tier, amount_paise, payment_method, payment_reference,
    paid_on, valid_until, duration_days, notes
  ) values (
    p_clinic_id, v_name, p_tier, p_amount_paise, p_payment_method, p_payment_reference,
    v_today, coalesce(v_last, v_today) + p_duration_days, p_duration_days, p_notes
  ) returning id into v_id;

  perform platform_admin.set_clinic_tier(p_clinic_id, p_tier, 'active', true);
  return v_id;
end $$;

-- 5. Void a wrong payment. Does not change the plan: review renewals_due afterwards.
create or replace function platform_admin.void_subscription_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql set search_path = pg_catalog, platform_admin as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update platform_admin.subscription_payments set voided_at = now(), void_reason = trim(p_reason)
   where id = p_payment_id and voided_at is null;
  if not found then raise exception 'No unvoided payment with id %', p_payment_id; end if;
end $$;

-- 6. Overview of every clinic.
create or replace view platform_admin.clinics_overview as
select
  c.id as clinic_id, c.name as clinic_name, c.phone as clinic_phone, c.email as clinic_email,
  c.onboarding_completed_at,
  owner.email as admin_email,
  cp.plan_tier, cp.status as plan_status,
  coalesce(v.visits_this_month, 0) as visits_this_month,
  cp.visit_cap_per_month,
  coalesce(cp.visit_cap_per_month > 0 and coalesce(v.visits_this_month, 0) >= 0.8 * cp.visit_cap_per_month, false) as near_visit_cap,
  m.team_seats_used, cp.max_members as max_team_seats,
  t.roster_therapists_used, cp.max_roster_therapists,
  pay.last_paid_on, pay.valid_until,
  pay.valid_until - today.d as days_remaining,
  case
    when pay.valid_until is null then 'exempt_unpaid'
    when pay.valid_until - today.d > 7 then 'active'
    when pay.valid_until - today.d >= 0 then 'renewal_due_soon'
    when pay.valid_until - today.d >= -7 then 'in_grace_period'
    else 'overdue'
  end as renewal_status,
  v.latest_visit_date, v.latest_visit_change
from public.clinics c
cross join lateral (select (now() at time zone c.timezone)::date as d) today
left join public.clinic_plans cp on cp.clinic_id = c.id
left join lateral (
  select u.email from public.clinic_members cm join auth.users u on u.id = cm.user_id
   where cm.clinic_id = c.id and cm.role = 'admin' order by cm.updated_at limit 1
) owner on true
left join lateral (
  select count(*) filter (where date_trunc('month', x.visit_date) = date_trunc('month', today.d)) as visits_this_month,
         max(x.visit_date) as latest_visit_date, max(x.updated_at) as latest_visit_change
    from public.visits x where x.clinic_id = c.id and not x.deleted
) v on true
left join lateral (select count(*) as team_seats_used from public.clinic_members cm where cm.clinic_id = c.id) m on true
left join lateral (
  select count(*) as roster_therapists_used from public.therapists th
   where th.clinic_id = c.id and th.active and th.user_id is null
) t on true
left join lateral (
  select sp.paid_on as last_paid_on, sp.valid_until from platform_admin.subscription_payments sp
   where sp.clinic_id = c.id and sp.voided_at is null order by sp.valid_until desc limit 1
) pay on true;

-- 7. Paying clinics that need attention. Exempt clinics are in clinics_overview only.
create or replace view platform_admin.renewals_due as
select clinic_id, clinic_name, admin_email, clinic_phone, plan_tier, plan_status,
       valid_until, days_remaining, renewal_status, visits_this_month, latest_visit_date
  from platform_admin.clinics_overview
 where renewal_status in ('renewal_due_soon', 'in_grace_period', 'overdue')
 order by days_remaining;

-- 8. Lock by hand. Previews by default; pass false to apply. Only clinics past grace.
create or replace function platform_admin.lock_overdue_clinics(p_dry_run boolean default true)
returns table (clinic_id uuid, clinic_name text, valid_until date, days_remaining int, locked boolean)
language plpgsql set search_path = pg_catalog, public, platform_admin as $$
begin
  for clinic_id, clinic_name, valid_until, days_remaining in
    select o.clinic_id, o.clinic_name, o.valid_until, o.days_remaining
      from platform_admin.clinics_overview o
     where o.renewal_status = 'overdue' and o.plan_status is distinct from 'read_only'
     order by o.days_remaining
  loop
    if not p_dry_run then
      update public.clinic_plans cp set status = 'read_only' where cp.clinic_id = lock_overdue_clinics.clinic_id;
    end if;
    locked := not p_dry_run;
    return next;
  end loop;
end $$;

revoke all on all tables in schema platform_admin from public, anon, authenticated, service_role;
revoke all on all functions in schema platform_admin from public, anon, authenticated, service_role;
