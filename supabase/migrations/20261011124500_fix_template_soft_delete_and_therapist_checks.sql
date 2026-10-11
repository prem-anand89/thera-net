-- 1. Add soft-delete tombstone column to shift_templates
alter table public.shift_templates
  add column if not exists removed_at timestamptz default null;

-- 2. Update delete_shift_template to soft-delete with removed_at
-- This ensures the sync engine (which pulls updated_at > cursor) syncs the deletion to all client Dexie instances.
create or replace function public.delete_shift_template(
  p_template_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_active_usage integer;
begin
  select clinic_id into v_clinic_id from shift_templates where id = p_template_id and removed_at is null;
  if not found then raise exception 'Shift template not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;

  select count(*) into v_active_usage
  from therapist_shift_assignments
  where shift_template_id = p_template_id and status in ('approved', 'pending');

  if v_active_usage > 0 then
    raise exception 'Cannot delete template that is currently assigned to staff. Deactivate it or unassign staff first.';
  end if;

  -- Clean up assignments referencing this template
  delete from therapist_shift_assignments where shift_template_id = p_template_id;

  -- Soft delete template so sync engine pulls row update
  update shift_templates
     set active = false,
         removed_at = now(),
         updated_at = now()
   where id = p_template_id;
end $$;

-- 3. Fix submit_appointment_request therapist membership check
-- Previously checked clinic_members.user_id = p_preferred_therapist_id, which rejected valid roster therapists.
create or replace function public.submit_appointment_request(
  p_slug text, p_name text, p_phone text, p_email text,
  p_preferred_therapist_id uuid, p_notes text, p_preferred_date date,
  p_preferred_time_text text, p_preferred_time_of_day text DEFAULT NULL::text,
  p_is_waitlist boolean DEFAULT false
)
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
    if not exists (select 1 from therapists where id = p_preferred_therapist_id and clinic_id = v_clinic_id) then
      raise exception 'Therapist is not a member of this clinic.';
    end if;
    if exists (select 1 from therapists where id = p_preferred_therapist_id and clinic_id = v_clinic_id and (active is false or public_bookable is false)) then
      raise exception 'This therapist is not available for online booking.';
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

-- 4. Fix add_waitlist_entry therapist check (therapists.id vs clinic_members.user_id)
create or replace function public.add_waitlist_entry(
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
    if not exists (select 1 from therapists where id = p_preferred_therapist_id and clinic_id = p_clinic_id) then
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
