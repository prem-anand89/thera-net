-- ===========================================================================
-- Provision a new clinic — run ONCE per clinic in the Supabase SQL editor.
--
-- This creates the clinic, a starter physio catalog, therapist records, and
-- links the admin login(s). It replaces the old hand-edited setup_members.sql
-- runbook for any clinic after Beyond Mechanics.
--
-- PREREQUISITES
--   1. All migrations are applied (this script uses own_share_label /
--      partner_share_label from 20260708000001_clinic_share_labels.sql).
--   2. Create the login user(s) first: Authentication → Users → Add user.
--      Logins are provisioned manually; this script only *links* existing
--      users to the new clinic by email.
--
-- USAGE
--   Edit the values in the "EDIT ME" block, then run the whole file. It aborts
--   if a clinic with the same name already exists, so an accidental re-run
--   won't create a duplicate. Prices are in paise (₹800 = 80000) and can be
--   changed later in the app under Setup.
-- ===========================================================================
do $$
declare
  -- ============================ EDIT ME ============================
  v_name          text    := 'New Physio Clinic';       -- clinic name
  v_partner       text    := null;                        -- partner hospital name, or null
  v_prefix        text    := 'NPC';                       -- invoice number prefix
  v_billing_mode  text    := 'simple';                    -- 'simple' (bill + paid/outstanding) or 'hospital_split'
  v_therapist_split boolean := false;                     -- track internal therapist revenue splits?
  v_bm_split_pct  numeric := 75;                          -- own share % (only used in hospital_split mode)
  v_tax_pct       numeric := 10;                          -- tax / TDS % (only used in hospital_split mode)
  v_tds_basis     text    := 'gross_bill';                -- 'gross_bill' or 'bm_share' (hospital_split only)
  v_fy_start      int     := 4;                           -- fiscal year start month (April = 4)
  v_own_label     text    := null;                        -- report column label; null → 'BM'
  v_partner_label text    := null;                        -- report column label; null → 'HV'
  v_admin_emails  text[]  := array['owner@example.com'];  -- existing auth-user emails to make admins
  v_therapists    text[]  := array['Therapist One'];      -- therapist display names (attribution; no login)
  -- ================================================================
  v_clinic_id uuid := gen_random_uuid();
  v_linked int;
  v_therapist text;
begin
  if exists (select 1 from clinics where name = v_name) then
    raise exception 'A clinic named "%" already exists — aborting to avoid a duplicate.', v_name;
  end if;

  insert into clinics (
    id, name, partner_hospital_name, invoice_prefix,
    billing_mode, enable_therapist_split,
    bm_split_pct, tax_pct, tds_basis, fy_start_month,
    own_share_label, partner_share_label
  ) values (
    v_clinic_id, v_name, v_partner, v_prefix,
    v_billing_mode, v_therapist_split,
    v_bm_split_pct, v_tax_pct, v_tds_basis, v_fy_start,
    v_own_label, v_partner_label
  );

  -- Starter physio catalog (mirrors the Beyond Mechanics menu as a sensible
  -- default; edit prices/services afterward in Setup → Service catalog).
  insert into service_catalog (clinic_id, category, name, session_count, base_price_paise) values
    (v_clinic_id, 'Consultation',     'Consultation',              1,   80000),
    (v_clinic_id, 'Physiotherapy',    'Physiotherapy 3 Days',      3,  220000),
    (v_clinic_id, 'Physiotherapy',    'Physiotherapy 7 Days',      7,  500000),
    (v_clinic_id, 'Physiotherapy',    'Physiotherapy 15 Days',    15, 1000000),
    (v_clinic_id, 'Exercise Therapy', 'Exercise Therapy',          1,  100000),
    (v_clinic_id, 'Exercise Therapy', 'Exercise Therapy 3 Days',   3,  280000),
    (v_clinic_id, 'Exercise Therapy', 'Exercise Therapy 7 Days',   7,  630000),
    (v_clinic_id, 'Exercise Therapy', 'Exercise Therapy 15 Days', 15, 1300000),
    (v_clinic_id, 'Manual Therapy',   'Manual Therapy',            1,  150000),
    (v_clinic_id, 'Manual Therapy',   'Manual Therapy 3 Days',     3,  400000),
    (v_clinic_id, 'Manual Therapy',   'Manual Therapy 7 Days',     7,  900000),
    (v_clinic_id, 'Advanced Therapy', 'Advanced Therapy',          1,  200000),
    (v_clinic_id, 'Advanced Therapy', 'Advanced Therapy 3 Days',   3,  540000),
    (v_clinic_id, 'Advanced Therapy', 'Advanced Therapy 7 Days',   7, 1200000),
    (v_clinic_id, 'Fascia Release',   'Fascia Release',            1,  300000),
    (v_clinic_id, 'Fascia Release',   'Fascia Release 3 Days',     3,  800000),
    (v_clinic_id, 'Kinesio Taping',   'Kinesio Taping',            1,   30000),
    (v_clinic_id, 'Assessment',       'Assessment',                1,   60000);

  -- Therapist records (for per-therapist attribution; separate from logins).
  foreach v_therapist in array v_therapists loop
    insert into therapists (clinic_id, name, active) values (v_clinic_id, v_therapist, true);
  end loop;

  -- Link the already-created auth users as clinic admins, matched by email.
  insert into clinic_members (clinic_id, user_id, role)
  select v_clinic_id, u.id, 'admin'
  from auth.users u
  where u.email = any (v_admin_emails)
  on conflict do nothing;
  get diagnostics v_linked = row_count;

  raise notice 'Created clinic "%" (id %). Seeded catalog + % therapist(s), linked % admin(s).',
    v_name, v_clinic_id, coalesce(array_length(v_therapists, 1), 0), v_linked;

  if v_linked = 0 then
    raise warning 'No admins were linked — none of % matched a user in Authentication → Users. Create the login(s) first, then re-run just the clinic_members insert (the clinic itself is already made).', v_admin_emails;
  end if;
end $$;
