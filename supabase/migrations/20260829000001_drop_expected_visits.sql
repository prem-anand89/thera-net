-- ---------------------------------------------------------------------------
-- Removes the "Expected today" feature end to end. It shipped
-- (20260807000001_expected_visits.sql), got a Workspace UI section, then
-- that UI was later removed during a Workspace redesign without anyone
-- removing the table, the clinic-level opt-in toggle, or the service/repo
-- layer behind it — leaving `clinics.enable_expected_today` sitting in the
-- Clinic Profile form's state with no field to actually toggle it, and
-- `expected_visits`/`expectedVisitsService` with zero consumers anywhere in
-- `src/features/`.
--
-- Confirmed before writing this migration: 2 rows in expected_visits, 1
-- clinic with enable_expected_today = true — real but small, and nothing in
-- the live app reads either, so there's no in-app path left that could
-- surface this data even if it stayed. Dropped rather than left in place.
-- ---------------------------------------------------------------------------
drop table if exists public.expected_visits;

alter table public.clinics drop column if exists enable_expected_today;
