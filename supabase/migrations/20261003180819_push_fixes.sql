create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_seen_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent, now())
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    last_seen_at = now();
end $$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

revoke all on function public.notify_push(text, uuid, uuid) from public, anon, authenticated;

create or replace function public.notify_push_reassigned(p_clinic_id uuid, p_row_id uuid, p_previous uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://ajzcfbgjvnxgpebowwqc.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('kind', 'appointment_reassigned', 'clinic_id', p_clinic_id,
                               'row_id', p_row_id, 'previous_therapist_id', p_previous)
  );
end $$;

revoke all on function public.notify_push_reassigned(uuid, uuid, uuid) from public, anon, authenticated;

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

create or replace trigger appointments_push
  after insert or update of status, scheduled_at, therapist_id on public.appointments
  for each row execute function public.appointments_push_trigger();
