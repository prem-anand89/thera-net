-- ---------------------------------------------------------------------------
-- Billing & Notes Rebuild Phase 1, step 1.4: a per-invoice clinical-context
-- snapshot (diagnosis, referring physician, place of service, treatment
-- performed) for TPA/insurance-facing bills, pre-filled at issue time from
-- the patient's most recent completed note but editable and then frozen —
-- invoices stay immutable snapshots (H3), this is never re-read from the
-- note after issuance.
--
-- issue_invoice()/amend_invoice() need a new optional trailing parameter to
-- accept it. Postgres identifies a function by name AND argument types, so
-- `create or replace` with a changed argument list does not replace the
-- existing function — it creates a second, distinct one, leaving the old
-- one live and making every call from an unrefreshed client ambiguous
-- (PostgREST/Postgres can no longer tell which of the two matching
-- functions to call). The correct way to add a parameter to an existing
-- function is an explicit `drop function` of the exact old signature
-- followed by `create function` of the new one, in the same transaction,
-- so exactly one candidate ever exists. Bodies are otherwise byte-for-byte
-- unchanged from their current live definitions (confirmed directly via
-- pg_get_functiondef before writing this migration) except for the new
-- parameter and the new insert column.
-- ---------------------------------------------------------------------------

alter table public.invoices add column clinical_snapshot jsonb;

drop function public.issue_invoice(uuid, text, jsonb, jsonb, bigint, text, uuid, uuid[]);

create function public.issue_invoice(
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

  select invoice_prefix, billing_enabled, invoicing_access
    into v_prefix, v_billing_enabled, v_invoicing_access
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

  insert into invoice_counters (clinic_id, fy_label)
  values (p_clinic_id, p_fy_label)
  on conflict (clinic_id, fy_label) do nothing;

  update invoice_counters
  set next_seq = next_seq + 1
  where clinic_id = p_clinic_id and fy_label = p_fy_label
  returning next_seq - 1 into v_seq;

  insert into invoices (
    clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items,
    total_paise, payment_mode, therapist_id, clinical_snapshot
  ) values (
    p_clinic_id,
    v_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0'),
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

  return v_invoice;
end $function$;

revoke execute on function public.issue_invoice(
  uuid, text, jsonb, jsonb, bigint, text, uuid, uuid[], jsonb
) from anon;

drop function public.amend_invoice(uuid, uuid, text, jsonb, jsonb, bigint, text, uuid, uuid[]);

create function public.amend_invoice(
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
  v_billing_enabled boolean;
  v_invoicing_access text;
  v_caller_role text;
  v_invoice public.invoices;
  v_stamped int;
  v_original_clinic_id uuid;
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

  select invoice_prefix, billing_enabled, invoicing_access
    into v_prefix, v_billing_enabled, v_invoicing_access
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

  insert into invoice_counters (clinic_id, fy_label)
  values (p_clinic_id, p_fy_label)
  on conflict (clinic_id, fy_label) do nothing;

  update invoice_counters
  set next_seq = next_seq + 1
  where clinic_id = p_clinic_id and fy_label = p_fy_label
  returning next_seq - 1 into v_seq;

  insert into invoices (
    clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items,
    total_paise, payment_mode, therapist_id, supersedes_invoice_id, clinical_snapshot
  ) values (
    p_clinic_id,
    v_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0'),
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

  return v_invoice;
end $function$;

-- amend_invoice was never revoked from anon (confirmed via pg_proc.proacl
-- before writing this migration — issue_invoice was hardened in
-- 20260707000001_rls_hardening.sql, amend_invoice shipped later in
-- 20260821000004_invoice_amendments.sql without the same treatment). Not
-- exploitable today (is_clinic_member() fails closed for a null auth.uid()),
-- but closing it now costs nothing while this signature is already being
-- replaced, and leaves both RPCs consistently hardened going forward.
revoke execute on function public.amend_invoice(
  uuid, uuid, text, jsonb, jsonb, bigint, text, uuid, uuid[], jsonb
) from anon;
