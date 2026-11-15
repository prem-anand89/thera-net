-- HEP: exercise positions (Standing, Sitting, ...), save_exercise takes p_positions, and grouped use counts.
-- save_exercise is the definition from 20261113200000_hep_module.sql, unchanged apart from the positions additions.

-- 1. Positions column: a staff-only filter, several per exercise, never shown to patients.
alter table public.exercises add column if not exists positions text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'exercises_positions_check' and conrelid = 'public.exercises'::regclass
  ) then
    alter table public.exercises
      add constraint exercises_positions_check
      check (positions <@ array['Standing','Sitting','Supine','Prone','Side-lying','Quadruped','Kneeling']::text[]);
  end if;
end;
$$;

-- 2. save_exercise gains a 25th parameter; drop the 24-argument version so only one overload exists.
drop function if exists public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text);

-- 3. RPC: save_exercise (create or update; enforces 10-exercise Lite cap on new inserts)
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
  p_thumb_key text default null,
  p_positions text[] default '{}'::text[]
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
      dose_type, default_duration_seconds, default_rest_seconds, media_captions, active, other_names, thumb_key, positions
    ) values (
      v_id, p_clinic_id, btrim(p_title), btrim(p_body_region), coalesce(nullif(btrim(p_phase), ''), 'other'), coalesce(p_also_regions, '{}'::text[]), coalesce(p_equipment, '{}'::text[]), coalesce(p_instructions, ''),
      p_media_type, coalesce(p_media_keys, '{}'::text[]),
      p_default_sets, p_default_reps, p_default_hold_seconds, p_default_sessions_per_day,
      p_side, coalesce(p_stop_if, ''), false,
      coalesce(nullif(btrim(p_dose_type), ''), 'reps'), p_default_duration_seconds,
      coalesce(p_default_rest_seconds, 30), coalesce(p_media_captions, '{}'::text[]), coalesce(p_active, true), coalesce(p_other_names, '{}'::text[]), p_thumb_key, coalesce(p_positions, '{}'::text[])
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
           positions = coalesce(p_positions, '{}'::text[]),
           version = version + 1,
           updated_at = now()
     where id = v_id and clinic_id = p_clinic_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[]) from public, anon;
grant execute on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[]) to authenticated;

-- 4. RPC: exercise_use_counts — how many program items were copied from each exercise, counted in the database
--    (pulling every program_items row would hit PostgREST's 1,000-row cap). No rows for non-staff.
create or replace function public.exercise_use_counts(p_clinic_id uuid)
returns table (exercise_id uuid, uses int)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select pi.source_exercise_id, count(*)::int
    from public.program_items pi
    join public.programs p on p.id = pi.program_id
   where public.is_hep_staff(p_clinic_id)
     and p.clinic_id = p_clinic_id
     and pi.source_exercise_id is not null
   group by 1;
$$;

revoke all on function public.exercise_use_counts(uuid) from public, anon;
grant execute on function public.exercise_use_counts(uuid) to authenticated;
