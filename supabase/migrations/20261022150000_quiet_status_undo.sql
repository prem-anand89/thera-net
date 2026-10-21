-- Undoing a mistaken "no-show" must not tell the therapist about a "new appointment", just as undoing
-- "arrived" doesn't (20261022140000). Both restores put the appointment back to confirmed at the SAME
-- time, so the push trigger and the notify-therapist email trigger now skip a change out of arrived or
-- no_show when the time is unchanged.
--
-- A no-show that is rebooked to a NEW time is a real change and still notifies: reschedule_appointment
-- changes scheduled_at, so the condition below does not match it.

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
  -- Undoing "arrived" or "no-show" (same time, back to confirmed) is not a new appointment.
  if tg_op = 'UPDATE' and old.status in ('arrived', 'no_show') and new.status in ('confirmed', 'rescheduled')
     and new.scheduled_at = old.scheduled_at then
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
  -- Undoing "arrived" or "no-show" (same time) is not a new appointment.
  if tg_op = 'UPDATE' and old.status in ('arrived', 'no_show') and new.scheduled_at = old.scheduled_at then
    return NEW;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/notify-therapist',
    headers := edge_hook_headers(),
    body := row_to_json(NEW)::jsonb
  );
  return NEW;
end $$;
