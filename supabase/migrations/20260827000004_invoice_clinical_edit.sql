-- ---------------------------------------------------------------------------
-- Lets the clinical-context snapshot (diagnosis, referring physician, place
-- of service, treatment performed — see 20260827000002) be corrected AFTER
-- an invoice is issued, without reopening the financial record. The amount,
-- line items, invoice number, payment mode, etc. stay genuinely immutable —
-- a TPA correction to those still goes through amend_invoice (new invoice
-- number, supersedes the old one). Clinical details are metadata riding
-- along on the bill, not the bill itself, so an in-place edit with a proper
-- audit trail is a better fit here than minting a whole new invoice number
-- over a typo in a diagnosis field.
--
-- reject_invoice_mutation() (20260702000001_init.sql) unconditionally
-- rejected every update — this narrows that to: allow an update IFF (a) it
-- was issued through update_invoice_clinical_details() below (signaled via
-- the same session-local set_config bypass amend_invoice's visit-unlock
-- already uses) AND (b) no column outside clinical_snapshot actually
-- changed. Belt-and-suspenders: even a bug in the new RPC that also touched,
-- say, total_paise, would still be rejected here.
-- ---------------------------------------------------------------------------
create or replace function public.reject_invoice_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('app.allow_invoice_clinical_edit', true) = 'true' then
    if new.id is distinct from old.id
      or new.clinic_id is distinct from old.clinic_id
      or new.invoice_no is distinct from old.invoice_no
      or new.fy_label is distinct from old.fy_label
      or new.seq is distinct from old.seq
      or new.issued_at is distinct from old.issued_at
      or new.patient_snapshot is distinct from old.patient_snapshot
      or new.line_items is distinct from old.line_items
      or new.total_paise is distinct from old.total_paise
      or new.payment_mode is distinct from old.payment_mode
      or new.therapist_id is distinct from old.therapist_id
      or new.supersedes_invoice_id is distinct from old.supersedes_invoice_id
      or new.created_by is distinct from old.created_by
    then
      raise exception 'only an invoice''s clinical details can be edited after issuance';
    end if;
    return new;
  end if;
  raise exception 'issued invoices are immutable; corrections require an amendment record';
end $$;

-- Same permission model as issue_invoice/amend_invoice: any clinic member
-- may edit when invoicing_access is 'all_staff' (the clinic-level default),
-- admin/front_desk only when it's 'billing_staff'.
create function public.update_invoice_clinical_details(
  p_invoice_id uuid,
  p_clinic_id uuid,
  p_clinical_snapshot jsonb
)
 returns invoices
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_invoicing_access text;
  v_caller_role text;
  v_invoice public.invoices;
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;

  select invoicing_access into v_invoicing_access from clinics where id = p_clinic_id;

  if v_invoicing_access = 'billing_staff' then
    select role into v_caller_role from clinic_members
      where clinic_id = p_clinic_id and user_id = auth.uid();
    if v_caller_role not in ('admin', 'front_desk') then
      raise exception 'only front desk or an admin can edit invoice details at this clinic';
    end if;
  end if;

  perform set_config('app.allow_invoice_clinical_edit', 'true', true);
  update invoices
  set clinical_snapshot = p_clinical_snapshot
  where id = p_invoice_id and clinic_id = p_clinic_id
  returning * into v_invoice;

  if v_invoice.id is null then
    raise exception 'invoice not found for this clinic';
  end if;

  return v_invoice;
end $function$;

revoke execute on function public.update_invoice_clinical_details(uuid, uuid, jsonb) from anon;

-- Invoices was deliberately excluded from the generic audit_log trigger set
-- in 20260721000001 because it was, at the time, fully immutable end to end
-- (the note there: "a before/after log would only ever show old_data =
-- new_data on the fields that can change"). That's no longer true — attach
-- it now so every clinical-details edit gets a genuine before/after row,
-- same as every other editable table.
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function public.audit_row_change();
