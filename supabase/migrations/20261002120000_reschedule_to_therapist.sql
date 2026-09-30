-- Drag-to-move on the calendar can drop an appointment into another
-- therapist's column, and a resize changes only the length. reschedule_appointment
-- gains an optional p_therapist_id (drop-and-recreate, see FEATURES_AND_SCHEMA
-- pattern 3c). Reassigning needs permission over both the current and the new
-- therapist, so a therapist can move their own appointments but not hand them
-- to (or take them from) a colleague. A pure resize (same start, same
-- therapist) doesn't count as a reschedule.

drop function if exists public.reschedule_appointment(uuid, timestamptz, integer);

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
  if v_appt.status not in ('confirmed', 'rescheduled') then
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

revoke execute on function public.reschedule_appointment(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, integer, uuid) to authenticated;
