-- Checks for the invoice integrity rules (issue_invoice / amend_invoice refuse an invoice that does not match its visits).
-- Runs entirely inside a transaction that is rolled back: nothing is kept. Uses the "demo clinic" and its admin; to use
-- another clinic, change the three ids in the `cfg` row (the clinic needs a plan above Lite, which the script sets for the
-- length of the transaction, a therapist and a service).
--
-- Reads as a table at the end: every row's `ok` must be true. Before the migration the "refused" rows read false (the server
-- accepted them); after it, all rows are true.
begin;

create temp table cfg as select
  'f3919f75-815d-4f59-9bda-89bbceb2dbd2'::uuid as clinic_id,
  'a9c1320e-86b6-4e46-b518-a29a01f14665'::uuid as admin_user,
  '17d5b404-2c03-488f-bdef-97286c99393e'::uuid as therapist_id,
  '2d3af21a-f65b-4476-95b6-6a9889bca7de'::uuid as service_id;

select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_user from cfg), 'role', 'authenticated')::text, true);
update public.clinic_plans set plan_tier = 'clinic', status = 'active' where clinic_id = (select clinic_id from cfg);

create temp table t (k text primary key, id uuid);
create temp table res (n serial, name text, expected text, got text, ok boolean);

insert into public.patients (clinic_id, mrno, name)
  select clinic_id, 'ZZTEST-A', 'Test Patient A' from cfg;
insert into public.patients (clinic_id, mrno, name)
  select clinic_id, 'ZZTEST-B', 'Test Patient B' from cfg;
insert into t select 'pa', id from public.patients where mrno = 'ZZTEST-A';
insert into t select 'pb', id from public.patients where mrno = 'ZZTEST-B';

create function pg_temp.mkvisit(p_key text, p_patient text, p_bill bigint) returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.visits (
    clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise, actual_bill_paise,
    clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise, tds_paise, partner_share_paise
  ) select c.clinic_id, (select id from t where k = p_patient), c.therapist_id, current_date, c.service_id, p_bill, p_bill,
           0, 0, 'gross_bill', 0, 0, 0, 0
    from cfg c returning id into v;
  insert into t values (p_key, v);
end $$;

-- Runs one statement and records what happened. expected = 'ok' or a phrase the error must contain.
create function pg_temp.attempt(p_name text, p_expected text, p_sql text) returns void language plpgsql as $$
declare v_got text;
begin
  begin
    execute p_sql;
    v_got := 'ok';
  exception when others then
    v_got := sqlerrm;
  end;
  insert into res (name, expected, got, ok)
    values (p_name, p_expected, v_got, case when p_expected = 'ok' then v_got = 'ok' else position(p_expected in v_got) > 0 end);
end $$;

-- builds the call text
create function pg_temp.issue(p_mrno text, p_total bigint, p_lines bigint, p_visits text[]) returns text language sql as $$
  select format(
    $f$select public.issue_invoice(%L, 'ZZ-TEST', %L::jsonb, %L::jsonb, %s, 'UPI', %L, (select array_agg(id) from t where k = any(%L::text[])), null)$f$,
    (select clinic_id from cfg), json_build_object('mrno', p_mrno, 'name', 'x')::text,
    json_build_array(json_build_object('totalPaise', p_lines, 'serviceName', 'S'))::text, p_total,
    (select therapist_id from cfg), p_visits::text)
$$;
create function pg_temp.amend(p_orig text, p_mrno text, p_total bigint, p_lines bigint, p_visits text[]) returns text language sql as $$
  select format(
    $f$select public.amend_invoice((select id from t where k = %L), %L, 'ZZ-TEST', %L::jsonb, %L::jsonb, %s, 'UPI', %L, (select array_agg(id) from t where k = any(%L::text[])), null)$f$,
    p_orig, (select clinic_id from cfg), json_build_object('mrno', p_mrno, 'name', 'x')::text,
    json_build_array(json_build_object('totalPaise', p_lines, 'serviceName', 'S'))::text, p_total,
    (select therapist_id from cfg), p_visits::text)
$$;

select pg_temp.mkvisit('a1', 'pa', 150000), pg_temp.mkvisit('a2', 'pa', 80000), pg_temp.mkvisit('a3', 'pa', 150000),
       pg_temp.mkvisit('a4', 'pa', 50000), pg_temp.mkvisit('a5', 'pa', 50000), pg_temp.mkvisit('a6', 'pa', 50000),
       pg_temp.mkvisit('a7', 'pa', 50000), pg_temp.mkvisit('a8', 'pa', 50000), pg_temp.mkvisit('a9', 'pa', 70000),
       pg_temp.mkvisit('a0', 'pa', 0),
       pg_temp.mkvisit('b1', 'pb', 50000);

-- Valid invoices still issue
select pg_temp.attempt('one visit issues', 'ok', pg_temp.issue('ZZTEST-A', 150000, 150000, array['a1']));
insert into t select 'inv1', id from public.invoices where invoice_no like '%/ZZ-TEST/%' order by seq desc limit 1;
select pg_temp.attempt('two visits, one patient, issue', 'ok', pg_temp.issue('ZZTEST-A', 230000, 230000, array['a2','a3']));

-- Refused
select pg_temp.attempt('total one rupee too high is refused', 'does not match the visits', pg_temp.issue('ZZTEST-A', 50100, 50100, array['a4']));
select pg_temp.attempt('total one rupee too low is refused', 'does not match the visits', pg_temp.issue('ZZTEST-A', 49900, 49900, array['a5']));
select pg_temp.attempt('two patients on one invoice are refused', 'same patient', pg_temp.issue('ZZTEST-A', 100000, 100000, array['a6','b1']));
select pg_temp.attempt('another patient''s ID on the invoice is refused', 'does not match its visits', pg_temp.issue('ZZTEST-B', 50000, 50000, array['a7']));
select pg_temp.attempt('lines that do not add up to the total are refused', 'do not add up', pg_temp.issue('ZZTEST-A', 50000, 40000, array['a8']));
select pg_temp.attempt('a zero total is refused', 'Nothing to bill', pg_temp.issue('ZZTEST-A', 0, 0, array['a0']));
select pg_temp.attempt('no visits is refused', 'No visits', pg_temp.issue('ZZTEST-A', 0, 0, array[]::text[]));

-- Amend. The refused cases come first: a successful amendment re-points the invoice's visits to the new invoice.
select pg_temp.attempt('amend: a visit of another patient is refused', 'same patient', pg_temp.amend('inv1', 'ZZTEST-A', 200000, 200000, array['a1','b1']));
select pg_temp.attempt('amend: a wrong total is refused', 'does not match the visits', pg_temp.amend('inv1', 'ZZTEST-A', 150001, 150001, array['a1']));
select pg_temp.attempt('amend: same visit plus one more visit of the patient', 'ok', pg_temp.amend('inv1', 'ZZTEST-A', 220000, 220000, array['a1','a9']));

select n, name, expected, got, ok from res order by n;

rollback;
