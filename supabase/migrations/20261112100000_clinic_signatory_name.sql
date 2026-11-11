-- ---------------------------------------------------------------------------
-- Authorised signatory: the name printed under the clinic's uploaded signature
-- (invoices, advance receipts, notes, session logs). One person per clinic, chosen
-- by the clinic admin. The treating therapist is printed separately as "Therapist",
-- so a bill no longer shows one person's signature over another person's name.
-- ---------------------------------------------------------------------------
alter table public.clinics add column if not exists signatory_name text;
