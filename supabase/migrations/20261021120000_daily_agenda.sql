-- Daily agenda: every evening (clinic time) each therapist gets ONE email listing tomorrow's
-- appointments, with a calendar file. It replaces the per-appointment email as the default:
-- new therapists get the agenda and not a mail per booking; existing therapists keep whatever
-- they chose. Each therapist can switch either one in Notifications.

alter table public.therapists
  add column if not exists email_daily_agenda boolean not null default true;

-- New therapists start with the agenda only; existing rows keep their current choice.
alter table public.therapists alter column email_appointment_updates set default false;

-- The hour (clinic time, 0-23) the agenda goes out. 20 = 8 pm.
alter table public.clinics
  add column if not exists agenda_hour smallint not null default 20
  check (agenda_hour between 0 and 23);

-- One row per therapist per day that has been sent, so a re-run in the same hour never mails twice.
-- Service role only (no policies), like other server bookkeeping.
create table if not exists public.agenda_log (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  for_date     date not null,
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  sent_at      timestamptz not null default now(),
  primary key (therapist_id, for_date)
);
alter table public.agenda_log enable row level security;
create index if not exists agenda_log_clinic_idx on public.agenda_log (clinic_id, for_date);

-- Runs every 15 minutes; send-agenda only acts for a clinic whose local hour is its agenda hour,
-- and agenda_log makes repeat runs within that hour do nothing.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('send-agenda');
exception when others then
  null; -- not scheduled yet
end $$;

select cron.schedule(
  'send-agenda',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://ajzcfbgjvnxgpebowwqc.supabase.co/functions/v1/send-agenda',
       headers := jsonb_build_object('Content-Type', 'application/json'),
       body := '{}'::jsonb
     ) $$
);
