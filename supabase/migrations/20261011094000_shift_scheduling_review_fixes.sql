-- Shift-based scheduling: fixes from the whole-feature code review.
--   1. Internal helpers were directly callable by any authenticated user.
--   2. approve/decline never bumped updated_at, so sync never pulled them.
--   3. Assigning a shift didn't supersede an approved custom-hours row.
--   4. "Clinic hours" (null) violated the shift_template_id/custom_hours
--      exclusivity check; null now means "no assignment, working_hours = null".
--   5. set_break_placement accepted a NULL break start (deleted the break
--      with no approval — a capacity increase).

-- ---------------------------------------------------------------------------
-- 1. Lock down internal helpers. They have no authorization check of their
--    own; they're only meant to be called from the authorized security
--    definer RPCs, which run as the function owner and so are unaffected.
-- ---------------------------------------------------------------------------
revoke execute on function public.derive_working_hours(jsonb, integer[], integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.supersede_overlapping_weekdays(uuid, integer[]) from public, anon, authenticated;
revoke execute on function public.supersede_all_assignments(uuid) from public, anon, authenticated;
revoke execute on function public.apply_shift_hours(uuid, integer[], integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.apply_custom_hours(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. updated_at defense-in-depth. The shared set_updated_at() also writes
--    updated_by/created_by, which these two tables don't have (it would
--    raise "record new has no field updated_by" on every update), so these
--    tables get their own updated_at-only trigger function — same approach
--    as set_clinic_plans_updated_at / set_platform_config_updated_at.
-- ---------------------------------------------------------------------------
create or replace function public.set_shift_scheduling_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists shift_templates_updated on public.shift_templates;
create trigger shift_templates_updated before update on public.shift_templates
  for each row execute function public.set_shift_scheduling_updated_at();

drop trigger if exists therapist_shift_assignments_updated on public.therapist_shift_assignments;
create trigger therapist_shift_assignments_updated before update on public.therapist_shift_assignments
  for each row execute function public.set_shift_scheduling_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Shift assignment and custom hours are mutually exclusive: assigning a
--    shift supersedes an approved custom-hours row. Because approving custom
--    hours runs supersede_all_assignments() (every approved row, shift or
--    custom), an approved custom-hours row never coexists with an approved
--    shift row — so when one exists, the merge base is '{}' (the custom
--    hours are being replaced, not merged into).
-- ---------------------------------------------------------------------------
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
    select working_hours into v_hours from therapists where id = p_therapist_id;
  end if;

  v_hours := derive_working_hours(v_hours, p_weekdays, p_shift_start, p_shift_end, p_break_start, p_break_duration);
  if not working_hours_valid(v_hours) then
    raise exception 'Derived working hours are invalid.';
  end if;
  update therapists set working_hours = v_hours, updated_at = now() where id = p_therapist_id;
end $$;

-- Re-assert after create or replace (privileges are preserved, but be explicit).
revoke execute on function public.apply_shift_hours(uuid, integer[], integer, integer, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. "Clinic hours" (null).
--    assign_custom_hours(null): no assignment row; supersede everything and
--      set working_hours = null directly. Returns null.
--    request_custom_hours(null): stores the JSON-null sentinel 'null'::jsonb
--      (a non-NULL jsonb value, so it passes the exclusivity check).
--    approve_shift_assignment: the sentinel is applied as "reset to clinic
--      hours", never passed to apply_custom_hours as if it were real hours.
-- ---------------------------------------------------------------------------
create or replace function public.assign_custom_hours(
  p_therapist_id uuid,
  p_custom_hours jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  if p_custom_hours is null or p_custom_hours = 'null'::jsonb then
    -- "Clinic hours": zero assignments + working_hours = null.
    perform supersede_all_assignments(p_therapist_id);
    update therapists set working_hours = null, updated_at = now() where id = p_therapist_id;
    return null;
  end if;

  -- Supersede/write BEFORE inserting the new row so
  -- supersede_all_assignments() can't sweep the brand-new row.
  perform apply_custom_hours(p_therapist_id, p_custom_hours);

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, custom_hours, status, decided_by, decided_at
  ) values (
    v_clinic_id, p_therapist_id, p_custom_hours, 'approved', auth.uid(), now()
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function public.request_custom_hours(
  p_therapist_id uuid,
  p_custom_hours jsonb,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not is_own_therapist(v_clinic_id, p_therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if p_custom_hours is not null and p_custom_hours <> 'null'::jsonb
     and not working_hours_valid(p_custom_hours) then
    raise exception 'Working hours must be non-overlapping times within the day, earliest first.';
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, custom_hours, note, status, requested_by
  ) values (
    -- SQL NULL ("Clinic hours") is stored as the JSON-null sentinel.
    v_clinic_id, p_therapist_id, coalesce(p_custom_hours, 'null'::jsonb),
    nullif(trim(both from p_note), ''), 'pending', auth.uid()
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function public.approve_shift_assignment(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
  v_shift record;
begin
  select * into v_req from therapist_shift_assignments where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if not (is_clinic_admin(v_req.clinic_id) or is_front_desk(v_req.clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been actioned.';
  end if;

  if v_req.shift_template_id is not null then
    select * into v_shift from shift_templates where id = v_req.shift_template_id;
    if not found or not v_shift.active then raise exception 'Shift template no longer available.'; end if;
    if v_req.break_start_minute is not null and (
      v_req.break_start_minute < v_shift.start_minute
      or v_req.break_start_minute + v_shift.break_duration_minutes > v_shift.end_minute
    ) then
      raise exception 'Break placement no longer fits the shift.';
    end if;
    perform apply_shift_hours(
      v_req.therapist_id, v_req.weekdays, v_shift.start_minute, v_shift.end_minute,
      coalesce(v_req.break_start_minute, v_shift.default_break_start_minute), v_shift.break_duration_minutes
    );
  elsif v_req.custom_hours = 'null'::jsonb then
    -- "Reset to clinic hours" request.
    perform supersede_all_assignments(v_req.therapist_id);
    update therapists set working_hours = null, updated_at = now() where id = v_req.therapist_id;
  else
    perform apply_custom_hours(v_req.therapist_id, v_req.custom_hours);
  end if;

  update therapist_shift_assignments
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
    where id = p_request_id;
end $$;

create or replace function public.decline_shift_assignment(p_request_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  select * into v_req from therapist_shift_assignments where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if not (is_clinic_admin(v_req.clinic_id) or is_front_desk(v_req.clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been actioned.';
  end if;
  update therapist_shift_assignments
    set status = 'declined', decided_by = auth.uid(), decided_at = now(), updated_at = now(),
        note = coalesce(nullif(trim(both from p_note), ''), note)
    where id = p_request_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. set_break_placement: NULL break start would silently remove the break.
-- ---------------------------------------------------------------------------
create or replace function public.set_break_placement(
  p_assignment_id uuid,
  p_break_start_minute integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_assignment record;
  v_shift record;
  v_hours jsonb;
begin
  select * into v_assignment from therapist_shift_assignments where id = p_assignment_id for update;
  if not found then raise exception 'Assignment not found.'; end if;
  if not (
    is_clinic_admin(v_assignment.clinic_id)
    or is_front_desk(v_assignment.clinic_id)
    or is_own_therapist(v_assignment.clinic_id, v_assignment.therapist_id)
  ) then
    raise exception 'Not authorized.';
  end if;
  if p_break_start_minute is null then
    raise exception 'Break start time is required.';
  end if;
  if v_assignment.status <> 'approved' or v_assignment.shift_template_id is null then
    raise exception 'Break placement only applies to an approved shift assignment.';
  end if;

  select * into v_shift from shift_templates where id = v_assignment.shift_template_id;
  if p_break_start_minute < v_shift.start_minute
     or p_break_start_minute + v_shift.break_duration_minutes > v_shift.end_minute then
    raise exception 'Break placement must fit within the shift.';
  end if;

  update therapist_shift_assignments set break_start_minute = p_break_start_minute, updated_at = now()
    where id = p_assignment_id;

  select working_hours into v_hours from therapists where id = v_assignment.therapist_id;
  v_hours := derive_working_hours(
    v_hours, v_assignment.weekdays, v_shift.start_minute, v_shift.end_minute,
    p_break_start_minute, v_shift.break_duration_minutes
  );
  if not working_hours_valid(v_hours) then
    raise exception 'Derived working hours are invalid.';
  end if;
  update therapists set working_hours = v_hours, updated_at = now() where id = v_assignment.therapist_id;
end $$;
