-- Deletes reach other devices. Sync only downloads rows changed since its last pull, so a row deleted on the
-- server (a patient, a payment, an appointment, a cascade from either) stayed on every device that already
-- had it. Each synced table now leaves a marker here when a row is deleted; devices pull the markers like any
-- other table and delete their local copy. The column is called updated_at so the same pull code reads it.
-- Members of the clinic can read its markers (ids only, no row content). Nobody writes them directly.

create table if not exists public.sync_tombstones (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  table_name text not null,
  row_id uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.sync_tombstones enable row level security;
create index if not exists sync_tombstones_pull_idx on public.sync_tombstones (updated_at, id);

drop policy if exists sync_tombstones_select on public.sync_tombstones;
create policy sync_tombstones_select on public.sync_tombstones
  for select using (is_clinic_member(clinic_id));

create or replace function public.record_sync_tombstone() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
begin
  v_clinic := case when tg_table_name = 'clinics' then old.id else (to_jsonb(old) ->> 'clinic_id')::uuid end;
  if v_clinic is not null then
    insert into sync_tombstones (clinic_id, table_name, row_id) values (v_clinic, tg_table_name, old.id);
  end if;
  return old;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'clinics', 'therapists', 'service_catalog', 'no_return_reason_catalog', 'referring_source_catalog',
    'treatment_catalog', 'patients', 'visits', 'invoices', 'invoice_payments', 'payments', 'settlements',
    'settlement_payments', 'consultation_notes', 'patient_module_enrollments', 'patient_advances',
    'feedback_requests', 'feedback_responses', 'appointment_requests', 'appointments', 'clinic_closed_dates',
    'shift_templates', 'therapist_shift_assignments', 'user_seen_markers', 'user_push_preferences'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_tombstone', t);
    execute format(
      'create trigger %I after delete on public.%I for each row execute function public.record_sync_tombstone()',
      t || '_tombstone', t
    );
  end loop;
end $$;

-- Markers older than 90 days are dropped nightly; a device offline longer than that keeps rows deleted meanwhile.
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('prune-sync-tombstones');
exception when others then
  null;
end $$;
select cron.schedule(
  'prune-sync-tombstones',
  '30 21 * * *',
  $$ delete from public.sync_tombstones where updated_at < now() - interval '90 days' $$
);
