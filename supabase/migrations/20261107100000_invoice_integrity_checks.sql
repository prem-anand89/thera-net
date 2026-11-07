-- An invoice must match the visits it bills.
--
-- issue_invoice / amend_invoice trusted the app for everything on the invoice: the total, the line items, the patient
-- snapshot and which visits it covers. The server checked only that the visits belong to the clinic and are free to bill.
-- A buggy or altered client could therefore issue an invoice whose total differs from its visits' bills, that mixes two
-- patients, or that bills nothing (three zero-total invoices already exist in the live data, from ₹0 package sessions).
--
-- Now, after the visits are stamped (so "missing, deleted or already invoiced" still reports first), both functions call
-- check_invoice_matches_visits(), which refuses:
--   * no visits at all;
--   * visits of more than one patient, or a patient snapshot whose ID is not the visits' patient;
--   * a total of zero or less ("Nothing to bill");
--   * a total that differs from the sum of the visits' bills;
--   * line items that do not add up to the total.
-- Any refusal rolls the whole call back, so the gap-free invoice counter is not consumed.
--
-- Existing invoices are not touched. Everything else in both functions is exactly as it was.

create or replace function public.check_invoice_matches_visits(
  p_clinic_id uuid,
  p_visit_ids uuid[],
  p_total_paise bigint,
  p_line_items jsonb,
  p_patient_snapshot jsonb
) returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_visits int;
  v_patients int;
  v_bills bigint;
  v_lines bigint;
  v_mrno text;
begin
  select count(*), count(distinct patient_id), coalesce(sum(actual_bill_paise), 0)
    into v_visits, v_patients, v_bills
    from visits
   where id = any (coalesce(p_visit_ids, '{}')) and clinic_id = p_clinic_id and not deleted;

  if v_visits = 0 then
    raise exception 'No visits on this invoice';
  end if;
  if v_patients <> 1 then
    raise exception 'All visits on one invoice must belong to the same patient';
  end if;

  select p.mrno into v_mrno
    from patients p
   where p.id = (select patient_id from visits where id = p_visit_ids[1]);
  if p_patient_snapshot ->> 'mrno' is distinct from v_mrno then
    raise exception 'The patient on this invoice does not match its visits';
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

-- Called only from the two definer functions below; nobody else needs it.
revoke all on function public.check_invoice_matches_visits(uuid, uuid[], bigint, jsonb, jsonb)
  from public, anon, authenticated;

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

  perform public.check_invoice_matches_visits(
    p_clinic_id, p_visit_ids, p_total_paise, p_line_items, p_patient_snapshot
  );

  return v_invoice;
end $function$;
