-- Self-service, immediate, no approval — moving a fixed-duration break
-- within an already-approved shift never changes total capacity. Only
-- valid on an approved, shift_template_id-based assignment; duration is
-- never a parameter here, it cannot be changed through this RPC.
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

revoke execute on function public.set_break_placement(uuid, integer) from public, anon;
grant execute on function public.set_break_placement(uuid, integer) to authenticated;
