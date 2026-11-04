-- Editing an assignment's weekdays down (e.g. Mon–Sat → Mon–Fri) left the
-- removed day switched on: assign_shift inserts a new row, and
-- supersede_overlapping_weekdays only trims the OLD row down to the days the
-- new one does not cover (Sat), so the old row lives on with Saturday and
-- rebuild_working_hours_from_shifts keeps it.
--
-- Fix: assign_shift takes an optional p_replaces — the id of the approved
-- shift assignment being edited. That row is superseded entirely before the
-- hours are rebuilt, so any day the admin unticked goes off. Other approved
-- rows (a therapist's second shift type on other days) are still only
-- trimmed where they overlap, exactly as before. A call without p_replaces
-- (a new assignment) behaves as it always did.

drop function if exists public.assign_shift(uuid, uuid, integer[], integer);

create function public.assign_shift(
  p_therapist_id uuid,
  p_shift_template_id uuid,
  p_weekdays integer[],
  p_break_start_minute integer default null,
  p_replaces uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- The row being edited must be this therapist's approved shift row. If it
  -- was already superseded (another device changed it first), carry on as a
  -- plain new assignment rather than failing the admin's save.
  if p_replaces is not null then
    update therapist_shift_assignments set status = 'superseded', updated_at = now()
      where id = p_replaces
        and therapist_id = p_therapist_id
        and status = 'approved'
        and shift_template_id is not null;
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  -- Supersede/derive BEFORE inserting the new row: apply_shift_hours's
  -- internal supersede_overlapping_weekdays() scans all currently-approved
  -- shift-based rows for this therapist. Running it before the insert
  -- keeps the brand-new assignment out of that scan, so it can't supersede
  -- itself (it would otherwise find its own weekdays as a 100% overlap).
  -- The replaced row is already superseded above, so the rebuild inside
  -- apply_shift_hours no longer sees its days.
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
end $function$;

revoke execute on function public.assign_shift(uuid, uuid, integer[], integer, uuid) from public, anon;
grant execute on function public.assign_shift(uuid, uuid, integer[], integer, uuid) to authenticated;
