-- ---------------------------------------------------------------------------
-- Clinic signature image: one-time uploaded signature (same pattern as the
-- existing logo_path -- a path into the `clinic-assets` bucket, not the
-- image itself), printed on every invoice in place of the blank
-- "Authorised signature" line. Not a cryptographic e-signature.
-- ---------------------------------------------------------------------------
alter table public.clinics add column if not exists signature_path text;
