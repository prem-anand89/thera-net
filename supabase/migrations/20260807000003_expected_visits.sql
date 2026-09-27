-- ---------------------------------------------------------------------------
-- Expected today: a lightweight, opt-in "who's coming in" list for clinics
-- that use informal scheduling. Deliberately NOT a booking/calendar system —
-- no per-therapist availability, no conflict detection, no patient
-- self-booking. time_note is a generic free-text string (not a real time
-- slot) so a future real booking module could populate it with an actual
-- timestamp later without a schema migration — this table is the seed of
-- that, not the booking system itself.
--
-- patient_id is nullable: an expected visitor who isn't a registered patient
-- yet is captured by patient_name free text instead. Converts into a real
-- visit the same way any New Visit does — this table has no lifecycle beyond
-- that; status exists so front-desk staff can mark a no-show without
-- creating a visit at all.
-- ---------------------------------------------------------------------------
create table public.expected_visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid references public.patients (id),
  patient_name text,
  time_note text not null default '',
  visit_date date not null,
  status text not null default 'expected' check (status in ('expected', 'arrived', 'no-show')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id)
);

create index expected_visits_clinic_date_idx
  on public.expected_visits (clinic_id, visit_date);

create trigger expected_visits_updated before insert or update on public.expected_visits
  for each row execute function public.set_updated_at();

alter table public.expected_visits enable row level security;

create policy expected_visits_all on public.expected_visits
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter publication supabase_realtime add table public.expected_visits;

-- ---------------------------------------------------------------------------
-- Setup toggle: opt-in, off by default — a clinic that doesn't use informal
-- scheduling shouldn't see an empty "Expected today" section every day, same
-- reasoning as enable_therapist_split.
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column enable_expected_today boolean not null default false;
