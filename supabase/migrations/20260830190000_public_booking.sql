-- ---------------------------------------------------------------------------
-- Patient Communications, Slice 5+6: public booking requests → confirmed
-- appointments → Workspace's "Expected today". Spec:
-- docs/HANDOFF-patient-comms.md, "Booking UX (v1, no slots)" and
-- "Appointments vs visits vs Expected today". No slot picker — a public
-- form collects name/phone/preferred day-time-as-text; staff confirm by
-- hand into a real scheduled appointment. Patient identity is resolved
-- exactly once, at arrival, never at confirm.
--
-- Every write on both tables below is an RPC, not a direct client write —
-- see each RPC's own comment for why a couple of them need to bypass RLS
-- entirely rather than rely on it (same reasoning
-- `list_google_review_eligible_requests` already established). Both
-- tables therefore carry SELECT-only RLS policies for staff.
-- ---------------------------------------------------------------------------

alter table public.clinics add column booking_slug text unique;

create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  phone text not null,
  preferred_therapist_id uuid references public.therapists (id),
  preferred_time_text text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  appointment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  -- Null from confirm until arrival — see the Appointment domain type's
  -- own doc comment. patient_name/patient_phone are the raw submitted
  -- values, kept even after patient_id resolves, so the row always has
  -- something to display before/without a resolved identity.
  patient_id uuid references public.patients (id),
  patient_name text not null,
  patient_phone text not null,
  therapist_id uuid references public.therapists (id),
  scheduled_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'rescheduled', 'no_show', 'cancelled', 'arrived')),
  request_id uuid references public.appointment_requests (id),
  visit_id uuid references public.visits (id),
  reschedule_count int not null default 0,
  previous_scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- appointment_requests.appointment_id can't reference appointments until
-- that table exists, so the FK is added after both tables are created.
alter table public.appointment_requests
  add constraint appointment_requests_appointment_id_fkey
  foreign key (appointment_id) references public.appointments (id);

create index appointment_requests_clinic_idx on public.appointment_requests (clinic_id);
create index appointments_clinic_idx on public.appointments (clinic_id);
create index appointments_scheduled_at_idx on public.appointments (clinic_id, scheduled_at);

create trigger appointment_requests_set_updated_at
  before update on public.appointment_requests
  for each row execute function public.set_updated_at();
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

alter table public.appointment_requests enable row level security;
alter table public.appointments enable row level security;

-- ---------------------------------------------------------------------------
-- Front-desk membership check, mirroring is_own_therapist's shape. The
-- Slice 0 migration inlined this exists-subquery twice already
-- (feedback_requests_insert/_update); this slice needs it 6 more times
-- (the appointment_requests SELECT policy, plus once inside each of
-- confirm/decline/reschedule/no-show/cancel's body), so it's worth
-- extracting now rather than repeating it a 7th and 8th time.
-- ---------------------------------------------------------------------------
create or replace function public.is_front_desk(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clinic_members
    where clinic_id = p_clinic and user_id = auth.uid() and role = 'front_desk'
  );
$$;

-- Requests → Bookings is admin + front_desk only (spec role table:
-- therapist gets "own day's appointments on Workspace only; no full
-- request queue in v1") — narrower than feedback_requests_select, which
-- is clinic-member-wide, because a raw public submission carries no
-- clinical content worth hiding from a therapist, but the queue itself is
-- deliberately not a therapist-facing surface per the doc.
create policy appointment_requests_select on public.appointment_requests
  for select using (is_clinic_admin(clinic_id) or is_front_desk(clinic_id));

-- appointments IS the day list (Workspace "Expected today") once the
-- module is on, and every role needs to see today's board — same
-- clinic-wide-read-narrower-write shape as visits_select.
create policy appointments_select on public.appointments
  for select using (is_clinic_member(clinic_id));

-- ---------------------------------------------------------------------------
-- Public RPCs (anonymous, no login) — same generic-error/rate-limit
-- discipline as the Slice 0 feedback RPCs. A clinic's booking_slug is not
-- a secret (it's meant to live on Google/the clinic website), so there's
-- no "oracle" concern here the way there is for feedback tokens — these
-- just need the module to be on and the slug to exist.
-- ---------------------------------------------------------------------------
create or replace function public.get_booking_clinic_name(p_slug text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_enabled boolean;
begin
  perform public.check_public_rpc_rate_limit('get_booking_clinic_name', 30, 60);

  select name, enable_patient_comms into v_name, v_enabled
    from clinics where booking_slug = p_slug;

  if not found or v_enabled is not true then
    raise exception 'This booking page is not available.';
  end if;

  return v_name;
end $$;

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
    where t.clinic_id = v_clinic_id and t.active is true
    order by t.name;
end $$;

create or replace function public.submit_appointment_request(
  p_slug text,
  p_name text,
  p_phone text,
  p_preferred_therapist_id uuid,
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
    clinic_id, name, phone, preferred_therapist_id, preferred_time_text
  ) values (
    v_clinic_id, trim(p_name), trim(p_phone), p_preferred_therapist_id, nullif(trim(both from p_preferred_time_text), '')
  );
end $$;

revoke execute on function public.get_booking_clinic_name(text) from public, anon;
revoke execute on function public.list_booking_therapists(text) from public, anon;
revoke execute on function public.submit_appointment_request(text, text, text, uuid, text) from public, anon;
grant execute on function public.get_booking_clinic_name(text) to anon, authenticated;
grant execute on function public.list_booking_therapists(text) to anon, authenticated;
grant execute on function public.submit_appointment_request(text, text, text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff RPCs. Confirm/decline/reschedule/no-show/cancel are admin OR
-- front_desk only (spec role table) — a rule that doesn't map cleanly to
-- one RLS policy shared with the broader-access arrival RPCs below, so
-- each re-implements its own check in the body instead, same reasoning
-- list_google_review_eligible_requests already established.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_appointment_request(
  p_request_id uuid,
  p_scheduled_at timestamptz,
  p_therapist_id uuid
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

  insert into appointments (
    clinic_id, patient_name, patient_phone, therapist_id, scheduled_at, request_id
  ) values (
    v_req.clinic_id, v_req.name, v_req.phone, p_therapist_id, p_scheduled_at, v_req.id
  ) returning id into v_appointment_id;

  update appointment_requests
    set status = 'confirmed', appointment_id = v_appointment_id
    where id = v_req.id;

  return v_appointment_id;
end $$;

create or replace function public.decline_appointment_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  select id, clinic_id, status into v_req
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

  update appointment_requests set status = 'declined' where id = v_req.id;
end $$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_scheduled_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
begin
  select id, clinic_id, scheduled_at into v_appt
    from appointments where id = p_appointment_id for update;

  if not found then
    raise exception 'Appointment not found.';
  end if;
  if not (is_clinic_admin(v_appt.clinic_id) or is_front_desk(v_appt.clinic_id)) then
    raise exception 'Not authorized.';
  end if;

  update appointments
    set previous_scheduled_at = v_appt.scheduled_at,
        scheduled_at = p_new_scheduled_at,
        reschedule_count = reschedule_count + 1,
        status = 'rescheduled'
    where id = v_appt.id;
end $$;

create or replace function public.mark_appointment_no_show(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Appointment not found.';
  end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  update appointments set status = 'no_show' where id = p_appointment_id;
end $$;

create or replace function public.cancel_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Appointment not found.';
  end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  update appointments set status = 'cancelled' where id = p_appointment_id;
end $$;

-- Broader than the five above: any clinic member who can log a visit
-- (visits_insert is clinic-member-wide) needs to be able to mark an
-- appointment arrived or link it to the visit they just created — this
-- is the same population, not the admin/front_desk-only booking-queue
-- population, so it gets its own, wider check rather than reusing theirs.
create or replace function public.mark_appointment_arrived(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Appointment not found.';
  end if;
  if not is_clinic_member(v_clinic_id) then
    raise exception 'Not authorized.';
  end if;
  update appointments set status = 'arrived' where id = p_appointment_id;
end $$;

create or replace function public.link_appointment_visit(
  p_appointment_id uuid,
  p_visit_id uuid,
  p_patient_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Appointment not found.';
  end if;
  if not is_clinic_member(v_clinic_id) then
    raise exception 'Not authorized.';
  end if;
  update appointments
    set patient_id = p_patient_id, visit_id = p_visit_id, status = 'arrived'
    where id = p_appointment_id;
end $$;

revoke execute on function public.confirm_appointment_request(uuid, timestamptz, uuid) from public, anon;
revoke execute on function public.decline_appointment_request(uuid) from public, anon;
revoke execute on function public.reschedule_appointment(uuid, timestamptz) from public, anon;
revoke execute on function public.mark_appointment_no_show(uuid) from public, anon;
revoke execute on function public.cancel_appointment(uuid) from public, anon;
revoke execute on function public.mark_appointment_arrived(uuid) from public, anon;
revoke execute on function public.link_appointment_visit(uuid, uuid, uuid) from public, anon;

grant execute on function public.confirm_appointment_request(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.decline_appointment_request(uuid) to authenticated;
grant execute on function public.reschedule_appointment(uuid, timestamptz) to authenticated;
grant execute on function public.mark_appointment_no_show(uuid) to authenticated;
grant execute on function public.cancel_appointment(uuid) to authenticated;
grant execute on function public.mark_appointment_arrived(uuid) to authenticated;
grant execute on function public.link_appointment_visit(uuid, uuid, uuid) to authenticated;
