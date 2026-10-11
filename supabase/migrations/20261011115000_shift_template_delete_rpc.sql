-- RPC to allow deleting unused shift templates (or inactive templates with no active assignments)
-- Cleanly removes superseded assignments and prevents deleting actively assigned templates.

create or replace function public.delete_shift_template(
  p_template_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_active_usage integer;
begin
  select clinic_id into v_clinic_id from shift_templates where id = p_template_id;
  if not found then raise exception 'Shift template not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;

  select count(*) into v_active_usage
  from therapist_shift_assignments
  where shift_template_id = p_template_id and status in ('approved', 'pending');

  if v_active_usage > 0 then
    raise exception 'Cannot delete template that is currently assigned to staff. Deactivate it or unassign staff first.';
  end if;

  -- Clean up any historical/superseded assignments bound to this template before deleting
  delete from therapist_shift_assignments where shift_template_id = p_template_id;
  delete from shift_templates where id = p_template_id;
end $$;
