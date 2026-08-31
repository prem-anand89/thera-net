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
begin
  select id into v_clinic_id from clinics where booking_slug = p_slug;
  if v_clinic_id is null then
    raise exception 'Booking page not found.';
  end if;

  insert into appointment_requests (
    clinic_id, name, phone, email, preferred_therapist_id,
    notes, preferred_date, preferred_time_text
  ) values (
    v_clinic_id, p_name, p_phone, p_email, p_preferred_therapist_id,
    p_notes, p_preferred_date, p_preferred_time_text
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
