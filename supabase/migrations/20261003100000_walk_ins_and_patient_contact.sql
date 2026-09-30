-- 1. Patient contact: optional email and a second phone.
-- 2. "Visit in progress": a walk-in starts as an arrived appointment with no
--    visit yet (appointments.source = 'walk_in'); the therapist can write notes
--    straight away and add the service + payment later by logging the visit.
--    Nothing goes into `visits` until then, so billing, splits and reports are
--    untouched.
-- 3. consultation_notes.appointment_id: a note started from an appointment /
--    walk-in before any visit exists; when the visit is logged the client sets
--    the note's visit_id from it.

alter table public.patients
  add column if not exists email text,
  add column if not exists alt_phone text;

alter table public.appointments
  add column if not exists source text not null default 'booking';

alter table public.appointments
  drop constraint if exists appointments_source_check;
alter table public.appointments
  add constraint appointments_source_check check (source in ('booking', 'walk_in'));

alter table public.consultation_notes
  add column if not exists appointment_id uuid references public.appointments (id);

create index if not exists consultation_notes_appointment_idx
  on public.consultation_notes (appointment_id) where appointment_id is not null;

-- A walk-in is already in the room, so there is no overlap check: it may
-- sit on top of a booked slot (the therapist decides). Admin / front desk can
-- start one for anyone; a therapist for themselves. The patient may have been
-- created offline and not synced yet, so a missing patient id is allowed: the
-- row keeps name/phone and patient_id is filled in when the visit is logged
-- (link_appointment_visit), the same as appointments from public requests.
create or replace function public.start_walk_in(
  p_clinic_id uuid,
  p_therapist_id uuid,
  p_name text,
  p_phone text default null,
  p_patient_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_patient_id uuid;
  v_minutes integer;
  v_id uuid;
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

  select id into v_patient_id from patients where id = p_patient_id and clinic_id = p_clinic_id;
  select coalesce(slot_duration_minutes, 30) into v_minutes from clinics where id = p_clinic_id;

  insert into appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id,
    scheduled_at, duration_minutes, status, source
  ) values (
    p_clinic_id, v_patient_id, trim(p_name), coalesce(trim(p_phone), ''), p_therapist_id,
    date_trunc('minute', now()), v_minutes, 'arrived', 'walk_in'
  ) returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.start_walk_in(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.start_walk_in(uuid, uuid, text, text, uuid) to authenticated;
