-- ---------------------------------------------------------------------------
-- FaCE Scale + Facial Palsy (House-Brackmann / Sunnybrook) instrument capture.
--
-- Ported from real standalone assessment tools (FaCE_Original_iPad.html,
-- HB_Sunnybrook_iPad.html), not specs. Each table stores the raw item-level
-- answers as JSONB (an auditable record of exactly what was answered) plus
-- computed, queryable result columns — scoring itself lives in pure TS
-- modules (src/domain/instruments/), never in the database, so it runs
-- identically online and offline.
--
-- Unlike the source HTML tools (which discard every result on reset), these
-- rows accumulate per patient — visit_label lets a course of assessments be
-- compared over time on the patient profile page.
-- ---------------------------------------------------------------------------

create table public.face_scale_responses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  enrollment_id uuid references public.patient_module_enrollments (id),
  side_affected text check (side_affected in ('left', 'right', 'both')),
  visit_label text,
  responses jsonb not null,            -- {"1": 1-5, ..., "15": 1-5} raw Likert answers
  vas_movement int check (vas_movement between 0 and 10),
  vas_qol int check (vas_qol between 0 and 10),
  domain_scores jsonb not null,        -- {facialMovement, facialComfort, oralFunction,
                                        --  eyeComfort, lacrimalControl, socialFunction}
  total_score numeric not null,        -- 0-100, average of the 6 domain scores
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id)
);

create index face_scale_responses_clinic_patient_idx
  on public.face_scale_responses (clinic_id, patient_id);
create index face_scale_responses_clinic_updated_idx
  on public.face_scale_responses (clinic_id, updated_at);

create trigger face_scale_responses_updated before insert or update on public.face_scale_responses
  for each row execute function public.set_updated_at();

create table public.facial_palsy_assessments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  enrollment_id uuid references public.patient_module_enrollments (id),
  side_affected text check (side_affected in ('left', 'right', 'both')),
  visit_label text,
  hb_grade int check (hb_grade between 1 and 6),
  sunnybrook_resting jsonb,            -- {r0,r1,r2} 0-4 each
  sunnybrook_voluntary jsonb,          -- {v0..v4} 1-5 each
  sunnybrook_synkinesis jsonb,         -- {s0..s4} 0-3 each
  sunnybrook_score numeric,            -- 0-100: voluntary*4 - resting*5 - synkinesis, clamped
  synkinesis_total int,                -- 0-12, sum of synkinesis items
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id)
);

create index facial_palsy_assessments_clinic_patient_idx
  on public.facial_palsy_assessments (clinic_id, patient_id);
create index facial_palsy_assessments_clinic_updated_idx
  on public.facial_palsy_assessments (clinic_id, updated_at);

create trigger facial_palsy_assessments_updated before insert or update on public.facial_palsy_assessments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Extend the module registry to recognize these two instruments.
-- ---------------------------------------------------------------------------
alter table public.patient_module_enrollments
  drop constraint patient_module_enrollments_module_type_check;
alter table public.patient_module_enrollments
  add constraint patient_module_enrollments_module_type_check check (module_type in (
    'gut_screening', 'return_to_sport', 'scoliosis_screening', 'face_scale', 'facial_palsy'));

-- ---------------------------------------------------------------------------
-- Row Level Security: clinic-scoped, matching the rest of Thera.Net.
-- ---------------------------------------------------------------------------
alter table public.face_scale_responses enable row level security;
alter table public.facial_palsy_assessments enable row level security;

create policy face_scale_responses_all on public.face_scale_responses
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy facial_palsy_assessments_all on public.facial_palsy_assessments
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter publication supabase_realtime add table
  public.face_scale_responses,
  public.facial_palsy_assessments;
