-- Waitlist: extend appointment_requests rather than a parallel table.
-- A waitlist entry is structurally a normal request (name/phone/email/
-- preferred therapist/date/notes) — the only new things are a structured
-- time-of-day preference (for matching a newly-freed slot) and a cosmetic
-- flag so patient-facing copy and staff filtering can tell a "day was full"
-- join apart from an ordinary request. Confirming either already creates
-- the Appointment and moves the request off the pending set — the
-- auto-resolve behavior falls out of the existing confirm_appointment_request
-- RPC, unchanged.

alter table appointment_requests
  add column preferred_time_of_day text
    check (preferred_time_of_day in ('morning', 'afternoon', 'evening', 'any')),
  add column is_waitlist boolean not null default false;

-- 1. submit_appointment_request: add p_preferred_time_of_day, p_is_waitlist
--    (the public, anonymous path — a patient joining via the booking page).
drop function if exists public.submit_appointment_request(text, text, text, text, uuid, text, date, text);

create function public.submit_appointment_request(
  p_slug text,
  p_name text,
  p_phone text,
  p_email text,
  p_preferred_therapist_id uuid,
  p_notes text,
  p_preferred_date date,
  p_preferred_time_text text,
  p_preferred_time_of_day text default null,
  p_is_waitlist boolean default false
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

  if p_preferred_time_of_day is not null and p_preferred_time_of_day not in ('morning', 'afternoon', 'evening', 'any') then
    raise exception 'Invalid time-of-day preference.';
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
    notes, preferred_date, preferred_time_text, preferred_time_of_day, is_waitlist
  ) values (
    v_clinic_id, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    p_preferred_therapist_id,
    nullif(trim(both from p_notes), ''), p_preferred_date,
    nullif(trim(both from p_preferred_time_text), ''), p_preferred_time_of_day, p_is_waitlist
  );
end $$;

revoke all on function public.submit_appointment_request(
  text, text, text, text, uuid, text, date, text, text, boolean
) from public, anon;
grant execute on function public.submit_appointment_request(
  text, text, text, text, uuid, text, date, text, text, boolean
) to anon, authenticated;

-- 2. add_waitlist_entry: the staff-entered path (e.g. a phone call-in).
--    Same shape as submit_appointment_request, minus the public rate limit
--    and booking-slug lookup — caller is already inside the clinic.
create function public.add_waitlist_entry(
  p_clinic_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_preferred_therapist_id uuid,
  p_notes text,
  p_preferred_date date,
  p_preferred_time_of_day text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'Name and phone are required.';
  end if;
  if p_preferred_time_of_day is not null and p_preferred_time_of_day not in ('morning', 'afternoon', 'evening', 'any') then
    raise exception 'Invalid time-of-day preference.';
  end if;
  if p_preferred_therapist_id is not null then
    if not exists (select 1 from clinic_members where clinic_id = p_clinic_id and user_id = p_preferred_therapist_id) then
      raise exception 'Therapist is not a member of this clinic.';
    end if;
  end if;

  insert into appointment_requests (
    clinic_id, name, phone, email, preferred_therapist_id,
    notes, preferred_date, preferred_time_of_day, is_waitlist
  ) values (
    p_clinic_id, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    p_preferred_therapist_id,
    nullif(trim(both from p_notes), ''), p_preferred_date, p_preferred_time_of_day, true
  ) returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.add_waitlist_entry(uuid, text, text, text, uuid, text, date, text) from public, anon;
grant execute on function public.add_waitlist_entry(uuid, text, text, text, uuid, text, date, text) to authenticated;
