-- ---------------------------------------------------------------------------
-- Patient Communications: found during a full workflow review, not a user
-- report. reschedule_appointment/mark_appointment_no_show/
-- cancel_appointment/mark_appointment_arrived/link_appointment_visit had
-- no status guard at all — unlike confirm_appointment_request/
-- decline_appointment_request, which already check `status = 'pending'`
-- before acting. The UI already only ever offers these actions from the
-- right states, but the RPCs themselves would silently accept a call
-- against an appointment already in a terminal or conflicting state — two
-- staff acting on the same appointment at once, a stale browser tab, or a
-- double-click could flip an already-arrived appointment (with a real
-- linked visit) back to "no_show", resurrect a cancelled one via
-- reschedule, or double-link a second visit onto one appointment row,
-- overwriting the first visit_id and orphaning its own audit trail.
-- Row-locked (`for update`) the same way confirm/decline already are, so
-- two concurrent calls serialize instead of racing past each other.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_scheduled_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
begin
  select id, clinic_id, scheduled_at, status into v_appt
    from appointments where id = p_appointment_id for update;

  if not found then
    raise exception 'Appointment not found.';
  end if;
  if not (is_clinic_admin(v_appt.clinic_id) or is_front_desk(v_appt.clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be rescheduled.';
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
  v_status text;
begin
  select clinic_id, status into v_clinic_id, v_status
    from appointments where id = p_appointment_id for update;
  if v_clinic_id is null then
    raise exception 'Appointment not found.';
  end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be marked no-show.';
  end if;
  update appointments set status = 'no_show' where id = p_appointment_id;
end $$;

create or replace function public.cancel_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_status text;
begin
  select clinic_id, status into v_clinic_id, v_status
    from appointments where id = p_appointment_id for update;
  if v_clinic_id is null then
    raise exception 'Appointment not found.';
  end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be cancelled.';
  end if;
  update appointments set status = 'cancelled' where id = p_appointment_id;
end $$;

create or replace function public.mark_appointment_arrived(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_status text;
begin
  select clinic_id, status into v_clinic_id, v_status
    from appointments where id = p_appointment_id for update;
  if v_clinic_id is null then
    raise exception 'Appointment not found.';
  end if;
  if not is_clinic_member(v_clinic_id) then
    raise exception 'Not authorized.';
  end if;
  if v_status not in ('confirmed', 'rescheduled') then
    raise exception 'This appointment can no longer be marked arrived.';
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
  update appointments
    set patient_id = p_patient_id, visit_id = p_visit_id, status = 'arrived'
    where id = p_appointment_id;
end $$;
