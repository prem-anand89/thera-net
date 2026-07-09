-- ---------------------------------------------------------------------------
-- Patient lifecycle: soft delete (hide) + hard delete (zero-visit only).
-- Hide is the default remediation because the client sync engine only
-- propagates updates — a soft delete reaches every device's local cache,
-- a hard delete would not. Hard delete is therefore an online-only RPC
-- reserved for rows that never accrued history.
-- ---------------------------------------------------------------------------
alter table public.patients add column deleted_at timestamptz;

create or replace function public.hard_delete_patient(p_patient_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
  v_visits int;
begin
  select clinic_id into v_clinic from patients where id = p_patient_id;
  if v_clinic is null then
    raise exception 'patient not found';
  end if;
  if not is_clinic_member(v_clinic) then
    raise exception 'not a member of this clinic';
  end if;
  select count(*) into v_visits from visits where patient_id = p_patient_id;
  if v_visits > 0 then
    raise exception 'patient has % visit(s); hide the patient instead of deleting', v_visits;
  end if;
  delete from patients where id = p_patient_id;
end $$;

revoke execute on function public.hard_delete_patient(uuid) from anon;

-- ---------------------------------------------------------------------------
-- One-shot admin wipe for test-data cleanup. Deletes all patient/visit/
-- invoice/payment/settlement rows for a clinic and resets the invoice
-- counter, leaving the clinic, therapists, catalog, and memberships intact.
-- The immutability triggers exist to protect real financial history from
-- edits; a deliberate, admin-gated wipe is the sanctioned bypass, so the
-- function disables them for the duration of the transaction.
-- ---------------------------------------------------------------------------
create or replace function public.admin_wipe_clinic_data(p_clinic_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  p_count int;
  v_count int;
  i_count int;
begin
  if not is_clinic_admin(p_clinic_id) then
    raise exception 'only clinic admins can wipe clinic data';
  end if;

  select count(*) into i_count from invoices where clinic_id = p_clinic_id;
  select count(*) into v_count from visits where clinic_id = p_clinic_id;
  select count(*) into p_count from patients where clinic_id = p_clinic_id;

  alter table invoices disable trigger invoices_immutable;
  alter table visits disable trigger visits_protect_invoiced;

  delete from invoice_payments where clinic_id = p_clinic_id;
  delete from visits where clinic_id = p_clinic_id;
  delete from invoices where clinic_id = p_clinic_id;
  delete from patients where clinic_id = p_clinic_id;
  delete from settlements where clinic_id = p_clinic_id;
  delete from invoice_counters where clinic_id = p_clinic_id;

  alter table visits enable trigger visits_protect_invoiced;
  alter table invoices enable trigger invoices_immutable;

  return json_build_object('patients', p_count, 'visits', v_count, 'invoices', i_count);
end $$;

revoke execute on function public.admin_wipe_clinic_data(uuid) from anon;
