-- HEP: a session pain score of 7 or more notifies the prescribing therapist (else the clinic's admins).
-- Plan: docs/superpowers/plans/2026-11-09-hep-module.md, Task 1b and amendment 53. Needs 20261113200000_hep_module.sql.
-- send-push builds the message from the row (patient first name and the first marked exercise; hidden when the person
-- chose "Hide patient names"; never a note, PIN, phone number or token).

alter table public.user_push_preferences drop constraint if exists user_push_preferences_category_check;
alter table public.user_push_preferences add constraint user_push_preferences_category_check
  check (category in ('booking_request','appointment_changes','low_rating_feedback','hide_patient_names','hep_high_pain'));

create or replace function public.session_feedback_pain_push_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_clinic uuid;
begin
  if new.pain_score is null or new.pain_score < 7 then return new; end if;
  -- On an edit, only a higher score notifies again (same tag, so the phone shows one alert per program per day).
  if tg_op = 'UPDATE' and coalesce(old.pain_score, -1) >= new.pain_score then return new; end if;
  select prog.clinic_id into v_clinic from public.programs prog where prog.id = new.program_id;
  perform public.notify_push('hep_high_pain', v_clinic, new.id);
  return new;
end $$;

create trigger program_session_feedback_pain_push
  after insert or update of pain_score on public.program_session_feedback
  for each row execute function public.session_feedback_pain_push_trigger();
