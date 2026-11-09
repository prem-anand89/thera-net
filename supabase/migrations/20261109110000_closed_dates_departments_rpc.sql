-- Department-scoped clinic closures, public availability, and appointment restore guards

-- 1. set_clinic_closed_dates: drop old overload first to avoid signature ambiguity (4 vs 5 params)
drop function if exists public.set_clinic_closed_dates(uuid, date, date, text);
drop function if exists public.set_clinic_closed_dates(uuid, date, date, text, text[]);

create or replace function public.set_clinic_closed_dates(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_label text default null,
  p_departments text[] default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a valid date range.';
  end if;
  if p_to - p_from > 366 then
    raise exception 'A closure can be at most one year long.';
  end if;

  insert into clinic_closed_dates (clinic_id, closed_date, label, departments)
    select p_clinic_id, d::date, nullif(trim(coalesce(p_label, '')), ''), p_departments
    from generate_series(p_from, p_to, interval '1 day') d
  on conflict (clinic_id, closed_date) do update
    set label = excluded.label, departments = excluded.departments, removed_at = null;
end $$;

revoke execute on function public.set_clinic_closed_dates(uuid, date, date, text, text[]) from public, anon;
grant execute on function public.set_clinic_closed_dates(uuid, date, date, text, text[]) to authenticated;

-- 2. get_booking_availability: returns only closed dates that apply to OP ('clinic')
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
      and d.closed_date between p_start_date and p_end_date
      and (d.departments is null or 'clinic' = any(d.departments));

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

revoke execute on function public.get_booking_availability(text, date, date) from public;
grant execute on function public.get_booking_availability(text, date, date) to anon, authenticated;

-- 3. restore_cancelled_appointment: checks closed dates against appointment's own department
create or replace function public.restore_cancelled_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
  v_day date;
  v_tz text;
  v_closed_weekdays integer[];
  v_dept text;
begin
  select clinic_id, therapist_id, status, visit_id, scheduled_at, reschedule_count, location into v_appt
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

  v_dept := coalesce(v_appt.location, 'clinic');
  if exists (
    select 1 from clinic_closed_dates
    where clinic_id = v_appt.clinic_id
      and closed_date = v_day
      and removed_at is null
      and (departments is null or v_dept = any(departments))
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
