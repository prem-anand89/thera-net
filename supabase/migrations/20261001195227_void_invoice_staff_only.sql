-- ---------------------------------------------------------------------------
-- Voiding an invoice is admin / front desk only.
--
-- void_invoice() first copied issue_invoice()'s rule: with invoicing_access =
-- 'everyone' (the default), any clinic member could void. Voiding is more
-- disruptive than issuing or amending — it can release another person's
-- invoiced visits and cannot be undone — so it is limited to the roles that
-- run billing, whatever invoicing_access says. A therapist can still issue
-- and amend per invoicing_access; a wrong invoice of theirs is voided by
-- front desk or an admin.
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_billing_enabled boolean;
  v_caller_role text;
  v_status text;
  v_row_id uuid;
begin
  select clinic_id into v_clinic_id from invoices where id = p_invoice_id;
  if v_clinic_id is null then
    raise exception 'invoice not found';
  end if;
  if not is_clinic_member(v_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;

  if not coalesce(
    (select entitled from clinic_entitlements
     where clinic_id = v_clinic_id and module_key = 'invoicing'),
    true
  ) then
    raise exception 'clinic is not entitled to invoicing';
  end if;
  select billing_enabled into v_billing_enabled from clinics where id = v_clinic_id;
  if not v_billing_enabled then
    raise exception 'billing is turned off for this clinic';
  end if;

  select role into v_caller_role from clinic_members
    where clinic_id = v_clinic_id and user_id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('admin', 'front_desk') then
    raise exception 'only front desk or an admin can void invoices';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to void an invoice';
  end if;
  if exists (select 1 from invoices where supersedes_invoice_id = p_invoice_id) then
    raise exception 'this invoice was amended; void the latest version instead';
  end if;
  select status into v_status from invoice_payments where invoice_id = p_invoice_id;
  if v_status = 'void' then
    raise exception 'this invoice is already void';
  end if;

  perform set_config('app.allow_invoice_void', 'true', true);
  perform set_config('app.allow_invoice_amendment', 'true', true);

  insert into invoice_payments (clinic_id, invoice_id, status, paid_at, void_reason, voided_at)
  values (v_clinic_id, p_invoice_id, 'void', null, btrim(p_reason), now())
  on conflict (invoice_id) do update
    set status = 'void', paid_at = null,
        void_reason = excluded.void_reason, voided_at = excluded.voided_at
  returning id into v_row_id;

  update visits set invoice_id = null
  where invoice_id = p_invoice_id and clinic_id = v_clinic_id;

  return v_row_id;
end $$;

-- create or replace keeps the grants from the original migration, restated
-- so this file is correct on its own.
revoke execute on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;
