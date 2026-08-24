-- ---------------------------------------------------------------------------
-- Phase 4 of the tier-subscriptions plan: a global pilot kill switch.
--
-- Pilot clinics need to run with zero tier limits until payments are
-- integrated, and the whole system needs to be trivial to switch back on
-- once they are -- without hand-editing every clinic's clinic_plans row
-- (that's the wrong tool: per-clinic override, not a global pause).
--
-- platform_config is a singleton-row table (the `id boolean ... check (id)`
-- trick forces exactly one row, always keyed true). RLS: select for any
-- authenticated user (it's a boolean, not sensitive, and every clinic needs
-- to read it), no write policy at all -- same service-role-only pattern as
-- clinic_plans. tier_enforcement_enabled() wraps the read with
-- coalesce(..., true) so a missing row fails toward *enforced*, not toward
-- *open* -- consistent with the fail-closed-for-monetization principle the
-- whole tier design has followed from the start.
-- ---------------------------------------------------------------------------
create table public.platform_config (
  id boolean primary key default true check (id),
  tier_enforcement_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.platform_config (id, tier_enforcement_enabled) values (true, true);

alter table public.platform_config enable row level security;

create policy platform_config_select on public.platform_config
  for select using (auth.uid() is not null);

create or replace function public.set_platform_config_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger platform_config_updated before update on public.platform_config
  for each row execute function public.set_platform_config_updated_at();

create or replace function public.tier_enforcement_enabled()
returns boolean language sql stable as $$
  select coalesce((select tier_enforcement_enabled from public.platform_config limit 1), true);
$$;

-- ---------------------------------------------------------------------------
-- issue_invoice(): only the two Phase-2 tier checks (plan status, plan
-- tier) are wrapped. The pre-existing clinic_entitlements/billing_enabled/
-- invoicing_access checks are a separate, unrelated concern (admin
-- preferences, not tier) and stay active regardless of this switch.
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

-- ---------------------------------------------------------------------------
-- patients/visits insert triggers: early-return when the switch is off,
-- skipping the read-only block and (for visits) the visit-cap check
-- together.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_clinic_plan_on_patient_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not tier_enforcement_enabled() then
    return new;
  end if;

  select status into v_status from clinic_plans where clinic_id = new.clinic_id;
  if v_status is not null and v_status <> 'active' then
    raise exception 'this clinic''s plan is read-only -- new patients cannot be added until payment resumes';
  end if;
  return new;
end $$;

create or replace function public.enforce_clinic_plan_on_visit_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_cap int;
  v_month_count int;
  v_buffer int := 20;
begin
  if not tier_enforcement_enabled() then
    return new;
  end if;

  select status, visit_cap_per_month into v_status, v_cap
    from clinic_plans where clinic_id = new.clinic_id;

  if v_status is not null and v_status <> 'active' then
    raise exception 'this clinic''s plan is read-only -- new visits cannot be added until payment resumes';
  end if;

  if v_cap is not null then
    select count(*) into v_month_count
      from visits
      where clinic_id = new.clinic_id
        and not deleted
        and date_trunc('month', visit_date) = date_trunc('month', new.visit_date);
    if v_month_count >= v_cap + v_buffer then
      raise exception 'this clinic''s plan allows % visits/month, and the buffer above that is also used up -- upgrade to log more', v_cap;
    end if;
  end if;

  return new;
end $$;
