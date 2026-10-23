-- Reviewing (approving / declining) a therapist's shift request is admin-only; front desk can still assign shifts directly.

create or replace function public.approve_shift_assignment(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
  v_shift record;
begin
  select * into v_req from therapist_shift_assignments where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if not is_clinic_admin(v_req.clinic_id) then
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
  if not is_clinic_admin(v_req.clinic_id) then
    raise exception 'Not authorized.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been actioned.';
  end if;
  update therapist_shift_assignments
    set status = 'declined', decided_by = auth.uid(), decided_at = now(), updated_at = now(),
        decision_note = nullif(trim(both from p_note), '')
    where id = p_request_id;
end $$;

revoke execute on function public.approve_shift_assignment(uuid) from public, anon;
grant execute on function public.approve_shift_assignment(uuid) to authenticated;
revoke execute on function public.decline_shift_assignment(uuid, text) from public, anon;
grant execute on function public.decline_shift_assignment(uuid, text) to authenticated;
