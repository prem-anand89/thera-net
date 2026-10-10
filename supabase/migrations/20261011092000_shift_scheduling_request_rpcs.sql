-- Therapist requesting a shift change — pending until approved. Replaces
-- (supersedes) any existing unactioned pending row for this therapist so
-- requests don't stack.
create or replace function public.request_shift_assignment(
  p_therapist_id uuid,
  p_shift_template_id uuid,
  p_weekdays integer[],
  p_break_start_minute integer default null,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_shift record;
  v_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not is_own_therapist(v_clinic_id, p_therapist_id) then
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

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, shift_template_id, weekdays, break_start_minute, note, status, requested_by
  ) values (
    v_clinic_id, p_therapist_id, p_shift_template_id, p_weekdays, p_break_start_minute, nullif(trim(both from p_note), ''), 'pending', auth.uid()
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
  if not working_hours_valid(p_custom_hours) then
    raise exception 'Working hours must be non-overlapping times within the day, earliest first.';
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, custom_hours, note, status, requested_by
  ) values (
    v_clinic_id, p_therapist_id, p_custom_hours, nullif(trim(both from p_note), ''), 'pending', auth.uid()
  ) returning id into v_id;

  return v_id;
end $$;

-- Approves either path (shift or custom hours) — branches on
-- shift_template_id, then delegates to the same apply_shift_hours/
-- apply_custom_hours helpers (Task 1) that assign_shift/assign_custom_hours
-- (Task 2) use directly, since approving IS the same effect as an admin
-- assigning it directly, just reached via the request queue.
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
  else
    perform apply_custom_hours(v_req.therapist_id, v_req.custom_hours);
  end if;

  update therapist_shift_assignments set status = 'approved', decided_by = auth.uid(), decided_at = now()
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
    set status = 'declined', decided_by = auth.uid(), decided_at = now(), note = coalesce(nullif(trim(both from p_note), ''), note)
    where id = p_request_id;
end $$;

-- Therapists can no longer write working_hours directly — every path now
-- goes through a request/assign RPC above, which all converge on
-- derive_working_hours. Admin/front-desk keep direct access (they ARE
-- the approver) for any remaining callers during migration, though new
-- UI should prefer assign_shift/assign_custom_hours.
create or replace function public.set_therapist_working_hours(
  p_therapist_id uuid,
  p_hours jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if not working_hours_valid(p_hours) then
    raise exception 'Working hours must be non-overlapping times within the day, earliest first.';
  end if;
  update therapists set working_hours = p_hours, updated_at = now() where id = p_therapist_id;
end $$;

revoke execute on function public.request_shift_assignment(uuid, uuid, integer[], integer, text) from public, anon;
revoke execute on function public.request_custom_hours(uuid, jsonb, text) from public, anon;
revoke execute on function public.approve_shift_assignment(uuid) from public, anon;
revoke execute on function public.decline_shift_assignment(uuid, text) from public, anon;
grant execute on function public.request_shift_assignment(uuid, uuid, integer[], integer, text) to authenticated;
grant execute on function public.request_custom_hours(uuid, jsonb, text) to authenticated;
grant execute on function public.approve_shift_assignment(uuid) to authenticated;
grant execute on function public.decline_shift_assignment(uuid, text) to authenticated;
