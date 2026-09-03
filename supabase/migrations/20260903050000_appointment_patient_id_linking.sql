-- ---------------------------------------------------------------------------
-- Optional patient_id linking at booking/confirm time, for the two entry
-- points where identity is genuinely unambiguous — not a relaxation of the
-- "patient_id stays null until arrival" rule documented on the appointments
-- table (see 20260830190000_public_booking.sql's own comment on that
-- column): that rule exists because a public form submission or a staff
-- member typing a name by hand carries real name/duplicate-match risk, and
-- deferring identity resolution to New Visit's own search-or-create
-- typeahead is what avoids silently mis-linking two different people who
-- share a name.
--
-- Both call sites this migration touches are cases where a human has
-- already positively identified the patient, same "human confirms
-- identity" principle, just exercised earlier:
--   - create_appointment_staff, called from the Patients list's own "Book"
--     action (BookAppointmentDialog.tsx) — the caller already clicked a
--     specific patient's row, there is no name to match, no ambiguity.
--   - confirm_appointment_request, when staff recognize a pending
--     request's name/phone as an existing patient and explicitly pick them
--     from a search field on the Confirm mini-form (optional — leaving it
--     blank keeps today's exact behavior, deferred to visit time).
--
-- Both new p_patient_id arguments default to null and are clinic-scoped
-- checked (must belong to the same clinic the appointment is being created
-- in) before being trusted.
--
-- New trailing default-valued parameter changes each function's Postgres
-- identity (name + argument types) — create or replace would silently
-- leave the old N-arg function live alongside a new N+1-arg one rather
-- than replacing it (see FEATURES_AND_SCHEMA.md §3c). Explicit drop +
-- create, one candidate signature each, in this single transaction.
-- ---------------------------------------------------------------------------

drop function if exists public.create_appointment_staff(uuid, text, text, uuid, timestamptz);

create function public.create_appointment_staff(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_therapist_id uuid,
  p_scheduled_at timestamptz,
  p_patient_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_appointment_id uuid;
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if trim(p_name) = '' then
    raise exception 'Name is required.';
  end if;
  if trim(p_phone) = '' then
    raise exception 'Phone is required.';
  end if;
  if p_patient_id is not null
     and not exists (select 1 from patients where id = p_patient_id and clinic_id = p_clinic_id) then
    raise exception 'Patient not found in this clinic.';
  end if;

  insert into appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id, scheduled_at
  ) values (
    p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id, p_scheduled_at
  ) returning id into v_appointment_id;

  return v_appointment_id;
end $$;

-- Also closes a gap the security advisor flagged once this function was
-- touched: create_appointment_staff never had the anon revoke its sibling
-- functions in this same file (confirm_appointment_request etc.) already
-- carry — the is_clinic_admin/is_front_desk check inside the body already
-- blocks an anon caller (no auth.uid()), but the grant-level revoke is the
-- defense-in-depth layer every other staff RPC here has, and this one
-- should too.
revoke execute on function public.create_appointment_staff(uuid, text, text, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.create_appointment_staff(uuid, text, text, uuid, timestamptz, uuid) to authenticated;

drop function if exists public.confirm_appointment_request(uuid, timestamptz, uuid);

create function public.confirm_appointment_request(
  p_request_id uuid,
  p_scheduled_at timestamptz,
  p_therapist_id uuid,
  p_patient_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
  v_appointment_id uuid;
begin
  select id, clinic_id, name, phone, status into v_req
    from appointment_requests where id = p_request_id for update;

  if not found then
    raise exception 'Booking request not found.';
  end if;
  if not (is_clinic_admin(v_req.clinic_id) or is_front_desk(v_req.clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been actioned.';
  end if;
  if p_patient_id is not null
     and not exists (select 1 from patients where id = p_patient_id and clinic_id = v_req.clinic_id) then
    raise exception 'Patient not found in this clinic.';
  end if;

  insert into appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id, scheduled_at, request_id
  ) values (
    v_req.clinic_id, p_patient_id, v_req.name, v_req.phone, p_therapist_id, p_scheduled_at, v_req.id
  ) returning id into v_appointment_id;

  update appointment_requests
    set status = 'confirmed', appointment_id = v_appointment_id
    where id = v_req.id;

  return v_appointment_id;
end $$;

revoke execute on function public.confirm_appointment_request(uuid, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.confirm_appointment_request(uuid, timestamptz, uuid, uuid) to authenticated;
