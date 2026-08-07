-- Core Assessment payload columns, ported from TheraNet-OS (see
-- docs/CORE-ASSESSMENT-PORT-PLAN.md §3). consultation_notes already carries a
-- freeform note (notes_text); this adds a structured JSON payload alongside
-- it, plus a handful of promoted scalars derived from that payload so
-- outcome-tracking trend queries don't have to load every note and
-- JSON.parse each one.
--
-- No RLS changes: consultation_notes_insert/update already gate on
-- can_use_module(clinic_id, 'consultation_notes'), which the existing
-- 'consultation_notes' module row already covers — Core Assessment is a
-- richer payload on that same module, not a new one.
--
-- enrollment_id references patient_module_enrollments, which is being wired
-- into the frontend for the first time as part of this same port (the table
-- already existed, unused).

alter table public.consultation_notes
  add column assessment_payload jsonb,
  add column note_mode text check (note_mode in ('initial', 'followup')),
  add column nrs_score int check (nrs_score between 0 and 10),
  add column psfs_mean numeric(3, 1) check (psfs_mean between 0 and 10),
  add column red_flag_count int not null default 0,
  add column enrollment_id uuid references public.patient_module_enrollments (id);

create index consultation_notes_enrollment_idx
  on public.consultation_notes (enrollment_id);
