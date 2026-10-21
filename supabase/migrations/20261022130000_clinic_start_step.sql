-- How often staff can start an appointment (Settings → Hours & closures → "Start times every"),
-- separate from slot_duration_minutes (the default length). Null = same as the slot length, so
-- existing clinics keep today's start times. Public online booking keeps slot_duration_minutes.

alter table public.clinics
  add column if not exists start_step_minutes smallint
  check (start_step_minutes in (15, 30));
