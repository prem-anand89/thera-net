-- ---------------------------------------------------------------------------
-- Void an issued invoice.
--
-- Invoices are immutable and numbered without gaps, and an amendment can
-- only add visits or re-point them — it can never change a billed amount. So
-- a wrong price or patient on an issued invoice had no fix. A void keeps the
-- invoice (and its number) in the series, marked void, and releases its
-- visits so they can be corrected and billed again with a new invoice.
--
-- Status lives where payment status already lives — invoice_payments — as a
-- third value, so no new synced table and no UPDATE on invoices. Because a
-- client can write invoice_payments directly, a trigger makes 'void'
-- reachable only through void_invoice() (which also releases the visits), and
-- makes it final.
-- Payments already recorded against the visits stay with the visits.
-- ---------------------------------------------------------------------------
alter table public.invoice_payments drop constraint if exists invoice_payments_status_check;
alter table public.invoice_payments
  add constraint invoice_payments_status_check check (status in ('paid', 'outstanding', 'void'));
alter table public.invoice_payments add column if not exists void_reason text;
alter table public.invoice_payments add column if not exists voided_at timestamptz;

create or replace function public.guard_invoice_void()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.allow_invoice_void', true), '') = 'true' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'void' then
      raise exception 'invoices are voided with void_invoice()';
    end if;
    return new;
  end if;
  if old.status = 'void' then
    raise exception 'this invoice is void; its status can no longer change';
  end if;
  if new.status = 'void' then
    raise exception 'invoices are voided with void_invoice()';
  end if;
  return new;
end $$;

drop trigger if exists invoice_payments_guard_void on public.invoice_payments;
create trigger invoice_payments_guard_void before insert or update on public.invoice_payments
  for each row execute function public.guard_invoice_void();

-- Returns the invoice_payments row id so the client mirrors the same row.
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_billing_enabled boolean;
  v_invoicing_access text;
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

  -- Same gates as issue_invoice() / amend_invoice().
  if not coalesce(
    (select entitled from clinic_entitlements
     where clinic_id = v_clinic_id and module_key = 'invoicing'),
    true
  ) then
    raise exception 'clinic is not entitled to invoicing';
  end if;
  select billing_enabled, invoicing_access
    into v_billing_enabled, v_invoicing_access
    from clinics where id = v_clinic_id;
  if not v_billing_enabled then
    raise exception 'billing is turned off for this clinic';
  end if;
  if v_invoicing_access = 'billing_staff' then
    select role into v_caller_role from clinic_members
      where clinic_id = v_clinic_id and user_id = auth.uid();
    if v_caller_role not in ('admin', 'front_desk') then
      raise exception 'only front desk or an admin can void invoices at this clinic';
    end if;
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
  -- Releasing the visits is the same narrow bypass amend_invoice() uses.
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

revoke execute on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;
