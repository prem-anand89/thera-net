-- ---------------------------------------------------------------------------
-- Module registry: per-clinic, per-role activation for the pluggable
-- assessment modules (Tier 1 + Tier 2 of the module activation model).
--
-- Tier 1 (clinic): clinic_module_settings.enabled — does this practice use
-- this module at all?
-- Tier 2 (role): clinic_module_settings.allowed_roles — which staff roles
-- within an enabled clinic may open it?
-- Tier 3 (patient) already exists: patient_module_enrollments.
--
-- can_use_module() is the single source of truth both sides read: the RLS
-- policies on each module's response table call it server-side, and the
-- client mirrors the same rows locally (via sync) to gate the launcher UI
-- offline without waiting on a round trip.
-- ---------------------------------------------------------------------------

create table public.clinic_module_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  module_key text not null check (module_key in (
    'gut_screening', 'return_to_sport', 'scoliosis_screening', 'face_scale', 'facial_palsy')),
  enabled boolean not null default false,
  -- Which clinic_members.role values may use this module when enabled.
  allowed_roles text[] not null default array['admin', 'staff'],
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id),
  unique (clinic_id, module_key)
);

create index clinic_module_settings_clinic_idx
  on public.clinic_module_settings (clinic_id, updated_at);

create trigger clinic_module_settings_updated before insert or update on public.clinic_module_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- can_use_module: true iff the module is enabled for the clinic AND the
-- calling user's clinic_members.role is in the module's allowed_roles.
-- No configured row for a module means it is off by default (fail closed) —
-- a clinic must explicitly turn a module on, matching Tier 1's definition.
-- ---------------------------------------------------------------------------
create or replace function public.can_use_module(p_clinic_id uuid, p_module_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from clinic_module_settings s
    join clinic_members m on m.clinic_id = s.clinic_id
    where s.clinic_id = p_clinic_id
      and s.module_key = p_module_key
      and s.enabled
      and m.user_id = auth.uid()
      and m.role = any (s.allowed_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Auto-provision every clinic (new and existing) with one settings row per
-- known module. face_scale and facial_palsy ship already-built and stay
-- enabled by default so nothing regresses for clinics using them today;
-- the still-staged modules (gut_screening, return_to_sport,
-- scoliosis_screening) default to disabled until their real tool specs are
-- built against.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_module_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into clinic_module_settings (clinic_id, module_key, enabled)
  values
    (new.id, 'face_scale', true),
    (new.id, 'facial_palsy', true),
    (new.id, 'gut_screening', false),
    (new.id, 'return_to_sport', false),
    (new.id, 'scoliosis_screening', false)
  on conflict (clinic_id, module_key) do nothing;
  return new;
end $$;

create trigger clinics_seed_modules after insert on public.clinics
  for each row execute function public.seed_default_module_settings();

-- Backfill existing clinics created before this migration.
insert into clinic_module_settings (clinic_id, module_key, enabled)
select c.id, mk.module_key, mk.enabled
from clinics c
cross join (values
  ('face_scale', true),
  ('facial_palsy', true),
  ('gut_screening', false),
  ('return_to_sport', false),
  ('scoliosis_screening', false)
) as mk(module_key, enabled)
on conflict (clinic_id, module_key) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security: any clinic member can read the registry (so the
-- launcher UI can render); only clinic admins can change it (same authority
-- level as Setup's other clinic-configuration actions).
-- ---------------------------------------------------------------------------
alter table public.clinic_module_settings enable row level security;

create policy clinic_module_settings_select on public.clinic_module_settings
  for select using (is_clinic_member(clinic_id));
create policy clinic_module_settings_admin_write on public.clinic_module_settings
  for all using (is_clinic_admin(clinic_id)) with check (is_clinic_admin(clinic_id));

alter publication supabase_realtime add table public.clinic_module_settings;

-- ---------------------------------------------------------------------------
-- Re-gate the two live modules' response tables: reading a patient's
-- historical results stays available to every clinic member even if the
-- module is later disabled (clinical record retention). Creating or editing
-- a NEW result requires the module to be enabled AND the caller's role to
-- be permitted — this is Tier 1 + Tier 2 enforced at the database, not just
-- hidden in the UI.
-- ---------------------------------------------------------------------------
drop policy face_scale_responses_all on public.face_scale_responses;
drop policy facial_palsy_assessments_all on public.facial_palsy_assessments;

create policy face_scale_responses_select on public.face_scale_responses
  for select using (is_clinic_member(clinic_id));
create policy face_scale_responses_insert on public.face_scale_responses
  for insert with check (is_clinic_member(clinic_id) and can_use_module(clinic_id, 'face_scale'));
create policy face_scale_responses_update on public.face_scale_responses
  for update using (is_clinic_member(clinic_id))
  with check (is_clinic_member(clinic_id) and can_use_module(clinic_id, 'face_scale'));

create policy facial_palsy_assessments_select on public.facial_palsy_assessments
  for select using (is_clinic_member(clinic_id));
create policy facial_palsy_assessments_insert on public.facial_palsy_assessments
  for insert with check (is_clinic_member(clinic_id) and can_use_module(clinic_id, 'facial_palsy'));
create policy facial_palsy_assessments_update on public.facial_palsy_assessments
  for update using (is_clinic_member(clinic_id))
  with check (is_clinic_member(clinic_id) and can_use_module(clinic_id, 'facial_palsy'));
