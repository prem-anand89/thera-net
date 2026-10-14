-- Review follow-ups for appointment status changes.
--
-- 1. mark_appointment_arrived only checked clinic membership, so any member (a
--    therapist included) could mark ANOTHER therapist's appointment arrived
--    through the API even though the UI scopes the button. It now uses
--    can_manage_appointment like reschedule / no-show / cancel.
-- 2. restore_cancelled_appointment refuses to bring an appointment back onto a
--    therapist who is no longer active in the clinic, or onto a day the clinic
--    has since closed (closed weekday or closed date). The overlap guard
--    already re-checks the slot itself.

create or replace function public.mark_appointment_arrived(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_therapist uuid;
  v_status text;
begin
  select clinic_id, therapist_id, status into v_clinic_id, v_therapist, v_status
    from appointments where id = p_appointment_id for update;
  if v_clinic_id is null then
    raise exception 'Appointment not found.';
  end if;
  if not can_manage_appointment(v_clinic_id, v_therapist) then
    raise exception 'Not authorized.';
  end if;
  if v_status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be marked arrived.';
  end if;
  update appointments set status = 'arrived' where id = p_appointment_id;
end $$;

create or replace function public.restore_cancelled_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
  v_day date;
  v_closed_weekdays integer[];
begin
  select clinic_id, therapist_id, status, visit_id, scheduled_at, reschedule_count into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not can_manage_appointment(v_appt.clinic_id, v_appt.therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status <> 'cancelled' then
    raise exception 'Only a cancelled appointment can be restored.';
  end if;
  if v_appt.visit_id is not null then
    raise exception 'This appointment already has a visit.';
  end if;
  if v_appt.scheduled_at < now() then
    raise exception 'That time has passed — book a new appointment instead.';
  end if;
  if v_appt.therapist_id is not null and not exists (
    select 1 from therapists where id = v_appt.therapist_id and clinic_id = v_appt.clinic_id and active
  ) then
    raise exception 'This therapist is no longer active — reschedule it to someone else.';
  end if;

  v_day := (v_appt.scheduled_at at time zone 'Asia/Kolkata')::date;
  select closed_weekdays into v_closed_weekdays from clinics where id = v_appt.clinic_id;
  if v_closed_weekdays is not null and extract(dow from v_day)::integer = any (v_closed_weekdays) then
    raise exception 'The clinic is closed that day.';
  end if;
  if exists (
    select 1 from clinic_closed_dates
    where clinic_id = v_appt.clinic_id and closed_date = v_day and removed_at is null
  ) then
    raise exception 'The clinic is closed that day.';
  end if;

  -- The overlap guard re-checks the slot on this status change.
  update appointments
    set status = case when v_appt.reschedule_count > 0 then 'rescheduled' else 'confirmed' end
    where id = p_appointment_id;
end $$;

revoke execute on function public.mark_appointment_arrived(uuid) from public, anon;
grant execute on function public.mark_appointment_arrived(uuid) to authenticated;
revoke execute on function public.restore_cancelled_appointment(uuid) from public, anon;
grant execute on function public.restore_cancelled_appointment(uuid) to authenticated;
