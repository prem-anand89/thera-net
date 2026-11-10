-- Fix ward rounds booking: pass p_admission_id into confirm_booking_slot and confirm_booking_series
-- so that public.appointments is inserted with admission_id and location='ward' atomically,
-- preventing trigger check_appointment_ward_has_stay from firing a false error.

drop function if exists public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid, integer, text);
create or replace function public.confirm_booking_slot(
  p_clinic_id uuid, p_name text, p_phone text, p_therapist_id uuid, p_scheduled_at timestamptz,
  p_patient_id uuid default null, p_request_id uuid default null, p_duration_minutes integer default null,
  p_location text default 'clinic', p_admission_id uuid default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_appointment_id uuid;
  v_minutes integer;
  v_staff boolean := is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id);
  v_location text := coalesce(p_location, 'clinic');
begin
  if p_therapist_id is null then
    raise exception 'Therapist selection is required to book a slot.';
  end if;
  if not exists (
    select 1 from therapists where id = p_therapist_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'Therapist is not part of this clinic.';
  end if;
  if not can_manage_appointment(p_clinic_id, p_therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if p_request_id is not null and not v_staff then
    raise exception 'Only front desk or an admin can confirm booking requests.';
  end if;

  if trim(coalesce(p_name, '')) = '' then raise exception 'Name is required.'; end if;
  if trim(coalesce(p_phone, '')) = '' then raise exception 'Phone is required.'; end if;
  if v_location not in ('clinic', 'home', 'ward') then raise exception 'Unknown location.'; end if;

  if p_patient_id is not null and not exists (
    select 1 from patients where id = p_patient_id and clinic_id = p_clinic_id
  ) then
    raise exception 'Patient not found in this clinic.';
  end if;

  if p_request_id is not null then
    perform 1 from appointment_requests
      where id = p_request_id and clinic_id = p_clinic_id and status = 'pending'
      for update;
    if not found then
      raise exception 'Booking request not found or already actioned.';
    end if;
  end if;

  select coalesce(p_duration_minutes, c.slot_duration_minutes, 30) into v_minutes
    from clinics c where c.id = p_clinic_id;
  if v_minutes not between 5 and 240 then
    raise exception 'Appointment length must be between 5 and 240 minutes.';
  end if;

  if therapist_has_overlap(p_clinic_id, p_therapist_id, p_scheduled_at, v_minutes) then
    raise exception 'This therapist already has an appointment scheduled at this time.';
  end if;

  insert into appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id,
    scheduled_at, duration_minutes, request_id, location, admission_id
  ) values (
    p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id,
    p_scheduled_at, v_minutes, p_request_id, v_location, p_admission_id
  ) returning id into v_appointment_id;

  if p_request_id is not null then
    update appointment_requests
      set status = 'confirmed', appointment_id = v_appointment_id
      where id = p_request_id and clinic_id = p_clinic_id;
  end if;

  return v_appointment_id;
end;
$function$;

revoke all on function public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid, integer, text, uuid) from public, anon;
grant execute on function public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid, integer, text, uuid) to authenticated, service_role;

drop function if exists public.confirm_booking_series(uuid, text, text, uuid, timestamptz[], uuid, integer, text);
create or replace function public.confirm_booking_series(
  p_clinic_id uuid, p_name text, p_phone text, p_therapist_id uuid, p_starts timestamptz[],
  p_patient_id uuid default null, p_duration_minutes integer default null,
  p_location text default 'clinic', p_admission_id uuid default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_series_id uuid := gen_random_uuid();
  v_minutes integer;
  v_start timestamptz;
  v_clashes text[] := '{}';
  v_location text := coalesce(p_location, 'clinic');
  i integer;
  j integer;
begin
  if p_therapist_id is null then
    raise exception 'Therapist selection is required to book a slot.';
  end if;
  if not exists (
    select 1 from therapists where id = p_therapist_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'Therapist is not part of this clinic.';
  end if;
  if not can_manage_appointment(p_clinic_id, p_therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Name is required.'; end if;
  if trim(coalesce(p_phone, '')) = '' then raise exception 'Phone is required.'; end if;
  if v_location not in ('clinic', 'home', 'ward') then raise exception 'Unknown location.'; end if;
  if p_patient_id is not null and not exists (
    select 1 from patients where id = p_patient_id and clinic_id = p_clinic_id
  ) then
    raise exception 'Patient not found in this clinic.';
  end if;
  if coalesce(array_length(p_starts, 1), 0) < 2 then
    raise exception 'A repeat booking needs at least two dates.';
  end if;
  if array_length(p_starts, 1) > 52 then
    raise exception 'A repeat booking can have at most 52 sessions.';
  end if;

  select coalesce(p_duration_minutes, c.slot_duration_minutes, 30) into v_minutes
    from clinics c where c.id = p_clinic_id;
  if v_minutes not between 5 and 240 then
    raise exception 'Appointment length must be between 5 and 240 minutes.';
  end if;

  for i in 1 .. array_length(p_starts, 1) loop
    v_start := p_starts[i];
    if therapist_has_overlap(p_clinic_id, p_therapist_id, v_start, v_minutes) then
      v_clashes := v_clashes || to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"');
      continue;
    end if;
    for j in 1 .. array_length(p_starts, 1) loop
      if j <> i
         and p_starts[j] < v_start + make_interval(mins => v_minutes)
         and p_starts[j] + make_interval(mins => v_minutes) > v_start then
        v_clashes := v_clashes || to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"');
        exit;
      end if;
    end loop;
  end loop;

  if array_length(v_clashes, 1) > 0 then
    raise exception 'These dates clash with other bookings: %', array_to_string(v_clashes, ', ');
  end if;

  insert into appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id,
    scheduled_at, duration_minutes, series_id, location, admission_id
  )
  select p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id, s, v_minutes, v_series_id, v_location, p_admission_id
  from unnest(p_starts) as s;

  return v_series_id;
end;
$function$;

revoke all on function public.confirm_booking_series(uuid, text, text, uuid, timestamptz[], uuid, integer, text, uuid) from public, anon;
grant execute on function public.confirm_booking_series(uuid, text, text, uuid, timestamptz[], uuid, integer, text, uuid) to authenticated, service_role;

-- Update book_ward_rounds to pass p_admission_id directly to confirm_booking_slot / confirm_booking_series
create or replace function public.book_ward_rounds(
  p_clinic_id uuid, p_admission_id uuid, p_therapist_id uuid, p_starts timestamptz[], p_duration_minutes integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_patient_id uuid;
  v_name text;
  v_phone text;
  v_minutes integer;
  v_id uuid;
begin
  if p_starts is null or cardinality(p_starts) = 0 then
    raise exception 'Choose at least one time.';
  end if;
  select a.patient_id, p.name, p.phone into v_patient_id, v_name, v_phone
    from admissions a join patients p on p.id = a.patient_id
    where a.id = p_admission_id and a.clinic_id = p_clinic_id and not a.deleted and a.discharged_on is null;
  if not found then
    raise exception 'A ward round must belong to a patient who is currently admitted in this clinic.' using errcode = '23514';
  end if;
  select coalesce(p_duration_minutes, nullif(c.department_hours -> 'ward' ->> 'slotMinutes', '')::integer) into v_minutes
    from clinics c where c.id = p_clinic_id;
  v_phone := coalesce(nullif(trim(v_phone), ''), '-');

  if cardinality(p_starts) = 1 then
    v_id := confirm_booking_slot(
      p_clinic_id, v_name, v_phone, p_therapist_id, p_starts[1],
      v_patient_id, null, v_minutes, 'ward', p_admission_id
    );
  else
    v_id := confirm_booking_series(
      p_clinic_id, v_name, v_phone, p_therapist_id, p_starts,
      v_patient_id, v_minutes, 'ward', p_admission_id
    );
  end if;
  return v_id;
end $$;

revoke all on function public.book_ward_rounds(uuid, uuid, uuid, timestamptz[], integer) from public, anon;
grant execute on function public.book_ward_rounds(uuid, uuid, uuid, timestamptz[], integer) to authenticated, service_role;
