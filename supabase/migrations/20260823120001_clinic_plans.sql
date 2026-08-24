-- Phase 0 (tier-based subscriptions plan), step 2: clinic_plans — the tier
-- boundary that can't be self-serve bypassed.
--
-- Why not columns on `clinics`: clinics_update is `for update using
-- (is_clinic_admin(id))` with no column restriction, and `clinics` rides
-- the client-writable outbox (src/lib/db.ts). A `plan_tier` column there
-- would be customer-editable through the normal write path. `clinic_plans`
-- gets `select` for clinic members and NO write policy at all — with RLS
-- enabled and no write policy, only service_role (which bypasses RLS) can
-- write it. That's the entire fix; there is deliberately no admin-write
-- policy to "tighten later."
--
-- max_members and visit_cap_per_month are tunable columns, not enum-derived
-- constants, so a per-clinic negotiated deal or a tier's default ceiling
-- changing is a data update, not a migration.
create table public.clinic_plans (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  plan_tier text not null check (plan_tier in ('lite', 'solo', 'clinic', 'clinic_plus')),
  status text not null default 'active' check (status in ('active', 'past_due', 'read_only')),
  max_members int not null,
  visit_cap_per_month int, -- null = unlimited
  updated_at timestamptz not null default now()
);

alter table public.clinic_plans enable row level security;

create policy clinic_plans_select on public.clinic_plans
  for select using (is_clinic_member(clinic_id));

create trigger clinic_plans_updated before update on public.clinic_plans
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.clinic_plans;

-- Backfill existing clinics as clinic_plus/active/unlimited — grandfathering
-- today's de-facto behavior (nothing has ever been gated, so every clinic
-- effectively has full access already). This is a deliberate placeholder,
-- not a tier decision: clinic_plans has zero enforcement wired up yet
-- (that's Phase 2), so this row is inert until then. Real per-clinic tier
-- assignment needs to happen before Phase 2 enforcement ships — see the
-- tier-plan doc's open questions on default/seeded tier.
insert into public.clinic_plans (clinic_id, plan_tier, status, max_members, visit_cap_per_month)
select
  c.id,
  'clinic_plus',
  'active',
  greatest(10, coalesce((select count(*) from public.clinic_members m where m.clinic_id = c.id), 0)),
  null
from public.clinics c
on conflict (clinic_id) do nothing;

-- New clinics: seed on create, mirroring add_creator_as_admin() and
-- seed_default_module_settings() (both AFTER INSERT triggers on clinics
-- already). Default tier is 'lite' for self-serve signup (Part 1.6 of the
-- tier plan) with the Lite numbers from the tier proposal: 1 seat, 50
-- visits/month.
create or replace function public.seed_default_clinic_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into clinic_plans (clinic_id, plan_tier, status, max_members, visit_cap_per_month)
  values (new.id, 'lite', 'active', 1, 50)
  on conflict (clinic_id) do nothing;
  return new;
end $$;

create trigger seed_default_clinic_plan_trigger after insert on public.clinics
  for each row execute function public.seed_default_clinic_plan();
