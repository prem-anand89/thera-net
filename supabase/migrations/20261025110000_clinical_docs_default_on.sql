-- New clinics start with the clinical documentation module on: a Lite clinic
-- (no invoicing) signs up mainly for notes, and a visit flow that never asks
-- for them looks hollow. Existing clinics keep their current setting.
alter table public.clinics alter column clinical_docs_enabled set default true;
