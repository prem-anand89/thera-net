-- "Mark arrived" pressed by mistake had no way back (no-shows and cancellations already do).
--
-- restore_arrived_appointment moves an arrived appointment back to confirmed (rescheduled if it had been
-- moved before), exactly like restore_no_show_appointment. An arrived appointment still holds its slot, so
-- restoring cannot clash. Refused when:
--   - it has a visit (Complete visit already started: the visit would be left pointing at an appointment
--     that "never happened"; the visit has to go first), or
--   - it is a walk-in (created as arrived, there is no booked status to go back to; cancel it instead).
--
-- Going back to confirmed must not tell the therapist about a "new appointment": the push trigger and the
-- notify-therapist email trigger both skip a change that comes from arrived.

create or replace function public.restore_arrived_appointment(p_appointment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_appt record;
begin
  select clinic_id, therapist_id, status, visit_id, source, reschedule_count into v_appt
    from appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if not can_manage_appointment(v_appt.clinic_id, v_appt.therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if v_appt.status <> 'arrived' then
    raise exception 'Only an arrived appointment can be undone.';
  end if;
  if v_appt.visit_id is not null then
    raise exception 'This appointment already has a visit.';
  end if;
  if v_appt.source = 'walk_in' then
    raise exception 'A walk-in has no booking to go back to — cancel it instead.';
  end if;
  update appointments
    set status = case when v_appt.reschedule_count > 0 then 'rescheduled' else 'confirmed' end
    where id = p_appointment_id;
end $$;

revoke execute on function public.restore_arrived_appointment(uuid) from public, anon;
grant execute on function public.restore_arrived_appointment(uuid) to authenticated;

create or replace function public.appointments_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.therapist_id is distinct from old.therapist_id then
    if old.therapist_id is not null and old.status in ('confirmed', 'rescheduled') then
      perform notify_push_reassigned(new.clinic_id, new.id, old.therapist_id);
    end if;
    if new.therapist_id is not null and new.status = 'confirmed' then
      perform notify_push('appointment_confirmed', new.clinic_id, new.id);
    end if;
    return new;
  end if;
  if new.therapist_id is null then
    return new;
  end if;
  -- Undoing "arrived" is not a new appointment.
  if tg_op = 'UPDATE' and old.status = 'arrived' and new.status in ('confirmed', 'rescheduled') then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status = 'confirmed' then
    perform notify_push('appointment_confirmed', new.clinic_id, new.id);
  elsif tg_op = 'UPDATE' and new.status = 'confirmed'
        and (old.status is distinct from 'confirmed' or old.scheduled_at is distinct from new.scheduled_at) then
    perform notify_push(
      case when old.status = 'confirmed' and old.scheduled_at is distinct from new.scheduled_at
           then 'appointment_rescheduled' else 'appointment_confirmed' end,
      new.clinic_id, new.id);
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform notify_push('appointment_cancelled', new.clinic_id, new.id);
  end if;
  return new;
end $$;

create or replace function public.trigger_notify_therapist() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_base_url text := coalesce(
    current_setting('app.edge_function_base_url', true),
    'https://ajzcfbgjvnxgpebowwqc.supabase.co'
  );
begin
  -- Undoing "arrived" is not a new appointment.
  if tg_op = 'UPDATE' and old.status = 'arrived' then
    return NEW;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/notify-therapist',
    headers := edge_hook_headers(),
    body := row_to_json(NEW)::jsonb
  );
  return NEW;
end $$;
