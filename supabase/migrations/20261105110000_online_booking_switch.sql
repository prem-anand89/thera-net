-- Split the patient-comms switch (awaiting plan, Task 1; owner approved 2026-11-05).
-- enable_patient_comms showed in Settings only as "Ask patients for feedback" but also ran the public booking page.
-- The booking page gets its own switch; enable_patient_comms now means feedback only (the column keeps its name).
-- Backfilled from the old switch, so no clinic's public page changes on the day.
-- Only the check changes in these five public functions; the feedback functions keep the old column.

alter table public.clinics
  add column if not exists online_booking_enabled boolean not null default false;

update public.clinics
  set online_booking_enabled = enable_patient_comms
  where online_booking_enabled is distinct from enable_patient_comms;

create or replace function public.get_booking_availability(p_slug text, p_start_date date, p_end_date date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_clinic_id uuid;
  v_enabled boolean;
  v_closed_weekdays integer[];
  v_closed_dates json;
  v_booked_slots json;
  v_hours json;
begin
  perform public.check_public_rpc_rate_limit('get_booking_availability', 60, 60);

  select c.id, c.online_booking_enabled, c.closed_weekdays
    into v_clinic_id, v_enabled, v_closed_weekdays
    from public.clinics c
    where c.booking_slug = p_slug;

  if not found or v_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  select coalesce(json_agg(json_build_object('date', d.closed_date, 'label', d.label)), '[]'::json)
    into v_closed_dates
    from public.clinic_closed_dates d
    where d.clinic_id = v_clinic_id
      and d.removed_at is null
      and d.closed_date between p_start_date and p_end_date;

  select coalesce(json_agg(json_build_object(
      'scheduled_at', a.scheduled_at,
      'therapist_id', a.therapist_id,
      'duration_minutes', a.duration_minutes
    )), '[]'::json)
    into v_booked_slots
    from public.appointments a
    where a.clinic_id = v_clinic_id
      and a.status <> 'cancelled'
      and a.scheduled_at >= p_start_date::timestamp
      and a.scheduled_at < (p_end_date + interval '1 day')::timestamp;

  select coalesce(json_object_agg(t.id, t.working_hours), '{}'::json)
    into v_hours
    from public.therapists t
    where t.clinic_id = v_clinic_id and t.active and t.working_hours is not null;

  return json_build_object(
    'closedWeekdays', v_closed_weekdays,
    'closedDates', v_closed_dates,
    'appointments', v_booked_slots,
    'therapistHours', v_hours
  );
end $function$;

create or replace function public.get_booking_clinic_info(p_slug text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row record;
begin
  perform public.check_public_rpc_rate_limit('get_booking_clinic_info', 30, 60);

  select name, logo_path, online_booking_enabled, slot_duration_minutes, booking_start_hour, booking_end_hour, timezone,
         operating_hours
    into v_row
    from clinics where booking_slug = p_slug;

  if not found or v_row.online_booking_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  return jsonb_build_object(
    'name', v_row.name,
    'logoPath', v_row.logo_path,
    'slotDurationMinutes', v_row.slot_duration_minutes,
    'bookingStartHour', v_row.booking_start_hour,
    'bookingEndHour', v_row.booking_end_hour,
    'timezone', v_row.timezone,
    'operatingHours', v_row.operating_hours
  );
end $function$;

create or replace function public.get_booking_clinic_name(p_slug text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_name text;
  v_enabled boolean;
begin
  perform public.check_public_rpc_rate_limit('get_booking_clinic_name', 30, 60);

  select name, online_booking_enabled into v_name, v_enabled
    from clinics where booking_slug = p_slug;

  if not found or v_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  return v_name;
end $function$;

create or replace function public.list_booking_therapists(p_slug text)
 returns table(id uuid, name text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_clinic_id uuid;
  v_enabled boolean;
begin
  perform public.check_public_rpc_rate_limit('list_booking_therapists', 30, 60);

  select c.id, c.online_booking_enabled into v_clinic_id, v_enabled
    from clinics c where c.booking_slug = p_slug;

  if not found or v_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  return query
    select t.id, t.name from therapists t
    where t.clinic_id = v_clinic_id and t.active is true and t.public_bookable is true
    order by t.name;
end $function$;

create or replace function public.submit_appointment_request(p_slug text, p_name text, p_phone text, p_email text, p_preferred_therapist_id uuid, p_notes text, p_preferred_date date, p_preferred_time_text text, p_preferred_time_of_day text default null::text, p_is_waitlist boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_clinic_id uuid;
  v_enabled boolean;
begin
  perform public.check_public_rpc_rate_limit('submit_appointment_request', 10, 60);

  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'Name and phone are required.';
  end if;

  if p_preferred_time_of_day is not null and p_preferred_time_of_day not in ('morning', 'afternoon', 'evening', 'any') then
    raise exception 'Invalid time-of-day preference.';
  end if;

  select c.id, c.online_booking_enabled into v_clinic_id, v_enabled
    from clinics c where c.booking_slug = p_slug;

  if not found or v_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  if p_preferred_therapist_id is not null then
    if not exists (select 1 from therapists where id = p_preferred_therapist_id and clinic_id = v_clinic_id) then
      raise exception 'Therapist is not a member of this clinic.';
    end if;
    if exists (select 1 from therapists where id = p_preferred_therapist_id and clinic_id = v_clinic_id and (active is false or public_bookable is false)) then
      raise exception 'This therapist is not available for online booking.';
    end if;
  end if;

  insert into appointment_requests (
    clinic_id, name, phone, email, preferred_therapist_id,
    notes, preferred_date, preferred_time_text, preferred_time_of_day, is_waitlist
  ) values (
    v_clinic_id, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    p_preferred_therapist_id,
    nullif(trim(both from p_notes), ''), p_preferred_date,
    nullif(trim(both from p_preferred_time_text), ''), p_preferred_time_of_day, p_is_waitlist
  );
end $function$;
