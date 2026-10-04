-- The Dexie sync engine uses UPSERT (INSERT ... ON CONFLICT DO UPDATE) to sync changes.
-- Postgres requires the user to have INSERT permissions to perform an UPSERT, even if the row already exists.
-- This grants therapists the ability to satisfy the INSERT check for their own profile onboarding.

create policy therapists_insert_self on public.therapists
  for insert
  with check (user_id = auth.uid() and is_clinic_member(clinic_id));
