-- ---------------------------------------------------------------------------
-- Treatment tracking (independent of Core Assessment / clinical docs, so it
-- works for every clinic regardless of clinicalDocsEnabled): a clinic-
-- editable catalog of treatment types (Exercise, Manual Therapy, Kinesio
-- Taping, ...) — same add / deactivate-not-delete / rename shape as
-- service_catalog and no_return_reason_catalog — plus a multi-select array
-- on visits recording which ones were performed that session. Lets a clinic
-- answer "how many Manual Therapy sessions has this patient had in their
-- current package?" without re-deriving it from free-text treatment notes.
-- ---------------------------------------------------------------------------
create table public.treatment_catalog (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create index treatment_catalog_clinic_updated_idx
  on public.treatment_catalog (clinic_id, updated_at);

create trigger treatment_catalog_updated
  before insert or update on public.treatment_catalog
  for each row execute function public.set_updated_at();

alter table public.treatment_catalog enable row level security;

create policy treatment_catalog_select on public.treatment_catalog
  for select using (is_clinic_member(clinic_id));
create policy treatment_catalog_insert on public.treatment_catalog
  for insert with check (is_clinic_admin(clinic_id));
create policy treatment_catalog_update on public.treatment_catalog
  for update using (is_clinic_admin(clinic_id));
create policy treatment_catalog_delete on public.treatment_catalog
  for delete using (is_clinic_admin(clinic_id));

-- Native array column, not a join table — a visit's treatment set is a
-- simple multi-select with no per-treatment metadata of its own, same
-- reasoning as clinic_module_settings.allowed_roles already in this schema.
alter table public.visits
  add column treatment_ids uuid[] not null default '{}';

-- Starter set for every existing clinic, editable/removable afterward like
-- any catalog entry.
insert into treatment_catalog (clinic_id, name)
select c.id, v.name
from clinics c
cross join (values
  ('Manual Therapy'),
  ('Exercise Therapy'),
  ('Kinesio Taping'),
  ('Electrotherapy'),
  ('Dry Needling'),
  ('Postural Education')
) as v(name);

-- Same starter set for new clinics going forward.
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

  insert into treatment_catalog (clinic_id, name) values
    (v_clinic.id, 'Manual Therapy'),
    (v_clinic.id, 'Exercise Therapy'),
    (v_clinic.id, 'Kinesio Taping'),
    (v_clinic.id, 'Electrotherapy'),
    (v_clinic.id, 'Dry Needling'),
    (v_clinic.id, 'Postural Education');

  return v_clinic;
end $function$;
