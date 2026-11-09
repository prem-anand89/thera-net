-- Step 3: Separate the money across departments (OP, Home care, IP).
-- 1. No bill mixes departments (`check_invoice_matches_visits`).
-- 2. IP bill series (`clinics.ip_invoice_prefix`, `invoice_counters.series`, `issue_invoice`, `amend_invoice`).
-- 3. Advances per department (`patient_advances.department`, `enforce_advance_balance`).
-- 4. Services per department (`service_catalog.departments`).

-- ---------------------------------------------------------------------------
-- 1. IP invoice prefix & per-series invoice counters
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column if not exists ip_invoice_prefix text;

alter table public.clinics
  drop constraint if exists clinics_ip_invoice_prefix_check;

alter table public.clinics
  add constraint clinics_ip_invoice_prefix_check
  check (
    ip_invoice_prefix is null
    or (
      btrim(ip_invoice_prefix) <> ''
      and upper(btrim(ip_invoice_prefix)) <> upper(btrim(invoice_prefix))
    )
  );

alter table public.invoice_counters
  add column if not exists series text not null default 'main'
  check (series in ('main', 'ip'));

alter table public.invoice_counters
  drop constraint if exists invoice_counters_pkey;

alter table public.invoice_counters
  add primary key (clinic_id, fy_label, series);

-- Both `main` and `ip` series start at seq = 1 within the same (clinic_id, fy_label);
-- `unique (clinic_id, invoice_no)` remains and guarantees each formatted bill number is unique.
alter table public.invoices
  drop constraint if exists invoices_clinic_id_fy_label_seq_key;

-- ---------------------------------------------------------------------------
-- 2. Invoice integrity & series selection (`check_invoice_matches_visits`, `issue_invoice`, `amend_invoice`)
--    Based directly on 20261107120000_invoice_patient_check_by_id.sql and
--    20261107100000_invoice_integrity_checks.sql.
-- ---------------------------------------------------------------------------
drop function if exists public.check_invoice_matches_visits(uuid, uuid[], jsonb, bigint, jsonb, uuid);
drop function if exists public.check_invoice_matches_visits(uuid, uuid[], bigint, jsonb, jsonb, uuid);
drop function if exists public.check_invoice_matches_visits(uuid, uuid[], bigint, jsonb, jsonb, uuid, text);

create function public.check_invoice_matches_visits(
  p_clinic_id uuid,
  p_visit_ids uuid[],
  p_total_paise bigint,
  p_line_items jsonb,
  p_patient_snapshot jsonb,
  p_original_patient_id uuid default null,
  p_original_dept text default null
) returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_visits int;
  v_patients int;
  v_depts int;
  v_patient uuid;
  v_dept text;
  v_bills bigint;
  v_lines bigint;
begin
  select
    count(*),
    count(distinct patient_id),
    count(distinct case
      when admission_id is not null or location = 'ward' then 'ward'
      when location = 'home' then 'home'
      else 'clinic'
    end),
    (array_agg(patient_id))[1],
    (array_agg(case
      when admission_id is not null or location = 'ward' then 'ward'
      when location = 'home' then 'home'
      else 'clinic'
    end))[1],
    coalesce(sum(actual_bill_paise), 0)
    into v_visits, v_patients, v_depts, v_patient, v_dept, v_bills
    from visits
   where id = any (coalesce(p_visit_ids, '{}')) and clinic_id = p_clinic_id and not deleted;

  if v_visits = 0 then
    raise exception 'No visits on this invoice';
  end if;
  if v_patients <> 1 then
    raise exception 'All visits on one invoice must belong to the same patient';
  end if;
  if v_depts <> 1 then
    raise exception 'All visits on one invoice must belong to the same department';
  end if;
  if p_original_dept is not null and p_original_dept <> v_dept then
    raise exception 'All visits on one invoice must belong to the same department';
  end if;

  if p_original_patient_id is not null and p_original_patient_id <> v_patient then
    raise exception 'The patient on this invoice does not match its visits';
  end if;
  if p_patient_snapshot ? 'patientId' then
    if p_patient_snapshot ->> 'patientId' is distinct from v_patient::text then
      raise exception 'The patient on this invoice does not match its visits';
    end if;
  elsif p_original_patient_id is null then
    if p_patient_snapshot ->> 'mrno' is distinct from (select p.mrno from patients p where p.id = v_patient) then
      raise exception 'The patient on this invoice does not match its visits';
    end if;
  end if;

  if p_total_paise <= 0 then
    raise exception 'Nothing to bill: these visits have no charge';
  end if;
  if p_total_paise <> v_bills then
    raise exception 'The invoice total does not match the visits'' bills';
  end if;

  select coalesce(sum((l ->> 'totalPaise')::bigint), 0) into v_lines
    from jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb)) l;
  if v_lines <> p_total_paise then
    raise exception 'The invoice lines do not add up to its total';
  end if;
end $$;

revoke all on function public.check_invoice_matches_visits(uuid, uuid[], bigint, jsonb, jsonb, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.issue_invoice(
  p_clinic_id uuid,
  p_fy_label text,
  p_patient_snapshot jsonb,
  p_line_items jsonb,
  p_total_paise bigint,
  p_payment_mode text,
  p_therapist_id uuid,
  p_visit_ids uuid[],
  p_clinical_snapshot jsonb default null
)
 returns invoices
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_seq int;
  v_prefix text;
  v_ip_prefix text;
  v_effective_prefix text;
  v_series text;
  v_is_ip boolean;
  v_billing_enabled boolean;
  v_invoicing_access text;
  v_caller_role text;
  v_plan_tier text;
  v_plan_status text;
  v_invoice public.invoices;
  v_stamped int;
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;

  if tier_enforcement_enabled() then
    select plan_tier, status into v_plan_tier, v_plan_status
      from clinic_plans where clinic_id = p_clinic_id;

    if v_plan_status is not null and v_plan_status <> 'active' then
      raise exception 'this clinic''s plan is read-only -- invoicing is unavailable until payment resumes';
    end if;

    if v_plan_tier = 'lite' then
      raise exception 'invoicing is not included in the Lite plan -- upgrade to Solo or above';
    end if;
  end if;

  if not coalesce(
    (select entitled from clinic_entitlements
     where clinic_id = p_clinic_id and module_key = 'invoicing'),
    true
  ) then
    raise exception 'clinic is not entitled to invoicing';
  end if;

  select invoice_prefix, ip_invoice_prefix, billing_enabled, invoicing_access
    into v_prefix, v_ip_prefix, v_billing_enabled, v_invoicing_access
    from clinics where id = p_clinic_id;

  if not v_billing_enabled then
    raise exception 'billing is turned off for this clinic';
  end if;

  if v_invoicing_access = 'billing_staff' then
    select role into v_caller_role from clinic_members
      where clinic_id = p_clinic_id and user_id = auth.uid();
    if v_caller_role not in ('admin', 'front_desk') then
      raise exception 'only front desk or an admin can issue invoices at this clinic';
    end if;
  end if;

  select exists (
    select 1
      from visits
     where id = any (coalesce(p_visit_ids, '{}'))
       and clinic_id = p_clinic_id
       and not deleted
       and (admission_id is not null or location = 'ward')
  ) into v_is_ip;

  if v_is_ip then
    v_series := 'ip';
    v_effective_prefix := coalesce(nullif(btrim(v_ip_prefix), ''), v_prefix || 'IP');
  else
    v_series := 'main';
    v_effective_prefix := v_prefix;
  end if;

  insert into invoice_counters (clinic_id, fy_label, series)
  values (p_clinic_id, p_fy_label, v_series)
  on conflict (clinic_id, fy_label, series) do nothing;

  update invoice_counters
  set next_seq = next_seq + 1
  where clinic_id = p_clinic_id and fy_label = p_fy_label and series = v_series
  returning next_seq - 1 into v_seq;

  insert into invoices (
    clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items,
    total_paise, payment_mode, therapist_id, clinical_snapshot
  ) values (
    p_clinic_id,
    v_effective_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0'),
    p_fy_label, v_seq, p_patient_snapshot, p_line_items,
    p_total_paise, p_payment_mode, p_therapist_id, p_clinical_snapshot
  ) returning * into v_invoice;

  update visits
  set invoice_id = v_invoice.id
  where id = any (p_visit_ids)
    and clinic_id = p_clinic_id
    and invoice_id is null
    and not deleted;
  get diagnostics v_stamped = row_count;
  if v_stamped <> coalesce(array_length(p_visit_ids, 1), 0) then
    raise exception 'one or more visits are missing, deleted, or already invoiced';
  end if;

  perform public.check_invoice_matches_visits(
    p_clinic_id, p_visit_ids, p_total_paise, p_line_items, p_patient_snapshot
  );

  return v_invoice;
end $function$;

create or replace function public.amend_invoice(
  p_original_invoice_id uuid,
  p_clinic_id uuid,
  p_fy_label text,
  p_patient_snapshot jsonb,
  p_line_items jsonb,
  p_total_paise bigint,
  p_payment_mode text,
  p_therapist_id uuid,
  p_visit_ids uuid[],
  p_clinical_snapshot jsonb default null
)
 returns invoices
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_seq int;
  v_prefix text;
  v_ip_prefix text;
  v_effective_prefix text;
  v_series text;
  v_billing_enabled boolean;
  v_invoicing_access text;
  v_caller_role text;
  v_invoice public.invoices;
  v_stamped int;
  v_original_clinic_id uuid;
  v_original_patient uuid;
  v_original_dept text;
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;

  select clinic_id into v_original_clinic_id from invoices where id = p_original_invoice_id;
  if v_original_clinic_id is null or v_original_clinic_id <> p_clinic_id then
    raise exception 'original invoice not found for this clinic';
  end if;

  if not coalesce(
    (select entitled from clinic_entitlements
     where clinic_id = p_clinic_id and module_key = 'invoicing'),
    true
  ) then
    raise exception 'clinic is not entitled to invoicing';
  end if;

  select invoice_prefix, ip_invoice_prefix, billing_enabled, invoicing_access
    into v_prefix, v_ip_prefix, v_billing_enabled, v_invoicing_access
    from clinics where id = p_clinic_id;

  if not v_billing_enabled then
    raise exception 'billing is turned off for this clinic';
  end if;

  if v_invoicing_access = 'billing_staff' then
    select role into v_caller_role from clinic_members
      where clinic_id = p_clinic_id and user_id = auth.uid();
    if v_caller_role not in ('admin', 'front_desk') then
      raise exception 'only front desk or an admin can issue invoices at this clinic';
    end if;
  end if;

  -- Read before the visits are re-pointed: who the bill being amended was for and which department it belongs to.
  select
    patient_id,
    case
      when admission_id is not null or location = 'ward' then 'ward'
      when location = 'home' then 'home'
      else 'clinic'
    end
    into v_original_patient, v_original_dept
    from visits
   where invoice_id = p_original_invoice_id and clinic_id = p_clinic_id and not deleted
   limit 1;

  if v_original_dept is null then
    select
      case
        when clinical_snapshot ->> 'placeOfService' in ('ward', 'home') then clinical_snapshot ->> 'placeOfService'
        else 'clinic'
      end
      into v_original_dept
      from invoices
     where id = p_original_invoice_id and clinic_id = p_clinic_id;
  end if;

  if v_original_dept = 'ward' then
    v_series := 'ip';
    v_effective_prefix := coalesce(nullif(btrim(v_ip_prefix), ''), v_prefix || 'IP');
  else
    v_series := 'main';
    v_effective_prefix := v_prefix;
  end if;

  insert into invoice_counters (clinic_id, fy_label, series)
  values (p_clinic_id, p_fy_label, v_series)
  on conflict (clinic_id, fy_label, series) do nothing;

  update invoice_counters
  set next_seq = next_seq + 1
  where clinic_id = p_clinic_id and fy_label = p_fy_label and series = v_series
  returning next_seq - 1 into v_seq;

  insert into invoices (
    clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items,
    total_paise, payment_mode, therapist_id, supersedes_invoice_id, clinical_snapshot
  ) values (
    p_clinic_id,
    v_effective_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0'),
    p_fy_label, v_seq, p_patient_snapshot, p_line_items,
    p_total_paise, p_payment_mode, p_therapist_id, p_original_invoice_id, p_clinical_snapshot
  ) returning * into v_invoice;

  perform set_config('app.allow_invoice_amendment', 'true', true);
  update visits
  set invoice_id = v_invoice.id
  where id = any (p_visit_ids)
    and clinic_id = p_clinic_id
    and (invoice_id is null or invoice_id = p_original_invoice_id)
    and not deleted;
  get diagnostics v_stamped = row_count;
  if v_stamped <> coalesce(array_length(p_visit_ids, 1), 0) then
    raise exception 'one or more visits are missing, deleted, or invoiced elsewhere';
  end if;

  perform public.check_invoice_matches_visits(
    p_clinic_id, p_visit_ids, p_total_paise, p_line_items, p_patient_snapshot, v_original_patient, v_original_dept
  );

  return v_invoice;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Advances per department (`patient_advances.department` & `enforce_advance_balance`)
--    Based directly on 20261005170000_package_and_advance_race_guards.sql.
-- ---------------------------------------------------------------------------
alter table public.patient_advances
  add column if not exists department text not null default 'clinic'
  check (department in ('clinic', 'home', 'ward'));

create or replace function public.enforce_advance_balance()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_advance_amount bigint;
  v_advance_dept text;
  v_visit_dept text;
  v_drawn_down bigint;
begin
  if new.advance_id is not null then
    select amount_paise, coalesce(department, 'clinic')
      into v_advance_amount, v_advance_dept
      from patient_advances where id = new.advance_id;
    if v_advance_amount is null then
      raise exception 'Advance not found for this payment.';
    end if;

    if new.visit_id is not null then
      select
        case
          when admission_id is not null or location = 'ward' then 'ward'
          when location = 'home' then 'home'
          else 'clinic'
        end
        into v_visit_dept
        from visits where id = new.visit_id;
      if v_visit_dept is not null and v_visit_dept <> v_advance_dept then
        raise exception 'Advance belongs to a different department (%) than this visit (%).',
          v_advance_dept, v_visit_dept;
      end if;
    end if;

    select coalesce(sum(amount_paise), 0) into v_drawn_down
      from payments
      where advance_id = new.advance_id and id <> new.id;

    if v_drawn_down + new.amount_paise > v_advance_amount then
      raise exception 'This payment (paise: %) would draw down more than the advance''s remaining balance (paise: % of % already used).',
        new.amount_paise, v_drawn_down, v_advance_amount;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payments_enforce_advance_balance on public.payments;
create trigger payments_enforce_advance_balance
  before insert or update of amount_paise, advance_id, visit_id on public.payments
  for each row execute function public.enforce_advance_balance();

-- ---------------------------------------------------------------------------
-- 4. Services per department (`service_catalog.departments`)
-- ---------------------------------------------------------------------------
alter table public.service_catalog
  add column if not exists departments text[]
  check (
    departments is null
    or (
      cardinality(departments) > 0
      and departments <@ array['clinic', 'home', 'ward']::text[]
    )
  );
