-- ---------------------------------------------------------------------------
-- Feature flag: clinics opt into the clinical documentation module. Existing
-- clinics default to off so this ships dark until each clinic is switched on.
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column clinical_docs_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- Clinical fields on visits: retrospective documentation of what happened at
-- a visit, kept separate from the billing/revenue-split columns. These are
-- deliberately NOT added to protect_invoiced_visit()'s frozen-field list —
-- a therapist must be able to finish clinical documentation after the visit
-- is billed. The immutability trigger is column-selective, so an update
-- touching only these columns passes even once invoice_id is set.
-- ---------------------------------------------------------------------------
alter table public.visits
  add column patient_consent_confirmed boolean not null default false,
  add column patient_signature_url text,
  add column clinical_status text not null default 'pending'
    check (clinical_status in ('pending', 'documented', 'reviewed')),
  add column consultation_note_id uuid references public.consultation_notes (id),
  add column reauthorization_required boolean not null default false;
