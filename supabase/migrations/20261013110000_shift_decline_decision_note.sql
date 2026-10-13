alter table public.therapist_shift_assignments add column if not exists decision_note text;

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
        decision_note = nullif(trim(both from p_note), '')
    where id = p_request_id;
end $$;

revoke execute on function public.decline_shift_assignment(uuid, text) from public, anon;
grant execute on function public.decline_shift_assignment(uuid, text) to authenticated;
