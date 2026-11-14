-- Fix for 20261113200000_hep_module.sql: the app's shared set_updated_at() trigger (20260706000001_audit_trail.sql)
-- writes new.updated_by on every insert/update and new.created_by on insert, so every table that uses it needs both
-- columns. public.exercises uses that trigger but was created without them, which made every Save exercise fail with
-- 'record "new" has no field "updated_by"'. (No other HEP table uses set_updated_at.)
alter table public.exercises
  add column if not exists created_by uuid references auth.users (id),
  add column if not exists updated_by uuid references auth.users (id);
