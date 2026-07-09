-- ---------------------------------------------------------------------------
-- Clinical documentation engine + patient module registration.
--
-- consultation_notes is a structured clinical note per patient, distinct
-- from visits' free-text treatment_notes: it carries clinician sign-off
-- status and an authorized session count so a course of treatment can be
-- tracked independent of billing. It is intentionally NOT added to
-- protect_invoiced_visit()'s frozen-field list or linked to visit financial
-- columns — a therapist must be able to finish a clinical note after the
-- visit is billed.
--
-- patient_module_enrollments + the per-module response tables let a patient
-- register into a lightweight screening tool (Gut Screening, Return to
-- Sport, Scoliosis Screening) without any billing linkage. Re-enrollment
-- into the same module while an existing enrollment is still active is
-- explicitly allowed (no uniqueness constraint) — repeat assessments are
-- legitimate clinical practice.
-- ---------------------------------------------------------------------------

create table public.consultation_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  therapist_id uuid not null references public.therapists (id),
  authorized_session_count int check (authorized_session_count >= 1),
  notes_text text,
  status text not null default 'draft' check (status in ('draft', 'completed', 'archived')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id)
);

create index consultation_notes_clinic_patient_idx
  on public.consultation_notes (clinic_id, patient_id);
create index consultation_notes_clinic_updated_idx
  on public.consultation_notes (clinic_id, updated_at);

create trigger consultation_notes_updated before insert or update on public.consultation_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Patient module registration: which lightweight screening tools a patient
-- is enrolled in. No uniqueness constraint — a patient may hold multiple
-- concurrent or repeated enrollments in the same module.
-- ---------------------------------------------------------------------------
create table public.patient_module_enrollments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  module_type text not null check (module_type in (
    'gut_screening', 'return_to_sport', 'scoliosis_screening')),
  status text not null default 'active' check (status in ('active', 'completed', 'discharged')),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id)
);

create index patient_module_enrollments_clinic_patient_idx
  on public.patient_module_enrollments (clinic_id, patient_id, module_type);
create index patient_module_enrollments_clinic_updated_idx
  on public.patient_module_enrollments (clinic_id, updated_at);

create trigger patient_module_enrollments_updated before insert or update on public.patient_module_enrollments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Gut Screening: a flat questionnaire — responses captured as JSONB with a
-- computed score and triage level. Return to Sport and Scoliosis Screening
-- are multi-page flows with conditional routing / richer scoring, so they
-- get their own dedicated tables below rather than sharing this shape.
-- ---------------------------------------------------------------------------
create table public.screening_responses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  enrollment_id uuid references public.patient_module_enrollments (id),
  responses jsonb not null,
  computed_score numeric,
  triage_level text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id)
);

create index screening_responses_clinic_patient_idx
  on public.screening_responses (clinic_id, patient_id);
create index screening_responses_clinic_updated_idx
  on public.screening_responses (clinic_id, updated_at);

create trigger screening_responses_updated before insert or update on public.screening_responses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Return to Sport: dedicated table for its richer, multi-page assessment.
-- ---------------------------------------------------------------------------
create table public.return_to_sport_responses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  enrollment_id uuid references public.patient_module_enrollments (id),
  responses jsonb not null,
  computed_score numeric,
  risk_category text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id)
);

create index rts_responses_clinic_patient_idx
  on public.return_to_sport_responses (clinic_id, patient_id);
create index rts_responses_clinic_updated_idx
  on public.return_to_sport_responses (clinic_id, updated_at);

create trigger rts_responses_updated before insert or update on public.return_to_sport_responses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Scoliosis Screening: dedicated table for its richer, multi-page assessment.
-- ---------------------------------------------------------------------------
create table public.scoliosis_screening_responses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  enrollment_id uuid references public.patient_module_enrollments (id),
  responses jsonb not null,
  cobb_angle numeric,
  severity_level text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id)
);

create index scoliosis_responses_clinic_patient_idx
  on public.scoliosis_screening_responses (clinic_id, patient_id);
create index scoliosis_responses_clinic_updated_idx
  on public.scoliosis_screening_responses (clinic_id, updated_at);

create trigger scoliosis_responses_updated before insert or update on public.scoliosis_screening_responses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: clinic-scoped, matching the rest of Thera.Net.
-- ---------------------------------------------------------------------------
alter table public.consultation_notes enable row level security;
alter table public.patient_module_enrollments enable row level security;
alter table public.screening_responses enable row level security;
alter table public.return_to_sport_responses enable row level security;
alter table public.scoliosis_screening_responses enable row level security;

create policy consultation_notes_all on public.consultation_notes
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy patient_module_enrollments_all on public.patient_module_enrollments
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy screening_responses_all on public.screening_responses
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy rts_responses_all on public.return_to_sport_responses
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy scoliosis_responses_all on public.scoliosis_screening_responses
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter publication supabase_realtime add table
  public.consultation_notes,
  public.patient_module_enrollments,
  public.screening_responses,
  public.return_to_sport_responses,
  public.scoliosis_screening_responses;
