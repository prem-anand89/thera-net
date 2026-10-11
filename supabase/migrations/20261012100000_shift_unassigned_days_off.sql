-- Shift scheduling: days a therapist has no shift on are days off.
--
-- Until now apply_shift_hours merged the new shift into whatever was already
-- in therapists.working_hours, so hours set before shifts existed survived on
-- the days an admin left out ("Custom" days nobody assigned). Shifts and
-- hand-set hours are mutually exclusive, so working_hours is now derived only
-- from the therapist's approved shift assignments; anything else is dropped.

-- Internal helper: working hours implied by a therapist's approved shift
-- assignments alone ('{}' when there are none = no days). Not callable by
-- clients; only the authorized RPCs call it.
create or replace function public.rebuild_working_hours_from_shifts(p_therapist_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hours jsonb := '{}'::jsonb;
  v_row record;
begin
  for v_row in
    select a.weekdays, a.break_start_minute,
           t.start_minute, t.end_minute, t.break_duration_minutes, t.default_break_start_minute
    from therapist_shift_assignments a
    join shift_templates t on t.id = a.shift_template_id
    where a.therapist_id = p_therapist_id and a.status = 'approved' and a.shift_template_id is not null
    order by a.created_at, a.id
  loop
    v_hours := derive_working_hours(
      v_hours, v_row.weekdays, v_row.start_minute, v_row.end_minute,
      coalesce(v_row.break_start_minute, v_row.default_break_start_minute), v_row.break_duration_minutes
    );
  end loop;
  return v_hours;
end $$;

revoke execute on function public.rebuild_working_hours_from_shifts(uuid) from public, anon, authenticated;

-- apply_shift_hours: same contract, but the merge base is the therapist's
-- remaining shift assignments, not the stored hours.
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
  v_custom_id uuid;
begin
  select id into v_custom_id from therapist_shift_assignments
    where therapist_id = p_therapist_id and status = 'approved' and shift_template_id is null
    limit 1
    for update;

  if v_custom_id is not null then
    update therapist_shift_assignments set status = 'superseded', updated_at = now()
      where therapist_id = p_therapist_id and status = 'approved' and shift_template_id is null;
    v_hours := '{}'::jsonb;
  else
    perform supersede_overlapping_weekdays(p_therapist_id, p_weekdays);
    v_hours := rebuild_working_hours_from_shifts(p_therapist_id);
  end if;

  v_hours := derive_working_hours(v_hours, p_weekdays, p_shift_start, p_shift_end, p_break_start, p_break_duration);
  if not working_hours_valid(v_hours) then
    raise exception 'Derived working hours are invalid.';
  end if;
  update therapists set working_hours = v_hours, updated_at = now() where id = p_therapist_id;
end $$;

revoke execute on function public.apply_shift_hours(uuid, integer[], integer, integer, integer, integer) from public, anon, authenticated;

-- One-time cleanup: therapists who already have shift assignments get their
-- stored hours rebuilt from those assignments, dropping leftover hours on
-- days no shift covers.
update therapists t
set working_hours = public.rebuild_working_hours_from_shifts(t.id), updated_at = now()
where exists (
  select 1 from therapist_shift_assignments a
  where a.therapist_id = t.id and a.status = 'approved' and a.shift_template_id is not null
);
