-- ---------------------------------------------------------------------------
-- Every new clinic went through create_clinic_with_admin(), which hardcoded
-- bm_split_pct=50, tax_pct=18 regardless of whether the clinic actually has
-- a hospital partner (has_partner). For a standalone clinic that never
-- touches Settings -> Billing, that meant every visit's postTaxPaise (the
-- figure the Dashboard/Reports show as "Revenue") was silently computed as
-- only ~41% of the actual gross bill (50% split x 82% after 18% tax), with
-- no indication anywhere that a reduction was being applied at all.
--
-- Fixed going forward: new clinics now default to bm_split_pct=100,
-- tax_pct=0 -- no phantom reduction unless an admin explicitly configures
-- a real partner-share/tax arrangement in Settings -> Billing.
--
-- Also reset the three existing clinics in this project to the same
-- neutral defaults -- confirmed via has_partner=false (none of the three
-- are configured as real hospital-split arrangements) and zero visits on
-- record for any of them (nothing to reconcile; the setting only affects
-- visits billed after this point).
-- ---------------------------------------------------------------------------
create or replace function public.create_clinic_with_admin(
  p_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_invoice_prefix text
)
returns clinics
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic public.clinics;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into clinics (
    name, email, phone, address, invoice_prefix,
    bm_split_pct, tax_pct, enable_therapist_split
  )
  values (
    p_name, nullif(p_email, ''), nullif(p_phone, ''), nullif(p_address, ''), p_invoice_prefix,
    100, 0, false
  )
  returning * into v_clinic;

  insert into service_catalog (clinic_id, category, name, session_count, base_price_paise) values
    (v_clinic.id, 'Consultation',    'Initial Consultation',        1,  50000),
    (v_clinic.id, 'Consultation',    'Follow-up Consultation',      1,  30000),
    (v_clinic.id, 'Physiotherapy',   'Physiotherapy Session',       1,  80000),
    (v_clinic.id, 'Physiotherapy',   'Physiotherapy Package (5)',   5, 350000),
    (v_clinic.id, 'Manual Therapy',  'Manual Therapy Session',      1, 100000),
    (v_clinic.id, 'Exercise Therapy','Exercise Therapy Session',    1,  70000);

  return v_clinic;
end $function$;

alter table public.clinics alter column bm_split_pct set default 100;
alter table public.clinics alter column tax_pct set default 0;

update public.clinics
set bm_split_pct = 100, tax_pct = 0
where has_partner = false;
