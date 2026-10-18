-- Per-person switches for push alerts. Everyone is ON by default; a row only
-- exists once someone has made a choice, so adding a new alert type later
-- doesn't need a backfill. Scoped per clinic (a person can belong to several).
-- The send-push edge function reads these (service role) before it sends and
-- skips anyone who switched that alert off; the app reads/writes its own rows
-- through the normal sync outbox.
--
-- The id is deterministic ("<user>:<clinic>:<category>") and enforced by a
-- check constraint, so two devices flipping the same switch write the SAME row.

create table public.user_push_preferences (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  clinic_id   uuid not null references public.clinics (id) on delete cascade,
  category    text not null check (category in ('booking_request', 'appointment_changes', 'low_rating_feedback')),
  enabled     boolean not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_push_preferences_id_matches
    check (id = user_id::text || ':' || clinic_id::text || ':' || category)
);

create index user_push_preferences_user_clinic_idx on public.user_push_preferences (user_id, clinic_id);
-- send-push looks up "who switched this alert off in this clinic".
create index user_push_preferences_off_idx on public.user_push_preferences (clinic_id, category) where enabled = false;

alter table public.user_push_preferences enable row level security;

create policy user_push_preferences_select on public.user_push_preferences
  for select using (user_id = auth.uid() and is_clinic_member(clinic_id));
create policy user_push_preferences_insert on public.user_push_preferences
  for insert with check (user_id = auth.uid() and is_clinic_member(clinic_id));
create policy user_push_preferences_update on public.user_push_preferences
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_clinic_member(clinic_id));
-- No delete policy: a switch is turned back on by writing enabled = true.

-- updated_at is server-authoritative like every other synced table; this table
-- has no updated_by/created_by, so it can't use the shared set_updated_at().
create or replace function public.user_push_preferences_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger user_push_preferences_touch
  before insert or update on public.user_push_preferences
  for each row execute function public.user_push_preferences_touch();

alter publication supabase_realtime add table public.user_push_preferences;
