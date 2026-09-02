-- ---------------------------------------------------------------------------
-- Patient Communications, Slice 5 follow-up: richer public booking form
-- fields (email, service, a real preferred date) after reviewing a fuller
-- reference design. Deliberately does NOT add availability/slot checking —
-- the handoff doc is explicit that stays a later, separate effort ("Slot
-- picker / weekly availability / conflict checking: later build. Do not
-- start here."). `preferred_date` is informational only, same as
-- `preferred_time_text` already was — front desk still picks the real
-- `scheduled_at` by hand in confirm_appointment_request, nothing here
-- constrains or validates it against anyone's actual calendar.
-- ---------------------------------------------------------------------------
alter table public.appointment_requests
  add column email text,
  add column service_catalog_id uuid references public.service_catalog (id),
  add column preferred_date date;

-- Return type/param list changed, so drop before recreate (grants don't
-- survive a drop, re-stated below, same discipline as every RPC in this
-- module).
drop function if exists public.submit_appointment_request(text, text, text, uuid, text);

create or replace function public.submit_appointment_request(
  p_slug text,
  p_name text,
  p_phone text,
  p_email text,
  p_preferred_therapist_id uuid,
  p_service_catalog_id uuid,
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

  insert into appointment_requests (
    clinic_id, name, phone, email, preferred_therapist_id, service_catalog_id,
    preferred_date, preferred_time_text
  ) values (
    v_clinic_id, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    p_preferred_therapist_id, p_service_catalog_id, p_preferred_date,
    nullif(trim(both from p_preferred_time_text), '')
  );
end $$;

revoke execute on function public.submit_appointment_request(text, text, text, text, uuid, uuid, date, text) from public, anon;
grant execute on function public.submit_appointment_request(text, text, text, text, uuid, uuid, date, text) to anon, authenticated;

-- Mirrors list_booking_therapists — active services for the optional
-- Service dropdown on the public form.
create or replace function public.list_booking_services(p_slug text)
returns table (id uuid, name text, category text)
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_enabled boolean;
begin
  perform public.check_public_rpc_rate_limit('list_booking_services', 30, 60);

  select c.id, c.enable_patient_comms into v_clinic_id, v_enabled
    from clinics c where c.booking_slug = p_slug;

  if not found or v_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  return query
    select s.id, s.name, s.category from service_catalog s
    where s.clinic_id = v_clinic_id and s.active is true
    order by s.category, s.name;
end $$;

revoke execute on function public.list_booking_services(text) from public, anon;
grant execute on function public.list_booking_services(text) to anon, authenticated;
