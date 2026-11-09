-- Separate booking slots per department (Home care and IP book too).
-- OP keeps the existing clinic columns; Home care and IP are optional overrides that inherit OP when absent.
--   clinics.department_hours       {"home": {...}, "ward": {...}} (keys: startHour, endHour, operating, closedWeekdays,
--                                   slotMinutes, startStepMinutes); the app resolves inheritance (departmentHours()).
--   clinic_closed_dates.departments a holiday can close some departments only; null = every department.
--   appointments.admission_id       a ward round belongs to a live stay; set <=> location = 'ward' (checked at commit,
--                                   so the booking functions below can insert the row first and attach the stay after).
--   book_ward_rounds                books one or several rounds for an admitted patient in one transaction.

alter table public.clinics
  add column if not exists department_hours jsonb
  check (department_hours is null or jsonb_typeof(department_hours) = 'object');

alter table public.clinic_closed_dates
  add column if not exists departments text[]
  check (departments is null or (cardinality(departments) > 0 and departments <@ array['clinic', 'home', 'ward']::text[]));

alter table public.appointments
  add column if not exists admission_id uuid references public.admissions (id);

create index if not exists appointments_admission_idx on public.appointments (admission_id) where admission_id is not null;

-- Same patient, same clinic, and a live open stay when the round is first attached. Later edits (cancel, mark
-- attended after the patient went home) are not blocked: the stay is only judged when admission_id is set or changed.
create or replace function public.check_appointment_admission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.admission_id is not null
     and (tg_op = 'INSERT' or new.admission_id is distinct from old.admission_id) then
    if not exists (
      select 1 from admissions a
      where a.id = new.admission_id and a.clinic_id = new.clinic_id and not a.deleted and a.discharged_on is null
        and (new.patient_id is null or a.patient_id = new.patient_id)
    ) then
      raise exception 'A ward round must belong to a patient who is currently admitted in this clinic.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists appointments_check_admission on public.appointments;
create trigger appointments_check_admission before insert or update of admission_id, patient_id, clinic_id on public.appointments
  for each row execute function public.check_appointment_admission();

-- Ward <=> stay, judged when the transaction commits (a CHECK cannot be deferred, a constraint trigger can).
create or replace function public.check_appointment_ward_has_stay() returns trigger
language plpgsql as $$
begin
  if (coalesce(new.location, 'clinic') = 'ward') is distinct from (new.admission_id is not null) then
    raise exception 'An IP booking needs an admitted patient, and only IP bookings have one.' using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists appointments_ward_has_stay on public.appointments;
create constraint trigger appointments_ward_has_stay after insert or update of location, admission_id on public.appointments
  deferrable initially deferred
  for each row execute function public.check_appointment_ward_has_stay();

-- Books ward rounds for an admitted patient. One start = one appointment (returns its id); several = a series (returns
-- the series id). Reuses the live booking functions, so the overlap, therapist and permission checks are the same.
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
    raise exception 'That patient is not currently admitted.';
  end if;
  select coalesce(p_duration_minutes, nullif(c.department_hours -> 'ward' ->> 'slotMinutes', '')::integer) into v_minutes
    from clinics c where c.id = p_clinic_id;
  -- confirm_booking_* require a phone; a patient without one is booked under a dash.
  v_phone := coalesce(nullif(trim(v_phone), ''), '-');

  if cardinality(p_starts) = 1 then
    v_id := confirm_booking_slot(p_clinic_id, v_name, v_phone, p_therapist_id, p_starts[1], v_patient_id, null, v_minutes, 'ward');
    update appointments set admission_id = p_admission_id where id = v_id;
  else
    v_id := confirm_booking_series(p_clinic_id, v_name, v_phone, p_therapist_id, p_starts, v_patient_id, v_minutes, 'ward');
    update appointments set admission_id = p_admission_id where series_id = v_id;
  end if;
  return v_id;
end $$;

revoke all on function public.book_ward_rounds(uuid, uuid, uuid, timestamptz[], integer) from public, anon;
grant execute on function public.book_ward_rounds(uuid, uuid, uuid, timestamptz[], integer) to authenticated, service_role;
