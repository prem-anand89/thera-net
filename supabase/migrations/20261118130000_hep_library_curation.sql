-- TheraNet Library curation (table `starter_exercises`):
--   1) where each library item's pictures come from (image_source, image_note),
--   2) publish_starter_exercise takes those two values and refuses pictures without a source,
--   3) exercise_origins: which library item a clinic's copy came from (library now, public library later).
-- Earlier HEP migrations are live and are not edited.

-- 1. Provenance on library items.
alter table public.starter_exercises
  add column if not exists image_source text
    check (image_source in ('own_photography', 'ai_generated', 'illustration', 'licensed'));
alter table public.starter_exercises
  add column if not exists image_note text
    check (length(image_note) <= 200);

-- 2. publish_starter_exercise gains p_image_source and p_image_note (last two parameters).
--    Drop the 25-argument version from 20261118110000_hep_starter_library.sql so only one overload exists.
drop function if exists public.publish_starter_exercise(uuid, uuid, uuid, text, text[], text, text[], text, text[], text[], text[], text, text, text, text[], text[], text, text, smallint, smallint, smallint, smallint, smallint, smallint, text);

create or replace function public.publish_starter_exercise(
  p_clinic_id uuid,
  p_source_exercise_id uuid default null,
  p_starter_id uuid default null,
  p_title text default '',
  p_other_names text[] default '{}'::text[],
  p_body_region text default 'General',
  p_also_regions text[] default '{}'::text[],
  p_phase text default 'other',
  p_also_phases text[] default '{}'::text[],
  p_positions text[] default '{}'::text[],
  p_equipment text[] default '{}'::text[],
  p_instructions text default '',
  p_stop_if text default '',
  p_media_type text default 'none',
  p_media_keys text[] default '{}'::text[],
  p_media_captions text[] default '{}'::text[],
  p_thumb_key text default null,
  p_dose_type text default 'reps',
  p_default_sets smallint default 3,
  p_default_reps smallint default 10,
  p_default_hold_seconds smallint default null,
  p_default_duration_seconds smallint default null,
  p_default_rest_seconds smallint default 30,
  p_default_sessions_per_day smallint default 1,
  p_side text default 'none',
  p_image_source text default null,
  p_image_note text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid := p_starter_id;
  v_phase text := coalesce(nullif(btrim(p_phase), ''), 'other');
  v_also_phases text[] := coalesce(
    (select array_agg(x order by ord)
       from (select x, min(ord) as ord
               from unnest(coalesce(p_also_phases, '{}'::text[])) with ordinality as u(x, ord)
              where x <> v_phase
              group by x) s),
    '{}'::text[]
  );
  v_image_source text := nullif(btrim(coalesce(p_image_source, '')), '');
  v_image_note text := nullif(btrim(coalesce(p_image_note, '')), '');
begin
  if not public.is_starter_curator(p_clinic_id) then
    raise exception 'Only curator clinics can update the Starter library.';
  end if;

  if cardinality(coalesce(p_media_keys, '{}'::text[])) > 0 and v_image_source is null then
    raise exception 'Say where the pictures come from.';
  end if;

  if v_id is null and p_source_exercise_id is not null then
    select s.id into v_id
      from public.starter_exercises s
     where s.source_clinic_id = p_clinic_id
       and s.source_exercise_id = p_source_exercise_id
     limit 1;
  end if;
  v_id := coalesce(v_id, gen_random_uuid());

  if exists (
       select 1
         from unnest(coalesce(p_media_keys, '{}'::text[]) || coalesce(array[p_thumb_key], '{}'::text[])) k
        where k is not null
          and (k not like 'starter/exercises/' || v_id::text || '/%' or position('..' in k) > 0)
     ) then
    raise exception 'Starter picture key does not belong to this starter exercise.';
  end if;

  insert into public.starter_exercises (
    id, source_clinic_id, source_exercise_id, title, other_names, body_region, also_regions,
    phase, also_phases, positions, equipment, instructions, stop_if,
    media_type, media_keys, media_captions, thumb_key,
    dose_type, default_sets, default_reps, default_hold_seconds, default_duration_seconds,
    default_rest_seconds, default_sessions_per_day, side,
    image_source, image_note,
    published_by, published_at, active, updated_at
  ) values (
    v_id, p_clinic_id, p_source_exercise_id, btrim(p_title), coalesce(p_other_names, '{}'::text[]),
    btrim(p_body_region), coalesce(p_also_regions, '{}'::text[]),
    v_phase, v_also_phases, coalesce(p_positions, '{}'::text[]), coalesce(p_equipment, '{}'::text[]),
    coalesce(p_instructions, ''), coalesce(p_stop_if, ''),
    coalesce(nullif(btrim(p_media_type), ''), 'none'),
    coalesce(p_media_keys, '{}'::text[]), coalesce(p_media_captions, '{}'::text[]), p_thumb_key,
    coalesce(nullif(btrim(p_dose_type), ''), 'reps'),
    coalesce(p_default_sets, 3), p_default_reps, p_default_hold_seconds, p_default_duration_seconds,
    coalesce(p_default_rest_seconds, 30), coalesce(p_default_sessions_per_day, 1), coalesce(nullif(btrim(p_side), ''), 'none'),
    v_image_source, v_image_note,
    auth.uid(), now(), true, now()
  )
  on conflict (id) do update
    set source_clinic_id = excluded.source_clinic_id,
        source_exercise_id = excluded.source_exercise_id,
        title = excluded.title,
        other_names = excluded.other_names,
        body_region = excluded.body_region,
        also_regions = excluded.also_regions,
        phase = excluded.phase,
        also_phases = excluded.also_phases,
        positions = excluded.positions,
        equipment = excluded.equipment,
        instructions = excluded.instructions,
        stop_if = excluded.stop_if,
        media_type = excluded.media_type,
        media_keys = excluded.media_keys,
        media_captions = excluded.media_captions,
        thumb_key = excluded.thumb_key,
        dose_type = excluded.dose_type,
        default_sets = excluded.default_sets,
        default_reps = excluded.default_reps,
        default_hold_seconds = excluded.default_hold_seconds,
        default_duration_seconds = excluded.default_duration_seconds,
        default_rest_seconds = excluded.default_rest_seconds,
        default_sessions_per_day = excluded.default_sessions_per_day,
        side = excluded.side,
        image_source = excluded.image_source,
        image_note = excluded.image_note,
        published_by = auth.uid(),
        published_at = now(),
        active = true,
        updated_at = now();

  return v_id;
end;
$$;

revoke all on function public.publish_starter_exercise(uuid, uuid, uuid, text, text[], text, text[], text, text[], text[], text[], text, text, text, text[], text[], text, text, smallint, smallint, smallint, smallint, smallint, smallint, text, text, text) from public, anon;
grant execute on function public.publish_starter_exercise(uuid, uuid, uuid, text, text[], text, text[], text, text[], text[], text[], text, text, text, text[], text[], text, text, smallint, smallint, smallint, smallint, smallint, smallint, text, text, text) to authenticated;

-- 3. Where each clinic copy came from. Written only through record_exercise_origin; readable by the clinic's HEP staff.
--    source_id has no foreign key: the public library table does not exist yet.
create table if not exists public.exercise_origins (
  exercise_id uuid primary key references public.exercises (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  source_kind text not null check (source_kind in ('library', 'public')),
  source_id uuid not null,
  source_published_at timestamptz,
  imported_by uuid references auth.users (id),
  imported_at timestamptz not null default now()
);

create index if not exists exercise_origins_clinic_idx on public.exercise_origins (clinic_id);

alter table public.exercise_origins enable row level security;

drop policy if exists "exercise_origins_select_staff" on public.exercise_origins;
create policy "exercise_origins_select_staff"
  on public.exercise_origins
  for select
  to authenticated
  using (public.is_hep_staff(clinic_id));

revoke all on public.exercise_origins from anon, authenticated;
grant select on public.exercise_origins to authenticated;

create or replace function public.record_exercise_origin(
  p_clinic_id uuid,
  p_exercise_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_source_published_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_hep_staff(p_clinic_id) then
    raise exception 'Not a member of this clinic.';
  end if;

  if not exists (
       select 1 from public.exercises e
        where e.id = p_exercise_id and e.clinic_id = p_clinic_id and not e.deleted
     ) then
    raise exception 'Exercise not found.';
  end if;

  if p_source_kind = 'public' then
    raise exception 'The public library is not available yet.';
  end if;
  if p_source_kind is distinct from 'library' then
    raise exception 'Unknown source.';
  end if;

  if not exists (
       select 1 from public.starter_exercises s
        where s.id = p_source_id and s.active
     ) then
    raise exception 'That library exercise is not available.';
  end if;

  insert into public.exercise_origins (
    exercise_id, clinic_id, source_kind, source_id, source_published_at, imported_by
  ) values (
    p_exercise_id, p_clinic_id, p_source_kind, p_source_id, p_source_published_at, auth.uid()
  )
  on conflict (exercise_id) do update
    set source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        source_published_at = excluded.source_published_at,
        imported_by = auth.uid();
end;
$$;

revoke all on function public.record_exercise_origin(uuid, uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.record_exercise_origin(uuid, uuid, text, uuid, timestamptz) to authenticated;
