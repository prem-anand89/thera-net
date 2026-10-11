-- Separate "shows on the public online-booking page" from "active on the internal roster/schedule".
alter table public.therapists
  add column if not exists public_bookable boolean not null default true;

create or replace function public.list_booking_therapists(p_slug text)
returns table (id uuid, name text)
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_enabled boolean;
begin
  perform public.check_public_rpc_rate_limit('list_booking_therapists', 30, 60);

  select c.id, c.enable_patient_comms into v_clinic_id, v_enabled
    from clinics c where c.booking_slug = p_slug;

  if not found or v_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  return query
    select t.id, t.name from therapists t
    where t.clinic_id = v_clinic_id and t.active is true and t.public_bookable is true
    order by t.name;
end $$;

create or replace function public.submit_appointment_request(p_slug text, p_name text, p_phone text, p_email text, p_preferred_therapist_id uuid, p_notes text, p_preferred_date date, p_preferred_time_text text, p_preferred_time_of_day text DEFAULT NULL::text, p_is_waitlist boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Hidden from online booking: refuse a stale/forged preference server-side.
    if exists (select 1 from therapists where id = p_preferred_therapist_id and clinic_id = v_clinic_id and public_bookable is not true) then
      raise exception 'This therapist is not available for online booking.';
    end if;
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
end $function$;

-- Only clinic admins control public visibility; a therapist editing their own row cannot flip it.
create or replace function public.guard_therapists_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if is_clinic_admin(new.clinic_id) then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.user_id = auth.uid() then
    new.id := old.id;
    new.clinic_id := old.clinic_id;
    new.user_id := old.user_id;
    new.active := old.active;
    new.public_bookable := old.public_bookable;
    new.created_by := old.created_by;
  end if;

  return new;
end;
$function$;
