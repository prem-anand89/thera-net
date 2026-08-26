-- ---------------------------------------------------------------------------
-- Billing access: two independent settings, not one.
--
-- billing_enabled: does this clinic use the invoice module at all — some
-- bill entirely through a partner hospital's own system, and shouldn't see
-- an invoicing workflow that doesn't apply to them.
--
-- invoicing_access: within a clinic that DOES use it, who may issue
-- invoices — 'everyone' (any clinical member, today's behavior, kept as
-- the default so nothing changes for existing clinics) or 'billing_staff'
-- (admin + front_desk only, for clinics where a receptionist or admin
-- handles all billing and therapists only log visits/notes).
--
-- Considered reusing the existing clinic_module_settings/can_use_module()
-- Tier-1+Tier-2 mechanism (20260718000001_module_registry.sql), which
-- already models exactly this "clinic-wide on/off + which roles" shape,
-- and 'invoicing' is already registered in the modules reference table.
-- Not used here: clinic_module_settings has zero client-side integration
-- today (no Dexie table, no repo, no sync) — standing that up is a real,
-- separate undertaking for the assessment-module gating it was actually
-- built for, not something to bolt this feature onto. clinics is
-- already the most fully-wired synced table in the app, so plain columns
-- here ship the feature without new sync infrastructure.
-- ---------------------------------------------------------------------------
alter table public.clinics add column billing_enabled boolean not null default true;
alter table public.clinics add column invoicing_access text not null default 'everyone'
  check (invoicing_access in ('everyone', 'billing_staff'));

-- ---------------------------------------------------------------------------
-- issue_invoice() enforcement: billing_enabled and invoicing_access read
-- directly off the clinics row already being queried for invoice_prefix —
-- no extra round trip. A caller with no clinic_members row at all (already
-- rejected above by is_clinic_member) never reaches the role check.
-- ---------------------------------------------------------------------------
create or replace function public.issue_invoice(
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
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
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
    total_paise, payment_mode, therapist_id
  ) values (
    p_clinic_id,
    v_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0'),
    p_fy_label, v_seq, p_patient_snapshot, p_line_items,
    p_total_paise, p_payment_mode, p_therapist_id
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
end $$;
