-- ---------------------------------------------------------------------------
-- Phase 2: the sync engine's realtime channel (src/sync/engine.ts) already
-- subscribes to postgres_changes on every ALL_SYNCED_TABLES entry, including
-- appointment_requests, appointments and feedback_responses -- but a
-- postgres_changes subscription is a no-op for any table not added to the
-- supabase_realtime publication server-side, independent of client code.
-- Confirmed via `select * from pg_publication_tables where pubname =
-- 'supabase_realtime'` that these three were never added, despite having
-- been in ALL_SYNCED_TABLES since Patient Communications shipped -- so
-- every insert on them has only ever reached the client on the next
-- 5-minute fallback poll or tab-visibility sync, not in realtime. This
-- fixes the actual gap; no client code changes needed, since the listener
-- was already correctly wired and waiting.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.appointment_requests;
alter publication supabase_realtime add table public.appointments;
alter publication supabase_realtime add table public.feedback_responses;
