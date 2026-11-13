-- ---------------------------------------------------------------------------
-- Short onboarding (plan docs/superpowers/plans/2026-11-13-one-screen-onboarding.md)
--
-- 1. clinics.charges_patients: the answer to "Do your patients pay you?".
--    Existing clinics read true. False = the hospital bills the patients, or the
--    service is free; services are then saved at 0 and (in a later plan) the
--    money screens are hidden.
-- 2. create_clinic_with_admin takes the clinic code for Patient IDs, the browser's
--    time zone, a country code, the care locations, the charges answer, and can mark
--    onboarding complete in the same transaction, so a new clinic is never held on
--    /onboarding. Every new parameter has a default, so deployed clients that still
--    send the five original named arguments keep working. The old five-argument
--    function is dropped so PostgREST never sees two overloads.
-- Invalid region values fall back to the column defaults instead of failing sign-up.
-- ---------------------------------------------------------------------------

alter table public.clinics add column if not exists charges_patients boolean not null default true;

drop function if exists public.create_clinic_with_admin(text, text, text, text, text);

create or replace function public.create_clinic_with_admin(
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_address text default null,
  p_invoice_prefix text default 'INV',
  p_walk_in_mrno_prefix text default null,
  p_timezone text default null,
  p_default_country_code text default null,
  p_care_locations text[] default null,
  p_complete_onboarding boolean default false,
  p_charges_patients boolean default true
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
    clinic_split_pct, tax_pct, enable_therapist_split,
    walk_in_mrno_prefix, charges_patients, onboarding_completed_at
  )
  values (
    p_name, nullif(p_email, ''), nullif(p_phone, ''), nullif(p_address, ''), coalesce(nullif(p_invoice_prefix, ''), 'INV'),
    100, 0, false,
    nullif(p_walk_in_mrno_prefix, ''), coalesce(p_charges_patients, true),
    case when coalesce(p_complete_onboarding, false) then now() end
  )
  returning * into v_clinic;

  -- Region and places: only values that would pass the column checks; anything else keeps the column default.
  if p_timezone is not null and exists (select 1 from pg_timezone_names where name = p_timezone) then
    update clinics set timezone = p_timezone where id = v_clinic.id;
  end if;
  if p_default_country_code is not null and p_default_country_code ~ '^\+[0-9]{1,4}$' then
    update clinics set default_country_code = p_default_country_code where id = v_clinic.id;
  end if;
  if p_care_locations is not null
     and cardinality(p_care_locations) > 0
     and p_care_locations <@ array['clinic', 'home', 'ward']::text[] then
    update clinics set care_locations = p_care_locations where id = v_clinic.id;
  end if;

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

  select * into v_clinic from clinics where id = v_clinic.id;
  return v_clinic;
end $function$;

grant execute on function public.create_clinic_with_admin(text, text, text, text, text, text, text, text, text[], boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Checks (run live after applying, inside begin; ... rollback; as a signed-in user):
--   select onboarding_completed_at, charges_patients from create_clinic_with_admin(
--     p_name => 'T', p_email => '', p_phone => '', p_address => '', p_invoice_prefix => 'TT');
--     -> null, true                                  (old five-argument client)
--   select timezone, default_country_code, care_locations, onboarding_completed_at is not null, charges_patients
--     from create_clinic_with_admin(p_name => 'T', p_timezone => 'Mars/Base', p_default_country_code => '91',
--       p_care_locations => '{}', p_complete_onboarding => true, p_charges_patients => false);
--     -> column defaults kept, true, false
--   select timezone, care_locations from create_clinic_with_admin(p_name => 'T', p_timezone => 'Asia/Dubai',
--       p_care_locations => '{clinic,home}');
--     -> Asia/Dubai, {clinic,home}
-- ---------------------------------------------------------------------------
