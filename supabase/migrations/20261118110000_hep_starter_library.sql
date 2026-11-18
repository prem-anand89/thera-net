-- Shared Starter Library backed by Postgres + neutral R2 prefix (`starter/exercises/{id}/...`),
-- curated by Beyond Mechanics and Physio Clinic admins/staff via security-definer RPCs.
-- Clinics still copy starter items into their own `exercises` + `clinics/{clinicId}/exercises/...` on add.

create table if not exists public.starter_exercises (
  id uuid primary key default gen_random_uuid(),
  source_clinic_id uuid references public.clinics (id) on delete set null,
  source_exercise_id uuid,
  title text not null check (length(btrim(title)) between 1 and 80),
  other_names text[] not null default '{}'::text[],
  body_region text not null check (length(btrim(body_region)) between 1 and 40),
  also_regions text[] not null default '{}'::text[],
  phase text not null default 'other'
    check (phase in ('warm_up','mobility','stretching','activation','strengthening','balance','functional','cool_down','other')),
  also_phases text[] not null default '{}'::text[]
    check (also_phases <@ array['warm_up','mobility','stretching','activation','strengthening','balance','functional','cool_down','other']::text[]),
  positions text[] not null default '{}'::text[]
    check (positions <@ array['Standing','Sitting','Supine','Prone','Side-lying','Quadruped','Kneeling']::text[]),
  equipment text[] not null default '{}'::text[],
  instructions text not null default '',
  stop_if text not null default '',
  media_type text not null default 'none' check (media_type in ('none','gif','stills')),
  media_keys text[] not null default '{}'::text[],
  media_captions text[] not null default '{}'::text[],
  thumb_key text,
  dose_type text not null default 'reps' check (dose_type in ('reps','hold','timed')),
  default_sets smallint not null default 3 check (default_sets between 1 and 20),
  default_reps smallint,
  default_hold_seconds smallint,
  default_duration_seconds smallint,
  default_rest_seconds smallint not null default 30,
  default_sessions_per_day smallint not null default 1 check (default_sessions_per_day between 1 and 3),
  side text not null default 'none' check (side in ('none','left','right','both')),
  published_by uuid references auth.users (id),
  published_at timestamptz not null default now(),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create unique index if not exists starter_exercises_source_idx
  on public.starter_exercises (source_clinic_id, source_exercise_id)
  where source_exercise_id is not null;

alter table public.starter_exercises enable row level security;

drop policy if exists "starter_exercises_select_authenticated" on public.starter_exercises;
create policy "starter_exercises_select_authenticated"
  on public.starter_exercises
  for select
  to authenticated
  using (active = true);

-- Curator flag: can only be set by running SQL directly on the database.
alter table public.clinics
  add column if not exists starter_curator boolean not null default false;

create or replace function public.clinics_protect_starter_curator()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('authenticated', 'anon') or auth.uid() is not null then
    if tg_op = 'INSERT' then
      if coalesce(new.starter_curator, false) then
        raise exception 'starter_curator can only be set directly via SQL on the database'
          using errcode = '42501';
      end if;
    elsif new.starter_curator is distinct from old.starter_curator then
      raise exception 'starter_curator can only be changed directly via SQL on the database'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clinics_protect_starter_curator on public.clinics;
create trigger trg_clinics_protect_starter_curator
  before insert or update on public.clinics
  for each row execute function public.clinics_protect_starter_curator();

-- One-off backfill at migration apply time for the two initial curator clinics; not a runtime check.
update public.clinics
   set starter_curator = true
 where lower(btrim(name)) in ('beyond mechanics', 'physio clinic');

-- Curator helper: HEP staff belonging to a clinic with starter_curator = true.
create or replace function public.is_starter_curator(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.is_hep_staff(p_clinic)
     and exists (
       select 1
         from public.clinics c
        where c.id = p_clinic
          and c.starter_curator = true
     );
$$;

revoke all on function public.is_starter_curator(uuid) from public, anon;
grant execute on function public.is_starter_curator(uuid) to authenticated;

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
  p_side text default 'none'
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
begin
  if not public.is_starter_curator(p_clinic_id) then
    raise exception 'Only curator clinics can update the Starter library.';
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
        published_by = auth.uid(),
        published_at = now(),
        active = true,
        updated_at = now();

  return v_id;
end;
$$;

revoke all on function public.publish_starter_exercise(uuid, uuid, uuid, text, text[], text, text[], text, text[], text[], text[], text, text, text, text[], text[], text, text, smallint, smallint, smallint, smallint, smallint, smallint, text) from public, anon;
grant execute on function public.publish_starter_exercise(uuid, uuid, uuid, text, text[], text, text[], text, text[], text[], text[], text, text, text, text[], text[], text, text, smallint, smallint, smallint, smallint, smallint, smallint, text) to authenticated;

create or replace function public.unpublish_starter_exercise(p_clinic_id uuid, p_starter_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_starter_curator(p_clinic_id) then
    raise exception 'Only curator clinics can update the Starter library.';
  end if;

  update public.starter_exercises
     set active = false,
         updated_at = now()
   where id = p_starter_id;
end;
$$;

revoke all on function public.unpublish_starter_exercise(uuid, uuid) from public, anon;
grant execute on function public.unpublish_starter_exercise(uuid, uuid) to authenticated;
