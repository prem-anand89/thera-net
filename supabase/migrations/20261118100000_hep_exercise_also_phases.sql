-- Multi-select exercise types: exercises keep one primary `phase` (sets program section grouping & default dosage)
-- plus zero or more secondary types in `also_phases` (for Library & Picker multi-type filtering).
-- Earlier HEP migrations are live and are not edited.

-- 1. Exercise column. Existing rows default to empty array.
alter table public.exercises
  add column if not exists also_phases text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'exercises_also_phases_check'
       and conrelid = 'public.exercises'::regclass
  ) then
    alter table public.exercises
      add constraint exercises_also_phases_check
      check (also_phases <@ array['warm_up','mobility','stretching','activation','strengthening','balance','functional','cool_down','other']::text[]);
  end if;
end;
$$;

-- 2. save_exercise gains p_also_phases; drop the 27-argument version
--    (20261115100000_hep_photo_consent_and_portal_home.sql) so only one overload exists. Body otherwise unchanged.
drop function if exists public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[], boolean, boolean);

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
  p_positions text[] default '{}'::text[],
  p_picture_consent boolean default false,
  p_hide_pictures_in_lists boolean default false,
  p_also_phases text[] default '{}'::text[]
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count int;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_exists boolean;
  v_has_media boolean := cardinality(coalesce(p_media_keys, '{}'::text[])) > 0;
  v_old_consent_at timestamptz;
  v_old_keys text[];
  v_new_pictures boolean;
  v_record_consent boolean;
  v_phase text := coalesce(nullif(btrim(p_phase), ''), 'other');
  v_also_phases text[] := coalesce(
    (select array_agg(x order by ord)
       from (select x, min(ord) as ord
               from unnest(coalesce(p_also_phases, '{}'::text[])) with ordinality as u(x, ord)
              where x <> v_phase
              group by x) s),
    '{}'::text[]
  );
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

  if v_exists then
    select e.picture_consent_at, e.media_keys into v_old_consent_at, v_old_keys
      from public.exercises e
     where e.id = v_id and e.clinic_id = p_clinic_id;
  end if;
  v_new_pictures := v_has_media
                    and not coalesce(p_deleted, false)
                    and (not v_exists
                         or not (v_old_keys @> coalesce(p_media_keys, '{}'::text[])
                                 and v_old_keys <@ coalesce(p_media_keys, '{}'::text[])));
  if v_new_pictures and not coalesce(p_picture_consent, false) then
    raise exception 'Consent is needed for these pictures.';
  end if;
  v_record_consent := coalesce(p_picture_consent, false)
                      and (v_new_pictures or (v_has_media and v_old_consent_at is null));

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
      id, clinic_id, title, body_region, phase, also_phases, also_regions, equipment, instructions, media_type, media_keys,
      default_sets, default_reps, default_hold_seconds, default_sessions_per_day,
      side, stop_if, deleted,
      dose_type, default_duration_seconds, default_rest_seconds, media_captions, active, other_names, thumb_key, positions,
      hide_pictures_in_lists
    ) values (
      v_id, p_clinic_id, btrim(p_title), btrim(p_body_region), v_phase, v_also_phases, coalesce(p_also_regions, '{}'::text[]), coalesce(p_equipment, '{}'::text[]), coalesce(p_instructions, ''),
      p_media_type, coalesce(p_media_keys, '{}'::text[]),
      p_default_sets, p_default_reps, p_default_hold_seconds, p_default_sessions_per_day,
      p_side, coalesce(p_stop_if, ''), false,
      coalesce(nullif(btrim(p_dose_type), ''), 'reps'), p_default_duration_seconds,
      coalesce(p_default_rest_seconds, 30), coalesce(p_media_captions, '{}'::text[]), coalesce(p_active, true), coalesce(p_other_names, '{}'::text[]), p_thumb_key, coalesce(p_positions, '{}'::text[]),
      coalesce(p_hide_pictures_in_lists, false)
    );
  else
    update public.exercises
       set title = btrim(p_title),
           body_region = btrim(p_body_region),
           phase = v_phase,
           also_phases = v_also_phases,
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
           active = coalesce(p_active, true),
           other_names = coalesce(p_other_names, '{}'::text[]),
           thumb_key = p_thumb_key,
           positions = coalesce(p_positions, '{}'::text[]),
           hide_pictures_in_lists = coalesce(p_hide_pictures_in_lists, false),
           version = version + 1,
           updated_at = now()
     where id = v_id and clinic_id = p_clinic_id;
  end if;

  if v_record_consent then
    update public.exercises
       set picture_consent_by = auth.uid(),
           picture_consent_at = now()
     where id = v_id and clinic_id = p_clinic_id;
  elsif not v_has_media then
    update public.exercises
       set picture_consent_by = null,
           picture_consent_at = null
     where id = v_id and clinic_id = p_clinic_id
       and (picture_consent_by is not null or picture_consent_at is not null);
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[], boolean, boolean, text[]) from public, anon;
grant execute on function public.save_exercise(uuid, uuid, text, text, text, text[], text[], text, text, text[], smallint, smallint, smallint, smallint, text, text, boolean, text, smallint, smallint, text[], boolean, text[], text, text[], boolean, boolean, text[]) to authenticated;
