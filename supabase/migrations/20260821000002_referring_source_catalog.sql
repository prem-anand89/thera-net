-- ---------------------------------------------------------------------------
-- referring_source was a fixed 6-value enum (hospital_referral, doctor_
-- referral, walk_in, word_of_mouth, online, other) with no way for a clinic
-- to add its own channels. Same move as no_return_reason_catalog: a
-- clinic-editable list (add / deactivate-not-delete / rename from
-- Settings), seeded with the 6 existing labels as defaults so nothing
-- changes for a clinic that never touches it.
--
-- detail_label replaces the old referringSourceDetailLabel() switch
-- statement's hardcoded per-value labels ("Referring doctor", "Referred by
-- (patient name)", etc.) with a per-item column — a per-row flag rather
-- than name-matching, for the same reason no_return_reason_catalog's
-- is_closed is per-item: a name match would silently stop applying the
-- moment a clinic renames the item the code was matching on. Null means
-- this source needs no detail field (e.g. "Walk-in").
--
-- patients.referring_source_id is additive — the legacy referring_source/
-- referring_source_detail text columns stay in place so patients created
-- before this catalog existed keep displaying correctly (see
-- referringSourceDetailLabel/REFERRING_SOURCE_LABELS fallback in the app),
-- without a backfill of existing rows into the new catalog's ids.
-- ---------------------------------------------------------------------------
create table public.referring_source_catalog (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  detail_label text,
  active boolean not null default true,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create index referring_source_catalog_clinic_updated_idx
  on public.referring_source_catalog (clinic_id, updated_at);

create trigger referring_source_catalog_updated
  before insert or update on public.referring_source_catalog
  for each row execute function public.set_updated_at();

alter table public.referring_source_catalog enable row level security;

-- Same shape as no_return_reason_catalog's RLS: any clinic member can read
-- (needs to show up in a picker for anyone), only an admin edits it.
create policy referring_source_catalog_select on public.referring_source_catalog
  for select using (is_clinic_member(clinic_id));
create policy referring_source_catalog_insert on public.referring_source_catalog
  for insert with check (is_clinic_admin(clinic_id));
create policy referring_source_catalog_update on public.referring_source_catalog
  for update using (is_clinic_admin(clinic_id));
create policy referring_source_catalog_delete on public.referring_source_catalog
  for delete using (is_clinic_admin(clinic_id));

alter table public.patients
  add column referring_source_id uuid references public.referring_source_catalog (id);

-- Seed the 6 legacy labels as defaults for every existing clinic.
insert into referring_source_catalog (clinic_id, name, detail_label)
select c.id, v.name, v.detail_label
from clinics c
cross join (values
  ('Hospital referral', 'Referring doctor'),
  ('Doctor referral',    'Referring doctor'),
  ('Walk-in',            null),
  ('Word of mouth',      'Referred by (patient name)'),
  ('Online',             'Online channel (e.g. Google, Instagram)'),
  ('Other',              'Details')
) as v(name, detail_label);

-- Same seed for new clinics going forward.
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

  insert into referring_source_catalog (clinic_id, name, detail_label) values
    (v_clinic.id, 'Hospital referral', 'Referring doctor'),
    (v_clinic.id, 'Doctor referral',    'Referring doctor'),
    (v_clinic.id, 'Walk-in',            null),
    (v_clinic.id, 'Word of mouth',      'Referred by (patient name)'),
    (v_clinic.id, 'Online',             'Online channel (e.g. Google, Instagram)'),
    (v_clinic.id, 'Other',              'Details');

  return v_clinic;
end $function$;
