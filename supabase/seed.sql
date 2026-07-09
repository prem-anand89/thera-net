-- Seed: Beyond Mechanics @ Health Valley, therapists, and the service catalog
-- from the "Physiotherapy Charges — Updated" sheet. Idempotent (safe to re-run).
-- Prices are stored in paise (₹800 = 80000).

insert into public.clinics (
  id, name, partner_hospital_name, invoice_prefix,
  bm_split_pct, tax_pct, tds_basis, fy_start_month
) values (
  '11111111-1111-4111-8111-111111111111',
  'Beyond Mechanics',
  'Health Valley',
  'BM',
  75, 10, 'gross_bill', 4
) on conflict (id) do nothing;

insert into public.therapists (id, clinic_id, name, active) values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Prem', true),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Aishwarya', true)
on conflict (id) do nothing;

insert into public.service_catalog (clinic_id, category, name, session_count, base_price_paise) values
  ('11111111-1111-4111-8111-111111111111', 'Consultation',     'Consultation',              1,    80000),
  ('11111111-1111-4111-8111-111111111111', 'Physiotherapy',    'Physiotherapy 3 Days',      3,   220000),
  ('11111111-1111-4111-8111-111111111111', 'Physiotherapy',    'Physiotherapy 7 Days',      7,   500000),
  ('11111111-1111-4111-8111-111111111111', 'Physiotherapy',    'Physiotherapy 15 Days',    15,  1000000),
  ('11111111-1111-4111-8111-111111111111', 'Exercise Therapy', 'Exercise Therapy',          1,   100000),
  ('11111111-1111-4111-8111-111111111111', 'Exercise Therapy', 'Exercise Therapy 3 Days',   3,   280000),
  ('11111111-1111-4111-8111-111111111111', 'Exercise Therapy', 'Exercise Therapy 7 Days',   7,   630000),
  ('11111111-1111-4111-8111-111111111111', 'Exercise Therapy', 'Exercise Therapy 15 Days', 15,  1300000),
  ('11111111-1111-4111-8111-111111111111', 'Manual Therapy',   'Manual Therapy',            1,   150000),
  ('11111111-1111-4111-8111-111111111111', 'Manual Therapy',   'Manual Therapy 3 Days',     3,   400000),
  ('11111111-1111-4111-8111-111111111111', 'Manual Therapy',   'Manual Therapy 7 Days',     7,   900000),
  ('11111111-1111-4111-8111-111111111111', 'Advanced Therapy', 'Advanced Therapy',          1,   200000),
  ('11111111-1111-4111-8111-111111111111', 'Advanced Therapy', 'Advanced Therapy 3 Days',   3,   540000),
  ('11111111-1111-4111-8111-111111111111', 'Advanced Therapy', 'Advanced Therapy 7 Days',   7,  1200000),
  ('11111111-1111-4111-8111-111111111111', 'Fascia Release',   'Fascia Release',            1,   300000),
  ('11111111-1111-4111-8111-111111111111', 'Fascia Release',   'Fascia Release 3 Days',     3,   800000),
  ('11111111-1111-4111-8111-111111111111', 'Kinesio Taping',   'Kinesio Taping',            1,    30000),
  ('11111111-1111-4111-8111-111111111111', 'Assessment',       'Assessment',                1,    60000)
on conflict (clinic_id, name) do nothing;
