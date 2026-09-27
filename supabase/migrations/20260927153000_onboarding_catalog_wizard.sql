-- Post–create-clinic onboarding: track completion on the clinic row and stop
-- auto-seeding service_catalog (admins price editable templates in the wizard).

alter table public.clinics
  add column if not exists onboarding_completed_at timestamptz;

-- Existing clinics are treated as already set up.
update public.clinics
set onboarding_completed_at = coalesce(onboarding_completed_at, updated_at, now())
where onboarding_completed_at is null;

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
