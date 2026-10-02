-- ---------------------------------------------------------------------------
-- clinics.clinic_type never existed as a live column, even though
-- domain/types.ts's Clinic type and SettingsPage.tsx's "Therapist setup"
-- field have both read and written it all along. clinicBillingConfig()
-- branched on `clinic.clinicType !== undefined` to decide which billing
-- model to use -- since that was never true for any live clinic, every
-- clinic silently fell back to the legacy `billing_mode` column (stuck at
-- its default 'hospital_split' for all of them, since nothing writes it
-- anymore), making every clinic's Monthly Statement show hospital/partner
-- settlement UI regardless of whether `has_partner` was actually true.
--
-- Same failure shape 20260801000001_catch_up_live_schema_drift.sql already
-- found and fixed once before for has_partner ("any save touching
-- hasPartner was failing silently against production") -- this is that
-- same class of bug for clinic_type specifically.
--
-- Default 'multiple' matches the app's own existing fallback
-- (`form.clinicType ?? 'multiple'` in SettingsPage.tsx, same default the
-- "Track therapist splits" toggle's visibility gate already assumes), so
-- every existing clinic keeps seeing exactly the Settings UI it sees
-- today once this column exists -- nothing flips silently.
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column if not exists clinic_type text not null default 'multiple'
  check (clinic_type in ('individual', 'multiple'));
