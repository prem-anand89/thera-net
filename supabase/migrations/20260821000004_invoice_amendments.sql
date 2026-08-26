-- ---------------------------------------------------------------------------
-- Invoice amendments: a TPA/insurance payer sometimes asks for a corrected
-- bill-cum-receipt on an already-issued invoice (e.g. missing visit dates
-- added). Invoices are immutable by design (invoices_immutable trigger) and
-- must stay that way for audit/gap-free numbering — so a correction is a
-- brand-new invoice that supersedes the old one, never an edit to it.
--
-- supersedes_invoice_id is a one-directional forward pointer (new -> old)
-- only: the OLD invoice can never be UPDATEd to point at its replacement
-- without violating invoices_immutable, so "X is amended by Y" is always
-- derived by querying `where supersedes_invoice_id = X.id`, never stored
-- on X itself.
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column supersedes_invoice_id uuid references public.invoices(id);

-- ---------------------------------------------------------------------------
-- protect_invoiced_visit() needs one narrow bypass: today it unconditionally
-- blocks re-pointing invoice_id once a visit is invoiced. amend_invoice()
-- (below) sets a transaction-local flag before re-pointing a visit from the
-- original invoice to the new amendment invoice; every other financial-field
-- freeze on an invoiced visit stays fully enforced even during an amendment
-- — an amendment can only add visits or re-point which invoice a
-- previously-invoiced visit belongs to, never edit a visit's billed amount.
-- ---------------------------------------------------------------------------
create or replace function public.protect_invoiced_visit()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then
      raise exception 'visit is on issued invoice %; it cannot be deleted', old.invoice_id;
    end if;
    return old;
  end if;
  if old.invoice_id is not null then
    if new.deleted
      or (
        new.invoice_id is distinct from old.invoice_id
        and coalesce(current_setting('app.allow_invoice_amendment', true), '') <> 'true'
      )
      or new.actual_bill_paise is distinct from old.actual_bill_paise
      or new.catalog_price_paise is distinct from old.catalog_price_paise
      or new.adjustment_paise is distinct from old.adjustment_paise
      or new.service_catalog_id is distinct from old.service_catalog_id
      or new.bm_split_pct is distinct from old.bm_split_pct
      or new.tax_pct is distinct from old.tax_pct
      or new.tds_basis is distinct from old.tds_basis
      or new.bm_share_paise is distinct from old.bm_share_paise
      or new.post_tax_paise is distinct from old.post_tax_paise
      or new.tds_paise is distinct from old.tds_paise
      or new.hv_paise is distinct from old.hv_paise
    then
      raise exception 'visit is on issued invoice %; financial fields are frozen', old.invoice_id;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- amend_invoice(): mirrors issue_invoice()'s membership/entitlement/
-- billing_enabled/invoicing_access checks and gap-free sequential
-- numbering (the amendment gets its own real invoice number, same counter),
-- but additionally stamps supersedes_invoice_id and allows re-pointing
-- visits that are already on the original invoice (in addition to any
-- newly-added, previously-uninvoiced visits).
-- ---------------------------------------------------------------------------
create or replace function public.amend_invoice(
  p_original_invoice_id uuid,
  p_clinic_id uuid,
  p_fy_label text,
  p_patient_snapshot jsonb,
  p_line_items jsonb,
  p_total_paise bigint,
  p_payment_mode text,
  p_therapist_id uuid,
  p_visit_ids uuid[]
) returns public.invoices
language plpgsql security definer set search_path = public as $$
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
    total_paise, payment_mode, therapist_id, supersedes_invoice_id
  ) values (
    p_clinic_id,
    v_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0'),
    p_fy_label, v_seq, p_patient_snapshot, p_line_items,
    p_total_paise, p_payment_mode, p_therapist_id, p_original_invoice_id
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
end $$;
