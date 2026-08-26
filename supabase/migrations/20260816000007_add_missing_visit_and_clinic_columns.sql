-- Same class of bug as 20260816000006 (schema drift between the client
-- domain model and the actual Supabase table), caught by auditing every
-- synced table's TS fields against the live schema after that fix:
--
-- - Visit.pendingPaymentNote ("collect later" note, set from NewVisitPage
--   and read back on Workspace's Needs-attention list) has no
--   `pending_payment_note` column on `visits` — every new visit insert
--   fails with `PGRST204` (schema cache doesn't recognize the column),
--   surfaced to PostgREST as a 400. Blocks logging visits entirely.
--
-- - Clinic.walkInMrnoPrefix (set from Settings -> Clinic profile) has no
--   `walk_in_mrno_prefix` column on `clinics` — every clinic profile save
--   fails the same way, since SetupPage's profile form always includes
--   this field in its update payload.
alter table public.visits
  add column pending_payment_note text;

alter table public.clinics
  add column walk_in_mrno_prefix text;
