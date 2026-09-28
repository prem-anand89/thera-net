-- Ensure staff booking RPC rejects wrong-clinic ids before patient lookup.

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
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if trim(p_name) = '' then
    raise exception 'Name is required.';
  end if;
  if trim(p_phone) = '' then
    raise exception 'Phone is required.';
  end if;
  if p_patient_id is not null
     and not exists (select 1 from patients where id = p_patient_id and clinic_id = p_clinic_id) then
    raise exception 'Patient not found in this clinic.';
  end if;

  insert into appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id, scheduled_at
  ) values (
    p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id, p_scheduled_at
  ) returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;
