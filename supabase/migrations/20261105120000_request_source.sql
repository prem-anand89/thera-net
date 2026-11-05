-- Where an awaiting entry came from, so staff can tell a new online request (nobody has spoken to them yet) from
-- someone they added themselves. Public submissions (submit_appointment_request) keep the default 'online';
-- add_waitlist_entry (staff only) records 'staff'. Entries added before this are read as 'online'.
alter table public.appointment_requests
  add column if not exists source text not null default 'online'
  check (source in ('online', 'staff'));

create or replace function public.add_waitlist_entry(p_clinic_id uuid, p_name text, p_phone text, p_email text, p_preferred_therapist_id uuid, p_notes text, p_preferred_date date, p_preferred_time_of_day text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    if not exists (select 1 from therapists where id = p_preferred_therapist_id and clinic_id = p_clinic_id) then
      raise exception 'Therapist is not a member of this clinic.';
    end if;
  end if;

  insert into appointment_requests (
    clinic_id, name, phone, email, preferred_therapist_id,
    notes, preferred_date, preferred_time_of_day, is_waitlist, source
  ) values (
    p_clinic_id, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    p_preferred_therapist_id,
    nullif(trim(both from p_notes), ''), p_preferred_date, p_preferred_time_of_day, true, 'staff'
  ) returning id into v_id;

  return v_id;
end $function$;
