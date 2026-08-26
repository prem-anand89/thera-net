-- Root cause of the persistent "sync issue" on payments (and the same
-- latent defect on no_return_reason_catalog): both tables carry the shared
-- set_updated_at() trigger, which unconditionally does
--   new.updated_by := auth.uid();
--   if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
-- but neither table was created with created_by/updated_by columns. Every
-- insert or update to either table has been failing at the trigger with
-- `42703: record "new" has no field "updated_by"` — surfaced to PostgREST
-- as a plain 400, which the client's sync engine doesn't recognize as a
-- permanent failure (only 42501/RLS is), so it just retries forever and
-- never succeeds. payments has sat at 0 rows on the server since the table
-- was created (20260719000001_direct_payments.sql) despite that migration's
-- own comment claiming existing local rows would sync up — they never could,
-- for this reason. Add the columns every other set_updated_at table already
-- has, in the same shape (nullable uuid referencing auth.users, no default).
alter table public.payments
  add column created_by uuid references auth.users(id),
  add column updated_by uuid references auth.users(id);

alter table public.no_return_reason_catalog
  add column created_by uuid references auth.users(id),
  add column updated_by uuid references auth.users(id);
