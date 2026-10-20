-- Clinic region: the time zone every server-sent time uses (emails, push, the daily agenda,
-- the public booking page) and the default country code for new phone numbers. Defaults keep
-- every existing clinic exactly as it is today (India).

alter table public.clinics
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists default_country_code text not null default '+91';

alter table public.clinics
  add constraint clinics_default_country_code_format check (default_country_code ~ '^\+[0-9]{1,4}$');

-- A check constraint cannot look up pg_timezone_names, so a trigger refuses names Postgres
-- does not know ("Asia/Kolkata" yes, "India" no). Without it a typo would break every
-- server-side time conversion for the clinic.
create or replace function public.clinics_validate_timezone() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone;
  end if;
  return new;
end $$;

drop trigger if exists clinics_validate_timezone on public.clinics;
create trigger clinics_validate_timezone
  before insert or update of timezone on public.clinics
  for each row execute function public.clinics_validate_timezone();

-- The public booking page reads the zone from here (it has no login).
create or replace function public.get_booking_clinic_info(p_slug text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row record;
begin
  perform public.check_public_rpc_rate_limit('get_booking_clinic_info', 30, 60);

  select name, logo_path, enable_patient_comms, slot_duration_minutes, booking_start_hour, booking_end_hour, timezone
    into v_row
    from clinics where booking_slug = p_slug;

  if not found or v_row.enable_patient_comms is not true then
    raise exception 'This booking page is not available.';
  end if;

  return jsonb_build_object(
    'name', v_row.name,
    'logoPath', v_row.logo_path,
    'slotDurationMinutes', v_row.slot_duration_minutes,
    'bookingStartHour', v_row.booking_start_hour,
    'bookingEndHour', v_row.booking_end_hour,
    'timezone', v_row.timezone
  );
end $$;

-- Closed-day check in restore_cancelled_appointment: the day is the clinic's local day, not India's.
create or replace function public.restore_cancelled_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
  v_day date;
  v_tz text;
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

  select closed_weekdays, timezone into v_closed_weekdays, v_tz from clinics where id = v_appt.clinic_id;
  v_day := (v_appt.scheduled_at at time zone coalesce(v_tz, 'Asia/Kolkata'))::date;
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

revoke execute on function public.restore_cancelled_appointment(uuid) from public, anon;
grant execute on function public.restore_cancelled_appointment(uuid) to authenticated;
