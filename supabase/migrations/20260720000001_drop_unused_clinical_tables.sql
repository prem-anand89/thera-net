-- Drop unused clinical assessment and documentation tables
-- These tables were created speculatively for consultation notes, consent ledger,
-- and assessment modules (FaCE Scale, Facial Palsy) but are not used by the current app.
-- Keeping this data in the database serves no purpose and clutters the schema.

drop table if exists public.ai_generation_log cascade;
drop table if exists public.module_assessments cascade;
drop table if exists public.screening_responses cascade;
drop table if exists public.clinical_docs cascade;
drop table if exists public.consent_grants cascade;
drop table if exists public.consent_ledger cascade;
drop table if exists public.face_scale cascade;
drop table if exists public.facial_palsy cascade;
drop table if exists public.module_registry cascade;

-- Note: consultation_notes was already removed in earlier migrations
