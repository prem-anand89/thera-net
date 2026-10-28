-- Follow-up reviews: the therapist tells a patient "come back in 2 days / a week / on Friday". One active follow-up
-- per patient, stored on the patient so it can be set later by anyone in the clinic (front desk, the therapist) and
-- needs no billing rules. A target date, not a held slot; whether it was fulfilled is derived in the app from later
-- visits / appointments, never stored. Clearing the four columns dismisses it.
--
-- Any clinic member may already write patients (patients_all), so no policy changes. Idempotent.

alter table public.patients
  add column if not exists follow_up_on date,
  add column if not exists follow_up_note text,
  add column if not exists follow_up_therapist_id uuid references public.therapists(id) on delete set null,
  add column if not exists follow_up_set_on date;

alter table public.patients drop constraint if exists patients_follow_up_note_len;
alter table public.patients
  add constraint patients_follow_up_note_len check (follow_up_note is null or char_length(follow_up_note) <= 200);

-- The agenda email and the Workspace list look up patients with an open follow-up by clinic and date.
create index if not exists patients_follow_up_idx
  on public.patients (clinic_id, follow_up_on)
  where follow_up_on is not null;
