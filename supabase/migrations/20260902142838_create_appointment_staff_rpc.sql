-- ---------------------------------------------------------------------------
-- Manual/staff-side appointment booking, alongside the existing public
-- patient-facing link (/book/$slug → submit_appointment_request →
-- confirm_appointment_request). Front desk/admin already know the
-- confirmed date/time/therapist when entering a booking by hand (phone
-- call, walk-in), so this goes straight to a confirmed `appointments` row
-- with no `appointment_requests` row at all (`request_id` stays null,
-- same as any other nullable FK on that table) — routing it through the
-- pending-request pipeline first would just be redundant double-entry.
-- Same admin-or-front_desk check as every other staff RPC in this file's
-- companion migrations.
-- ---------------------------------------------------------------------------
create or replace function public.create_appointment_staff(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_therapist_id uuid,
  p_scheduled_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_appointment_id uuid;
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if trim(p_name) = '' then
    raise exception 'Name is required.';
  end if;
  if trim(p_phone) = '' then
    raise exception 'Phone is required.';
  end if;

  insert into appointments (
    clinic_id, patient_name, patient_phone, therapist_id, scheduled_at
  ) values (
    p_clinic_id, trim(p_name), trim(p_phone), p_therapist_id, p_scheduled_at
  ) returning id into v_appointment_id;

  return v_appointment_id;
end $$;

grant execute on function public.create_appointment_staff(uuid, text, text, uuid, timestamptz) to authenticated;
