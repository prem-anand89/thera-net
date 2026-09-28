-- supabase/migrations/20260928000000_audit_p0_fixes.sql
-- Fix P0 findings: cross-clinic appointment linking and therapist validation

-- 1. link_appointment_visit
create or replace function public.link_appointment_visit(
  p_appointment_id uuid,
  p_visit_id uuid,
  p_patient_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_status text;
  v_visit_id uuid;
begin
  select clinic_id, status, visit_id into v_clinic_id, v_status, v_visit_id
    from appointments where id = p_appointment_id for update;
  if v_clinic_id is null then
    raise exception 'Appointment not found.';
  end if;
  if not is_clinic_member(v_clinic_id) then
    raise exception 'Not authorized.';
  end if;
  if v_visit_id is not null then
    raise exception 'This appointment already has a linked visit.';
  end if;
  if v_status in ('cancelled', 'no_show') then
    raise exception 'This appointment can no longer be linked to a visit.';
  end if;

  if not exists (select 1 from patients where id = p_patient_id and clinic_id = v_clinic_id) then
    raise exception 'Patient not found in this clinic.';
  end if;

  if not exists (select 1 from visits where id = p_visit_id and patient_id = p_patient_id and clinic_id = v_clinic_id) then
    raise exception 'Visit does not belong to this patient or clinic.';
  end if;

  update appointments
    set patient_id = p_patient_id, visit_id = p_visit_id, status = 'arrived'
    where id = p_appointment_id;
end $$;

-- 2. create_appointment_staff
drop function if exists public.create_appointment_staff(uuid, text, text, uuid, timestamptz, uuid);

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
  if p_therapist_id is not null then
    if not exists (select 1 from clinic_members where clinic_id = p_clinic_id and user_id = p_therapist_id) then
      raise exception 'Therapist is not a member of this clinic.';
    end if;
  end if;

  insert into appointments (
    clinic_id, patient_id, patient_name, patient_phone, therapist_id, scheduled_at
  ) values (
    p_clinic_id, p_patient_id, trim(p_name), trim(p_phone), p_therapist_id, p_scheduled_at
  ) returning id into v_appointment_id;

  return v_appointment_id;
end $$;

revoke execute on function public.create_appointment_staff(uuid, text, text, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.create_appointment_staff(uuid, text, text, uuid, timestamptz, uuid) to authenticated;


-- 3. confirm_appointment_request
drop function if exists public.confirm_appointment_request(uuid, timestamptz, uuid, uuid);

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
  if p_therapist_id is not null then
    if not exists (select 1 from clinic_members where clinic_id = v_req.clinic_id and user_id = p_therapist_id) then
      raise exception 'Therapist is not a member of this clinic.';
    end if;
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


-- 4. submit_appointment_request
drop function if exists public.submit_appointment_request(text, text, text, text, uuid, text, date, text);

create function public.submit_appointment_request(
  p_slug text,
  p_name text,
  p_phone text,
  p_email text,
  p_preferred_therapist_id uuid,
  p_notes text,
  p_preferred_date date,
  p_preferred_time_text text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_enabled boolean;
begin
  perform public.check_public_rpc_rate_limit('submit_appointment_request', 10, 60);

  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'Name and phone are required.';
  end if;

  select c.id, c.enable_patient_comms into v_clinic_id, v_enabled
    from clinics c where c.booking_slug = p_slug;

  if not found or v_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  if p_preferred_therapist_id is not null then
    if not exists (select 1 from clinic_members where clinic_id = v_clinic_id and user_id = p_preferred_therapist_id) then
      raise exception 'Therapist is not a member of this clinic.';
    end if;
  end if;

  insert into appointment_requests (
    clinic_id, name, phone, email, preferred_therapist_id,
    notes, preferred_date, preferred_time_text
  ) values (
    v_clinic_id, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    p_preferred_therapist_id,
    nullif(trim(both from p_notes), ''), p_preferred_date,
    nullif(trim(both from p_preferred_time_text), '')
  );
end $$;

revoke all on function public.submit_appointment_request(
  text, text, text, text, uuid, text, date, text
) from public, anon;
grant execute on function public.submit_appointment_request(
  text, text, text, text, uuid, text, date, text
) to anon, authenticated;
