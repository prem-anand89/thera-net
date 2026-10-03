create or replace function public.notify_push(p_kind text, p_clinic_id uuid, p_row_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://ajzcfbgjvnxgpebowwqc.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('kind', p_kind, 'clinic_id', p_clinic_id, 'row_id', p_row_id)
  );
end $$;

create or replace function public.appointments_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.therapist_id is null then
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

create trigger appointments_push
  after insert or update of status, scheduled_at on public.appointments
  for each row execute function public.appointments_push_trigger();

create or replace function public.appointment_requests_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_push('booking_request', new.clinic_id, new.id);
  return new;
end $$;

create trigger appointment_requests_push
  after insert on public.appointment_requests
  for each row execute function public.appointment_requests_push_trigger();

create or replace function public.feedback_responses_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rating <= 2 then
    perform notify_push('low_rating_feedback', new.clinic_id, new.id);
  end if;
  return new;
end $$;

create trigger feedback_responses_push
  after insert on public.feedback_responses
  for each row execute function public.feedback_responses_push_trigger();
