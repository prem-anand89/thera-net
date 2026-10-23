-- Role checks for the visit_items / visit_credits migrations (20261023100000 and 20261024100000).
-- Run in the Supabase SQL editor AFTER applying both migrations. Run each do-block on its own;
-- every block ends with an error that starts with RESULT and rolls the block back. Read PASS/FAIL there.

-- Task 2 role checks for 20261023100000_visit_items_and_credits.sql.
--
-- Run AFTER the migration is applied (as the postgres/owner role, e.g. Supabase MCP execute_sql). Run each
-- do-block on its own. Every block builds its own test visit, simulates a role with request.jwt.claims +
-- `set local role authenticated`, and ends by raising 'RESULT ...' -- the raise rolls the whole block back,
-- so nothing is left behind. Read the outcome from the error message: each check prints PASS or FAIL.
--
-- Ids are looked up, not hard-coded, and each block picks the first clinic (ordered by name) that has just the
-- roles THAT block simulates -- no single clinic needs to have everything:
--   * front-desk blocks need a front-desk member (+ admin / a therapist login only where the block acts as one);
--   * blocks acting as a therapist need that therapist linked to a login whose membership role is 'therapist';
--     a second therapist used only as "assisting_therapist_id" or as another visit's primary is plain data and
--     needs no login;
--   * block 8 (delete policies) mixes a front desk with an assistant login, so its assistant check runs in a
--     separate clinic when needed; block 5's cross-clinic check needs a second clinic.
-- Every clinic needs a service; if it has no patient a throwaway patient is inserted (rolled back with the block).
-- Every RESULT string starts with the clinic name(s) the block ran on, in square brackets. If no clinic qualifies
-- the block reports 'RESULT skipped: ...'. A sub-check marked SKIPPED inside a result is NOT a failure; it
-- only means the data has no clinic that can supply that actor combination.
--
-- RLS hides rows rather than erroring on UPDATE/DELETE, so "cannot" is checked as row_count = 0; trigger and
-- constraint rejections are checked by catching the error code.

-- ===========================================================================
-- 1. Front desk can update a visit and its lines and shares (and add a line). Cannot delete the visit.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_desk uuid; v_t1 uuid; v_t1_user uuid; v_t2 uuid; v_t2_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_item uuid; v_credit uuid;
  n int; v_clinic_name text; r text := '';
begin
  -- lookup (as owner)
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where exists (select 1 from clinic_members d where d.clinic_id = c.id and d.role = 'front_desk')
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 2
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a front-desk member, 2 therapist rows, a service';
  end if;
  select user_id into v_desk from clinic_members where clinic_id = v_clinic and role = 'front_desk' limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic order by t.id limit 1;
  select t.id, t.user_id into v_t2, v_t2_user from therapists t
   where t.clinic_id = v_clinic and t.id <> v_t1 order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  -- test visit (primary t1) with one line assisted by t2, and a share row (as owner)
  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id)
  values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000, v_t2) returning id into v_item;
  insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise)
  values (v_clinic, v_visit, v_t1, 100000) returning id into v_credit;

  -- as front desk
  perform set_config('request.jwt.claims', json_build_object('sub', v_desk, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update visits set condition = 'front desk correction' where id = v_visit;
  get diagnostics n = row_count;
  r := r || format('desk updates visit: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);

  update visit_items set position = 1 where id = v_item;
  get diagnostics n = row_count;
  r := r || format('desk updates line: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);

  update visit_credits set amount_paise = 100000 where id = v_credit;
  get diagnostics n = row_count;
  r := r || format('desk updates share: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);

  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
    values (v_clinic, v_visit, 2, v_service, 'Verify extra', 0, 0);
    r := r || 'desk adds line: PASS; ';
  exception when others then
    r := r || format('desk adds line: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;

  delete from visits where id = v_visit;
  get diagnostics n = row_count;
  r := r || format('desk cannot delete visit: %s', case when n = 0 then 'PASS' else 'FAIL' end);

  raise exception 'RESULT [%] front desk -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 2. An assisting (non-primary) therapist cannot change the visit, its lines or its shares.
--    They can read them; an upsert of an existing line (the sync push shape) is refused.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_t1 uuid; v_t1_user uuid; v_t2 uuid; v_t2_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_item uuid; v_credit uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 2
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a therapist login and a second therapist row, a service';
  end if;
  select t.id, t.user_id into v_t2, v_t2_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic and t.id <> v_t2 order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id)
  values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000, v_t2) returning id into v_item;
  insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise)
  values (v_clinic, v_visit, v_t2, 100000) returning id into v_credit;

  -- as the assisting therapist t2
  perform set_config('request.jwt.claims', json_build_object('sub', v_t2_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from visit_items where id = v_item;
  r := r || format('assistant reads line: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);

  update visits set condition = 'assistant edit' where id = v_visit;
  get diagnostics n = row_count;
  r := r || format('assistant cannot update visit: %s; ', case when n = 0 then 'PASS' else 'FAIL' end);

  update visit_items set position = 5 where id = v_item;
  get diagnostics n = row_count;
  r := r || format('assistant cannot update line: %s; ', case when n = 0 then 'PASS' else 'FAIL' end);

  update visit_items set deleted = true where id = v_item;
  get diagnostics n = row_count;
  r := r || format('assistant cannot soft-delete line: %s; ', case when n = 0 then 'PASS' else 'FAIL' end);

  update visit_credits set amount_paise = 1 where id = v_credit;
  get diagnostics n = row_count;
  r := r || format('assistant cannot update own share: %s; ', case when n = 0 then 'PASS' else 'FAIL' end);

  -- The sync engine pushes with upsert; for an existing row that is an UPDATE and must be refused.
  begin
    insert into visit_items (id, clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
    values (v_item, v_clinic, v_visit, 9, v_service, 'Verify service', 100000, 100000)
    on conflict (id) do update set position = excluded.position;
    r := r || 'assistant upsert of existing line refused: FAIL';
  exception when others then
    r := r || format('assistant upsert of existing line refused: %s (%s)',
                     case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  raise exception 'RESULT [%] assisting therapist -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 3. The primary therapist and an admin can change lines and shares.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_t1 uuid; v_t1_user uuid; v_t2 uuid; v_t2_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_item uuid; v_credit uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where exists (select 1 from clinic_members a where a.clinic_id = c.id and a.role = 'admin')
     and (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 2
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with an admin, a therapist login, a second therapist row, a service';
  end if;
  select user_id into v_admin from clinic_members where clinic_id = v_clinic and role = 'admin' limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select t.id, t.user_id into v_t2, v_t2_user from therapists t
   where t.clinic_id = v_clinic and t.id <> v_t1 order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id)
  values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000, v_t2) returning id into v_item;
  insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise)
  values (v_clinic, v_visit, v_t1, 100000) returning id into v_credit;

  -- as the primary therapist t1
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update visit_items set position = 1 where id = v_item;
  get diagnostics n = row_count;
  r := r || format('primary updates line: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  update visit_credits set amount_paise = 100000 where id = v_credit;
  get diagnostics n = row_count;
  r := r || format('primary updates share: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  update visits set credits_mode = 'manual' where id = v_visit;
  get diagnostics n = row_count;
  r := r || format('primary updates visit: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);

  -- as admin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update visit_items set position = 2 where id = v_item;
  get diagnostics n = row_count;
  r := r || format('admin updates line: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  update visit_credits set amount_paise = 100000 where id = v_credit;
  get diagnostics n = row_count;
  r := r || format('admin updates share: %s', case when n = 1 then 'PASS' else 'FAIL' end);

  raise exception 'RESULT [%] primary + admin -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 4. Nobody (not even an admin) can add, change or delete lines on an invoiced visit (error code 42501 AND the
--    freeze message). Shares stay editable.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_t1 uuid; v_t1_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_item uuid; v_credit uuid; v_invoice uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where exists (select 1 from clinic_members a where a.clinic_id = c.id and a.role = 'admin')
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 1
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with an admin, a therapist row, a service';
  end if;
  select user_id into v_admin from clinic_members where clinic_id = v_clinic and role = 'admin' limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
  values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000) returning id into v_item;
  insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise)
  values (v_clinic, v_visit, v_t1, 100000) returning id into v_credit;
  -- a throwaway invoice, then put the visit on it (as owner)
  insert into invoices (clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items, total_paise, payment_mode)
  values (v_clinic, 'VERIFY-' || gen_random_uuid(), 'VERIFY-' || gen_random_uuid(), 1, '{}'::jsonb, '[]'::jsonb, 100000, 'Cash')
  returning id into v_invoice;
  update visits set invoice_id = v_invoice where id = v_visit;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    update visit_items set position = 1 where id = v_item;
    r := r || 'invoiced: update line refused: FAIL; ';
  exception when others then
    r := r || format('invoiced: update line refused: %s (%s %s); ',
                     case when sqlstate = '42501' and sqlerrm = 'This visit is on an invoice; its services are frozen.' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    update visit_items set deleted = true where id = v_item;
    r := r || 'invoiced: soft-delete line refused: FAIL; ';
  exception when others then
    r := r || format('invoiced: soft-delete line refused: %s (%s %s); ', case when sqlstate = '42501' and sqlerrm = 'This visit is on an invoice; its services are frozen.' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
    values (v_clinic, v_visit, 1, v_service, 'Verify extra', 0, 0);
    r := r || 'invoiced: add line refused: FAIL; ';
  exception when others then
    r := r || format('invoiced: add line refused: %s (%s %s); ', case when sqlstate = '42501' and sqlerrm = 'This visit is on an invoice; its services are frozen.' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    delete from visit_items where id = v_item;
    r := r || 'invoiced: delete line refused: FAIL; ';
  exception when others then
    r := r || format('invoiced: delete line refused: %s (%s %s); ', case when sqlstate = '42501' and sqlerrm = 'This visit is on an invoice; its services are frozen.' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;

  update visit_credits set amount_paise = 100000 where id = v_credit;
  get diagnostics n = row_count;
  r := r || format('invoiced: admin still updates share: %s', case when n = 1 then 'PASS' else 'FAIL' end);

  raise exception 'RESULT [%] invoiced -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 5. Row rules: two live package lines on one visit fail; a soft-deleted one doesn't count; the assistant
--    cannot be the visit's own therapist; a line can't point at another clinic.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_t1 uuid; v_t1_user uuid; v_patient uuid; v_service uuid; v_visit uuid; v_pkg uuid;
  v_other_clinic uuid;
  v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a therapist login, a service';
  end if;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;
  select id into v_other_clinic from clinics where id <> v_clinic limit 1;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;

  -- as primary therapist
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise, is_package_line)
  values (v_clinic, v_visit, 0, v_service, 'Verify package', 100000, 100000, true) returning id into v_pkg;
  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise, is_package_line)
    values (v_clinic, v_visit, 1, v_service, 'Verify package 2', 0, 0, true);
    r := r || 'second package line refused: FAIL; ';
  exception when others then
    r := r || format('second package line refused: %s (%s); ',
                     case when sqlstate = '23505' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  update visit_items set deleted = true where id = v_pkg;
  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise, is_package_line)
    values (v_clinic, v_visit, 1, v_service, 'Verify package 3', 0, 0, true);
    r := r || 'package line after the first is soft-deleted: PASS; ';
  exception when others then
    r := r || format('package line after the first is soft-deleted: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;

  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise, assisting_therapist_id)
    values (v_clinic, v_visit, 2, v_service, 'Verify self-assist', 0, 0, v_t1);
    r := r || 'assistant = primary refused: FAIL; ';
  exception when others then
    r := r || format('assistant = primary refused: %s (%s); ',
                     case when sqlstate = '23514' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  if v_other_clinic is not null then
    execute 'reset role';  -- as owner, so only the trigger (not RLS) can refuse it
    begin
      insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise)
      values (v_other_clinic, v_visit, v_t1, 0);
      r := r || 'share pointing at another clinic refused: FAIL';
    exception when others then
      r := r || format('share pointing at another clinic refused: %s (%s)',
                       case when sqlstate = '23514' then 'PASS' else 'FAIL' end, sqlstate);
    end;
  else
    r := r || 'share pointing at another clinic refused: SKIPPED (needs a second clinic)';
  end if;

  raise exception 'RESULT [%] row rules -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 6. A therapist who is neither the primary nor the visit's creator cannot add a line or a share to it
--    (not even crediting themselves).
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_desk uuid; v_t1 uuid; v_t1_user uuid; v_t2 uuid; v_t2_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_visit_b uuid; v_item uuid; v_credit uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_other_ther uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 2
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a therapist login and a second therapist row, a service';
  end if;
  select t.id, t.user_id into v_t2, v_t2_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic and t.id <> v_t2 order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t2_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise, assisting_therapist_id)
    values (v_clinic, v_visit, 7, v_service, 'Verify extra', 0, 0, null);
    r := r || 'non-primary non-creator adds line refused: FAIL; ';
  exception when others then
    r := r || format('non-primary non-creator adds line refused: %s (%s %s); ', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise) values (v_clinic, v_visit, v_t2, 0);
    r := r || 'non-primary non-creator credits themselves refused: FAIL; ';
  exception when others then
    r := r || format('non-primary non-creator credits themselves refused: %s (%s %s); ', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;

  raise exception 'RESULT [%] non-creator insert -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 7. A therapist who logged a visit for a colleague (visits.created_by = them) can add its lines and shares,
--    but cannot change them afterwards.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_desk uuid; v_t1 uuid; v_t1_user uuid; v_t2 uuid; v_t2_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_visit_b uuid; v_item uuid; v_credit uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_other_ther uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 2
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a therapist login and a second therapist row, a service';
  end if;
  select t.id, t.user_id into v_t2, v_t2_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic and t.id <> v_t2 order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  -- create the visit as t2 (owner role, but auth.uid() = t2 so set_updated_at stamps created_by = t2)
  perform set_config('request.jwt.claims', json_build_object('sub', v_t2_user, 'role', 'authenticated')::text, true);
  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  select count(*) into n from visits where id = v_visit and created_by = v_t2_user;
  r := r || format('created_by stamped on insert: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  execute 'set local role authenticated';
  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise, assisting_therapist_id)
    values (v_clinic, v_visit, 7, v_service, 'Verify extra', 0, 0, null);
    r := r || 'creator adds line: PASS; ';
  exception when others then
    r := r || format('creator adds line: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;
  begin
    insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise) values (v_clinic, v_visit, v_t1, 0);
    insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise) values (v_clinic, v_visit, v_t2, 0);
    r := r || 'creator adds shares: PASS; ';
  exception when others then
    r := r || format('creator adds shares: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;
  update visit_items set position = 8 where visit_id = v_visit;
  get diagnostics n = row_count;
  r := r || format('creator cannot change a line afterwards: %s; ', case when n = 0 then 'PASS' else 'FAIL' end);

  raise exception 'RESULT [%] creator insert -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 8. Delete policies: front desk, admin and the primary can hard-delete a line on an uninvoiced visit; the
--    assistant cannot.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_clinic_name text; v_admin uuid; v_desk uuid; v_t1 uuid; v_t1_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_i1 uuid; v_i2 uuid; v_i3 uuid;
  -- part B (assistant), possibly a different clinic
  v_clinic_b uuid; v_clinic_b_name text; v_pt uuid; v_pt_user uuid; v_pa uuid; v_pa_user uuid;
  v_patient_b uuid; v_service_b uuid; v_visit_b uuid; v_i4 uuid;
  n int; r text := '';
begin
  -- part A: front desk + admin + primary therapist login
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where exists (select 1 from clinic_members d where d.clinic_id = c.id and d.role = 'front_desk')
     and exists (select 1 from clinic_members a where a.clinic_id = c.id and a.role = 'admin')
     and (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a front-desk member, an admin, a therapist login, a service';
  end if;
  select user_id into v_admin from clinic_members where clinic_id = v_clinic and role = 'admin' limit 1;
  select user_id into v_desk from clinic_members where clinic_id = v_clinic and role = 'front_desk' limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  -- part B: the assistant is a therapist login; needs only a therapist login plus another therapist row
  select c.id, c.name into v_clinic_b, v_clinic_b_name from clinics c
   where (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 2
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic_b is null then
    r := r || 'assistant cannot delete line: SKIPPED (needs a clinic with a therapist login and a second therapist row); ';
  else
    select t.id, t.user_id into v_pa, v_pa_user from therapists t
      join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
     where t.clinic_id = v_clinic_b and m.role = 'therapist' order by t.id limit 1;
    select t.id, t.user_id into v_pt, v_pt_user from therapists t
     where t.clinic_id = v_clinic_b and t.id <> v_pa order by t.id limit 1;
    select id into v_patient_b from patients where clinic_id = v_clinic_b limit 1;
    if v_patient_b is null then  -- throwaway patient (rolled back with the block)
      insert into patients (clinic_id, mrno, name)
      values (v_clinic_b, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient_b;
    end if;
    select id into v_service_b from service_catalog where clinic_id = v_clinic_b limit 1;
    insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                        actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                        tds_paise, partner_share_paise)
    values (v_clinic_b, v_patient_b, v_pt, current_date, v_service_b, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
    returning id into v_visit_b;
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                             price_paise, assisting_therapist_id)
    values (v_clinic_b, v_visit_b, 0, v_service_b, 'Verify service', 100000, 100000, v_pa) returning id into v_i4;
  end if;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id)
  values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000, null) returning id into v_i1;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id)
  values (v_clinic, v_visit, 1, v_service, 'Verify service', 100000, 100000, null) returning id into v_i2;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id)
  values (v_clinic, v_visit, 2, v_service, 'Verify service', 100000, 100000, null) returning id into v_i3;
  perform set_config('request.jwt.claims', json_build_object('sub', v_desk, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from visit_items where id = v_i1;
  get diagnostics n = row_count;
  r := r || format('front desk deletes line: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from visit_items where id = v_i2;
  get diagnostics n = row_count;
  r := r || format('admin deletes line: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from visit_items where id = v_i3;
  get diagnostics n = row_count;
  r := r || format('primary deletes line: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  if v_i4 is not null then
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v_pa_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    delete from visit_items where id = v_i4;
    get diagnostics n = row_count;
    r := r || format('assistant cannot delete line: %s; ', case when n = 0 then 'PASS' else 'FAIL' end);
  end if;

  raise exception 'RESULT [%] delete policies -- %', v_clinic_name || coalesce(' / ' || v_clinic_b_name, ''), r;
end $$;

-- ===========================================================================
-- 9. WITH CHECK: the primary of visit A cannot move a line or a share onto visit B (someone else's visit).
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_desk uuid; v_t1 uuid; v_t1_user uuid; v_t2 uuid; v_t2_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_visit_b uuid; v_item uuid; v_credit uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_other_ther uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 2
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a therapist login, a second therapist row, a service';
  end if;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select t.id, t.user_id into v_t2, v_t2_user from therapists t
   where t.clinic_id = v_clinic and t.id <> v_t1 order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t2, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit_b;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id)
  values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000, null) returning id into v_item;
  insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise)
  values (v_clinic, v_visit, v_t1, 100000) returning id into v_credit;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update visit_items set visit_id = v_visit_b where id = v_item;
    r := r || 'primary moves line to another visit refused: FAIL; ';
  exception when others then
    r := r || format('primary moves line to another visit refused: %s (%s %s); ', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    update visit_credits set visit_id = v_visit_b where id = v_credit;
    r := r || 'primary moves share to another visit refused: FAIL; ';
  exception when others then
    r := r || format('primary moves share to another visit refused: %s (%s %s); ', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;

  raise exception 'RESULT [%] with check -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 10. A therapist from another clinic can't be tagged as assistant or credited.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_desk uuid; v_t1 uuid; v_t1_user uuid; v_t2 uuid; v_t2_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_visit_b uuid; v_item uuid; v_credit uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_other_ther uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where exists (select 1 from clinic_members a where a.clinic_id = c.id and a.role = 'admin')
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 1
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with an admin, a therapist row, a service';
  end if;
  select user_id into v_admin from clinic_members where clinic_id = v_clinic and role = 'admin' limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  select id into v_other_ther from therapists where clinic_id <> v_clinic limit 1;
  if v_other_ther is null then
    raise exception 'RESULT skipped: no therapist in another clinic';
  end if;
  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise, assisting_therapist_id)
    values (v_clinic, v_visit, 7, v_service, 'Verify extra', 0, 0, v_other_ther);
    r := r || 'other-clinic assistant refused: FAIL; ';
  exception when others then
    r := r || format('other-clinic assistant refused: %s (%s %s); ', case when sqlstate = '23514' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise) values (v_clinic, v_visit, v_other_ther, 0);
    r := r || 'other-clinic credit refused: FAIL; ';
  exception when others then
    r := r || format('other-clinic credit refused: %s (%s %s); ', case when sqlstate = '23514' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;

  raise exception 'RESULT [%] other-clinic therapist -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- FINAL REVIEW additions, for 20261024100000_visit_items_hardening.sql (run after that migration is applied).
-- ===========================================================================

-- ===========================================================================
-- 11. Soft-deleting a visit (deleted = true): front desk is refused (42501), even though it can update the
--     visit; the visit's own therapist and an admin can; server-side work without a user (auth.uid() null)
--     is let through.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_desk uuid; v_t1 uuid; v_t1_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_visit_b uuid; v_visit_c uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where exists (select 1 from clinic_members d where d.clinic_id = c.id and d.role = 'front_desk')
     and exists (select 1 from clinic_members a where a.clinic_id = c.id and a.role = 'admin')
     and (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a front-desk member, an admin, a therapist login, a service';
  end if;
  select user_id into v_admin from clinic_members where clinic_id = v_clinic and role = 'admin' limit 1;
  select user_id into v_desk from clinic_members where clinic_id = v_clinic and role = 'front_desk' limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  -- three test visits, primary t1 (as owner)
  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit_b;
  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit_c;

  -- as front desk
  perform set_config('request.jwt.claims', json_build_object('sub', v_desk, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update visits set condition = 'front desk correction' where id = v_visit;
  get diagnostics n = row_count;
  r := r || format('desk updates visit: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  begin
    update visits set deleted = true where id = v_visit;
    r := r || 'desk soft-delete refused: FAIL; ';
  exception when others then
    r := r || format('desk soft-delete refused: %s (%s %s); ',
                     case when sqlstate = '42501' and sqlerrm = 'Only an admin or the visit''s therapist can delete a visit.'
                          then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  -- the sync push shape (upsert) for the same flip
  begin
    insert into visits (id, clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                        actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                        tds_paise, partner_share_paise, deleted)
    values (v_visit, v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000, true)
    on conflict (id) do update set deleted = excluded.deleted;
    r := r || 'desk soft-delete by upsert refused: FAIL; ';
  exception when others then
    r := r || format('desk soft-delete by upsert refused: %s (%s %s); ',
                     case when sqlstate = '42501' and sqlerrm = 'Only an admin or the visit''s therapist can delete a visit.'
                          then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;

  -- as the visit's own therapist
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update visits set deleted = true where id = v_visit;
    get diagnostics n = row_count;
    r := r || format('own therapist soft-deletes: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    r := r || format('own therapist soft-deletes: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;

  -- as admin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update visits set deleted = true where id = v_visit_b;
    get diagnostics n = row_count;
    r := r || format('admin soft-deletes: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    r := r || format('admin soft-deletes: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;

  -- as owner with no user (server-side work)
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin
    update visits set deleted = true where id = v_visit_c;
    get diagnostics n = row_count;
    r := r || format('no-user server work soft-deletes: %s', case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    r := r || format('no-user server work soft-deletes: FAIL (%s %s)', sqlstate, sqlerrm);
  end;

  raise exception 'RESULT [%] visit soft-delete -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 12. Invoiced visit: an identical update of a line (what a backup restore or a sync retry sends) passes; a
--     price change is still refused (42501 with the freeze message).
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_t1 uuid; v_t1_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_item uuid; v_invoice uuid;
  n int; v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where exists (select 1 from clinic_members a where a.clinic_id = c.id and a.role = 'admin')
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 1
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with an admin, a therapist row, a service';
  end if;
  select user_id into v_admin from clinic_members where clinic_id = v_clinic and role = 'admin' limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
  values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000) returning id into v_item;
  insert into invoices (clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items, total_paise, payment_mode)
  values (v_clinic, 'VERIFY-' || gen_random_uuid(), 'VERIFY-' || gen_random_uuid(), 1, '{}'::jsonb, '[]'::jsonb, 100000, 'Cash')
  returning id into v_invoice;
  update visits set invoice_id = v_invoice where id = v_visit;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    update visit_items set position = position, price_paise = price_paise where id = v_item;
    get diagnostics n = row_count;
    r := r || format('invoiced: identical update passes: %s; ', case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    r := r || format('invoiced: identical update passes: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;
  -- the restore / sync push shape: upsert of the same row with the same values
  begin
    insert into visit_items (id, clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
    values (v_item, v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000)
    on conflict (id) do update set position = excluded.position, service_name = excluded.service_name,
      catalog_price_paise = excluded.catalog_price_paise, price_paise = excluded.price_paise,
      deleted = excluded.deleted;
    r := r || 'invoiced: identical upsert passes: PASS; ';
  exception when others then
    r := r || format('invoiced: identical upsert passes: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;
  -- the same upsert shape, but changing the price: refused
  begin
    insert into visit_items (id, clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
    values (v_item, v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 1)
    on conflict (id) do update set position = excluded.position, service_name = excluded.service_name,
      catalog_price_paise = excluded.catalog_price_paise, price_paise = excluded.price_paise,
      deleted = excluded.deleted;
    r := r || 'invoiced: upsert changing the price refused: FAIL; ';
  exception when others then
    r := r || format('invoiced: upsert changing the price refused: %s (%s %s); ',
                     case when sqlstate = '42501' and sqlerrm = 'This visit is on an invoice; its services are frozen.' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  -- an upsert of a NEW line id on the invoiced visit: refused
  begin
    insert into visit_items (id, clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
    values (gen_random_uuid(), v_clinic, v_visit, 1, v_service, 'Verify extra', 0, 0)
    on conflict (id) do update set position = excluded.position, price_paise = excluded.price_paise;
    r := r || 'invoiced: upsert of a new line refused: FAIL; ';
  exception when others then
    r := r || format('invoiced: upsert of a new line refused: %s (%s %s); ',
                     case when sqlstate = '42501' and sqlerrm = 'This visit is on an invoice; its services are frozen.' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    update visit_items set price_paise = 1 where id = v_item;
    r := r || 'invoiced: price change refused: FAIL';
  exception when others then
    r := r || format('invoiced: price change refused: %s (%s %s)',
                     case when sqlstate = '42501' and sqlerrm = 'This visit is on an invoice; its services are frozen.' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;

  raise exception 'RESULT [%] invoiced no-op update -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 13. The visit's creator (t2, not the primary) can add a line and a share while the visit is uninvoiced, and
--     neither once it is invoiced (the share is refused by RLS; the line is also refused by the freeze trigger,
--     so can_add_visit_children is checked directly as well).
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_t1 uuid; v_t1_user uuid; v_t2 uuid; v_t2_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid; v_invoice uuid;
  v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where (select count(*) from therapists t join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id where t.clinic_id = c.id and m.role = 'therapist') >= 1
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 2
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with a therapist login and a second therapist row, a service';
  end if;
  select t.id, t.user_id into v_t2, v_t2_user from therapists t
    join clinic_members m on m.clinic_id = t.clinic_id and m.user_id = t.user_id
   where t.clinic_id = v_clinic and m.role = 'therapist' order by t.id limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic and t.id <> v_t2 order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  -- t2 logs the visit for t1 (owner role, auth.uid() = t2, so created_by = t2)
  perform set_config('request.jwt.claims', json_build_object('sub', v_t2_user, 'role', 'authenticated')::text, true);
  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;

  execute 'set local role authenticated';
  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
    values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000);
    r := r || 'creator adds line before invoice: PASS; ';
  exception when others then
    r := r || format('creator adds line before invoice: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;
  begin
    insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise) values (v_clinic, v_visit, v_t1, 100000);
    r := r || 'creator adds share before invoice: PASS; ';
  exception when others then
    r := r || format('creator adds share before invoice: FAIL (%s %s); ', sqlstate, sqlerrm);
  end;

  -- invoice the visit (as owner, no user)
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  insert into invoices (clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items, total_paise, payment_mode)
  values (v_clinic, 'VERIFY-' || gen_random_uuid(), 'VERIFY-' || gen_random_uuid(), 1, '{}'::jsonb, '[]'::jsonb, 100000, 'Cash')
  returning id into v_invoice;
  update visits set invoice_id = v_invoice where id = v_visit;

  perform set_config('request.jwt.claims', json_build_object('sub', v_t2_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise, price_paise)
    values (v_clinic, v_visit, 1, v_service, 'Verify extra', 0, 0);
    r := r || 'creator adds line after invoice refused: FAIL; ';
  exception when others then
    -- BEFORE triggers run before RLS's WITH CHECK, so the freeze trigger answers first here; the rule itself is
    -- checked directly below.
    r := r || format('creator adds line after invoice refused: %s (%s %s); ',
                     case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  r := r || format('can_add_visit_children false for the creator once invoiced: %s; ',
                   case when not can_add_visit_children(v_visit) then 'PASS' else 'FAIL' end);
  begin
    insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise) values (v_clinic, v_visit, v_t2, 0);
    r := r || 'creator adds share after invoice refused: FAIL';
  exception when others then
    r := r || format('creator adds share after invoice refused: %s (%s %s)',
                     case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;

  raise exception 'RESULT [%] creator after invoice -- %', v_clinic_name, r;
end $$;

-- ===========================================================================
-- 14. hard_delete_therapist refuses a therapist who only holds a revenue share row, or only assisted on a
--     line (live or soft-deleted), with its normal "linked record(s)" message -- not a foreign-key error. A
--     therapist with nothing linked is still deleted. Uses throwaway therapist rows.
-- ===========================================================================
do $$
declare
  v_clinic uuid; v_admin uuid; v_t1 uuid; v_t1_user uuid;
  v_patient uuid; v_service uuid; v_visit uuid;
  v_share_only uuid; v_assist_only uuid; v_assist_deleted uuid; v_unlinked uuid;
  v_clinic_name text; r text := '';
begin
  select c.id, c.name into v_clinic, v_clinic_name from clinics c
   where exists (select 1 from clinic_members a where a.clinic_id = c.id and a.role = 'admin')
     and (select count(*) from therapists t where t.clinic_id = c.id) >= 1
     and exists (select 1 from service_catalog s where s.clinic_id = c.id)
   order by c.name, c.id limit 1;
  if v_clinic is null then
    raise exception 'RESULT skipped: no clinic with an admin, a therapist row, a service';
  end if;
  select user_id into v_admin from clinic_members where clinic_id = v_clinic and role = 'admin' limit 1;
  select t.id, t.user_id into v_t1, v_t1_user from therapists t
   where t.clinic_id = v_clinic order by t.id limit 1;
  select id into v_patient from patients where clinic_id = v_clinic limit 1;
  if v_patient is null then  -- throwaway patient (rolled back with the block)
    insert into patients (clinic_id, mrno, name)
    values (v_clinic, 'VERIFY-' || substr(gen_random_uuid()::text, 1, 8), 'Verify patient') returning id into v_patient;
  end if;
  select id into v_service from service_catalog where clinic_id = v_clinic limit 1;

  -- throwaway roster rows (as owner); a seat/plan rule refusing them means this check can't run here
  begin
    insert into therapists (clinic_id, name) values (v_clinic, 'Verify share-only') returning id into v_share_only;
    insert into therapists (clinic_id, name) values (v_clinic, 'Verify assist-only') returning id into v_assist_only;
    insert into therapists (clinic_id, name) values (v_clinic, 'Verify assist-deleted') returning id into v_assist_deleted;
    insert into therapists (clinic_id, name) values (v_clinic, 'Verify unlinked') returning id into v_unlinked;
  exception when others then
    raise exception 'RESULT skipped: could not add throwaway therapists (%: %)', sqlstate, sqlerrm;
  end;

  insert into visits (clinic_id, patient_id, therapist_id, visit_date, service_catalog_id, catalog_price_paise,
                      actual_bill_paise, clinic_split_pct, tax_pct, tds_basis, clinic_share_paise, post_tax_paise,
                      tds_paise, partner_share_paise)
  values (v_clinic, v_patient, v_t1, current_date, v_service, 100000, 100000, 50, 0, 'gross_bill', 50000, 50000, 0, 50000)
  returning id into v_visit;
  insert into visit_credits (clinic_id, visit_id, therapist_id, amount_paise) values (v_clinic, v_visit, v_share_only, 0);
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id)
  values (v_clinic, v_visit, 0, v_service, 'Verify service', 100000, 100000, v_assist_only);
  insert into visit_items (clinic_id, visit_id, position, service_catalog_id, service_name, catalog_price_paise,
                           price_paise, assisting_therapist_id, deleted)
  values (v_clinic, v_visit, 1, v_service, 'Verify service', 0, 0, v_assist_deleted, true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform hard_delete_therapist(v_share_only);
    r := r || 'share-only refused: FAIL (deleted); ';
  exception when others then
    r := r || format('share-only refused: %s (%s %s); ',
                     case when sqlerrm like 'therapist has % linked record(s)%' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    perform hard_delete_therapist(v_assist_only);
    r := r || 'assist-only refused: FAIL (deleted); ';
  exception when others then
    r := r || format('assist-only refused: %s (%s %s); ',
                     case when sqlerrm like 'therapist has % linked record(s)%' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    perform hard_delete_therapist(v_assist_deleted);
    r := r || 'assist on a deleted line refused: FAIL (deleted); ';
  exception when others then
    r := r || format('assist on a deleted line refused: %s (%s %s); ',
                     case when sqlerrm like 'therapist has % linked record(s)%' then 'PASS' else 'FAIL' end, sqlstate, sqlerrm);
  end;
  begin
    perform hard_delete_therapist(v_unlinked);
    r := r || 'unlinked therapist deleted: PASS';
  exception when others then
    r := r || format('unlinked therapist deleted: FAIL (%s %s)', sqlstate, sqlerrm);
  end;

  raise exception 'RESULT [%] hard_delete_therapist -- %', v_clinic_name, r;
end $$;
