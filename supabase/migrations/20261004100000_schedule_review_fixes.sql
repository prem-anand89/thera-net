-- Fixes from the schedule code review.
--
-- 1. Double booking under concurrency. The RPCs' therapist_has_overlap check
--    is a plain read under READ COMMITTED, so two bookings for the same
--    therapist and time made at the same moment could both pass. A BEFORE
--    trigger now takes a per-therapist transaction lock and re-checks, so the
--    second writer waits for the first to commit and then sees its row.
--    Walk-ins (source = 'walk_in') may overlap by design and are skipped, as
--    are cancelled rows and updates that don't move the appointment.
-- 2. confirm_booking_series compared starts by value, so two identical
--    timestamps in p_starts were never flagged as clashing with each other.
--    It now compares by array position.
-- 3. cancel_appointment_series authorised against one arbitrary row, then
--    cancelled every remaining session, even ones since moved to another
--    therapist. It now requires permission over every session it cancels.
-- 4. restore_appointment_slot: the calendar's Undo after a drag. Undo used to
--    call reschedule_appointment again, counting a second reschedule and
--    unable to return an appointment to Unassigned. This puts the previous
--    time, length, therapist, status and reschedule history back.
-- 5. therapists.working_hours is client-writable through sync; a CHECK
--    (NOT VALID: new writes only) keeps malformed JSON out, matching
--    set_therapist_working_hours' own validation.

-- 1 ---------------------------------------------------------------------------
create or replace function public.appointments_overlap_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.therapist_id is null or new.status = 'cancelled' or new.source = 'walk_in' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.scheduled_at = old.scheduled_at
     and new.duration_minutes is not distinct from old.duration_minutes
     and new.therapist_id is not distinct from old.therapist_id
     and old.status <> 'cancelled' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('appointments:therapist:' || new.therapist_id::text, 0));
  if therapist_has_overlap(new.clinic_id, new.therapist_id, new.scheduled_at, coalesce(new.duration_minutes, 30), new.id) then
    raise exception 'This therapist already has an appointment scheduled at this time.';
  end if;
  return new;
end $$;

drop trigger if exists appointments_overlap_guard on public.appointments;
create trigger appointments_overlap_guard
  before insert or update on public.appointments
  for each row execute function public.appointments_overlap_guard();

-- 2 ---------------------------------------------------------------------------
create or replace function public.confirm_booking_series(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_therapist_id uuid,
  p_starts timestamptz[],
  p_patient_id uuid default null,
  p_duration_minutes integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_series_id uuid := gen_random_uuid();
  v_minutes integer;
  v_start timestamptz;
  v_clashes text[] := '{}';
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
    scheduled_at, duration_minutes, series_id
  )
  select p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id, s, v_minutes, v_series_id
  from unnest(p_starts) as s;

  return v_series_id;
end $$;

revoke execute on function public.confirm_booking_series(uuid, text, text, uuid, timestamptz[], uuid, integer) from public, anon;
grant execute on function public.confirm_booking_series(uuid, text, text, uuid, timestamptz[], uuid, integer) to authenticated;

-- 3 ---------------------------------------------------------------------------
create or replace function public.cancel_appointment_series(
  p_series_id uuid,
  p_from timestamptz
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not exists (select 1 from appointments where series_id = p_series_id) then
    raise exception 'Series not found.';
  end if;
  -- Every session this would cancel must be one the caller may manage —
  -- sessions can have been moved to another therapist since booking.
  if exists (
    select 1 from appointments
    where series_id = p_series_id
      and scheduled_at >= p_from
      and status in ('confirmed', 'rescheduled')
      and not can_manage_appointment(clinic_id, therapist_id)
  ) then
    raise exception 'Not authorized.';
  end if;

  update appointments
    set status = 'cancelled'
    where series_id = p_series_id
      and scheduled_at >= p_from
      and status in ('confirmed', 'rescheduled');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.cancel_appointment_series(uuid, timestamptz) from public, anon;
grant execute on function public.cancel_appointment_series(uuid, timestamptz) to authenticated;

-- 4 ---------------------------------------------------------------------------
create or replace function public.restore_appointment_slot(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_therapist_id uuid,
  p_status text,
  p_reschedule_count integer,
  p_previous_scheduled_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
begin
  select id, clinic_id, therapist_id, status, reschedule_count into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not can_manage_appointment(v_appt.clinic_id, v_appt.therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be moved.';
  end if;
  if p_status not in ('confirmed', 'rescheduled') then
    raise exception 'Invalid status.';
  end if;
  -- Undo only ever winds the history back, never forward.
  if p_reschedule_count < 0 or p_reschedule_count > v_appt.reschedule_count then
    raise exception 'Invalid reschedule count.';
  end if;
  if p_duration_minutes not between 5 and 240 then
    raise exception 'Appointment length must be between 5 and 240 minutes.';
  end if;
  if p_therapist_id is distinct from v_appt.therapist_id then
    if p_therapist_id is not null and not exists (
      select 1 from therapists where id = p_therapist_id and clinic_id = v_appt.clinic_id
    ) then
      raise exception 'Therapist is not part of this clinic.';
    end if;
    -- Back to Unassigned needs admin / front desk (can_manage with null).
    if not can_manage_appointment(v_appt.clinic_id, p_therapist_id) then
      raise exception 'Not authorized.';
    end if;
  end if;

  -- The overlap trigger re-checks the restored slot.
  update appointments
    set scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        therapist_id = p_therapist_id,
        status = p_status,
        reschedule_count = p_reschedule_count,
        previous_scheduled_at = p_previous_scheduled_at
    where id = v_appt.id;
end $$;

revoke execute on function public.restore_appointment_slot(uuid, timestamptz, integer, uuid, text, integer, timestamptz) from public, anon;
grant execute on function public.restore_appointment_slot(uuid, timestamptz, integer, uuid, text, integer, timestamptz) to authenticated;

-- 5 ---------------------------------------------------------------------------
alter table public.therapists
  drop constraint if exists therapists_working_hours_valid;
alter table public.therapists
  add constraint therapists_working_hours_valid
  check (working_hours_valid(working_hours)) not valid;
