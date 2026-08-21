-- ---------------------------------------------------------------------------
-- no_return_reason_catalog shipped with zero seeding — every clinic,
-- including the two already live, started with a completely empty list and
-- had to type each reason from scratch via Reports' inline "Manage reasons"
-- panel. Seeds a sensible starter set (editable/removable afterward like any
-- catalog entry, same as service_catalog) for both new and existing clinics.
--
-- is_closed marks which of these read as "no longer an active lead" (moved
-- away, recovered, switched providers, referred elsewhere) vs. still worth
-- a follow-up (cost, scheduling, lost contact, discomfort) — see the
-- original migration's comment for what that flag drives downstream.
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

  insert into no_return_reason_catalog (clinic_id, name, is_closed) values
    (v_clinic.id, 'Moved away / relocated',            true),
    (v_clinic.id, 'Discomfort with treatment',          false),
    (v_clinic.id, 'Cost / could not afford',            false),
    (v_clinic.id, 'Recovered — no longer needed care',  true),
    (v_clinic.id, 'Switched to another provider',       true),
    (v_clinic.id, 'Lost contact / unreachable',         false),
    (v_clinic.id, 'Scheduling conflict',                false),
    (v_clinic.id, 'Referred elsewhere',                 true);

  return v_clinic;
end $function$;

-- Backfill: any clinic whose catalog is currently empty gets the same
-- starter set. Guarded on a zero-row check per clinic, so this is a no-op
-- for a clinic that has already added its own reasons.
insert into no_return_reason_catalog (clinic_id, name, is_closed)
select c.id, r.name, r.is_closed
from clinics c
cross join (values
  ('Moved away / relocated',            true),
  ('Discomfort with treatment',          false),
  ('Cost / could not afford',            false),
  ('Recovered — no longer needed care',  true),
  ('Switched to another provider',       true),
  ('Lost contact / unreachable',         false),
  ('Scheduling conflict',                false),
  ('Referred elsewhere',                 true)
) as r(name, is_closed)
where not exists (
  select 1 from no_return_reason_catalog existing where existing.clinic_id = c.id
);
