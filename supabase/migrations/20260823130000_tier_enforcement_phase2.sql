-- ---------------------------------------------------------------------------
-- Phase 2 of the tier-subscriptions plan: enforcement. Three gates land
-- here, all reading clinic_plans (Phase 0):
--  1. issue_invoice(): Lite doesn't include invoicing; a read_only plan
--     (lapsed payment) blocks issuing new invoices entirely.
--  2. patients: a read_only plan blocks new patients.
--  3. visits: a read_only plan blocks new visits; visit_cap_per_month is
--     enforced with a buffer, scoped to the visit's own visit_date rather
--     than today's date (see that trigger's comment for why).
--
-- Deliberately NOT touched here: can_use_module() / consultation_notes /
-- face_scale / facial_palsy / gut_screening / return_to_sport /
-- scoliosis_screening gating. Per the tier plan's own landmine note,
-- clinics.clinical_docs_enabled and clinic_module_settings('consultation_notes')
-- are two separate gates for the SAME live, actively-used feature -- adding
-- a third (plan-tier) gate on top without reconciling those two first risks
-- breaking real clinical documentation for real clinics, which is exactly
-- what this project was told not to touch yet. The five assessment-module
-- keys have zero client code today regardless, so gating them has no
-- practical effect yet -- deferred to the still-open "advanced modules
-- content" planning pass, alongside that reconciliation.
--
-- Seat cap ships in the same change but isn't SQL -- it's a
-- count-and-reject added to the invite-therapist edge function.
-- ---------------------------------------------------------------------------

-- 1. Invoicing: plan status + plan tier, checked before the existing
-- entitlement/billing_enabled/invoicing_access chain. Precedence per the
-- tier plan: plan -> entitlement -> billing_enabled -> invoicing_access.
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

  select plan_tier, status into v_plan_tier, v_plan_status
    from clinic_plans where clinic_id = p_clinic_id;

  if v_plan_status is not null and v_plan_status <> 'active' then
    raise exception 'this clinic''s plan is read-only -- invoicing is unavailable until payment resumes';
  end if;

  if v_plan_tier = 'lite' then
    raise exception 'invoicing is not included in the Lite plan -- upgrade to Solo or above';
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

-- 2. patients: a read_only plan blocks new patients. Edits to existing
-- patients are NOT blocked -- only inserts (matches the confirmed lapse
-- behavior: "new visits, new invoices, new patients" blocked, not edits
-- to what's already there).
create or replace function public.enforce_clinic_plan_on_patient_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  select status into v_status from clinic_plans where clinic_id = new.clinic_id;
  if v_status is not null and v_status <> 'active' then
    raise exception 'this clinic''s plan is read-only -- new patients cannot be added until payment resumes';
  end if;
  return new;
end $$;

create trigger patients_enforce_plan before insert on public.patients
  for each row execute function public.enforce_clinic_plan_on_patient_insert();

-- 3. visits: a read_only plan blocks new visits outright; visit_cap_per_month
-- is enforced with a buffer over the stated cap. Two deliberate choices,
-- both from the tier plan's own risk analysis:
--   - Counted by the visit's own visit_date's calendar month, not today's
--     date. This is what makes the bulk historical importer
--     (importVisitsService.ts) safe without any special-casing: it writes
--     through this exact same visits-insert path as manual entry (there is
--     no separate RPC to exempt it through), but virtually every imported
--     row is genuinely from a past month, so it never touches "this
--     month"'s count at all. A same-month import still hits the buffer.
--   - A buffer (+20) over the plan's stated cap, not the cap itself. The
--     client pre-check (NewVisitPage.tsx, via useEntitlements) is the real
--     day-to-day gate and should stop a normal user well before this fires.
--     This trigger is the backstop against a tampered/bypassed client, and
--     a hard block at the *exact* cap risks losing a real logged visit on
--     multi-device offline sync (two devices each thinking they have the
--     50th slot). The buffer absorbs that race; only genuine, sustained
--     overuse reaches it.
create or replace function public.enforce_clinic_plan_on_visit_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_cap int;
  v_month_count int;
  v_buffer int := 20;
begin
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

create trigger visits_enforce_plan before insert on public.visits
  for each row execute function public.enforce_clinic_plan_on_visit_insert();
