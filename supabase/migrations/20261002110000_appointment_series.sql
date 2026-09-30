-- Repeat bookings: a series of appointments booked together (e.g. Mon/Wed/Fri
-- for 8 sessions). Each occurrence is an ordinary appointments row sharing a
-- series_id, so every existing screen, RPC and sync path keeps working.

alter table public.appointments
  add column if not exists series_id uuid;

create index if not exists appointments_series_idx
  on public.appointments (series_id) where series_id is not null;

-- All-or-nothing: if any date clashes (with existing bookings or with another
-- date in the same request), nothing is booked and the error lists the clashing
-- starts as UTC ISO times (the app shows them in the clinic's local time).
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
  v_other timestamptz;
  v_clashes text[] := '{}';
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

  foreach v_start in array p_starts loop
    if therapist_has_overlap(p_clinic_id, p_therapist_id, v_start, v_minutes) then
      v_clashes := v_clashes || to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"');
      continue;
    end if;
    foreach v_other in array p_starts loop
      if v_other <> v_start
         and v_other < v_start + make_interval(mins => v_minutes)
         and v_other + make_interval(mins => v_minutes) > v_start then
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

-- "Cancel this and following": cancels every still-open session of the series
-- from p_from on. Returns how many were cancelled.
create or replace function public.cancel_appointment_series(
  p_series_id uuid,
  p_from timestamptz
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_count integer;
begin
  select clinic_id, therapist_id into v_row
    from appointments where series_id = p_series_id limit 1;
  if not found then raise exception 'Series not found.'; end if;
  if not can_manage_appointment(v_row.clinic_id, v_row.therapist_id) then
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
