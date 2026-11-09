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
-- ---------------------------------------------------------------------------
create or replace function public.check_invoice_matches_visits(
  p_clinic_id uuid,
  p_visit_ids uuid[],
  p_line_items jsonb,
  p_total_paise bigint,
  p_patient_snapshot jsonb,
  p_allow_invoice_id uuid
) returns void
language plpgsql
as $$
declare
  v_requested integer := coalesce(cardinality(p_visit_ids), 0);
  v_found integer;
  v_patients integer;
  v_departments integer;
  v_orig_dept text;
  v_patient_id uuid;
  v_patient_mrno text;
  v_snap_patient_id text := nullif(btrim(p_patient_snapshot->>'patientId'), '');
  v_snap_mrno text := nullif(btrim(p_patient_snapshot->>'mrno'), '');
  v_visits_total bigint;
  v_lines_total bigint;
  v_bad_line boolean;
begin
  if v_requested = 0 then
    raise exception 'Select at least one visit to invoice' using errcode = '22023';
  end if;

  if jsonb_typeof(p_line_items) is distinct from 'array' or jsonb_array_length(p_line_items) = 0 then
    raise exception 'Invoice must have at least one line item' using errcode = '22023';
  end if;

  perform 1
    from public.visits v
    where v.clinic_id = p_clinic_id
      and v.id = any(p_visit_ids)
      and not v.deleted
      and (v.invoice_id is null or v.invoice_id = p_allow_invoice_id)
    for update;

  select count(*),
         count(distinct v.patient_id),
         (array_agg(v.patient_id))[1],
         count(distinct coalesce(v.location, 'clinic'))
    into v_found, v_patients, v_patient_id, v_departments
    from public.visits v
    where v.clinic_id = p_clinic_id
      and v.id = any(p_visit_ids)
      and not v.deleted
      and (v.invoice_id is null or v.invoice_id = p_allow_invoice_id);

  if v_found < v_requested then
    raise exception 'One or more visits are missing, deleted, or already on another invoice'
      using errcode = '22023';
  end if;

  if v_patients > 1 then
    raise exception 'All visits on an invoice must belong to the same patient'
      using errcode = '22023';
  end if;

  if v_departments > 1 then
    raise exception 'Cannot combine visits from different departments on one invoice'
      using errcode = '22023';
  end if;

  if p_allow_invoice_id is not null then
    select coalesce(v.location, 'clinic')
      into v_orig_dept
      from public.visits v
      where v.clinic_id = p_clinic_id
        and v.invoice_id = p_allow_invoice_id
        and not v.deleted
      limit 1;

    if v_orig_dept is not null then
      perform 1
        from public.visits v
        where v.clinic_id = p_clinic_id
          and v.id = any(p_visit_ids)
          and not v.deleted
          and coalesce(v.location, 'clinic') <> v_orig_dept;
      if found then
        raise exception 'Cannot combine visits from different departments on one invoice'
          using errcode = '22023';
      end if;
    end if;
  end if;

  if v_snap_patient_id is not null then
    if v_patient_id::text is distinct from v_snap_patient_id then
      raise exception 'Invoice patient details do not match the billed visits'
        using errcode = '22023';
    end if;
  else
    select p.mrno into v_patient_mrno
      from public.patients p
      where p.id = v_patient_id and p.clinic_id = p_clinic_id;

    if v_snap_mrno is null or v_patient_mrno is distinct from v_snap_mrno then
      raise exception 'Invoice patient details do not match the billed visits'
        using errcode = '22023';
    end if;
  end if;

  select coalesce(sum(v.actual_bill_paise), 0)
    into v_visits_total
    from public.visits v
    where v.clinic_id = p_clinic_id
      and v.id = any(p_visit_ids)
      and not v.deleted;

  if p_total_paise is distinct from v_visits_total then
    raise exception 'Invoice total (%) does not match the sum of the billed visits (%)',
      p_total_paise, v_visits_total
      using errcode = '22023';
  end if;

  select bool_or(
           (li->>'totalPaise') is null
           or (li->>'totalPaise') !~ '^-?[0-9]+$'
           or (li->>'totalPaise')::bigint < 0
         ),
         coalesce(sum(case when (li->>'totalPaise') ~ '^-?[0-9]+$' then (li->>'totalPaise')::bigint else 0 end), 0)
    into v_bad_line, v_lines_total
    from jsonb_array_elements(p_line_items) li;

  if coalesce(v_bad_line, false) then
    raise exception 'Each invoice line item must have a non-negative integer totalPaise'
      using errcode = '22023';
  end if;

  if v_lines_total is distinct from p_total_paise then
    raise exception 'Invoice line items (%) do not add up to the invoice total (%)',
      v_lines_total, p_total_paise
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.check_invoice_matches_visits(uuid, uuid[], jsonb, bigint, jsonb, uuid)
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
) returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_ip_prefix text;
  v_eff_prefix text;
  v_series text;
  v_billing_enabled boolean;
  v_invoicing_access text;
  v_seq integer;
  v_invoice_no text;
  v_invoice invoices;
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'Not a member of this clinic' using errcode = '42501';
  end if;

  if not clinic_has_feature(p_clinic_id, 'invoicing') then
    raise exception 'Invoicing is not included in this clinic''s current plan'
      using errcode = '42501';
  end if;

  if not can_use_module(p_clinic_id, 'invoicing') then
    raise exception 'The invoicing module is not enabled for this clinic'
      using errcode = '42501';
  end if;

  if p_clinical_snapshot is not null and jsonb_typeof(p_clinical_snapshot) <> 'object' then
    raise exception 'clinical_snapshot must be a JSON object or null'
      using errcode = '22023';
  end if;

  select invoice_prefix, ip_invoice_prefix, billing_enabled, invoicing_access
    into v_prefix, v_ip_prefix, v_billing_enabled, v_invoicing_access
    from clinics where id = p_clinic_id;

  if not coalesce(v_billing_enabled, true) then
    raise exception 'Billing is turned off for this clinic'
      using errcode = '42501';
  end if;

  if v_invoicing_access = 'billing_staff'
     and not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Only billing staff can issue invoices for this clinic'
      using errcode = '42501';
  end if;

  perform public.check_invoice_matches_visits(
    p_clinic_id, p_visit_ids, p_line_items, p_total_paise, p_patient_snapshot, null
  );

  select case when coalesce(v.location, 'clinic') = 'ward' then 'ip' else 'main' end
    into v_series
    from public.visits v
    where v.clinic_id = p_clinic_id
      and v.id = any(p_visit_ids)
      and not v.deleted
    limit 1;
  v_series := coalesce(v_series, 'main');

  v_eff_prefix := case
    when v_series = 'ip' then coalesce(nullif(btrim(v_ip_prefix), ''), v_prefix || 'IP')
    else v_prefix
  end;

  insert into invoice_counters (clinic_id, fy_label, series)
  values (p_clinic_id, p_fy_label, v_series)
  on conflict (clinic_id, fy_label, series) do nothing;

  update invoice_counters
     set next_seq = next_seq + 1
   where clinic_id = p_clinic_id and fy_label = p_fy_label and series = v_series
  returning next_seq - 1 into v_seq;

  v_invoice_no := v_eff_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0');

  insert into invoices (
    clinic_id, invoice_no, fy_label, seq,
    patient_snapshot, line_items, total_paise, payment_mode, therapist_id,
    clinical_snapshot
  ) values (
    p_clinic_id, v_invoice_no, p_fy_label, v_seq,
    p_patient_snapshot, p_line_items, p_total_paise, p_payment_mode, p_therapist_id,
    p_clinical_snapshot
  ) returning * into v_invoice;

  update visits
     set invoice_id = v_invoice.id,
         updated_at = now()
   where clinic_id = p_clinic_id
     and id = any(p_visit_ids)
     and invoice_id is null;

  perform record_audit_event(
    p_clinic_id,
    'invoice.issued',
    'invoice',
    v_invoice.id::text,
    jsonb_build_object(
      'invoice_no', v_invoice.invoice_no,
      'series', v_series,
      'total_paise', v_invoice.total_paise,
      'visit_ids', to_jsonb(p_visit_ids)
    )
  );

  return v_invoice;
end;
$$;

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
) returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_ip_prefix text;
  v_eff_prefix text;
  v_series text;
  v_billing_enabled boolean;
  v_invoicing_access text;
  v_seq integer;
  v_invoice_no text;
  v_invoice invoices;
  v_orig invoices;
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'Not a member of this clinic' using errcode = '42501';
  end if;

  if not clinic_has_feature(p_clinic_id, 'invoicing') then
    raise exception 'Invoicing is not included in this clinic''s current plan'
      using errcode = '42501';
  end if;

  if not can_use_module(p_clinic_id, 'invoicing') then
    raise exception 'The invoicing module is not enabled for this clinic'
      using errcode = '42501';
  end if;

  if p_clinical_snapshot is not null and jsonb_typeof(p_clinical_snapshot) <> 'object' then
    raise exception 'clinical_snapshot must be a JSON object or null'
      using errcode = '22023';
  end if;

  select * into v_orig
    from invoices
   where id = p_original_invoice_id
     and clinic_id = p_clinic_id
     for update;

  if not found then
    raise exception 'Original invoice not found in this clinic'
      using errcode = 'P0002';
  end if;

  if exists (select 1 from invoices where supersedes_invoice_id = p_original_invoice_id) then
    raise exception 'This invoice has already been amended — amend the latest version instead'
      using errcode = '23505';
  end if;

  select invoice_prefix, ip_invoice_prefix, billing_enabled, invoicing_access
    into v_prefix, v_ip_prefix, v_billing_enabled, v_invoicing_access
    from clinics where id = p_clinic_id;

  if not coalesce(v_billing_enabled, true) then
    raise exception 'Billing is turned off for this clinic'
      using errcode = '42501';
  end if;

  if v_invoicing_access = 'billing_staff'
     and not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Only billing staff can issue invoices for this clinic'
      using errcode = '42501';
  end if;

  perform public.check_invoice_matches_visits(
    p_clinic_id, p_visit_ids, p_line_items, p_total_paise, p_patient_snapshot, p_original_invoice_id
  );

  select case when coalesce(v.location, 'clinic') = 'ward' then 'ip' else 'main' end
    into v_series
    from public.visits v
    where v.clinic_id = p_clinic_id
      and v.id = any(p_visit_ids)
      and not v.deleted
    limit 1;
  v_series := coalesce(v_series, 'main');

  v_eff_prefix := case
    when v_series = 'ip' then coalesce(nullif(btrim(v_ip_prefix), ''), v_prefix || 'IP')
    else v_prefix
  end;

  insert into invoice_counters (clinic_id, fy_label, series)
  values (p_clinic_id, p_fy_label, v_series)
  on conflict (clinic_id, fy_label, series) do nothing;

  update invoice_counters
     set next_seq = next_seq + 1
   where clinic_id = p_clinic_id and fy_label = p_fy_label and series = v_series
  returning next_seq - 1 into v_seq;

  v_invoice_no := v_eff_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0');

  insert into invoices (
    clinic_id, invoice_no, fy_label, seq,
    patient_snapshot, line_items, total_paise, payment_mode, therapist_id,
    supersedes_invoice_id,
    clinical_snapshot
  ) values (
    p_clinic_id, v_invoice_no, p_fy_label, v_seq,
    p_patient_snapshot, p_line_items, p_total_paise, p_payment_mode, p_therapist_id,
    p_original_invoice_id,
    coalesce(p_clinical_snapshot, v_orig.clinical_snapshot)
  ) returning * into v_invoice;

  update visits
     set invoice_id = v_invoice.id,
         updated_at = now()
   where clinic_id = p_clinic_id
     and id = any(p_visit_ids)
     and (invoice_id is null or invoice_id = p_original_invoice_id);

  perform record_audit_event(
    p_clinic_id,
    'invoice.amended',
    'invoice',
    v_invoice.id::text,
    jsonb_build_object(
      'invoice_no', v_invoice.invoice_no,
      'series', v_series,
      'supersedes_invoice_id', p_original_invoice_id,
      'supersedes_invoice_no', v_orig.invoice_no,
      'total_paise', v_invoice.total_paise,
      'visit_ids', to_jsonb(p_visit_ids)
    )
  );

  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Advances per department (`patient_advances.department` & `enforce_advance_balance`)
-- ---------------------------------------------------------------------------
alter table public.patient_advances
  add column if not exists department text not null default 'clinic'
  check (department in ('clinic', 'home', 'ward'));

create or replace function public.enforce_advance_balance()
returns trigger
language plpgsql
as $$
declare
  v_amount bigint;
  v_status text;
  v_deleted boolean;
  v_adv_dept text;
  v_visit_dept text;
  v_drawn bigint;
begin
  if new.advance_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.advance_id is not distinct from old.advance_id
     and new.visit_id is not distinct from old.visit_id
     and new.amount_paise <= old.amount_paise then
    return new;
  end if;

  select amount_paise, status, deleted, department
    into v_amount, v_status, v_deleted, v_adv_dept
    from public.patient_advances
   where id = new.advance_id
     for update;

  if v_deleted or v_status in ('refunded', 'void') then
    raise exception 'Advance is no longer open'
      using errcode = '23514';
  end if;

  select coalesce(location, 'clinic')
    into v_visit_dept
    from public.visits
   where id = new.visit_id;

  if v_visit_dept is not null and v_adv_dept <> v_visit_dept then
    raise exception 'Advance belongs to a different department than this visit'
      using errcode = '22023';
  end if;

  select coalesce(sum(amount_paise), 0)
    into v_drawn
    from public.payments
   where advance_id = new.advance_id
     and id is distinct from new.id;

  if v_drawn + new.amount_paise > v_amount then
    raise exception 'Amount exceeds advance remaining balance (% available, % requested)',
      v_amount - v_drawn, new.amount_paise
      using errcode = '23514';
  end if;

  return new;
end;
$$;

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

