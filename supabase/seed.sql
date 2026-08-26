-- Seed: a generic example clinic, therapists, and service catalog for local
-- development (supabase db reset). Deliberately placeholder data, not any
-- real clinic's business information — new self-service clinics get their
-- own generic starter catalog automatically instead (see
-- create_clinic_with_admin() / 20260816000001_starter_service_catalog.sql).
-- Idempotent (safe to re-run). Prices are stored in paise (Rs.800 = 80000).

insert into public.clinics (
  id, name, partner_hospital_name, invoice_prefix,
  bm_split_pct, tax_pct, tds_basis, fy_start_month
) values (
  '11111111-1111-4111-8111-111111111111',
  'Example Physiotherapy Clinic',
  'Example Partner Hospital',
  'EX',
  75, 10, 'gross_bill', 4
) on conflict (id) do nothing;

insert into public.therapists (id, clinic_id, name, active) values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Therapist One', true),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Therapist Two', true)
on conflict (id) do nothing;

insert into public.service_catalog (clinic_id, category, name, session_count, base_price_paise) values
  ('11111111-1111-4111-8111-111111111111', 'Consultation',     'Initial Consultation',      1,    50000),
  ('11111111-1111-4111-8111-111111111111', 'Consultation',     'Follow-up Consultation',    1,    30000),
  ('11111111-1111-4111-8111-111111111111', 'Physiotherapy',    'Physiotherapy Session',     1,    80000),
  ('11111111-1111-4111-8111-111111111111', 'Physiotherapy',    'Physiotherapy Package (5)', 5,   350000),
  ('11111111-1111-4111-8111-111111111111', 'Manual Therapy',   'Manual Therapy Session',    1,   100000),
  ('11111111-1111-4111-8111-111111111111', 'Exercise Therapy', 'Exercise Therapy Session',  1,    70000)
on conflict (clinic_id, name) do nothing;
