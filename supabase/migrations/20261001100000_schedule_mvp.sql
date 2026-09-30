-- Schedule MVP: appointment durations, therapist-scoped booking, clinic
-- closures editable from the calendar.
--
-- 1. Fixes the therapist check in confirm_booking_slot / create_appointment_staff:
--    p_therapist_id is a therapists.id (a roster row), never an auth user id,
--    so checking it against clinic_members.user_id rejected every booking.
-- 2. appointments.duration_minutes — blocks on the calendar have real lengths
--    and every overlap check uses each row's own duration.
-- 3. can_manage_appointment — admin / front desk manage every appointment;
--    a therapist manages only appointments assigned to their own roster row.
-- 4. clinic_closed_dates gets RLS (it had none), a unique date per clinic,
--    updated_at for sync, and removed_at as a soft delete (the sync pull
--    only sees upserts), plus set/remove RPCs.

-- ---------------------------------------------------------------------------
-- Durations
-- ---------------------------------------------------------------------------
alter table public.appointments
  add column if not exists duration_minutes integer;

update public.appointments a
  set duration_minutes = coalesce(c.slot_duration_minutes, 30)
  from public.clinics c
  where c.id = a.clinic_id and a.duration_minutes is null;

alter table public.appointments
  alter column duration_minutes set default 30,
  alter column duration_minutes set not null,
  add constraint appointments_duration_minutes_check
    check (duration_minutes between 5 and 240);

-- ---------------------------------------------------------------------------
-- Permission helper
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_appointment(p_clinic uuid, p_therapist_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_clinic_admin(p_clinic)
      or is_front_desk(p_clinic)
      or (p_therapist_id is not null and is_own_therapist(p_clinic, p_therapist_id));
$$;

revoke execute on function public.can_manage_appointment(uuid, uuid) from public, anon;
grant execute on function public.can_manage_appointment(uuid, uuid) to authenticated;

-- Shared overlap test: does any live appointment for this therapist
-- intersect [p_start, p_start + p_minutes)?
create or replace function public.therapist_has_overlap(
  p_clinic uuid,
  p_therapist_id uuid,
  p_start timestamptz,
  p_minutes integer,
  p_ignore_id uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from appointments a
    where a.clinic_id = p_clinic
      and a.therapist_id = p_therapist_id
      and a.status <> 'cancelled'
      and (p_ignore_id is null or a.id <> p_ignore_id)
      and a.scheduled_at < p_start + make_interval(mins => p_minutes)
      and a.scheduled_at + make_interval(mins => a.duration_minutes) > p_start
  );
$$;

revoke execute on function public.therapist_has_overlap(uuid, uuid, timestamptz, integer, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- confirm_booking_slot (adds p_duration_minutes, therapist scope)
-- ---------------------------------------------------------------------------
drop function if exists public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid);

create or replace function public.confirm_booking_slot(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_therapist_id uuid,
  p_scheduled_at timestamptz,
  p_patient_id uuid default null,
  p_request_id uuid default null,
  p_duration_minutes integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_appointment_id uuid;
  v_minutes integer;
  v_staff boolean := is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id);
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
    scheduled_at, duration_minutes, request_id
  ) values (
    p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id,
    p_scheduled_at, v_minutes, p_request_id
  ) returning id into v_appointment_id;

  if p_request_id is not null then
    update appointment_requests
      set status = 'confirmed', appointment_id = v_appointment_id
      where id = p_request_id and clinic_id = p_clinic_id;
  end if;

  return v_appointment_id;
end $$;

revoke execute on function public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid, integer) from public, anon;
grant execute on function public.confirm_booking_slot(uuid, text, text, uuid, timestamptz, uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- create_appointment_staff (Patients page "Book"): same therapist fix and
-- per-row overlap; stays admin/front desk only.
-- ---------------------------------------------------------------------------
create or replace function public.create_appointment_staff(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_therapist_id uuid,
  p_scheduled_at timestamptz,
  p_patient_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  return confirm_booking_slot(
    p_clinic_id, p_name, p_phone, p_therapist_id, p_scheduled_at, p_patient_id, null, null
  );
end $$;

-- ---------------------------------------------------------------------------
-- reschedule_appointment (adds optional new length, therapist scope)
-- ---------------------------------------------------------------------------
drop function if exists public.reschedule_appointment(uuid, timestamptz);

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_scheduled_at timestamptz,
  p_duration_minutes integer default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
  v_minutes integer;
begin
  select id, clinic_id, therapist_id, scheduled_at, status, duration_minutes into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not can_manage_appointment(v_appt.clinic_id, v_appt.therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be rescheduled.';
  end if;

  v_minutes := coalesce(p_duration_minutes, v_appt.duration_minutes);
  if v_minutes not between 5 and 240 then
    raise exception 'Appointment length must be between 5 and 240 minutes.';
  end if;

  if therapist_has_overlap(v_appt.clinic_id, v_appt.therapist_id, p_new_scheduled_at, v_minutes, v_appt.id) then
    raise exception 'This therapist already has an appointment scheduled at this time.';
  end if;

  update appointments
    set previous_scheduled_at = v_appt.scheduled_at,
        scheduled_at = p_new_scheduled_at,
        duration_minutes = v_minutes,
        reschedule_count = reschedule_count + 1,
        status = 'rescheduled'
    where id = v_appt.id;
end $$;

revoke execute on function public.reschedule_appointment(uuid, timestamptz, integer) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel / no-show: therapist may act on own appointments
-- ---------------------------------------------------------------------------
create or replace function public.mark_appointment_no_show(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
begin
  select clinic_id, therapist_id, status into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not can_manage_appointment(v_appt.clinic_id, v_appt.therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be marked no-show.';
  end if;
  update appointments set status = 'no_show' where id = p_appointment_id;
end $$;

create or replace function public.cancel_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
begin
  select clinic_id, therapist_id, status into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not can_manage_appointment(v_appt.clinic_id, v_appt.therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be cancelled.';
  end if;
  update appointments set status = 'cancelled' where id = p_appointment_id;
end $$;

-- ---------------------------------------------------------------------------
-- Clinic closures
-- ---------------------------------------------------------------------------
alter table public.clinic_closed_dates
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists removed_at timestamptz;

-- Collapse any duplicates before the unique constraint.
delete from public.clinic_closed_dates d
  using public.clinic_closed_dates newer
  where d.clinic_id = newer.clinic_id
    and d.closed_date = newer.closed_date
    and d.created_at < newer.created_at;

alter table public.clinic_closed_dates
  add constraint clinic_closed_dates_clinic_date_key unique (clinic_id, closed_date);

drop trigger if exists clinic_closed_dates_set_updated_at on public.clinic_closed_dates;
create trigger clinic_closed_dates_set_updated_at
  before update on public.clinic_closed_dates
  for each row execute function public.set_updated_at();

alter table public.clinic_closed_dates enable row level security;

drop policy if exists clinic_closed_dates_select on public.clinic_closed_dates;
create policy clinic_closed_dates_select on public.clinic_closed_dates
  for select using (is_clinic_member(clinic_id));
-- No insert/update/delete policies: writes go through the RPCs below.

create or replace function public.set_clinic_closed_dates(
  p_clinic_id uuid,
  p_from date,
  p_to date,
  p_label text default null
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

  insert into clinic_closed_dates (clinic_id, closed_date, label)
    select p_clinic_id, d::date, nullif(trim(coalesce(p_label, '')), '')
    from generate_series(p_from, p_to, interval '1 day') d
  on conflict (clinic_id, closed_date) do update
    set label = excluded.label, removed_at = null;
end $$;

create or replace function public.remove_clinic_closed_dates(
  p_clinic_id uuid,
  p_from date,
  p_to date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  update clinic_closed_dates
    set removed_at = now()
    where clinic_id = p_clinic_id
      and closed_date between p_from and p_to
      and removed_at is null;
end $$;

revoke execute on function public.set_clinic_closed_dates(uuid, date, date, text) from public, anon;
revoke execute on function public.remove_clinic_closed_dates(uuid, date, date) from public, anon;
grant execute on function public.set_clinic_closed_dates(uuid, date, date, text) to authenticated;
grant execute on function public.remove_clinic_closed_dates(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Public availability: live closures only, no cancelled rows, with lengths
-- ---------------------------------------------------------------------------
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

  return json_build_object(
    'closedWeekdays', v_closed_weekdays,
    'closedDates', v_closed_dates,
    'appointments', v_booked_slots
  );
end $$;

revoke execute on function public.get_booking_availability(text, date, date) from public;
grant execute on function public.get_booking_availability(text, date, date) to anon, authenticated;
