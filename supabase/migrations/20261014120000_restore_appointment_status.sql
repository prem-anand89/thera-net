-- Mistaken no-shows and cancellations had no way back, and a no-show who calls
-- to rebook could not be rescheduled from the appointment. Two restore RPCs and
-- a wider reschedule_appointment guard.
--
-- A no-show still holds its slot (therapist_has_overlap counts every
-- non-cancelled appointment), so restoring one cannot clash. A cancelled
-- appointment freed its slot: moving it back to an active status goes through
-- appointments_overlap_guard, which re-checks the slot and raises "already
-- scheduled" if someone booked it since. The appointments_set_updated_at
-- trigger bumps updated_at so other devices pick the change up.

create or replace function public.restore_no_show_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
begin
  select clinic_id, therapist_id, status, visit_id, reschedule_count into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not can_manage_appointment(v_appt.clinic_id, v_appt.therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status <> 'no_show' then
    raise exception 'Only a no-show can be restored.';
  end if;
  if v_appt.visit_id is not null then
    raise exception 'This appointment already has a visit.';
  end if;
  update appointments
    set status = case when v_appt.reschedule_count > 0 then 'rescheduled' else 'confirmed' end
    where id = p_appointment_id;
end $$;

create or replace function public.restore_cancelled_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
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
  -- The overlap guard re-checks the slot on this status change.
  update appointments
    set status = case when v_appt.reschedule_count > 0 then 'rescheduled' else 'confirmed' end
    where id = p_appointment_id;
end $$;

-- A no-show patient who calls back can be rebooked from the same appointment.
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_scheduled_at timestamptz,
  p_duration_minutes integer default null,
  p_therapist_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
  v_minutes integer;
  v_therapist uuid;
  v_moved boolean;
begin
  select id, clinic_id, therapist_id, scheduled_at, status, duration_minutes into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not can_manage_appointment(v_appt.clinic_id, v_appt.therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status not in ('confirmed', 'rescheduled', 'no_show') then
    raise exception 'This appointment can no longer be rescheduled.';
  end if;

  v_therapist := coalesce(p_therapist_id, v_appt.therapist_id);
  if v_therapist is distinct from v_appt.therapist_id then
    if not exists (
      select 1 from therapists where id = v_therapist and clinic_id = v_appt.clinic_id and active
    ) then
      raise exception 'Therapist is not part of this clinic.';
    end if;
    if not can_manage_appointment(v_appt.clinic_id, v_therapist) then
      raise exception 'Not authorized.';
    end if;
  end if;

  v_minutes := coalesce(p_duration_minutes, v_appt.duration_minutes);
  if v_minutes not between 5 and 240 then
    raise exception 'Appointment length must be between 5 and 240 minutes.';
  end if;

  if therapist_has_overlap(v_appt.clinic_id, v_therapist, p_new_scheduled_at, v_minutes, v_appt.id) then
    raise exception 'This therapist already has an appointment scheduled at this time.';
  end if;

  v_moved := p_new_scheduled_at <> v_appt.scheduled_at or v_therapist is distinct from v_appt.therapist_id;

  update appointments
    set previous_scheduled_at = case when v_moved then v_appt.scheduled_at else previous_scheduled_at end,
        scheduled_at = p_new_scheduled_at,
        therapist_id = v_therapist,
        duration_minutes = v_minutes,
        reschedule_count = reschedule_count + case when v_moved then 1 else 0 end,
        status = case when v_moved then 'rescheduled' else status end
    where id = v_appt.id;
end $$;

revoke execute on function public.restore_no_show_appointment(uuid) from public, anon;
grant execute on function public.restore_no_show_appointment(uuid) to authenticated;
revoke execute on function public.restore_cancelled_appointment(uuid) from public, anon;
grant execute on function public.restore_cancelled_appointment(uuid) to authenticated;
revoke execute on function public.reschedule_appointment(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, integer, uuid) to authenticated;
