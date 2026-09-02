-- ---------------------------------------------------------------------------
-- Fixes a bug in 20260830190000_public_booking.sql: both new tables attach
-- the shared `set_updated_at()` trigger, but that function was redefined in
-- 20260706000001_audit_trail.sql to also stamp `updated_by`/`created_by`
-- unconditionally on every row it fires for — it does not check whether the
-- table actually has those columns first. Every other synced staff table in
-- this schema (feedback_requests included) already carries them; these two
-- were the first to attach the trigger without them, so any UPDATE (e.g.
-- confirm_appointment_request's own update) failed with 'record "new" has
-- no field "updated_by"'. Same fix shape as feedback_requests' own
-- created_by/updated_by columns.
-- ---------------------------------------------------------------------------
alter table public.appointment_requests
  add column created_by uuid references auth.users (id),
  add column updated_by uuid references auth.users (id);

alter table public.appointments
  add column created_by uuid references auth.users (id),
  add column updated_by uuid references auth.users (id);
