-- Per-user "I have seen X up to <time>" markers, so the notification bell's
-- "new" counts follow a person to every device instead of living in each
-- browser's own storage (a fresh phone showed every old feedback response as
-- new). One row per (user, clinic, marker). Client-writable through the sync
-- outbox, like the other synced tables; reads and writes are limited to the
-- row's own user.
--
-- The id is deterministic ("<user>:<clinic>:<marker>") and enforced by a
-- check constraint, so two devices upserting the same marker write the SAME
-- row rather than two competing ones, and no separate unique index is needed.

create table public.user_seen_markers (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  clinic_id   uuid not null references public.clinics (id) on delete cascade,
  marker_key  text not null check (marker_key in ('feedback', 'therapist_appointments')),
  seen_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_seen_markers_id_matches
    check (id = user_id::text || ':' || clinic_id::text || ':' || marker_key)
);

create index user_seen_markers_user_clinic_idx on public.user_seen_markers (user_id, clinic_id);

alter table public.user_seen_markers enable row level security;

create policy user_seen_markers_select on public.user_seen_markers
  for select using (user_id = auth.uid() and is_clinic_member(clinic_id));
create policy user_seen_markers_insert on public.user_seen_markers
  for insert with check (user_id = auth.uid() and is_clinic_member(clinic_id));
create policy user_seen_markers_update on public.user_seen_markers
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_clinic_member(clinic_id));
-- No delete policy: a marker is only ever moved forward.

-- A marker only moves forward, and never past "now": a stale device writing an
-- older time can't undo a newer look, and a device with a wrong (future) clock
-- can't pin the marker in the future and silence every new item for good.
-- updated_at is server-authoritative like every other synced table (this table
-- has no updated_by/created_by, so it can't use the shared set_updated_at()).
create or replace function public.user_seen_markers_guard() returns trigger
language plpgsql as $$
begin
  new.seen_at := least(new.seen_at, now() + interval '5 minutes');
  if tg_op = 'UPDATE' then
    new.seen_at := greatest(old.seen_at, new.seen_at);
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger user_seen_markers_guard
  before insert or update on public.user_seen_markers
  for each row execute function public.user_seen_markers_guard();

-- The sync engine subscribes to postgres_changes on every synced table; without
-- this a second device only learns of a new marker on its next periodic pull.
alter publication supabase_realtime add table public.user_seen_markers;
