-- ---------------------------------------------------------------------------
-- Patient Communications: remove the Service field from the public booking
-- form (user request — the service picker added in the booking-form
-- redesign is being dropped, not just hidden). Full backend removal rather
-- than UI-only hiding, matching this repo's established convention of not
-- leaving unused scaffolding behind (expected_visits/my_memberships were
-- dropped outright when found unused).
-- ---------------------------------------------------------------------------
drop function if exists public.submit_appointment_request(
  text, text, text, text, uuid, uuid, text, date, text
);

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

drop function if exists public.list_booking_services(text);

alter table public.appointment_requests drop column if exists service_catalog_id;
