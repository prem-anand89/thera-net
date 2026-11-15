-- HEP (Home Exercise Program), Slice 1 schema and RPCs.
-- Plan: docs/superpowers/plans/2026-11-09-hep-module.md (Task 1 and amendments 1 to 82).
-- Clinic-owned exercises (no seed), templates, patient programs with snapshotted items, session logs,
-- end-of-session Pain/Effort checks, the link + PIN patient access with lockout and remembered phones,
-- Lite caps, and the public patient-page RPCs (never raise on a bad PIN; rate-limited).
-- After applying: make supabase_migrations.schema_migrations hold this file's version and name (CLAUDE.md).

-- Home Exercise Prescription (HEP) — Locked Schema & RPCs (2026-11-10)
-- Clinic-owned exercises (no starter seed), templates, patient programs,
-- session-slot logs, Lite-tier caps (10 exercises, 5 active programs),
-- and 5-attempt / 15-minute PIN lockout.

-- 0. Who may use HEP: clinical staff only (admin and therapist). Front desk has no access to the module at all,
-- like clinical documentation. Every HEP policy and RPC below uses this, never is_clinic_member directly.
create or replace function public.is_hep_staff(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_clinic_member(p_clinic) and not public.is_front_desk(p_clinic);
$$;
revoke all on function public.is_hep_staff(uuid) from public, anon;
grant execute on function public.is_hep_staff(uuid) to authenticated, service_role;

-- 1. Helper: true when a clinic has unlimited HEP (active Solo+, active paid record, or pilot enforcement off)
create or replace function public.clinic_has_unlimited_hep(p_clinic_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v_tier text;
  v_status text;
  v_paid boolean;
begin
  if not public.tier_enforcement_enabled() then
    return true;
  end if;

  select cp.plan_tier, cp.status into v_tier, v_status
    from public.clinic_plans cp
   where cp.clinic_id = p_clinic_id;

  if v_tier in ('solo', 'clinic', 'clinic_plus') and coalesce(v_status, 'active') = 'active' then
    return true;
  end if;

  if to_regclass('platform_admin.subscription_payments') is not null then
    execute 'select exists (
               select 1
                 from platform_admin.subscription_payments
                where clinic_id = $1
                  and voided_at is null
                  and valid_until >= platform_admin.clinic_today($1)
             )'
       into v_paid
      using p_clinic_id;
    if coalesce(v_paid, false) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.clinic_has_unlimited_hep(uuid) from public, anon;
grant execute on function public.clinic_has_unlimited_hep(uuid) to authenticated, service_role;

-- The HEP caps per tier. Mirrors TIER_LIMITS.exercises / TIER_LIMITS.activePrograms in src/domain/plans.ts;
-- src/domain/planLimits.parity.test.ts compares them (extend it), like plan_tier_defaults for seats and visits.
create or replace function public.hep_tier_limits(p_tier text)
returns table (exercises int, active_programs int)
language sql immutable as $$
  select v.e, v.p
  from (values
    ('lite',        10,           5),
    ('solo',        null::int,    null::int),
    ('clinic',      null::int,    null::int),
    ('clinic_plus', null::int,    null::int)
  ) as v (tier, e, p)
  where v.tier = p_tier;
$$;

-- True when every picture key in a list of items (the p_items jsonb of the template and program RPCs) sits inside
-- this clinic's own exercise folder. Items are snapshots sent by the client, so their keys are checked like
-- save_exercise checks an exercise's own keys (review 2026-11-13).
create or replace function public.hep_item_keys_ok(p_clinic_id uuid, p_items jsonb)
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i,
           jsonb_array_elements_text(case when jsonb_typeof(i->'mediaKeys') = 'array' then i->'mediaKeys' else '[]'::jsonb end) k
     where k not like 'clinics/' || p_clinic_id::text || '/exercises/%'
        or position('..' in k) > 0
  );
$$;
revoke all on function public.hep_item_keys_ok(uuid, jsonb) from public, anon;

-- 2. Clinic-owned exercises (cached in Dexie for offline browse; written via RPC)
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  body_region text not null check (char_length(btrim(body_region)) > 0),
  phase text not null default 'other' check (phase in ('warm_up','stretching','mobility','activation','strengthening','balance','functional','cool_down','other')),
  thumb_key text,
  also_regions text[] not null default '{}'::text[],
  equipment text[] not null default '{}'::text[],
  instructions text not null default '',
  media_type text not null default 'none' check (media_type in ('none', 'gif', 'stills')),
  media_keys text[] not null default '{}'::text[] check (
    (media_type = 'none' and cardinality(media_keys) = 0) or
    (media_type = 'gif' and cardinality(media_keys) = 1) or
    (media_type = 'stills' and cardinality(media_keys) between 2 and 4)
  ),
  default_sets smallint not null default 3 check (default_sets between 1 and 20),
  dose_type text not null default 'reps' check (dose_type in ('reps', 'hold', 'timed')),
  default_reps smallint check (default_reps is null or default_reps between 1 and 600),
  default_hold_seconds smallint check (default_hold_seconds is null or default_hold_seconds between 1 and 600),
  default_duration_seconds smallint check (default_duration_seconds is null or default_duration_seconds between 1 and 3600),
  default_rest_seconds smallint not null default 30 check (default_rest_seconds between 0 and 300),
  media_captions text[] not null default '{}'::text[],
  other_names text[] not null default '{}'::text[] check (cardinality(other_names) <= 6),
  constraint exercises_dose_shape check (
    (dose_type = 'reps'  and default_reps is not null and default_hold_seconds is null and default_duration_seconds is null) or
    (dose_type = 'hold'  and default_reps is not null and default_hold_seconds is not null and default_duration_seconds is null) or
    (dose_type = 'timed' and default_reps is null and default_hold_seconds is null and default_duration_seconds is not null)
  ),
  default_sessions_per_day smallint not null default 1 check (default_sessions_per_day between 1 and 3),
  side text not null default 'none' check (side in ('none', 'left', 'right', 'both')),
  stop_if text not null default '',
  is_favorite boolean not null default false,
  active boolean not null default true,
  deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exercises_clinic_updated_idx
  on public.exercises (clinic_id, updated_at desc)
  where not deleted;

alter table public.exercises enable row level security;

create policy exercises_select on public.exercises
  for select to authenticated
  using (public.is_hep_staff(clinic_id));

drop trigger if exists exercises_updated on public.exercises;
create trigger exercises_updated before insert or update on public.exercises
  for each row execute function public.set_updated_at();

drop trigger if exists exercises_tombstone on public.exercises;
create trigger exercises_tombstone after delete on public.exercises
  for each row execute function public.record_sync_tombstone();

alter publication supabase_realtime add table public.exercises;

-- 3. Templates (named recipes with snapshotted items)
create table if not exists public.exercise_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  note text check (note is null or char_length(note) <= 120),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.exercise_templates enable row level security;

create policy exercise_templates_select on public.exercise_templates
  for select to authenticated
  using (public.is_hep_staff(clinic_id));

create table if not exists public.exercise_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.exercise_templates(id) on delete cascade,
  source_exercise_id uuid,
  title text not null,
  body_region text not null default 'General',
  phase text not null default 'other' check (phase in ('warm_up','stretching','mobility','activation','strengthening','balance','functional','cool_down','other')),
  equipment text[] not null default '{}'::text[],
  instructions text not null default '',
  media_type text not null default 'none' check (media_type in ('none', 'gif', 'stills')),
  media_keys text[] not null default '{}'::text[],
  sets smallint not null default 3 check (sets between 1 and 20),
  dose_type text not null default 'reps' check (dose_type in ('reps', 'hold', 'timed')),
  reps smallint check (reps is null or reps between 1 and 600),
  hold_seconds smallint check (hold_seconds is null or hold_seconds between 1 and 600),
  duration_seconds smallint check (duration_seconds is null or duration_seconds between 1 and 3600),
  rest_seconds smallint not null default 30 check (rest_seconds between 0 and 300),
  media_captions text[] not null default '{}'::text[],
  optional boolean not null default false,
  check (
    (dose_type = 'reps'  and reps is not null and hold_seconds is null and duration_seconds is null) or
    (dose_type = 'hold'  and reps is not null and hold_seconds is not null and duration_seconds is null) or
    (dose_type = 'timed' and reps is null and hold_seconds is null and duration_seconds is not null)
  ),
  sessions_per_day smallint not null default 1 check (sessions_per_day between 1 and 3),
  side text not null default 'none' check (side in ('none', 'left', 'right', 'both')),
  stop_if text not null default '',
  sort_order smallint not null default 0
);

create index if not exists exercise_template_items_template_idx on public.exercise_template_items (template_id);
alter table public.exercise_template_items enable row level security;

create policy exercise_template_items_select on public.exercise_template_items
  for select to authenticated
  using (
    exists (
      select 1 from public.exercise_templates t
       where t.id = exercise_template_items.template_id
         and public.is_hep_staff(t.clinic_id)
    )
  );

-- 4. Patient programs & snapshotted program_items
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id uuid references public.therapists(id) on delete set null,
  source_template_id uuid,
  title text not null check (char_length(btrim(title)) > 0),
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  start_date date not null default current_date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists programs_clinic_status_idx
  on public.programs (clinic_id, status);
create index if not exists programs_patient_idx
  on public.programs (patient_id, status);

alter table public.programs enable row level security;

create policy programs_select on public.programs
  for select to authenticated
  using (public.is_hep_staff(clinic_id));

create table if not exists public.program_items (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  source_exercise_id uuid,
  title text not null,
  body_region text not null default 'General',
  phase text not null default 'other' check (phase in ('warm_up','stretching','mobility','activation','strengthening','balance','functional','cool_down','other')),
  equipment text[] not null default '{}'::text[],
  instructions text not null default '',
  media_type text not null default 'none' check (media_type in ('none', 'gif', 'stills')),
  media_keys text[] not null default '{}'::text[],
  sets smallint not null default 3 check (sets between 1 and 20),
  dose_type text not null default 'reps' check (dose_type in ('reps', 'hold', 'timed')),
  reps smallint check (reps is null or reps between 1 and 600),
  hold_seconds smallint check (hold_seconds is null or hold_seconds between 1 and 600),
  duration_seconds smallint check (duration_seconds is null or duration_seconds between 1 and 3600),
  rest_seconds smallint not null default 30 check (rest_seconds between 0 and 300),
  media_captions text[] not null default '{}'::text[],
  optional boolean not null default false,
  check (
    (dose_type = 'reps'  and reps is not null and hold_seconds is null and duration_seconds is null) or
    (dose_type = 'hold'  and reps is not null and hold_seconds is not null and duration_seconds is null) or
    (dose_type = 'timed' and reps is null and hold_seconds is null and duration_seconds is not null)
  ),
  sessions_per_day smallint not null default 1 check (sessions_per_day between 1 and 3),
  sessions_schedule jsonb not null default '[]'::jsonb,
  side text not null default 'none' check (side in ('none', 'left', 'right', 'both')),
  stop_if text not null default '',
  special_instructions text not null default '',
  sort_order smallint not null default 0,
  added_on date not null default current_date,
  removed_on date
);

create index if not exists program_items_program_idx on public.program_items (program_id);
alter table public.program_items enable row level security;

create policy program_items_select on public.program_items
  for select to authenticated
  using (
    exists (
      select 1 from public.programs p
       where p.id = program_items.program_id
         and public.is_hep_staff(p.clinic_id)
    )
  );

-- 5. Patient access token & lockout state (one row per patient)
create table if not exists public.patient_hep_access (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  token text not null unique default public.generate_url_safe_token(),
  pin_hash text,
  link_revoked_at timestamptz,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Remembered phones (owner decision 2026-11-12, option C): after a correct PIN the patient's phone can be remembered
-- for 30 days of use. Only a hash of the random device token is stored. No policies: the definer functions only.
create table if not exists public.hep_device_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists hep_device_sessions_patient_idx on public.hep_device_sessions (patient_id);
alter table public.hep_device_sessions enable row level security;

alter table public.patient_hep_access enable row level security;

create policy patient_hep_access_select on public.patient_hep_access
  for select to authenticated
  using (public.is_hep_staff(clinic_id));

-- Staff may read the link state (so the chart can show "sharing on, opened today") but never the PIN hash: a bcrypt
-- hash of a 4-digit PIN can be guessed offline in seconds, which would let any staff member recover a patient's PIN.
-- Clients therefore list columns explicitly (no select *). The remembered-phone table has no client access at all.
revoke select on public.patient_hep_access from anon, authenticated;
-- (the column grant for authenticated follows the open_count / last_opened_at columns, in section 6b)
revoke all on public.hep_device_sessions from anon, authenticated;

-- 6. Session logs (one row per item per calendar day per session_index)
create table if not exists public.program_logs (
  id uuid primary key default gen_random_uuid(),
  program_item_id uuid not null references public.program_items(id) on delete cascade,
  log_date date not null,
  session_index smallint not null check (session_index between 1 and 3),
  skipped boolean not null default false,
  completed_at timestamptz not null default now(),
  unique (program_item_id, log_date, session_index)
);

alter table public.program_logs enable row level security;

create policy program_logs_select on public.program_logs
  for select to authenticated
  using (
    exists (
      select 1
        from public.program_items pi
        join public.programs p on p.id = pi.program_id
       where pi.id = program_logs.program_item_id
         and public.is_hep_staff(p.clinic_id)
    )
  );

-- 6b. Slice 1 columns and tables (review rounds 2 and 3, 2026-11-12/13; amendments 18, 28, 31 to 33, 44, 53, 55)
-- Exercise kind (amendment 62) lives in the create table statements above: dose_type, reps (smallint),
-- hold_seconds, duration_seconds, rest_seconds and media_captions (default_* names on exercises), with a shape check.
-- save_exercise and every item RPC (save_template, create_program, update_program, copy_template_to_program,
-- save_program_as_template, duplicate_*) copy them, and equipment, in sections 7 to 11 below.

alter table public.programs
  add column if not exists duration_days smallint check (duration_days is null or duration_days between 1 and 90),
  add column if not exists target_pct smallint not null default 70 check (target_pct between 1 and 100),
  add column if not exists checkin_on date,
  add column if not exists pain_reviewed_through timestamptz,
  add column if not exists feedback_default text not null default 'pain' check (feedback_default in ('pain', 'effort')),
  add column if not exists sessions_per_day smallint not null default 1 check (sessions_per_day between 1 and 3),
  add column if not exists first_opened_at timestamptz;
-- create_program and update_program write these from their p_settings jsonb argument (sections 9 and 10).

alter table public.program_logs
  add column if not exists skip_reason text
    check (skip_reason is null or skip_reason in ('pain', 'no_time', 'too_hard', 'forgot', 'didnt_understand', 'other'));

alter table public.patient_hep_access
  add column if not exists open_count integer not null default 0,
  add column if not exists last_opened_at timestamptz;

-- Staff read the link state through these columns only (never pin_hash); see the revoke in section 5.
grant select (patient_id, clinic_id, token, link_revoked_at, failed_attempts, locked_until, open_count,
              last_opened_at, created_at, updated_at) on public.patient_hep_access to authenticated;

alter table public.message_log drop constraint if exists message_log_kind_check;
alter table public.message_log add constraint message_log_kind_check check (kind in (
  'feedback_request', 'booking_confirmation', 'therapist_notify',
  'google_review', 'reminder_stale_package', 'reminder_single_visit',
  'payment_reminder', 'hep_reminder'
));
-- (copy the list from the newest migration that sets message_log_kind_check before applying; it was
--  20260918210000_payment_reminder_message_kind.sql when this plan was written)

create table if not exists public.program_session_feedback (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  log_date date not null,
  session_index smallint not null check (session_index between 1 and 3),
  pain_score smallint check (pain_score is null or pain_score between 0 and 10),
  effort_score smallint check (effort_score is null or effort_score between 0 and 10),
  pain_item_ids uuid[] not null default '{}'::uuid[],
  hard_item_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  check (pain_score is not null or effort_score is not null),
  unique (program_id, log_date, session_index)
);
create index if not exists program_session_feedback_pain_idx
  on public.program_session_feedback (program_id, created_at) where pain_score >= 7;

alter table public.program_session_feedback enable row level security;

create policy program_session_feedback_select on public.program_session_feedback
  for select to authenticated
  using (
    exists (
      select 1 from public.programs p
       where p.id = program_session_feedback.program_id
         and public.is_hep_staff(p.clinic_id)
    )
  );

-- 7. RPC: save_exercise (create or update; enforces 10-exercise Lite cap on new inserts)
create or replace function public.save_exercise(
  p_clinic_id uuid,
  p_id uuid default null,
  p_title text default '',
  p_body_region text default 'General',
  p_phase text default 'other',
  p_also_regions text[] default '{}'::text[],
  p_equipment text[] default '{}'::text[],
  p_instructions text default '',
  p_media_type text default 'none',
  p_media_keys text[] default '{}'::text[],
  p_default_sets smallint default 3,
  p_default_reps smallint default 10,
  p_default_hold_seconds smallint default null,
  p_default_sessions_per_day smallint default 1,
  p_side text default 'none',
  p_stop_if text default '',
  p_deleted boolean default false,
  p_dose_type text default 'reps',
  p_default_duration_seconds smallint default null,
  p_default_rest_seconds smallint default 30,
  p_media_captions text[] default '{}'::text[],
  p_active boolean default true,
  p_other_names text[] default '{}'::text[],
  p_thumb_key text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count int;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_exists boolean;
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;

  -- Pictures must sit inside this clinic's own prefix (the hep-media function also checks this before it signs anything).
  if exists (
       select 1 from unnest(coalesce(p_media_keys, '{}'::text[]) || coalesce(array[p_thumb_key], '{}'::text[])) k
        where k is not null and (k not like 'clinics/' || p_clinic_id::text || '/exercises/%' or position('..' in k) > 0)
     ) then
    raise exception 'Picture does not belong to this clinic.';
  end if;

  select exists (select 1 from public.exercises where id = v_id and clinic_id = p_clinic_id)
    into v_exists;

  if not v_exists and not p_deleted then
    if not public.clinic_has_unlimited_hep(p_clinic_id) then
      select count(*) into v_count
        from public.exercises
       where clinic_id = p_clinic_id and not deleted;
      if v_count >= (select l.exercises from public.hep_tier_limits('lite') l) then
        raise exception 'You have reached the free-plan limit of % exercises. Visit theranet.in to upgrade.',
          (select l.exercises from public.hep_tier_limits('lite') l);
      end if;
    end if;

    insert into public.exercises (
      id, clinic_id, title, body_region, phase, also_regions, equipment, instructions, media_type, media_keys,
      default_sets, default_reps, default_hold_seconds, default_sessions_per_day,
      side, stop_if, deleted,
      dose_type, default_duration_seconds, default_rest_seconds, media_captions, active, other_names, thumb_key
    ) values (
      v_id, p_clinic_id, btrim(p_title), btrim(p_body_region), coalesce(nullif(btrim(p_phase), ''), 'other'), coalesce(p_also_regions, '{}'::text[]), coalesce(p_equipment, '{}'::text[]), coalesce(p_instructions, ''),
      p_media_type, coalesce(p_media_keys, '{}'::text[]),
      p_default_sets, p_default_reps, p_default_hold_seconds, p_default_sessions_per_day,
      p_side, coalesce(p_stop_if, ''), false,
      coalesce(nullif(btrim(p_dose_type), ''), 'reps'), p_default_duration_seconds,
      coalesce(p_default_rest_seconds, 30), coalesce(p_media_captions, '{}'::text[]), coalesce(p_active, true), coalesce(p_other_names, '{}'::text[]), p_thumb_key
    );
  else
    update public.exercises
       set title = btrim(p_title),
           body_region = btrim(p_body_region),
           phase = coalesce(nullif(btrim(p_phase), ''), 'other'),
           also_regions = coalesce(p_also_regions, '{}'::text[]),
           equipment = coalesce(p_equipment, '{}'::text[]),
           instructions = coalesce(p_instructions, ''),
           media_type = p_media_type,
           media_keys = coalesce(p_media_keys, '{}'::text[]),
           default_sets = p_default_sets,
           default_reps = p_default_reps,
           default_hold_seconds = p_default_hold_seconds,
           default_sessions_per_day = p_default_sessions_per_day,
           side = p_side,
           stop_if = coalesce(p_stop_if, ''),
           deleted = coalesce(p_deleted, false),
           dose_type = coalesce(nullif(btrim(p_dose_type), ''), 'reps'),
           default_duration_seconds = p_default_duration_seconds,
           default_rest_seconds = coalesce(p_default_rest_seconds, 30),
           media_captions = coalesce(p_media_captions, '{}'::text[]),
           active = coalesce(p_active, true),          -- false = archived (amendment 74)
           other_names = coalesce(p_other_names, '{}'::text[]),
           thumb_key = p_thumb_key,
           version = version + 1,
           updated_at = now()
     where id = v_id and clinic_id = p_clinic_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text) from public, anon;
grant execute on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text) to authenticated;

-- 8. RPC: save_template (snapshots items into exercise_template_items)
create or replace function public.save_template(
  p_clinic_id uuid,
  p_template_id uuid default null,
  p_title text default '',
  p_items jsonb default '[]'::jsonb,
  p_deleted boolean default false,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := coalesce(p_template_id, gen_random_uuid());
  v_exists boolean;
  v_item jsonb;
  v_idx smallint := 0;
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;

  if not public.hep_item_keys_ok(p_clinic_id, p_items) then
    raise exception 'Picture does not belong to this clinic.';
  end if;

  select exists (select 1 from public.exercise_templates where id = v_id and clinic_id = p_clinic_id)
    into v_exists;

  if not v_exists then
    insert into public.exercise_templates (id, clinic_id, title, note, deleted)
    values (v_id, p_clinic_id, btrim(p_title), nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_deleted, false));
  else
    update public.exercise_templates
       set title = btrim(p_title),
           note = nullif(btrim(coalesce(p_note, '')), ''),
           deleted = coalesce(p_deleted, false),
           updated_at = now()
     where id = v_id and clinic_id = p_clinic_id;
    delete from public.exercise_template_items where template_id = v_id;
  end if;

  if not coalesce(p_deleted, false) then
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      insert into public.exercise_template_items (
        template_id, source_exercise_id, title, body_region, phase, instructions,
        media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
        side, stop_if, sort_order,
        equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
      ) values (
        v_id,
        nullif(v_item->>'sourceExerciseId', '')::uuid,
        btrim(coalesce(v_item->>'title', '')),
        coalesce(nullif(btrim(v_item->>'bodyRegion'), ''), 'General'),
        coalesce(nullif(btrim(v_item->>'phase'), ''), 'other'),
        coalesce(v_item->>'instructions', ''),
        coalesce(v_item->>'mediaType', 'none'),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaKeys', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'sets')::smallint, 3),
        nullif(v_item->>'reps', '')::smallint,
        nullif(v_item->>'holdSeconds', '')::smallint,
        coalesce((v_item->>'sessionsPerDay')::smallint, 1),
        coalesce(v_item->>'side', 'none'),
        coalesce(v_item->>'stopIf', ''),
        v_idx,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'equipment', '[]'::jsonb))), '{}'::text[]),
        coalesce(nullif(v_item->>'doseType', ''), 'reps'),
        nullif(v_item->>'durationSeconds', '')::smallint,
        coalesce(nullif(v_item->>'restSeconds', '')::smallint, 30),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaCaptions', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'optional')::boolean, false)
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_template(uuid, uuid, text, jsonb, boolean, text) from public, anon;
grant execute on function public.save_template(uuid, uuid, text, jsonb, boolean, text) to authenticated;

-- 9. RPC: create_program (enforces 5-active-program Lite cap, reuses existing patient by 10-digit phone, snapshots items, upserts patient_hep_access)
create or replace function public.create_program(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_therapist_id uuid default null,
  p_title text default '',
  p_items jsonb default '[]'::jsonb,
  p_custom_pin text default null,
  p_source_template_id uuid default null,
  p_today date default null,                    -- null = the clinic's own today (not the server's UTC date)
  p_settings jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_active_count int;
  v_resolved_patient_id uuid := p_patient_id;
  v_pin text;
  v_needs_pin boolean;
  v_revoked boolean;
  v_program_id uuid := gen_random_uuid();
  v_token text;
  v_item jsonb;
  v_idx smallint := 0;
  v_spd smallint;
  v_today date;
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;
  v_today := coalesce(p_today, platform_admin.clinic_today(p_clinic_id));

  if p_therapist_id is not null
     and not exists (select 1 from public.therapists t where t.id = p_therapist_id and t.clinic_id = p_clinic_id) then
    raise exception 'Therapist does not belong to this clinic.';
  end if;
  if not public.hep_item_keys_ok(p_clinic_id, p_items) then
    raise exception 'Picture does not belong to this clinic.';
  end if;

  -- Prescribing never creates a patient: the patient must already exist in this clinic (Add patient sheet first).
  if not exists (
    select 1 from public.patients
     where id = v_resolved_patient_id
       and clinic_id = p_clinic_id
       and deleted_at is null
  ) then
    raise exception 'Patient does not belong to this clinic.';
  end if;

  if not public.clinic_has_unlimited_hep(p_clinic_id) then
    select count(*) into v_active_count
      from public.programs
     where clinic_id = p_clinic_id and status = 'active';
    if v_active_count >= (select l.active_programs from public.hep_tier_limits('lite') l) then
      raise exception 'You have reached the free-plan limit of % active programs. Visit theranet.in to upgrade.',
        (select l.active_programs from public.hep_tier_limits('lite') l);
    end if;
  end if;

  -- Program settings (amendments 31, 33, 53). Keys are optional: durationDays (null = ongoing, absent = 7),
  -- targetPct (default 70), checkinDays (null = none, absent = 7), feedbackDefault ('pain' | 'effort'),
  -- sessionsPerDay (the program's times a day, default 1; items may override, amendment 68).
  insert into public.programs (
    id, clinic_id, patient_id, therapist_id, source_template_id, title, status, start_date,
    duration_days, target_pct, checkin_on, feedback_default, sessions_per_day
  ) values (
    v_program_id, p_clinic_id, v_resolved_patient_id, p_therapist_id, p_source_template_id,
    btrim(p_title), 'active', v_today,
    case when coalesce(p_settings, '{}'::jsonb) ? 'durationDays' then nullif(p_settings->>'durationDays', '')::smallint else 7 end,
    coalesce(nullif(p_settings->>'targetPct', '')::smallint, 70),
    v_today + case when coalesce(p_settings, '{}'::jsonb) ? 'checkinDays'
      then nullif(p_settings->>'checkinDays', '')::int else 7 end,
    coalesce(nullif(p_settings->>'feedbackDefault', ''), 'pain'),
    coalesce(nullif(p_settings->>'sessionsPerDay', '')::smallint, 1)
  );

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_spd := coalesce((v_item->>'sessionsPerDay')::smallint, 1);
    insert into public.program_items (
      program_id, source_exercise_id, title, body_region, phase, instructions,
      media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
      sessions_schedule, side, stop_if, special_instructions, sort_order, added_on,
      equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
    ) values (
      v_program_id,
      nullif(v_item->>'sourceExerciseId', '')::uuid,
      btrim(coalesce(v_item->>'title', '')),
      coalesce(nullif(btrim(v_item->>'bodyRegion'), ''), 'General'),
      coalesce(nullif(btrim(v_item->>'phase'), ''), 'other'),
      coalesce(v_item->>'instructions', ''),
      coalesce(v_item->>'mediaType', 'none'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaKeys', '[]'::jsonb))), '{}'::text[]),
      coalesce((v_item->>'sets')::smallint, 3),
      nullif(v_item->>'reps', '')::smallint,
      nullif(v_item->>'holdSeconds', '')::smallint,
      v_spd,
      jsonb_build_array(jsonb_build_object('from', v_today::text, 'sessionsPerDay', v_spd)),
      coalesce(v_item->>'side', 'none'),
      coalesce(v_item->>'stopIf', ''),
      coalesce(v_item->>'specialInstructions', ''),
      v_idx,
      v_today,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'equipment', '[]'::jsonb))), '{}'::text[]),
      coalesce(nullif(v_item->>'doseType', ''), 'reps'),
      nullif(v_item->>'durationSeconds', '')::smallint,
      coalesce(nullif(v_item->>'restSeconds', '')::smallint, 30),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaCaptions', '[]'::jsonb))), '{}'::text[]),
      coalesce((v_item->>'optional')::boolean, false)
    );
    v_idx := v_idx + 1;
  end loop;

  -- PIN: the therapist's own 4 digits, else a random one the first time this patient gets a link. Stored hashed,
  -- returned once as 'pin' (null when the patient already has one) so the therapist can pass it on, never by WhatsApp.
  if p_custom_pin is not null and btrim(p_custom_pin) <> '' then
    if btrim(p_custom_pin) !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits.';
    end if;
    v_pin := btrim(p_custom_pin);
  end if;

  insert into public.patient_hep_access (patient_id, clinic_id)
  values (v_resolved_patient_id, p_clinic_id)
  on conflict (patient_id) do nothing;

  select (pin_hash is null), (link_revoked_at is not null) into v_needs_pin, v_revoked
    from public.patient_hep_access where patient_id = v_resolved_patient_id
     for update;

  -- A revoked link never comes back to life: prescribing again issues a new link (the old one stays dead), forgets
  -- remembered phones and needs a new PIN, because whoever had the old link may also know the old PIN.
  if v_revoked then
    update public.patient_hep_access
       set token = public.generate_url_safe_token(),
           link_revoked_at = null,
           failed_attempts = 0, locked_until = null,
           updated_at = now()
     where patient_id = v_resolved_patient_id;
    delete from public.hep_device_sessions where patient_id = v_resolved_patient_id;
    v_needs_pin := true;
  end if;

  if v_pin is null and v_needs_pin then
    v_pin := lpad(((get_byte(extensions.gen_random_bytes(2), 0) * 256 + get_byte(extensions.gen_random_bytes(2), 1)) % 10000)::text, 4, '0');
  end if;
  if v_pin is not null then
    update public.patient_hep_access
       set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
           failed_attempts = 0, locked_until = null,
           updated_at = now()
     where patient_id = v_resolved_patient_id;
  end if;

  select token into v_token from public.patient_hep_access where patient_id = v_resolved_patient_id;

  return jsonb_build_object('programId', v_program_id, 'patientId', v_resolved_patient_id, 'token', v_token, 'pin', v_pin);
end;
$$;

revoke all on function public.create_program(uuid, uuid, uuid, text, jsonb, text, uuid, date, jsonb) from public, anon;
grant execute on function public.create_program(uuid, uuid, uuid, text, jsonb, text, uuid, date, jsonb) to authenticated;

-- 10. RPC: update_program (keeps sessions_per_day column at today's number while scheduling tomorrow; soft-removes removed items)
create or replace function public.update_program(
  p_program_id uuid,
  p_title text,
  p_status text,
  p_items jsonb,
  p_custom_pin text default null,
  p_today date default null,                    -- null = the clinic's own today
  p_settings jsonb default null
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prog public.programs;
  v_active_count int;
  v_item jsonb;
  v_item_id uuid;
  v_existing public.program_items;
  v_kept_ids uuid[] := '{}'::uuid[];
  v_idx smallint := 0;
  v_new_spd smallint;
  v_today_spd smallint;
  v_sched jsonb;
  v_today date;
  v_today_str text;
  v_tomorrow text;
begin
  select * into v_prog from public.programs where id = p_program_id for update;
  if not found then
    raise exception 'Program not found.';
  end if;
  if not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;
  if not public.hep_item_keys_ok(v_prog.clinic_id, p_items) then
    raise exception 'Picture does not belong to this clinic.';
  end if;
  v_today := coalesce(p_today, platform_admin.clinic_today(v_prog.clinic_id));
  v_today_str := v_today::text;
  v_tomorrow := (v_today + 1)::text;

  if p_status = 'active' and v_prog.status <> 'active' then
    if not public.clinic_has_unlimited_hep(v_prog.clinic_id) then
      select count(*) into v_active_count
        from public.programs
       where clinic_id = v_prog.clinic_id and status = 'active' and id <> p_program_id;
      if v_active_count >= (select l.active_programs from public.hep_tier_limits('lite') l) then
        raise exception 'You have reached the free-plan limit of % active programs. Visit theranet.in to upgrade.',
          (select l.active_programs from public.hep_tier_limits('lite') l);
      end if;
    end if;
  end if;

  update public.programs
     set title = btrim(p_title),
         status = p_status,
         duration_days = case when p_settings ? 'durationDays'
                              then nullif(p_settings->>'durationDays', '')::smallint else duration_days end,
         target_pct = coalesce(nullif(p_settings->>'targetPct', '')::smallint, target_pct),
         checkin_on = case when p_settings ? 'checkinOn'
                           then nullif(p_settings->>'checkinOn', '')::date else checkin_on end,
         feedback_default = coalesce(nullif(p_settings->>'feedbackDefault', ''), feedback_default),
         sessions_per_day = coalesce(nullif(p_settings->>'sessionsPerDay', '')::smallint, sessions_per_day),
         updated_at = now()
   where id = p_program_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item_id := nullif(v_item->>'id', '')::uuid;
    v_new_spd := coalesce((v_item->>'sessionsPerDay')::smallint, 1);

    if v_item_id is not null then
      select * into v_existing
        from public.program_items
       where id = v_item_id and program_id = p_program_id;
    else
      v_existing := null;
    end if;

    if v_existing.id is not null then
      -- Resolve today's effective sessions_per_day from existing schedule so today's column never jumps to tomorrow's value
      select coalesce(
        (
          select (e->>'sessionsPerDay')::smallint
            from jsonb_array_elements(coalesce(v_existing.sessions_schedule, '[]'::jsonb)) with ordinality as t(e, ord)
           where (e->>'from') <= v_today_str
           order by (e->>'from') desc, ord desc
           limit 1
        ),
        v_existing.sessions_per_day
      ) into v_today_spd;

      -- Strip any previous entry for tomorrow before appending the new tomorrow target, and sort chronologically
      select coalesce(
        jsonb_agg(e order by (e->>'from') asc, ord asc),
        jsonb_build_array(jsonb_build_object('from', v_existing.added_on::text, 'sessionsPerDay', v_today_spd))
      )
      into v_sched
      from jsonb_array_elements(coalesce(v_existing.sessions_schedule, '[]'::jsonb)) with ordinality as t(e, ord)
      where (e->>'from') <> v_tomorrow;

      if v_new_spd <> v_today_spd then
        v_sched := v_sched || jsonb_build_array(
          jsonb_build_object('from', v_tomorrow, 'sessionsPerDay', v_new_spd)
        );
      end if;

      update public.program_items
         set title = btrim(coalesce(v_item->>'title', v_existing.title)),
             instructions = coalesce(v_item->>'instructions', v_existing.instructions),
             sets = coalesce((v_item->>'sets')::smallint, v_existing.sets),
             dose_type = coalesce(nullif(v_item->>'doseType', ''), v_existing.dose_type),
             reps = nullif(v_item->>'reps', '')::smallint,          -- the client always sends the whole item
             hold_seconds = nullif(v_item->>'holdSeconds', '')::smallint,
             duration_seconds = nullif(v_item->>'durationSeconds', '')::smallint,
             rest_seconds = coalesce(nullif(v_item->>'restSeconds', '')::smallint, v_existing.rest_seconds),
             equipment = case when v_item ? 'equipment'
                              then coalesce(array(select jsonb_array_elements_text(v_item->'equipment')), '{}'::text[])
                              else v_existing.equipment end,
             optional = coalesce((v_item->>'optional')::boolean, v_existing.optional),
             media_captions = case when v_item ? 'mediaCaptions'
                              then coalesce(array(select jsonb_array_elements_text(v_item->'mediaCaptions')), '{}'::text[])
                              else v_existing.media_captions end,
             sessions_per_day = v_today_spd,
             sessions_schedule = v_sched,
             side = coalesce(v_item->>'side', v_existing.side),
             stop_if = coalesce(v_item->>'stopIf', v_existing.stop_if),
             special_instructions = coalesce(v_item->>'specialInstructions', v_existing.special_instructions),
             sort_order = v_idx,
             removed_on = null
       where id = v_existing.id;

      v_kept_ids := array_append(v_kept_ids, v_existing.id);
    else
      v_item_id := gen_random_uuid();
      insert into public.program_items (
        id, program_id, source_exercise_id, title, body_region, phase, instructions,
        media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
        sessions_schedule, side, stop_if, special_instructions, sort_order, added_on,
        equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
      ) values (
        v_item_id,
        p_program_id,
        nullif(v_item->>'sourceExerciseId', '')::uuid,
        btrim(coalesce(v_item->>'title', '')),
        coalesce(nullif(btrim(v_item->>'bodyRegion'), ''), 'General'),
        coalesce(nullif(btrim(v_item->>'phase'), ''), 'other'),
        coalesce(v_item->>'instructions', ''),
        coalesce(v_item->>'mediaType', 'none'),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaKeys', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'sets')::smallint, 3),
        nullif(v_item->>'reps', '')::smallint,
        nullif(v_item->>'holdSeconds', '')::smallint,
        v_new_spd,
        jsonb_build_array(jsonb_build_object('from', v_today::text, 'sessionsPerDay', v_new_spd)),
        coalesce(v_item->>'side', 'none'),
        coalesce(v_item->>'stopIf', ''),
        coalesce(v_item->>'specialInstructions', ''),
        v_idx,
        v_today,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'equipment', '[]'::jsonb))), '{}'::text[]),
        coalesce(nullif(v_item->>'doseType', ''), 'reps'),
        nullif(v_item->>'durationSeconds', '')::smallint,
        coalesce(nullif(v_item->>'restSeconds', '')::smallint, 30),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'mediaCaptions', '[]'::jsonb))), '{}'::text[]),
        coalesce((v_item->>'optional')::boolean, false)
      );
      v_kept_ids := array_append(v_kept_ids, v_item_id);
    end if;

    v_idx := v_idx + 1;
  end loop;

  -- Soft-remove items omitted from the updated list so past logs stay intact
  update public.program_items
     set removed_on = v_today
   where program_id = p_program_id
     and removed_on is null
     and not (id = any(v_kept_ids));

  -- p_custom_pin = null or '' -> leave the PIN unchanged (use reset_hep_pin for a new random one).
  if p_custom_pin is not null and btrim(p_custom_pin) <> '' then
    if btrim(p_custom_pin) !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits.';
    end if;
    update public.patient_hep_access
       set pin_hash = extensions.crypt(btrim(p_custom_pin), extensions.gen_salt('bf')),
           failed_attempts = 0, locked_until = null,
           updated_at = now()
     where patient_id = v_prog.patient_id;
  end if;
end;
$$;

revoke all on function public.update_program(uuid, text, text, jsonb, text, date, jsonb) from public, anon;
grant execute on function public.update_program(uuid, text, text, jsonb, text, date, jsonb) to authenticated;

-- 11. RPCs: copy_template_to_program & save_program_as_template
create or replace function public.copy_template_to_program(
  p_template_id uuid,
  p_patient_id uuid,
  p_therapist_id uuid default null,
  p_custom_pin text default null,
  p_today date default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tmpl public.exercise_templates;
  v_items jsonb;
begin
  select * into v_tmpl from public.exercise_templates where id = p_template_id and not deleted;
  if not found or not public.is_hep_staff(v_tmpl.clinic_id) then
    raise exception 'Template not found.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceExerciseId', ti.source_exercise_id,
        'title', ti.title,
        'bodyRegion', ti.body_region,
        'phase', ti.phase,
        'instructions', ti.instructions,
        'mediaType', ti.media_type,
        'mediaKeys', to_jsonb(ti.media_keys),
        'sets', ti.sets,
        'doseType', ti.dose_type,
        'reps', ti.reps,
        'holdSeconds', ti.hold_seconds,
        'durationSeconds', ti.duration_seconds,
        'restSeconds', ti.rest_seconds,
        'equipment', to_jsonb(ti.equipment),
        'mediaCaptions', to_jsonb(ti.media_captions),
        'optional', ti.optional,
        'sessionsPerDay', ti.sessions_per_day,
        'side', ti.side,
        'stopIf', ti.stop_if
      ) order by ti.sort_order
    ),
    '[]'::jsonb
  ) into v_items
  from public.exercise_template_items ti
  where ti.template_id = p_template_id;

  return public.create_program(
    v_tmpl.clinic_id,
    p_patient_id,
    p_therapist_id,
    v_tmpl.title,
    v_items,
    p_custom_pin,
    p_template_id,
    p_today
  );
end;
$$;

revoke all on function public.copy_template_to_program(uuid, uuid, uuid, text, date) from public, anon;
grant execute on function public.copy_template_to_program(uuid, uuid, uuid, text, date) to authenticated;

create or replace function public.save_program_as_template(
  p_program_id uuid,
  p_title text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prog public.programs;
  v_items jsonb;
begin
  select * into v_prog from public.programs where id = p_program_id;
  if not found or not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Program not found.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceExerciseId', pi.source_exercise_id,
        'title', pi.title,
        'bodyRegion', pi.body_region,
        'phase', pi.phase,
        'instructions', pi.instructions,
        'mediaType', pi.media_type,
        'mediaKeys', to_jsonb(pi.media_keys),
        'sets', pi.sets,
        'doseType', pi.dose_type,
        'reps', pi.reps,
        'holdSeconds', pi.hold_seconds,
        'durationSeconds', pi.duration_seconds,
        'restSeconds', pi.rest_seconds,
        'equipment', to_jsonb(pi.equipment),
        'mediaCaptions', to_jsonb(pi.media_captions),
        'optional', pi.optional,
        'sessionsPerDay', pi.sessions_per_day,
        'side', pi.side,
        'stopIf', pi.stop_if
      ) order by pi.sort_order
    ),
    '[]'::jsonb
  ) into v_items
  from public.program_items pi
  where pi.program_id = p_program_id and pi.removed_on is null;

  return public.save_template(v_prog.clinic_id, null, p_title, v_items, false);
end;
$$;

revoke all on function public.save_program_as_template(uuid, text) from public, anon;
grant execute on function public.save_program_as_template(uuid, text) to authenticated;

-- Helper: duplicate an existing template
create or replace function public.duplicate_template(
  p_template_id uuid,
  p_new_title text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tmpl public.exercise_templates;
  v_new_id uuid;
  v_title text;
begin
  select * into v_tmpl from public.exercise_templates where id = p_template_id and not deleted;
  if not found or not public.is_hep_staff(v_tmpl.clinic_id) then
    raise exception 'Template not found.';
  end if;

  v_title := coalesce(p_new_title, v_tmpl.title || ' (Copy)');
  v_new_id := gen_random_uuid();

  insert into public.exercise_templates (id, clinic_id, title, note)
  values (v_new_id, v_tmpl.clinic_id, v_title, v_tmpl.note);

  insert into public.exercise_template_items (
    template_id, source_exercise_id, title, body_region, phase, instructions,
    media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
    side, stop_if, sort_order,
    equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
  )
  select v_new_id, source_exercise_id, title, body_region, phase, instructions,
         media_type, media_keys, sets, reps, hold_seconds, sessions_per_day,
         side, stop_if, sort_order,
         equipment, dose_type, duration_seconds, rest_seconds, media_captions, optional
    from public.exercise_template_items
   where template_id = p_template_id;

  return v_new_id;
end;
$$;

revoke all on function public.duplicate_template(uuid, text) from public, anon;
grant execute on function public.duplicate_template(uuid, text) to authenticated;

-- Helper: duplicate an existing program onto a patient
create or replace function public.duplicate_program(
  p_program_id uuid,
  p_new_title text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prog public.programs;
  v_items jsonb;
  v_title text;
begin
  select * into v_prog from public.programs where id = p_program_id;
  if not found or not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Program not found.';
  end if;

  v_title := coalesce(p_new_title, v_prog.title || ' (Copy)');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceExerciseId', pi.source_exercise_id,
        'title', pi.title,
        'bodyRegion', pi.body_region,
        'phase', pi.phase,
        'instructions', pi.instructions,
        'mediaType', pi.media_type,
        'mediaKeys', to_jsonb(pi.media_keys),
        'sets', pi.sets,
        'doseType', pi.dose_type,
        'reps', pi.reps,
        'holdSeconds', pi.hold_seconds,
        'durationSeconds', pi.duration_seconds,
        'restSeconds', pi.rest_seconds,
        'equipment', to_jsonb(pi.equipment),
        'mediaCaptions', to_jsonb(pi.media_captions),
        'optional', pi.optional,
        'sessionsPerDay', pi.sessions_per_day,
        'side', pi.side,
        'stopIf', pi.stop_if
      ) order by pi.sort_order
    ),
    '[]'::jsonb
  ) into v_items
  from public.program_items pi
  where pi.program_id = p_program_id and pi.removed_on is null;

  return public.create_program(
    v_prog.clinic_id,
    v_prog.patient_id,
    v_prog.therapist_id,
    v_title,
    v_items,
    null,                                            -- p_custom_pin: keep the patient's PIN
    v_prog.source_template_id,
    platform_admin.clinic_today(v_prog.clinic_id),   -- the clinic's day, not the server's
    jsonb_build_object(
      'durationDays', v_prog.duration_days,
      'targetPct', v_prog.target_pct,
      'checkinDays', case when v_prog.checkin_on is null then null else v_prog.checkin_on - v_prog.start_date end,
      'feedbackDefault', v_prog.feedback_default,
      'sessionsPerDay', v_prog.sessions_per_day
    )
  );
end;
$$;

revoke all on function public.duplicate_program(uuid, text) from public, anon;
grant execute on function public.duplicate_program(uuid, text) to authenticated;

-- Helper: toggle exercise favorite
create or replace function public.toggle_exercise_favorite(
  p_exercise_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_fav boolean;
  v_clinic_id uuid;
begin
  select clinic_id, coalesce(is_favorite, false) into v_clinic_id, v_fav
    from public.exercises
   where id = p_exercise_id and not deleted;
  if not found or not public.is_hep_staff(v_clinic_id) then
    raise exception 'Exercise not found.';
  end if;

  update public.exercises
     set is_favorite = not v_fav,
         updated_at = now()
   where id = p_exercise_id;

  return not v_fav;
end;
$$;

revoke all on function public.toggle_exercise_favorite(uuid) from public, anon;
grant execute on function public.toggle_exercise_favorite(uuid) to authenticated;

-- 12. Internal PIN check helper (5 wrong attempts lock for 15 minutes; returns patient_id)
create or replace function public.hep_verify(p_token text, p_pin text, p_device text default null)
returns table (patient_id uuid, outcome text, attempts_left int)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_access public.patient_hep_access;
  v_ok boolean;
  v_new smallint;
  v_dev uuid;
begin
  -- Table columns are always qualified (ha., a., d.): the result column patient_id would make a bare
  -- "patient_id" ambiguous and every PIN check would fail.
  -- Never raises: a raise would roll back the failed_attempts update and the lock would never take hold.
  select a.* into v_access
    from public.patient_hep_access a
    join public.patients p on p.id = a.patient_id and p.deleted_at is null
   where a.token = btrim(coalesce(p_token, ''))
     and a.link_revoked_at is null
   for update of a;

  if not found then
    return query select null::uuid, 'unavailable'::text, 0;
    return;
  end if;

  -- A remembered phone skips the PIN (and is never locked out by someone else's wrong guesses). It slides 30 days
  -- from each use, capped at 180 days from when it was created.
  if p_device is not null and btrim(p_device) <> '' then
    select d.id into v_dev
      from public.hep_device_sessions d
     where d.patient_id = v_access.patient_id
       and d.token_hash = encode(extensions.digest(btrim(p_device), 'sha256'), 'hex')
       and d.expires_at > now()
       and d.created_at > now() - interval '180 days';
    if v_dev is not null then
      update public.hep_device_sessions
         set last_used_at = now(), expires_at = now() + interval '30 days'
       where id = v_dev;
      return query select v_access.patient_id, 'ok'::text, 5;
      return;
    end if;
  end if;

  if v_access.locked_until is not null and v_access.locked_until > now() then
    return query select null::uuid, 'locked'::text, 0;
    return;
  end if;

  -- No PIN supplied (an unknown or expired remembered phone): ask for it, and do not count an attempt.
  if p_pin is null or btrim(p_pin) = '' then
    return query select null::uuid, 'pin_needed'::text, 5 - v_access.failed_attempts::int;
    return;
  end if;

  v_ok := v_access.pin_hash is not null
          and btrim(coalesce(p_pin, '')) ~ '^[0-9]{4}$'
          and v_access.pin_hash = extensions.crypt(btrim(p_pin), v_access.pin_hash);

  if not v_ok then
    v_new := v_access.failed_attempts + 1;
    update public.patient_hep_access ha
       set failed_attempts = case when v_new >= 5 then 0 else v_new end,
           locked_until = case when v_new >= 5 then now() + interval '15 minutes' else null end,
           updated_at = now()
     where ha.patient_id = v_access.patient_id;
    if v_new >= 5 then
      return query select null::uuid, 'locked'::text, 0;
    else
      return query select null::uuid, 'wrong_pin'::text, (5 - v_new)::int;
    end if;
    return;
  end if;

  if v_access.failed_attempts > 0 or v_access.locked_until is not null then
    update public.patient_hep_access ha
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where ha.patient_id = v_access.patient_id;
  end if;

  return query select v_access.patient_id, 'ok'::text, 5;
end;
$$;

revoke all on function public.hep_verify(text, text, text) from public, anon, authenticated;

-- Remember this phone: verifies the PIN (counts wrong attempts like any PIN check), then returns a random device
-- token ONCE; only its hash is stored. At most 5 remembered phones per patient (the oldest is dropped).
create or replace function public.hep_remember_device(p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v record;
  v_device text;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_device := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.hep_device_sessions (patient_id, token_hash)
  values (v.patient_id, encode(extensions.digest(v_device, 'sha256'), 'hex'));
  delete from public.hep_device_sessions d
   where d.patient_id = v.patient_id
     and d.id not in (select id from public.hep_device_sessions where patient_id = v.patient_id order by created_at desc limit 5);
  return jsonb_build_object('ok', true, 'device', v_device);
end;
$$;
revoke all on function public.hep_remember_device(text, text) from public;
grant execute on function public.hep_remember_device(text, text) to anon, authenticated;

-- Revoke the shared link (the patient's page stops working) and issue a fresh random PIN on request.
create or replace function public.revoke_hep_link(p_patient_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_clinic uuid;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not a member of this clinic.';
  end if;
  update public.patient_hep_access set link_revoked_at = now(), updated_at = now() where patient_id = p_patient_id;
  delete from public.hep_device_sessions where patient_id = p_patient_id;
end;
$$;
revoke all on function public.revoke_hep_link(uuid) from public, anon;
grant execute on function public.revoke_hep_link(uuid) to authenticated;

create or replace function public.reset_hep_pin(p_patient_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare v_clinic uuid; v_pin text;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not a member of this clinic.';
  end if;
  v_pin := lpad(((get_byte(extensions.gen_random_bytes(2), 0) * 256 + get_byte(extensions.gen_random_bytes(2), 1)) % 10000)::text, 4, '0');
  update public.patient_hep_access
     set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
         failed_attempts = 0, locked_until = null, updated_at = now()
   where patient_id = p_patient_id;
  if not found then
    -- Never hand back a PIN that was not saved.
    raise exception 'This patient has no exercise link yet.';
  end if;
  delete from public.hep_device_sessions where patient_id = p_patient_id;
  return v_pin;
end;
$$;
revoke all on function public.reset_hep_pin(uuid) from public, anon;
grant execute on function public.reset_hep_pin(uuid) to authenticated;

-- 13. Public RPCs (all return jsonb { ok, reason?, attemptsLeft? } and never raise on a bad PIN)

-- Rate limit for the public HEP calls, reusing the app's existing public_rpc_rate_limit table
-- (20260830120000_patient_comms_foundation.sql). Unlike check_public_rpc_rate_limit it never raises (a raise
-- would roll back hep_verify's failed-attempt count). 60 calls a minute per link, 120 per IP. When the caller is
-- the hep-media edge function (service_role), the IP check is skipped here: every patient would share the edge's
-- IP; the edge function checks the real client IP itself by calling hep_rate_ok_ip.
create or replace function public.hep_rate_ok(p_token text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ip text := coalesce(
    nullif(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''),
    'unknown'
  );
  v_tok text := 'hep_tok:' || md5(coalesce(btrim(p_token), ''));
  v_check_ip boolean := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '') <> 'service_role';
  v_n int;
begin
  delete from public.public_rpc_rate_limit where called_at < now() - interval '1 day';

  select count(*) into v_n from public.public_rpc_rate_limit
   where fn_name = v_tok and called_at > now() - interval '60 seconds';
  if v_n >= 60 then return false; end if;

  if v_check_ip then
    select count(*) into v_n from public.public_rpc_rate_limit
     where fn_name = 'hep_public' and client_ip = v_ip and called_at > now() - interval '60 seconds';
    if v_n >= 120 then return false; end if;
    insert into public.public_rpc_rate_limit (fn_name, client_ip) values ('hep_public', v_ip);
  end if;

  insert into public.public_rpc_rate_limit (fn_name, client_ip) values (v_tok, v_ip);
  return true;
end;
$$;
revoke all on function public.hep_rate_ok(text) from public, anon, authenticated;

create or replace function public.hep_rate_ok_ip(p_ip text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_n int;
begin
  select count(*) into v_n from public.public_rpc_rate_limit
   where fn_name = 'hep_public' and client_ip = coalesce(nullif(btrim(p_ip), ''), 'unknown')
     and called_at > now() - interval '60 seconds';
  if v_n >= 120 then return false; end if;
  insert into public.public_rpc_rate_limit (fn_name, client_ip)
  values ('hep_public', coalesce(nullif(btrim(p_ip), ''), 'unknown'));
  return true;
end;
$$;
revoke all on function public.hep_rate_ok_ip(text) from public, anon, authenticated;
grant execute on function public.hep_rate_ok_ip(text) to service_role;

-- Before the PIN: the clinic's name and logo for a valid, non-revoked link (amendment 40). Nothing else.
create or replace function public.hep_clinic_brand(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
  v_logo text;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select c.name, c.logo_path into v_name, v_logo
    from public.patient_hep_access a
    join public.patients p on p.id = a.patient_id and p.deleted_at is null
    join public.clinics c on c.id = a.clinic_id
   where a.token = btrim(coalesce(p_token, ''))
     and a.link_revoked_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;
  return jsonb_build_object('ok', true, 'name', v_name, 'logoPath', v_logo);
end;
$$;
revoke all on function public.hep_clinic_brand(text) from public;
grant execute on function public.hep_clinic_brand(text) to anon, authenticated;

-- The patient page's data. Lists the patient's active programs; returns items, recent logs and today's
-- session checks only for the program being shown (p_program_id, else the newest), so media URLs are minted
-- for that program only (amendment 58). p_reason = 'refresh' for the 13.5-minute media refresh, which does
-- not count as an open (amendment 55).
create or replace function public.get_public_hep(
  p_token text,
  p_pin text,
  p_device text default null,
  p_program_id uuid default null,
  p_reason text default 'open'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_patient_id uuid;
  v_clinic_id uuid;
  v_today date;
  v_clinic jsonb;
  v_programs jsonb;
  v_shown uuid;
  v_items jsonb;
  v_logs jsonb;
  v_feedback jsonb;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_patient_id := v.patient_id;

  select p.clinic_id,
         jsonb_build_object('name', c.name, 'logoPath', c.logo_path, 'phone', c.phone, 'timezone', c.timezone)
    into v_clinic_id, v_clinic
    from public.patients p
    join public.clinics c on c.id = p.clinic_id
   where p.id = v_patient_id;
  v_today := platform_admin.clinic_today(v_clinic_id);

  if coalesce(p_reason, 'open') = 'open' then
    -- The first time the patient's page shows a program (amendment 72: "Opened ✓" and "Link not opened yet").
    update public.programs set first_opened_at = now()
     where patient_id = v_patient_id and status = 'active' and first_opened_at is null
       and id = coalesce(p_program_id, (select p2.id from public.programs p2
                                         where p2.patient_id = v_patient_id and p2.status = 'active'
                                         order by p2.start_date desc, p2.created_at desc limit 1));
    update public.patient_hep_access
       set open_count = open_count + 1, last_opened_at = now()
     where patient_id = v_patient_id
       and (last_opened_at is null or last_opened_at < now() - interval '30 minutes');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', prog.id,
           'title', prog.title,
           'startDate', prog.start_date,
           'durationDays', prog.duration_days,
           'feedbackDefault', prog.feedback_default,
           'prescribedBy', nullif(split_part(btrim(coalesce(t.name, '')), ' ', 1), '')
         ) order by prog.start_date desc, prog.created_at desc), '[]'::jsonb)
    into v_programs
    from public.programs prog
    left join public.therapists t on t.id = prog.therapist_id
   where prog.patient_id = v_patient_id and prog.status = 'active';

  select prog.id into v_shown
    from public.programs prog
   where prog.patient_id = v_patient_id
     and prog.status = 'active'
     and (p_program_id is null or prog.id = p_program_id)
   order by prog.start_date desc, prog.created_at desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pi.id,
           'title', pi.title,
           'phase', pi.phase,
           'equipment', to_jsonb(pi.equipment),
           'instructions', pi.instructions,
           'mediaType', pi.media_type,
           'mediaKeys', to_jsonb(pi.media_keys),
           'sets', pi.sets,
           'reps', pi.reps,
           'doseType', pi.dose_type,
           'durationSeconds', pi.duration_seconds,
           'restSeconds', pi.rest_seconds,
           'mediaCaptions', to_jsonb(pi.media_captions),
           'optional', pi.optional,
           'holdSeconds', pi.hold_seconds,
           'sessionsPerDay', pi.sessions_per_day,
           'sessionsSchedule', pi.sessions_schedule,
           'side', pi.side,
           'stopIf', pi.stop_if,
           'specialInstructions', pi.special_instructions,
           'sortOrder', pi.sort_order,
           'addedOn', pi.added_on
         ) order by pi.sort_order), '[]'::jsonb)
    into v_items
    from public.program_items pi
   where pi.program_id = v_shown and pi.removed_on is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'programItemId', l.program_item_id,
           'logDate', l.log_date,
           'sessionIndex', l.session_index,
           'skipped', l.skipped,
           'skipReason', l.skip_reason,
           'completedAt', l.completed_at
         )), '[]'::jsonb)
    into v_logs
    from public.program_logs l
    join public.program_items pi on pi.id = l.program_item_id
   where pi.program_id = v_shown
     and l.log_date >= v_today - 13;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sessionIndex', f.session_index,
           'pain', f.pain_score,
           'effort', f.effort_score,
           'painItemIds', to_jsonb(f.pain_item_ids),
           'hardItemIds', to_jsonb(f.hard_item_ids)
         )), '[]'::jsonb)
    into v_feedback
    from public.program_session_feedback f
   where f.program_id = v_shown and f.log_date = v_today;

  return jsonb_build_object(
    'ok', true,
    'clinicId', v_clinic_id,
    'today', v_today,
    'clinic', v_clinic,
    'programs', v_programs,
    'shownProgramId', v_shown,
    'items', v_items,
    'logs', v_logs,
    'sessionFeedback', v_feedback
  );
end;
$$;

revoke all on function public.get_public_hep(text, text, text, uuid, text) from public;
grant execute on function public.get_public_hep(text, text, text, uuid, text) to anon, authenticated;

-- Logs one session of one exercise (done or skipped with an optional reason). The client sends the session
-- number it acted on; the server never re-picks it. Clinic day: today or yesterday (Slice 2 widens to 3 days).
create or replace function public.submit_exercise_log(
  p_token text,
  p_pin text,
  p_item_id uuid,
  p_session_index smallint,
  p_log_date date default null,
  p_skipped boolean default false,
  p_skip_reason text default null,
  p_device text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_patient_id uuid;
  v_belongs boolean;
  v_clinic uuid;
  v_today date;
  v_day date;
  v_reason text;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_patient_id := v.patient_id;

  select exists (
    select 1
      from public.program_items pi
      join public.programs prog on prog.id = pi.program_id
     where pi.id = p_item_id
       and prog.patient_id = v_patient_id
       and prog.status = 'active'
       and pi.removed_on is null
       and p_session_index between 1 and pi.sessions_per_day
  ) into v_belongs;
  if not v_belongs then
    return jsonb_build_object('ok', false, 'reason', 'not_in_program');
  end if;

  select p.clinic_id into v_clinic from public.patients p where p.id = v_patient_id;
  v_today := platform_admin.clinic_today(v_clinic);
  v_day := case when p_log_date in (v_today, v_today - 1) then p_log_date else v_today end;
  v_reason := case
    when coalesce(p_skipped, false)
     and p_skip_reason in ('pain', 'no_time', 'too_hard', 'forgot', 'didnt_understand', 'other') then p_skip_reason
    else null
  end;

  insert into public.program_logs (program_item_id, log_date, session_index, skipped, skip_reason, completed_at)
  values (p_item_id, v_day, p_session_index, coalesce(p_skipped, false), v_reason, now())
  on conflict (program_item_id, log_date, session_index) do update
    set skipped = excluded.skipped,
        skip_reason = excluded.skip_reason,
        completed_at = now();
  return jsonb_build_object('ok', true, 'logDate', v_day);
end;
$$;

revoke all on function public.submit_exercise_log(text, text, uuid, smallint, date, boolean, text, text) from public;
grant execute on function public.submit_exercise_log(text, text, uuid, smallint, date, boolean, text, text) to anon, authenticated;

-- Undo: removes that day's log for that session (done or skipped), so "Undo" works after Mark as done too.
create or replace function public.undo_exercise_skip(
  p_token text,
  p_pin text,
  p_item_id uuid,
  p_session_index smallint,
  p_log_date date default null,
  p_device text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_patient_id uuid;
  v_clinic uuid;
  v_today date;
  v_day date;
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;
  v_patient_id := v.patient_id;

  if not exists (
    select 1
      from public.program_items pi
      join public.programs prog on prog.id = pi.program_id
     where pi.id = p_item_id and prog.patient_id = v_patient_id and prog.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_in_program');
  end if;

  select p.clinic_id into v_clinic from public.patients p where p.id = v_patient_id;
  v_today := platform_admin.clinic_today(v_clinic);
  v_day := case when p_log_date in (v_today, v_today - 1) then p_log_date else v_today end;

  delete from public.program_logs
   where program_item_id = p_item_id
     and log_date = v_day
     and session_index = p_session_index;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.undo_exercise_skip(text, text, uuid, smallint, date, text) from public;
grant execute on function public.undo_exercise_skip(text, text, uuid, smallint, date, text) to anon, authenticated;

-- End-of-session Pain | Effort check (amendment 53). Replaces earlier answers for the same session.
-- Marked exercises are filtered to the program's own items.
create or replace function public.submit_hep_session_feedback(
  p_token text,
  p_pin text,
  p_program_id uuid,
  p_session_index smallint,
  p_log_date date default null,
  p_pain smallint default null,
  p_effort smallint default null,
  p_pain_items uuid[] default '{}'::uuid[],
  p_hard_items uuid[] default '{}'::uuid[],
  p_device text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform_admin
as $$
declare
  v record;
  v_clinic uuid;
  v_today date;
  v_day date;
  v_pain_items uuid[];
  v_hard_items uuid[];
begin
  if not public.hep_rate_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  select * into v from public.hep_verify(p_token, p_pin, p_device);
  if v.outcome <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v.outcome, 'attemptsLeft', v.attempts_left);
  end if;

  select prog.clinic_id into v_clinic
    from public.programs prog
   where prog.id = p_program_id and prog.patient_id = v.patient_id and prog.status = 'active';
  if v_clinic is null then
    return jsonb_build_object('ok', false, 'reason', 'not_in_program');
  end if;
  if (p_pain is null and p_effort is null)
     or (p_pain is not null and p_pain not between 0 and 10)
     or (p_effort is not null and p_effort not between 0 and 10)
     or p_session_index not between 1 and 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  v_today := platform_admin.clinic_today(v_clinic);
  v_day := case when p_log_date in (v_today, v_today - 1) then p_log_date else v_today end;

  select coalesce(array_agg(pi.id), '{}'::uuid[]) into v_pain_items
    from public.program_items pi
   where pi.program_id = p_program_id and pi.id = any(coalesce(p_pain_items, '{}'::uuid[]));
  select coalesce(array_agg(pi.id), '{}'::uuid[]) into v_hard_items
    from public.program_items pi
   where pi.program_id = p_program_id and pi.id = any(coalesce(p_hard_items, '{}'::uuid[]));

  insert into public.program_session_feedback (
    program_id, log_date, session_index, pain_score, effort_score, pain_item_ids, hard_item_ids
  ) values (
    p_program_id, v_day, p_session_index, p_pain, p_effort,
    case when p_pain is null then '{}'::uuid[] else v_pain_items end,
    case when p_effort is null then '{}'::uuid[] else v_hard_items end
  )
  on conflict (program_id, log_date, session_index) do update
    set pain_score = excluded.pain_score,
        effort_score = excluded.effort_score,
        pain_item_ids = excluded.pain_item_ids,
        hard_item_ids = excluded.hard_item_ids,
        created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_hep_session_feedback(text, text, uuid, smallint, date, smallint, smallint, uuid[], uuid[], text) from public;
grant execute on function public.submit_hep_session_feedback(text, text, uuid, smallint, date, smallint, smallint, uuid[], uuid[], text) to anon, authenticated;

-- Hand-over panel (amendment 72): is the patient's page open yet? Polled every 5 s while the panel is open.
create or replace function public.hep_link_status(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_clinic uuid; v jsonb;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not authorized.';
  end if;
  select jsonb_build_object(
           'firstOpenedAt', (select max(first_opened_at) from public.programs where patient_id = p_patient_id and status = 'active'),
           'lastOpenedAt', a.last_opened_at,
           'openCount', a.open_count,
           'linkRevoked', a.link_revoked_at is not null)
    into v
    from public.patient_hep_access a where a.patient_id = p_patient_id;
  return coalesce(v, jsonb_build_object('openCount', 0));
end;
$$;
revoke all on function public.hep_link_status(uuid) from public, anon;
grant execute on function public.hep_link_status(uuid) to authenticated;

-- Pause, resume or complete a program without touching its exercises (update_program would soft-remove any item
-- not listed in p_items). Reactivating counts toward the Lite active-program cap, like update_program.
create or replace function public.set_program_status(p_program_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prog public.programs;
  v_active_count int;
begin
  if p_status is null or p_status not in ('active', 'paused', 'completed') then
    raise exception 'Unknown status.';
  end if;
  select * into v_prog from public.programs where id = p_program_id for update;
  if not found or not public.is_hep_staff(v_prog.clinic_id) then
    raise exception 'Program not found.';
  end if;
  if p_status = 'active' and v_prog.status <> 'active' and not public.clinic_has_unlimited_hep(v_prog.clinic_id) then
    select count(*) into v_active_count from public.programs
     where clinic_id = v_prog.clinic_id and status = 'active' and id <> p_program_id;
    if v_active_count >= (select l.active_programs from public.hep_tier_limits('lite') l) then
      raise exception 'You have reached the free-plan limit of % active programs. Visit theranet.in to upgrade.',
        (select l.active_programs from public.hep_tier_limits('lite') l);
    end if;
  end if;
  update public.programs set status = p_status, updated_at = now() where id = p_program_id;
end;
$$;
revoke all on function public.set_program_status(uuid, text) from public, anon;
grant execute on function public.set_program_status(uuid, text) to authenticated;

-- Extend a program by 1 to 90 days (Extend on an ended program). An ongoing program has no end to extend.
create or replace function public.extend_program(p_program_id uuid, p_extra_days int)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_clinic uuid;
begin
  if p_extra_days is null or p_extra_days < 1 or p_extra_days > 90 then
    raise exception 'Extend by 1 to 90 days.';
  end if;
  select clinic_id into v_clinic from public.programs where id = p_program_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Program not found.';
  end if;
  update public.programs
     set duration_days = least(90, duration_days + p_extra_days), updated_at = now()
   where id = p_program_id and duration_days is not null;
end;
$$;
revoke all on function public.extend_program(uuid, int) from public, anon;
grant execute on function public.extend_program(uuid, int) to authenticated;

-- Shared pain review (amendment 28): set when any clinical staff member opens the program's Exercises view.
create or replace function public.mark_pain_reviewed(p_program_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_clinic uuid;
begin
  select clinic_id into v_clinic from public.programs where id = p_program_id;
  if v_clinic is null or not public.is_hep_staff(v_clinic) then
    raise exception 'Not authorized.';
  end if;
  update public.programs set pain_reviewed_through = now(), updated_at = now() where id = p_program_id;
end;
$$;
revoke all on function public.mark_pain_reviewed(uuid) from public, anon;
grant execute on function public.mark_pain_reviewed(uuid) to authenticated;

-- 14. RPC: rotate_hep_token (authenticated clinic member only)
create or replace function public.rotate_hep_token(p_patient_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_clinic_id uuid;
  v_token text;
begin
  select clinic_id into v_clinic_id from public.patients where id = p_patient_id;
  if v_clinic_id is null or not public.is_hep_staff(v_clinic_id) then
    raise exception 'Not authorized.';
  end if;

  update public.patient_hep_access
     set token = public.generate_url_safe_token(),
         link_revoked_at = null,
         failed_attempts = 0,
         locked_until = null,
         updated_at = now()
   where patient_id = p_patient_id
   returning token into v_token;
  if v_token is null then
    raise exception 'This patient has no exercise link yet.';
  end if;

  delete from public.hep_device_sessions where patient_id = p_patient_id;

  return v_token;
end;
$$;

revoke execute on function public.rotate_hep_token(uuid) from public, anon;
grant execute on function public.rotate_hep_token(uuid) to authenticated;
