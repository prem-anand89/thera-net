-- The evening agenda email is the clinic's decision, not each therapist's: one switch per clinic
-- (Settings → General → Region). Therapists keep only their own "email me each appointment" choice.
-- email_daily_agenda stays on therapists but send-agenda no longer reads it.

alter table public.clinics
  add column if not exists agenda_enabled boolean not null default true;
