-- ---------------------------------------------------------------------------
-- "BM" (Beyond Mechanics) and "HV" (Health Valley) are one specific clinic's
-- own shorthand, baked into shared column/field names used by every clinic
-- on this platform. Renaming to generic terms: bm_split_pct -> clinic_split
-- _pct, bm_share_paise -> clinic_share_paise, hv_paise -> partner_share_
-- paise, and the tds_basis enum value 'bm_share' -> 'clinic_share'. Plain
-- metadata renames -- no data changes, no backfill needed.
--
-- Three things reference these columns by name and must move together:
-- the two CHECK constraints on tds_basis, and the two PL/pgSQL functions
-- below (create_clinic_with_admin, protect_invoiced_visit).
-- ---------------------------------------------------------------------------

alter table public.clinics rename column bm_split_pct to clinic_split_pct;
alter table public.visits rename column bm_split_pct to clinic_split_pct;
alter table public.visits rename column bm_share_paise to clinic_share_paise;
alter table public.visits rename column hv_paise to partner_share_paise;

-- tds_basis CHECK constraints + the stored enum value itself.
alter table public.clinics drop constraint if exists clinics_tds_basis_check;
update public.clinics set tds_basis = 'clinic_share' where tds_basis = 'bm_share';
alter table public.clinics add constraint clinics_tds_basis_check
  check (tds_basis = any (array['gross_bill'::text, 'clinic_share'::text]));

alter table public.visits drop constraint if exists visits_tds_basis_check;
update public.visits set tds_basis = 'clinic_share' where tds_basis = 'bm_share';
alter table public.visits add constraint visits_tds_basis_check
  check (tds_basis = any (array['gross_bill'::text, 'clinic_share'::text]));

-- create_clinic_with_admin: inserted bm_split_pct by name.
create or replace function public.create_clinic_with_admin(p_name text, p_email text, p_phone text, p_address text, p_invoice_prefix text)
returns clinics
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_clinic public.clinics;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into clinics (
    name, email, phone, address, invoice_prefix,
    clinic_split_pct, tax_pct, enable_therapist_split
  )
  values (
    p_name, nullif(p_email, ''), nullif(p_phone, ''), nullif(p_address, ''), p_invoice_prefix,
    100, 0, false
  )
  returning * into v_clinic;

  insert into no_return_reason_catalog (clinic_id, name, is_closed) values
    (v_clinic.id, 'Moved away / relocated',            true),
    (v_clinic.id, 'Discomfort with treatment',          false),
    (v_clinic.id, 'Cost / could not afford',            false),
    (v_clinic.id, 'Recovered — no longer needed care',  true),
    (v_clinic.id, 'Switched to another provider',       true),
    (v_clinic.id, 'Lost contact / unreachable',         false),
    (v_clinic.id, 'Scheduling conflict',                false),
    (v_clinic.id, 'Referred elsewhere',                 true);

  insert into referring_source_catalog (clinic_id, name, detail_label) values
    (v_clinic.id, 'Hospital referral', 'Referring doctor'),
    (v_clinic.id, 'Doctor referral',    'Referring doctor'),
    (v_clinic.id, 'Walk-in',            null),
    (v_clinic.id, 'Word of mouth',      'Referred by (patient name)'),
    (v_clinic.id, 'Online',             'Online channel (e.g. Google, Instagram)'),
    (v_clinic.id, 'Other',              'Details');

  insert into treatment_catalog (clinic_id, name) values
    (v_clinic.id, 'Manual Therapy'),
    (v_clinic.id, 'Exercise Therapy'),
    (v_clinic.id, 'Kinesio Taping'),
    (v_clinic.id, 'Electrotherapy'),
    (v_clinic.id, 'Dry Needling'),
    (v_clinic.id, 'Postural Education');

  return v_clinic;
end $function$;

-- protect_invoiced_visit: the immutability-after-invoice trigger checked
-- these columns by name.
create or replace function public.protect_invoiced_visit()
returns trigger
language plpgsql
as $function$
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
      or new.clinic_split_pct is distinct from old.clinic_split_pct
      or new.tax_pct is distinct from old.tax_pct
      or new.tds_basis is distinct from old.tds_basis
      or new.clinic_share_paise is distinct from old.clinic_share_paise
      or new.post_tax_paise is distinct from old.post_tax_paise
      or new.tds_paise is distinct from old.tds_paise
      or (
        new.partner_share_paise is distinct from old.partner_share_paise
        and coalesce(current_setting('app.allow_invoice_amendment', true), '') <> 'true'
      )
    then
      raise exception 'visit is on issued invoice %; financial fields are frozen', old.invoice_id;
    end if;
  end if;
  return new;
end $function$;
