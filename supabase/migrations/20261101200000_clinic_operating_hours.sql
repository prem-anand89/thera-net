-- Clinics that close in the middle of the day (a lunch break, or morning and evening sessions).
--
-- clinics.operating_hours: the real open intervals per weekday, in the same shape as therapists.working_hours
-- ({"0".."6": [[startMinute, endMinute], ...]}, at most 4 intervals a day, in order, no overlaps). NULL = the old
-- behaviour: one block from booking_start_hour to booking_end_hour. A weekday with no entry also falls back to that block.
-- Weekly closed days (closed_weekdays) and holidays are separate and unchanged.
--
-- booking_start_hour / booking_end_hour stay as the OUTER ENVELOPE the grid spans. A trigger derives them from
-- operating_hours (earliest start rounded down, latest end rounded up) whenever operating_hours is set, so the two can
-- never drift apart no matter which client wrote them.
--
-- get_booking_clinic_info returns operatingHours so the public booking page does not offer a time inside a closure.
-- Nothing here refuses a booking request or a staff booking: a closure only hides times from the public page, and staff
-- get a warning in the app.
--
-- Idempotent.

alter table public.clinics add column if not exists operating_hours jsonb;

create or replace function public.operating_hours_problem(p jsonb)
returns text
language plpgsql immutable as $$
declare
  d record;
  pr jsonb;
  v_prev numeric;
  v_start numeric;
  v_end numeric;
begin
  if p is null then
    return null;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return 'Hours must be given by weekday.';
  end if;
  for d in select key, value from jsonb_each(p) loop
    if d.key !~ '^[0-6]$' then
      return 'Unknown weekday ' || d.key || '.';
    end if;
    if jsonb_typeof(d.value) <> 'array' then
      return 'Each weekday needs a list of sessions.';
    end if;
    if jsonb_array_length(d.value) > 4 then
      return 'No more than 4 sessions a day.';
    end if;
    v_prev := -1;
    for pr in select value from jsonb_array_elements(d.value) loop
      if jsonb_typeof(pr) <> 'array' or jsonb_array_length(pr) <> 2
         or jsonb_typeof(pr -> 0) <> 'number' or jsonb_typeof(pr -> 1) <> 'number' then
        return 'Each session needs a start and an end.';
      end if;
      v_start := (pr ->> 0)::numeric;
      v_end := (pr ->> 1)::numeric;
      if v_start <> floor(v_start) or v_end <> floor(v_end) then
        return 'Times must be whole minutes.';
      end if;
      if v_start < 0 or v_end > 1440 or v_start >= v_end then
        return 'Each session must start before it ends, within one day.';
      end if;
      if v_start < v_prev then
        return 'Sessions overlap; keep them in order.';
      end if;
      v_prev := v_end;
    end loop;
  end loop;
  return null;
end $$;

create or replace function public.clinics_apply_operating_hours()
returns trigger
language plpgsql as $$
declare
  v_problem text;
  v_min numeric;
  v_max numeric;
begin
  if new.operating_hours is null then
    return new;
  end if;
  v_problem := public.operating_hours_problem(new.operating_hours);
  if v_problem is not null then
    raise exception 'Clinic hours: %', v_problem;
  end if;
  select min((pr ->> 0)::numeric), max((pr ->> 1)::numeric)
    into v_min, v_max
    from jsonb_each(new.operating_hours) as d(k, v), jsonb_array_elements(d.v) as pr;
  if v_min is not null then
    new.booking_start_hour := greatest(0, floor(v_min / 60))::int;
    new.booking_end_hour := least(24, ceil(v_max / 60))::int;
  end if;
  return new;
end $$;

drop trigger if exists clinics_apply_operating_hours on public.clinics;
create trigger clinics_apply_operating_hours
  before insert or update of operating_hours on public.clinics
  for each row execute function public.clinics_apply_operating_hours();

create or replace function public.get_booking_clinic_info(p_slug text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row record;
begin
  perform public.check_public_rpc_rate_limit('get_booking_clinic_info', 30, 60);

  select name, logo_path, enable_patient_comms, slot_duration_minutes, booking_start_hour, booking_end_hour, timezone,
         operating_hours
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
    'timezone', v_row.timezone,
    'operatingHours', v_row.operating_hours
  );
end $$;
