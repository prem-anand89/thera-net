-- Every staff path that assigns an appointment time must share the same
-- slot-duration overlap rule as confirm_booking_slot. Client-side disabled
-- slots are convenience only; this is the authoritative concurrency guard.

create or replace function public.create_appointment_staff(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_therapist_id uuid,
  p_scheduled_at timestamptz,
  p_patient_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_appointment_id uuid;
  v_slot_duration_minutes integer;
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if trim(p_name) = '' then raise exception 'Name is required.'; end if;
  if trim(p_phone) = '' then raise exception 'Phone is required.'; end if;
  if p_therapist_id is null then raise exception 'Therapist selection is required to book a slot.'; end if;
  if not exists (select 1 from clinic_members where clinic_id = p_clinic_id and user_id = p_therapist_id) then
    raise exception 'Therapist is not a member of this clinic.';
  end if;
  if p_patient_id is not null and not exists (
    select 1 from patients where id = p_patient_id and clinic_id = p_clinic_id
  ) then
    raise exception 'Patient not found in this clinic.';
  end if;

  select coalesce(slot_duration_minutes, 30) into v_slot_duration_minutes
    from clinics where id = p_clinic_id;
  if exists (
    select 1 from appointments a
    where a.clinic_id = p_clinic_id
      and a.therapist_id = p_therapist_id
      and a.status <> 'cancelled'
      and a.scheduled_at < p_scheduled_at + make_interval(mins => v_slot_duration_minutes)
      and a.scheduled_at + make_interval(mins => v_slot_duration_minutes) > p_scheduled_at
  ) then
    raise exception 'This therapist already has an appointment scheduled at this time.';
  end if;

  insert into appointments (clinic_id, patient_id, patient_name, patient_phone, therapist_id, scheduled_at)
  values (p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id, p_scheduled_at)
  returning id into v_appointment_id;
  return v_appointment_id;
end $$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_scheduled_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
  v_slot_duration_minutes integer;
begin
  select id, clinic_id, therapist_id, scheduled_at, status into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not (is_clinic_admin(v_appt.clinic_id) or is_front_desk(v_appt.clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be rescheduled.';
  end if;

  select coalesce(slot_duration_minutes, 30) into v_slot_duration_minutes
    from clinics where id = v_appt.clinic_id;
  if exists (
    select 1 from appointments a
    where a.clinic_id = v_appt.clinic_id
      and a.therapist_id = v_appt.therapist_id
      and a.id <> v_appt.id
      and a.status <> 'cancelled'
      and a.scheduled_at < p_new_scheduled_at + make_interval(mins => v_slot_duration_minutes)
      and a.scheduled_at + make_interval(mins => v_slot_duration_minutes) > p_new_scheduled_at
  ) then
    raise exception 'This therapist already has an appointment scheduled at this time.';
  end if;

  update appointments
    set previous_scheduled_at = v_appt.scheduled_at,
        scheduled_at = p_new_scheduled_at,
        reschedule_count = reschedule_count + 1,
        status = 'rescheduled'
    where id = v_appt.id;
end $$;

revoke execute on function public.create_appointment_staff(uuid, text, text, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.create_appointment_staff(uuid, text, text, uuid, timestamptz, uuid) to authenticated;
