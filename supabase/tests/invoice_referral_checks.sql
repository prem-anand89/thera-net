-- Checks for get_invoice_referral_for_visits. Runs inside a transaction that is rolled back: nothing is kept.
-- Every row's `ok` must be true. Uses the "demo clinic" and its admin (change the ids in `cfg` to use another clinic).
begin;
-- The notes table stamps updated_at itself; the checks need to set it, so triggers are off for this transaction only.
set local session_replication_role = replica;

create temp table cfg as select
  'f3919f75-815d-4f59-9bda-89bbceb2dbd2'::uuid as clinic_id,
  'a9c1320e-86b6-4e46-b518-a29a01f14665'::uuid as admin_user,
  '17d5b404-2c03-488f-bdef-97286c99393e'::uuid as therapist_id,
  '2d3af21a-f65b-4476-95b6-6a9889bca7de'::uuid as service_id;

select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_user from cfg), 'role', 'authenticated')::text, true);

create temp table t (k text primary key, id uuid);
create temp table res (n serial, name text, expected text, got text, ok boolean);

insert into public.patients (clinic_id, mrno, name) select clinic_id, 'ZZREF-A', 'Ref A' from cfg;
insert into public.patients (clinic_id, mrno, name) select clinic_id, 'ZZREF-B', 'Ref B' from cfg;
insert into t select 'pa', id from public.patients where mrno = 'ZZREF-A';
insert into t select 'pb', id from public.patients where mrno = 'ZZREF-B';

create function pg_temp.mkvisit(p_key text, p_patient text, p_date date) returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise, actual_bill_paise,
    clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise, tds_paise, partner_share_paise)
  select c.clinic_id, (select id from t where k = p_patient), c.therapist_id, p_date, c.service_id, 100, 100, 0, 0, 'gross_bill', 0, 0, 0, 0
    from cfg c returning id into v;
  insert into t values (p_key, v);
end $$;

create function pg_temp.mknote(p_patient text, p_visit text, p_mode text, p_status text, p_updated timestamptz, p_diag text, p_icd text) returns void language plpgsql as $$
begin
  insert into public.consultation_notes (clinic_id, patient_id, therapist_id, visit_id, note_mode, status, updated_at, assessment_payload)
  select c.clinic_id, (select id from t where k = p_patient), c.therapist_id, (select id from t where k = p_visit), p_mode, p_status, p_updated,
         jsonb_build_object('referral', jsonb_build_object('diagnosis', p_diag, 'diagnosisIcdCode', p_icd, 'referringPhysician', 'Dr R', 'physicianRegistrationNo', '123'))
    from cfg c;
end $$;

create function pg_temp.check_diag(p_name text, p_visits text[], p_expected text) returns void language plpgsql as $$
declare v_got jsonb;
begin
  select public.get_invoice_referral_for_visits((select array_agg(id) from t where k = any (p_visits))) into v_got;
  insert into res (name, expected, got, ok)
    values (p_name, coalesce(p_expected, 'null'), coalesce(v_got ->> 'diagnosis', 'null'), coalesce(v_got ->> 'diagnosis', 'null') = coalesce(p_expected, 'null'));
end $$;

select pg_temp.mkvisit('v1', 'pa', date '2026-11-02'), pg_temp.mkvisit('v2', 'pa', date '2026-11-10'), pg_temp.mkvisit('vb', 'pb', date '2026-11-03');

-- Notes for patient A
select pg_temp.mknote('pa', null, 'initial', 'completed', timestamptz '2026-10-01', 'OLD', 'M00');
select pg_temp.mknote('pa', null, 'followup', 'completed', timestamptz '2026-11-08', 'IN PERIOD', 'M54.12');
select pg_temp.mknote('pa', null, 'followup', 'completed', timestamptz '2026-12-01', 'AFTERWARDS', 'M99');
select pg_temp.mknote('pa', null, 'session', 'completed', timestamptz '2026-11-09', 'SESSION', 'S00');
select pg_temp.mknote('pa', null, 'initial', 'draft', timestamptz '2026-11-09', 'DRAFT', 'D00');

select pg_temp.check_diag('the latest completed note up to the last visit, not the newest overall', array['v1','v2'], 'IN PERIOD');
-- The demo clinic is in India: 20:00 UTC on the last visit's date is already the next day there, 18:00 UTC is not.
select pg_temp.mknote('pa', null, 'followup', 'completed', timestamptz '2026-11-10 20:00+00', 'NEXT DAY THERE', 'N01');
select pg_temp.check_diag('a note from the next day in the clinic''s zone is after the last visit', array['v1','v2'], 'IN PERIOD');
select pg_temp.mknote('pa', null, 'followup', 'completed', timestamptz '2026-11-10 18:00+00', 'SAME DAY THERE', 'N02');
select pg_temp.check_diag('a note late on the last visit''s day in the clinic''s zone counts', array['v1','v2'], 'SAME DAY THERE');
select pg_temp.mknote('pa', 'v1', 'initial', 'completed', timestamptz '2026-11-02', 'LINKED TO V1', 'L01');
select pg_temp.check_diag('a note written for one of the visits wins', array['v1','v2'], 'LINKED TO V1');
select pg_temp.mknote('pa', 'v2', 'followup', 'completed', timestamptz '2026-11-10', 'LINKED TO V2', 'L02');
select pg_temp.check_diag('the latest visit''s own note wins over an earlier visit''s', array['v1','v2'], 'LINKED TO V2');
select pg_temp.check_diag('visits of two patients return nothing', array['v1','vb'], null);
select pg_temp.check_diag('no visits return nothing', array[]::text[], null);

-- The ICD code comes back, and nothing else leaves
insert into res (name, expected, got, ok)
select 'the ICD code is returned', 'L02', coalesce(r ->> 'diagnosisIcdCode', 'null'), coalesce(r ->> 'diagnosisIcdCode', '') = 'L02'
  from (select public.get_invoice_referral_for_visits((select array_agg(id) from t where k in ('v1','v2'))) r) x;
insert into res (name, expected, got, ok)
select 'only the four referral fields are returned', '4', (select count(*)::text from jsonb_object_keys(r)), (select count(*) from jsonb_object_keys(r)) = 4
  from (select public.get_invoice_referral_for_visits((select array_agg(id) from t where k in ('v1','v2'))) r) x;

-- Not a member: nothing
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select pg_temp.check_diag('someone outside the clinic gets nothing', array['v1','v2'], null);

select n, name, expected, got, ok from res order by n;

rollback;
