-- Inpatient stays (Phase 2, I1 of the foundations and care plan).
--
-- admissions: one row per stay of a patient on a ward. At most ONE is open (no discharge date, not deleted) per
-- patient: a partial unique index holds that line even when two devices admit the same patient offline (the second
-- push is refused; the app keeps the first and tells staff). ward_bed is one free-text field; a bed move edits the
-- row in place. A stay can be soft-deleted (deleted = true) only while it has no live visits.
--
-- visits.admission_id: the stay a visit belongs to. A visit is an inpatient round exactly when it has an admission:
-- admission_id is set <=> location = 'ward'. The admission must be the same patient's, in the same clinic.
--
-- Plan: only clinics on a plan with the `inpatient` feature (Clinic and Clinic+) can ADD a stay. Editing or
-- discharging an existing stay is never blocked (a clinic that drops a plan must still be able to discharge), and a
-- re-put of an existing row (sync retry, backup restore) passes. The platform kill switch
-- (tier_enforcement_enabled) turns the plan check off like the other plan checks.
--
-- Sync like visits: soft delete, server-set updated_at/by, tombstone trigger, audit trail, realtime.
-- Permissions: any clinic member reads, adds and edits (like patients); only an admin hard-deletes.
-- A patient hard-delete (zero visits only) or a clinic wipe takes the patient's stays with it (on delete cascade).
--
-- Idempotent where it can be: tables and columns use if not exists; policies and triggers are dropped first.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.admissions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  ipd_no text,
  ward_bed text,
  admitting_doctor text,
  admitted_on date not null,
  discharged_on date,
  notes text,
  deleted boolean not null default false,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint admissions_discharge_after_admit check (discharged_on is null or discharged_on >= admitted_on)
);

create index if not exists admissions_patient_idx on public.admissions (patient_id);
create index if not exists admissions_pull_idx on public.admissions (clinic_id, updated_at, id);
create unique index if not exists admissions_one_open_per_patient
  on public.admissions (clinic_id, patient_id) where discharged_on is null and not deleted;

drop trigger if exists admissions_updated on public.admissions;
create trigger admissions_updated before insert or update on public.admissions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row checks: the patient belongs to the stay's clinic; adding needs a plan with inpatient; a stay with live
-- visits cannot be soft-deleted.
-- ---------------------------------------------------------------------------
create or replace function public.check_admission() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tier text;
  v_status text;
begin
  if not exists (select 1 from patients where id = new.patient_id and clinic_id = new.clinic_id) then
    raise exception 'The patient must belong to the stay''s clinic.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and tier_enforcement_enabled() then
    -- The sync and a backup restore push with an upsert; the BEFORE INSERT trigger fires before the conflict check,
    -- so a row whose id already exists is judged as the UPDATE it is, not as a new admission.
    if not exists (select 1 from public.admissions where id = new.id) then
      select plan_tier, status into v_tier, v_status from clinic_plans where clinic_id = new.clinic_id;
      if v_status is not null and v_status <> 'active' then
        raise exception 'this clinic''s plan is read-only -- patients cannot be admitted until payment resumes'
          using errcode = '42501';
      end if;
      if v_tier in ('lite', 'solo') then
        raise exception 'inpatient admissions are not included in the % plan -- upgrade to Clinic or above', initcap(v_tier)
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.deleted and not old.deleted
     and exists (select 1 from visits where admission_id = old.id and not deleted) then
    raise exception 'This stay has visits logged against it; it cannot be deleted.' using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists admissions_check on public.admissions;
create trigger admissions_check before insert or update on public.admissions
  for each row execute function public.check_admission();

-- ---------------------------------------------------------------------------
-- visits.admission_id
-- ---------------------------------------------------------------------------
alter table public.visits
  add column if not exists admission_id uuid references public.admissions (id);

create index if not exists visits_admission_idx on public.visits (admission_id) where admission_id is not null;

-- A visit is an inpatient round exactly when it has an admission. No visit has location 'ward' yet, so this holds
-- for every existing row.
alter table public.visits drop constraint if exists visits_admission_ward_check;
alter table public.visits add constraint visits_admission_ward_check
  check ((coalesce(location, 'clinic') = 'ward') = (admission_id is not null));

create or replace function public.check_visit_admission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.admission_id is not null and not exists (
    select 1 from admissions a
    where a.id = new.admission_id and a.clinic_id = new.clinic_id and a.patient_id = new.patient_id
  ) then
    raise exception 'A visit''s stay must be the same patient''s, in the same clinic.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists visits_check_admission on public.visits;
create trigger visits_check_admission before insert or update of admission_id, patient_id, clinic_id on public.visits
  for each row execute function public.check_visit_admission();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.admissions enable row level security;

drop policy if exists admissions_select on public.admissions;
drop policy if exists admissions_insert on public.admissions;
drop policy if exists admissions_update on public.admissions;
drop policy if exists admissions_delete on public.admissions;
create policy admissions_select on public.admissions
  for select using (is_clinic_member(clinic_id));
create policy admissions_insert on public.admissions
  for insert with check (is_clinic_member(clinic_id));
create policy admissions_update on public.admissions
  for update using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy admissions_delete on public.admissions
  for delete using (is_clinic_admin(clinic_id));

-- ---------------------------------------------------------------------------
-- Sync tombstones, audit trail, realtime
-- ---------------------------------------------------------------------------
drop trigger if exists admissions_tombstone on public.admissions;
create trigger admissions_tombstone after delete on public.admissions
  for each row execute function public.record_sync_tombstone();

drop trigger if exists admissions_audit on public.admissions;
create trigger admissions_audit after insert or update or delete on public.admissions
  for each row execute function public.audit_row_change();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admissions'
  ) then
    alter publication supabase_realtime add table public.admissions;
  end if;
end $$;
