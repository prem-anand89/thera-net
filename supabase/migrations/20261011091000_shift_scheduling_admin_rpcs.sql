create or replace function public.create_shift_template(
  p_clinic_id uuid,
  p_name text,
  p_start_minute integer,
  p_end_minute integer,
  p_break_duration_minutes integer default 0,
  p_default_break_start_minute integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  insert into shift_templates (
    clinic_id, name, start_minute, end_minute, break_duration_minutes, default_break_start_minute
  ) values (
    p_clinic_id, trim(p_name), p_start_minute, p_end_minute, p_break_duration_minutes, p_default_break_start_minute
  ) returning id into v_id;
  return v_id;
end $$;

-- Updates the template, then cascades to every approved assignment bound
-- to it: re-reads each therapist's CURRENT working_hours (not a value
-- captured before the loop) as the merge base, so an unrelated weekday
-- from a different assignment is never clobbered. An assignment's own
-- break_start_minute is re-validated against the template's NEW bounds;
-- if it no longer fits, it's reset to null (falls back to the template's
-- new default) rather than producing an invalid derivation.
create or replace function public.update_shift_template(
  p_template_id uuid,
  p_name text,
  p_start_minute integer,
  p_end_minute integer,
  p_break_duration_minutes integer,
  p_default_break_start_minute integer,
  p_active boolean default true
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_row record;
  v_hours jsonb;
  v_break_start integer;
begin
  select clinic_id into v_clinic_id from shift_templates where id = p_template_id for update;
  if not found then raise exception 'Shift template not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;

  update shift_templates set
    name = trim(p_name),
    start_minute = p_start_minute,
    end_minute = p_end_minute,
    break_duration_minutes = p_break_duration_minutes,
    default_break_start_minute = p_default_break_start_minute,
    active = p_active,
    updated_at = now()
  where id = p_template_id;

  for v_row in
    select therapist_id, id, weekdays, break_start_minute
    from therapist_shift_assignments
    where shift_template_id = p_template_id and status = 'approved'
  loop
    v_break_start := v_row.break_start_minute;
    if v_break_start is not null and (
      v_break_start < p_start_minute or v_break_start + p_break_duration_minutes > p_end_minute
    ) then
      v_break_start := null;
      update therapist_shift_assignments set break_start_minute = null, updated_at = now() where id = v_row.id;
    end if;

    select working_hours into v_hours from therapists where id = v_row.therapist_id;
    v_hours := derive_working_hours(
      v_hours, v_row.weekdays, p_start_minute, p_end_minute,
      coalesce(v_break_start, p_default_break_start_minute), p_break_duration_minutes
    );
    if not working_hours_valid(v_hours) then
      raise exception 'Derived working hours are invalid for therapist %.', v_row.therapist_id;
    end if;
    update therapists set working_hours = v_hours, updated_at = now() where id = v_row.therapist_id;
  end loop;
end $$;

-- Admin/front-desk assigning a shift takes effect immediately (the admin
-- IS the approver). Supersedes overlapping weekdays on the therapist's
-- other approved shift assignments, and closes out any pending request
-- for this therapist (a direct admin assignment resolves what the
-- therapist was asking for, even if the admin picked something different).
create or replace function public.assign_shift(
  p_therapist_id uuid,
  p_shift_template_id uuid,
  p_weekdays integer[],
  p_break_start_minute integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_shift record;
  v_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  select * into v_shift from shift_templates where id = p_shift_template_id and clinic_id = v_clinic_id and active;
  if not found then raise exception 'Shift template not found.'; end if;
  if p_weekdays is null or array_length(p_weekdays, 1) is null then
    raise exception 'At least one weekday is required.';
  end if;
  if p_break_start_minute is not null and (
    p_break_start_minute < v_shift.start_minute
    or p_break_start_minute + v_shift.break_duration_minutes > v_shift.end_minute
  ) then
    raise exception 'Break placement must fit within the shift.';
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  -- Supersede/derive BEFORE inserting the new row: apply_shift_hours's
  -- internal supersede_overlapping_weekdays() scans all currently-approved
  -- shift-based rows for this therapist. Running it before the insert
  -- keeps the brand-new assignment out of that scan, so it can't supersede
  -- itself (it would otherwise find its own weekdays as a 100% overlap and
  -- immediately flip its own just-inserted row to 'superseded').
  perform apply_shift_hours(
    p_therapist_id, p_weekdays, v_shift.start_minute, v_shift.end_minute,
    coalesce(p_break_start_minute, v_shift.default_break_start_minute), v_shift.break_duration_minutes
  );

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, shift_template_id, weekdays, break_start_minute,
    status, decided_by, decided_at
  ) values (
    v_clinic_id, p_therapist_id, p_shift_template_id, p_weekdays,
    p_break_start_minute, 'approved', auth.uid(), now()
  ) returning id into v_id;

  return v_id;
end $$;

-- Custom hours replace working_hours wholesale (unlike a shift
-- assignment, which merges by weekday) — it's a full weekly override, the
-- same meaning free-form hours always had. Supersedes every other
-- approved assignment for this therapist, shift or custom.
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

  -- Supersede/write BEFORE inserting the new row, for the same reason as
  -- assign_shift above: apply_custom_hours's supersede_all_assignments()
  -- marks every currently-approved row 'superseded'. Running it first
  -- keeps the brand-new row out of that sweep.
  perform apply_custom_hours(p_therapist_id, p_custom_hours);

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, custom_hours, status, decided_by, decided_at
  ) values (
    v_clinic_id, p_therapist_id, p_custom_hours, 'approved', auth.uid(), now()
  ) returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.create_shift_template(uuid, text, integer, integer, integer, integer) from public, anon;
revoke execute on function public.update_shift_template(uuid, text, integer, integer, integer, integer, boolean) from public, anon;
revoke execute on function public.assign_shift(uuid, uuid, integer[], integer) from public, anon;
revoke execute on function public.assign_custom_hours(uuid, jsonb) from public, anon;
grant execute on function public.create_shift_template(uuid, text, integer, integer, integer, integer) to authenticated;
grant execute on function public.update_shift_template(uuid, text, integer, integer, integer, integer, boolean) to authenticated;
grant execute on function public.assign_shift(uuid, uuid, integer[], integer) to authenticated;
grant execute on function public.assign_custom_hours(uuid, jsonb) to authenticated;
