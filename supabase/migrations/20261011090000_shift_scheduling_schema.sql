-- Shift-based scheduling: admin-assigned shift templates (or custom hours)
-- replace unilateral therapist self-editing of working hours. See
-- docs/superpowers/specs/2026-10-10-shift-based-scheduling-design.md.

create table public.shift_templates (
  id                          uuid primary key default gen_random_uuid(),
  clinic_id                   uuid not null references public.clinics(id) on delete cascade,
  name                        text not null,
  start_minute                integer not null check (start_minute >= 0 and start_minute < 1440),
  end_minute                  integer not null check (end_minute > start_minute and end_minute <= 1440),
  break_duration_minutes      integer not null default 0 check (break_duration_minutes >= 0),
  default_break_start_minute  integer check (
    default_break_start_minute is null
    or (default_break_start_minute >= start_minute
        and default_break_start_minute + break_duration_minutes <= end_minute)
  ),
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (break_duration_minutes = 0 or default_break_start_minute is not null)
);

create index shift_templates_clinic_idx on public.shift_templates (clinic_id, active);

alter table public.shift_templates enable row level security;
create policy shift_templates_select on public.shift_templates
  for select using (is_clinic_member(clinic_id));
-- No insert/update/delete policies — all writes go through security definer RPCs.

create table public.therapist_shift_assignments (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  therapist_id        uuid not null references public.therapists(id) on delete cascade,
  shift_template_id   uuid references public.shift_templates(id),
  custom_hours        jsonb,
  weekdays            integer[] check (
    weekdays is null
    or (array_length(weekdays, 1) > 0 and weekdays <@ array[0,1,2,3,4,5,6])
  ),
  break_start_minute  integer,
  status              text not null default 'pending' check (status in ('pending','approved','declined','superseded')),
  note                text,
  requested_by        uuid references auth.users(id),
  decided_by          uuid references auth.users(id),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((shift_template_id is null) <> (custom_hours is null)),
  check (shift_template_id is null or weekdays is not null),
  check (shift_template_id is not null or weekdays is null)
);

create index therapist_shift_assignments_therapist_idx
  on public.therapist_shift_assignments (therapist_id, status);
create index therapist_shift_assignments_clinic_pending_idx
  on public.therapist_shift_assignments (clinic_id, status);

alter table public.therapist_shift_assignments enable row level security;
create policy therapist_shift_assignments_select on public.therapist_shift_assignments
  for select using (
    is_clinic_admin(clinic_id) or is_front_desk(clinic_id) or is_own_therapist(clinic_id, therapist_id)
  );
-- No insert/update/delete policies — all writes go through security definer RPCs.

-- Builds { "<weekday>": [[start,break_start],[break_start+duration,end]], ... }
-- (or a single [[start,end]] interval when there's no break) for each
-- weekday in p_weekdays, merged into whichever weekdays p_existing already
-- held for other assignments. Callers resolve the break-start fallback
-- chain (assignment override, else template default) before calling this.
create or replace function public.derive_working_hours(
  p_existing jsonb,
  p_weekdays integer[],
  p_start_minute integer,
  p_end_minute integer,
  p_break_start integer,
  p_break_duration integer
) returns jsonb language plpgsql immutable as $$
declare
  v_result jsonb := coalesce(p_existing, '{}'::jsonb);
  v_day integer;
  v_intervals jsonb;
begin
  if p_break_duration > 0 and p_break_start is not null then
    v_intervals := jsonb_build_array(
      jsonb_build_array(p_start_minute, p_break_start),
      jsonb_build_array(p_break_start + p_break_duration, p_end_minute)
    );
  else
    v_intervals := jsonb_build_array(jsonb_build_array(p_start_minute, p_end_minute));
  end if;
  foreach v_day in array p_weekdays loop
    v_result := jsonb_set(v_result, array[v_day::text], v_intervals, true);
  end loop;
  return v_result;
end $$;

-- Weekdays in p_weekdays are being claimed by a new/edited shift
-- assignment: strip them from this therapist's other approved
-- shift-template assignments (partial overlap shrinks weekdays; full
-- overlap flips status to 'superseded' rather than leaving an invalid
-- zero-day row — the weekdays check constraint requires >=1 day whenever
-- shift_template_id is set). Custom-hours assignments are untouched here;
-- see supersede_all_assignments for the custom-hours path.
create or replace function public.supersede_overlapping_weekdays(
  p_therapist_id uuid,
  p_weekdays integer[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_remaining integer[];
begin
  for v_row in
    select id, weekdays from therapist_shift_assignments
    where therapist_id = p_therapist_id and status = 'approved' and shift_template_id is not null
    for update
  loop
    select array_agg(d) into v_remaining from unnest(v_row.weekdays) d where d <> all(p_weekdays);
    if v_remaining is null then
      update therapist_shift_assignments set status = 'superseded', updated_at = now() where id = v_row.id;
    elsif v_remaining <> v_row.weekdays then
      update therapist_shift_assignments set weekdays = v_remaining, updated_at = now() where id = v_row.id;
    end if;
  end loop;
end $$;

-- Custom hours and shift templates are mutually exclusive per therapist:
-- approving either one supersedes every other currently-approved
-- assignment for that therapist (shift or custom), full stop.
create or replace function public.supersede_all_assignments(p_therapist_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update therapist_shift_assignments
    set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'approved';
end $$;

-- Shared by assign_shift (Task 2) and approve_shift_assignment's
-- shift-template path (Task 3) — both reach the same "supersede, derive,
-- validate, write" sequence, one directly and one via the request queue.
-- Caller has already authorized and validated the shift/break-placement
-- bounds before calling this.
create or replace function public.apply_shift_hours(
  p_therapist_id uuid,
  p_weekdays integer[],
  p_shift_start integer,
  p_shift_end integer,
  p_break_start integer,
  p_break_duration integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_hours jsonb;
begin
  perform supersede_overlapping_weekdays(p_therapist_id, p_weekdays);
  select working_hours into v_hours from therapists where id = p_therapist_id;
  v_hours := derive_working_hours(v_hours, p_weekdays, p_shift_start, p_shift_end, p_break_start, p_break_duration);
  if not working_hours_valid(v_hours) then
    raise exception 'Derived working hours are invalid.';
  end if;
  update therapists set working_hours = v_hours, updated_at = now() where id = p_therapist_id;
end $$;

-- Shared by assign_custom_hours (Task 2) and approve_shift_assignment's
-- custom-hours path (Task 3).
create or replace function public.apply_custom_hours(
  p_therapist_id uuid,
  p_custom_hours jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not working_hours_valid(p_custom_hours) then
    raise exception 'Working hours must be non-overlapping times within the day, earliest first.';
  end if;
  perform supersede_all_assignments(p_therapist_id);
  update therapists set working_hours = p_custom_hours, updated_at = now() where id = p_therapist_id;
end $$;

revoke execute on function public.derive_working_hours(jsonb, integer[], integer, integer, integer, integer) from public, anon;
revoke execute on function public.supersede_overlapping_weekdays(uuid, integer[]) from public, anon;
revoke execute on function public.supersede_all_assignments(uuid) from public, anon;
revoke execute on function public.apply_shift_hours(uuid, integer[], integer, integer, integer, integer) from public, anon;
revoke execute on function public.apply_custom_hours(uuid, jsonb) from public, anon;
grant execute on function public.apply_shift_hours(uuid, integer[], integer, integer, integer, integer) to authenticated;
grant execute on function public.apply_custom_hours(uuid, jsonb) to authenticated;
grant execute on function public.derive_working_hours(jsonb, integer[], integer, integer, integer, integer) to authenticated;
grant execute on function public.supersede_overlapping_weekdays(uuid, integer[]) to authenticated;
grant execute on function public.supersede_all_assignments(uuid) to authenticated;
