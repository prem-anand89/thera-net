-- Per-therapist working hours. Stored on the roster row as
--   { "1": [[540, 780], [840, 1080]], ... }
-- weekday (0 = Sunday) -> minute-of-day intervals; a gap between intervals is
-- a break, a missing / empty weekday is a day off. NULL = the clinic's booking
-- hours on its open days (the behaviour before this column existed).
--
-- Written only through set_therapist_working_hours: admin and front desk for
-- anyone, a therapist for their own row. Staff bookings outside these hours
-- are allowed (the UI warns); the public form hides them.

alter table public.therapists
  add column if not exists working_hours jsonb;

create or replace function public.working_hours_valid(p_hours jsonb)
returns boolean language plpgsql immutable as $$
declare
  v_key text;
  v_day jsonb;
  v_interval jsonb;
  v_prev_end integer;
  v_start integer;
  v_end integer;
begin
  if p_hours is null then return true; end if;
  if jsonb_typeof(p_hours) <> 'object' then return false; end if;
  for v_key, v_day in select key, value from jsonb_each(p_hours) loop
    if v_key !~ '^[0-6]$' or jsonb_typeof(v_day) <> 'array' then return false; end if;
    if jsonb_array_length(v_day) > 6 then return false; end if;
    v_prev_end := -1;
    for v_interval in select value from jsonb_array_elements(v_day) loop
      if jsonb_typeof(v_interval) <> 'array' or jsonb_array_length(v_interval) <> 2 then return false; end if;
      if jsonb_typeof(v_interval -> 0) <> 'number' or jsonb_typeof(v_interval -> 1) <> 'number' then return false; end if;
      v_start := (v_interval ->> 0)::integer;
      v_end := (v_interval ->> 1)::integer;
      if v_start < 0 or v_end > 1440 or v_start >= v_end or v_start < v_prev_end then return false; end if;
      v_prev_end := v_end;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end $$;

create or replace function public.set_therapist_working_hours(
  p_therapist_id uuid,
  p_hours jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id) or is_own_therapist(v_clinic_id, p_therapist_id)) then
    raise exception 'Not authorized.';
  end if;
  if not working_hours_valid(p_hours) then
    raise exception 'Working hours must be non-overlapping times within the day, earliest first.';
  end if;
  update therapists set working_hours = p_hours, updated_at = now() where id = p_therapist_id;
end $$;

revoke execute on function public.set_therapist_working_hours(uuid, jsonb) from public, anon;
grant execute on function public.set_therapist_working_hours(uuid, jsonb) to authenticated;

-- Public availability also returns each active therapist's hours.
create or replace function public.get_booking_availability(
  p_slug text,
  p_start_date date,
  p_end_date date
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_enabled boolean;
  v_closed_weekdays integer[];
  v_closed_dates json;
  v_booked_slots json;
  v_hours json;
begin
  perform public.check_public_rpc_rate_limit('get_booking_availability', 60, 60);

  select c.id, c.enable_patient_comms, c.closed_weekdays
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
end $$;

revoke execute on function public.get_booking_availability(text, date, date) from public;
grant execute on function public.get_booking_availability(text, date, date) to anon, authenticated;
