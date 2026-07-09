-- ---------------------------------------------------------------------------
-- Referring source: where a patient found the clinic, for retention/marketing
-- visibility. A fixed set of channels keeps the data reportable (vs. free
-- text that never groups cleanly); referring_source_detail is free text
-- alongside it for the specifics (which doctor, who referred them, which
-- online channel). Both nullable — existing patients simply have neither set.
-- ---------------------------------------------------------------------------
alter table public.patients
  add column referring_source text check (
    referring_source in ('hospital_referral', 'doctor_referral', 'walk_in', 'word_of_mouth', 'online', 'other')
  ),
  add column referring_source_detail text;
