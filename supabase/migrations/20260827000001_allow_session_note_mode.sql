-- Widen consultation_notes.note_mode's CHECK to allow 'session', the new
-- light per-visit SOAP note mode (Billing & Notes Rebuild, Phase 2).
-- Constraint name confirmed live via pg_constraint before writing this
-- migration (created inline in 20260807000001_core_assessment_payload.sql
-- with no explicit name, but Postgres's default naming happens to match
-- the standard <table>_<column>_check convention).

alter table public.consultation_notes
  drop constraint if exists consultation_notes_note_mode_check;

alter table public.consultation_notes
  add constraint consultation_notes_note_mode_check
  check (note_mode in ('initial', 'followup', 'session'));
