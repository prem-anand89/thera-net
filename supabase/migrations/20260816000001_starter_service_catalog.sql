-- ---------------------------------------------------------------------------
-- A brand-new self-service clinic (create_clinic_with_admin) started with an
-- empty service catalog — every sign-up had to build their price list from
-- scratch before they could log a single visit. Seed a small, clearly-generic
-- starter list instead, editable/deletable from Settings -> Services like any
-- other catalog item (activate/deactivate, edit name/price — see Catalog() in
-- SetupPage.tsx). Deliberately NOT the real pricing sheet in supabase/seed.sql
-- (that's one specific clinic's actual business data, fine for local dev
-- bootstrapping, wrong to hand every new sign-up).
-- ---------------------------------------------------------------------------
create or replace function public.create_clinic_with_admin(
  p_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_invoice_prefix text
) returns public.clinics
language plpgsql security definer set search_path = public as $$
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
    50, 18, false
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
end $$;
