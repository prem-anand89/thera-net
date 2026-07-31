-- ---------------------------------------------------------------------------
-- Fix a real production bug: new-user clinic self-service creation
-- (CreateClinicForm.tsx) was writing the new clinic through the local-first
-- outbox (repos.clinics.put — an async, eventually-synced local write) and
-- then, in the same synchronous block, making a SEPARATE direct client call
-- to insert the admin clinic_members row. That direct insert requires
-- is_clinic_admin(clinic_id), which depends on the clinics row already
-- existing on the SERVER — but the outbox push is debounced and happens
-- over the network, so in the overwhelmingly common case the clinic hasn't
-- landed on the server yet when the direct insert fires. Result: the
-- membership insert fails RLS almost every time, the client shows a scary
-- inline error and never calls onSuccess(), and the local clinic row keeps
-- retrying in the background outbox indefinitely (the "1 sync issue" /
-- "new row violates row-level security policy for table 'clinics'" banner
-- users have been hitting).
--
-- The clinics-AFTER-INSERT trigger (add_creator_as_admin(), already
-- security definer) already adds the creator as admin automatically and
-- atomically the moment a clinics row is inserted — the manual client-side
-- clinic_members insert was always redundant. The real fix is to stop
-- routing clinic creation through the async local-first outbox at all: it's
-- a one-time, online-only operation (the user is by definition sitting at
-- a login screen with a live connection), exactly like issue_invoice().
-- This RPC does the insert as a single synchronous, authoritative round
-- trip; the trigger handles the membership row in the same transaction.
-- ---------------------------------------------------------------------------
create or replace function public.create_clinic_with_admin(
  p_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_invoice_prefix text
) returns public.clinics
language plpgsql security definer set search_path = public as $$
declare
  v_clinic public.clinics;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- bm_split_pct/tax_pct/enable_therapist_split values match what
  -- CreateClinicForm.tsx previously hardcoded client-side (50 / 18 / false)
  -- — preserved here rather than falling back to the table's schema
  -- defaults (75 / 10 / true), which are tuned for the original seeded
  -- clinic, not a blank self-service signup.
  insert into clinics (
    name, email, phone, address, invoice_prefix,
    bm_split_pct, tax_pct, enable_therapist_split
  )
  values (
    p_name, nullif(p_email, ''), nullif(p_phone, ''), nullif(p_address, ''), p_invoice_prefix,
    50, 18, false
  )
  returning * into v_clinic;

  -- add_creator_as_admin() (AFTER INSERT trigger on clinics) has already
  -- added auth.uid() as this clinic's admin in clinic_members by this point,
  -- in the same transaction — nothing left to do here.

  return v_clinic;
end $$;
