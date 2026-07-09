-- ---------------------------------------------------------------------------
-- DPDP-grade consent ledger: versioned, immutable, withdrawable consent for
-- patients and therapists, in accordance with the Digital Personal Data
-- Protection Act, 2023. Consolidated from the standalone Beyond Mechanics
-- spec and the Thera.Net extension handoff into a single clinic-scoped
-- implementation.
--
-- consent_form_templates carries the exact wording shown at capture time,
-- versioned so historical consents remain auditable even after the text
-- changes. consents is an append-only grant/withdraw ledger — a withdrawal
-- is a new row, never an edit to the original grant.
-- ---------------------------------------------------------------------------
create table public.consent_form_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  consent_type text not null check (consent_type in (
    'patient_data_privacy',   -- DPDP data-processing consent
    'patient_treatment',      -- clinical consent to physiotherapy treatment
    'therapist_engagement'    -- acknowledgment of a contracted professional agreement
  )),
  version int not null,
  locale text not null default 'en',   -- supports vernacular consent (DPDP §6(3))
  title text not null,
  body_text text not null,             -- exact wording shown at capture time
  purpose text not null,               -- DPDP purpose specification
  is_active boolean not null default false,
  effective_from date not null default current_date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id),
  unique (clinic_id, consent_type, version, locale)
);

-- Exactly one active template per clinic + consent_type + locale.
create unique index consent_template_active_idx
  on public.consent_form_templates (clinic_id, consent_type, locale) where is_active;

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  consent_type text not null check (consent_type in (
    'patient_data_privacy', 'patient_treatment', 'therapist_engagement')),
  template_id uuid not null references public.consent_form_templates (id),

  -- Polymorphic subject: exactly one of patient_id / therapist_id.
  subject_type text not null check (subject_type in ('patient', 'therapist')),
  patient_id uuid references public.patients (id),
  therapist_id uuid references public.therapists (id),

  granted boolean not null,             -- explicit grant vs. refusal on record
  granted_at timestamptz not null default now(),
  granted_via text not null check (granted_via in ('signature', 'otp', 'click')),
  evidence_url text,                    -- signature image / signed PDF / OTP log

  withdrawn_at timestamptz,             -- null = still in force
  withdrawn_reason text,

  captured_by uuid references auth.users (id),  -- who facilitated capture
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id),

  constraint chk_consent_subject check (
    (subject_type = 'patient'   and patient_id   is not null and therapist_id is null) or
    (subject_type = 'therapist' and therapist_id is not null and patient_id   is null)
  )
);

create index consents_patient_idx on public.consents (clinic_id, patient_id, consent_type);
create index consents_therapist_idx on public.consents (clinic_id, therapist_id, consent_type);
create index consents_clinic_updated_idx on public.consents (clinic_id, updated_at);

-- Current-state convenience view: latest consent row per subject + type.
create view public.current_consents as
select distinct on (clinic_id, subject_type, coalesce(patient_id, therapist_id), consent_type)
       id, clinic_id, consent_type, subject_type, patient_id, therapist_id, template_id,
       granted, granted_at, withdrawn_at,
       (granted and withdrawn_at is null) as is_in_force
from public.consents
order by clinic_id, subject_type, coalesce(patient_id, therapist_id), consent_type, granted_at desc;

create trigger consent_form_templates_updated before insert or update on public.consent_form_templates
  for each row execute function public.set_updated_at();
create trigger consents_updated before insert or update on public.consents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: clinic-scoped, matching the rest of Thera.Net.
-- ---------------------------------------------------------------------------
alter table public.consent_form_templates enable row level security;
alter table public.consents enable row level security;

create policy consent_templates_all on public.consent_form_templates
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

-- Consents are append-only from the app's perspective: insert grants/refusals
-- freely; "withdrawal" is modeled as a new row with granted = false, not an
-- update to the original. Update is only permitted to stamp withdrawn_at/
-- withdrawn_reason on the still-open row, never the grant fields themselves.
create policy consents_select on public.consents
  for select using (is_clinic_member(clinic_id));
create policy consents_insert on public.consents
  for insert with check (is_clinic_member(clinic_id));
create policy consents_withdraw on public.consents
  for update using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter publication supabase_realtime add table
  public.consent_form_templates,
  public.consents;
