-- Home care and inpatient, Phase 1 schema (foundations plan, H1). Nothing changes for a clinic that does nothing:
-- every default is 'clinic', and home and ward stay behind clinics.care_locations (off until a clinic turns them on).
-- Apply BEFORE the app that sends p_location. The old app keeps working: it omits p_location and gets 'clinic'.
-- Public online booking is untouched: requests have no location, and staff choose one when they confirm.

-- Where a clinic sees patients. One location means no choice anywhere in the app.
alter table public.clinics
  add column if not exists care_locations text[] not null default '{clinic}'
    check (cardinality(care_locations) > 0 and care_locations <@ array['clinic', 'home', 'ward']::text[]);

-- One optional free-text address, for home visits.
alter table public.patients add column if not exists address text;

alter table public.appointments
  add column if not exists location text not null default 'clinic'
    check (location in ('clinic', 'home', 'ward'));

alter table public.service_catalog
  add column if not exists default_location text not null default 'clinic'
    check (default_location in ('clinic', 'home', 'ward'));

-- visits.location had no check (only the app limited it). Null stays allowed: 196 older visits have none and read as clinic.
alter table public.visits drop constraint if exists visits_location_check;
alter table public.visits add constraint visits_location_check
  check (location is null or location in ('clinic', 'home', 'ward'));

-- The three booking functions the app calls gain an optional p_location. Each body is the live definition with only
-- the location added. The old signature is dropped first: keeping both would make calls ambiguous.
-- create_appointment_staff still resolves (it calls confirm_booking_slot with 8 positional arguments and takes the
-- default). confirm_appointment_request is not called by the app and inserts the default, so it is left alone.
drop function if exists public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid, integer);
create function public.confirm_booking_slot(
  p_clinic_id uuid, p_name text, p_phone text, p_therapist_id uuid, p_scheduled_at timestamptz,
  p_patient_id uuid default null, p_request_id uuid default null, p_duration_minutes integer default null,
  p_location text default 'clinic'
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
    scheduled_at, duration_minutes, request_id, location
  ) values (
    p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id,
    p_scheduled_at, v_minutes, p_request_id, v_location
  ) returning id into v_appointment_id;

  if p_request_id is not null then
    update appointment_requests
      set status = 'confirmed', appointment_id = v_appointment_id
      where id = p_request_id and clinic_id = p_clinic_id;
  end if;

  return v_appointment_id;
end $function$;

drop function if exists public.confirm_booking_series(uuid, text, text, uuid, timestamptz[], uuid, integer);
create function public.confirm_booking_series(
  p_clinic_id uuid, p_name text, p_phone text, p_therapist_id uuid, p_starts timestamptz[],
  p_patient_id uuid default null, p_duration_minutes integer default null,
  p_location text default 'clinic'
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
    -- Clashes within the request, by position (identical starts included).
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
    scheduled_at, duration_minutes, series_id, location
  )
  select p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id, s, v_minutes, v_series_id, v_location
  from unnest(p_starts) as s;

  return v_series_id;
end $function$;

drop function if exists public.start_walk_in(uuid, uuid, text, text, uuid);
create function public.start_walk_in(
  p_clinic_id uuid, p_therapist_id uuid, p_name text, p_phone text default null, p_patient_id uuid default null,
  p_location text default 'clinic'
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_patient_id uuid;
  v_minutes integer;
  v_id uuid;
  v_location text := coalesce(p_location, 'clinic');
begin
  if p_therapist_id is null or not exists (
    select 1 from therapists where id = p_therapist_id and clinic_id = p_clinic_id and active
  ) then
    raise exception 'Therapist is not part of this clinic.';
  end if;
  if not can_manage_appointment(p_clinic_id, p_therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Name is required.'; end if;
  if v_location not in ('clinic', 'home', 'ward') then raise exception 'Unknown location.'; end if;

  select id into v_patient_id from patients where id = p_patient_id and clinic_id = p_clinic_id;
  select coalesce(slot_duration_minutes, 30) into v_minutes from clinics where id = p_clinic_id;

  insert into appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id,
    scheduled_at, duration_minutes, status, source, location
  ) values (
    p_clinic_id, v_patient_id, trim(p_name), coalesce(trim(p_phone), ''), p_therapist_id,
    date_trunc('minute', now()), v_minutes, 'arrived', 'walk_in', v_location
  ) returning id into v_id;

  return v_id;
end $function$;

-- Same access as before: signed-in users only, never anonymous (a new function is open to everyone by default).
revoke all on function public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid, integer, text) from public, anon;
revoke all on function public.confirm_booking_series(uuid, text, text, uuid, timestamptz[], uuid, integer, text) from public, anon;
revoke all on function public.start_walk_in(uuid, uuid, text, text, uuid, text) from public, anon;
grant execute on function public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.confirm_booking_series(uuid, text, text, uuid, timestamptz[], uuid, integer, text) to authenticated, service_role;
grant execute on function public.start_walk_in(uuid, uuid, text, text, uuid, text) to authenticated, service_role;
