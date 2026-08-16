-- ---------------------------------------------------------------------------
-- Trends dashboard's single-visit-patients list can now record why a patient
-- hasn't come back. The list of reasons is clinic-editable, same shape as
-- service_catalog (add / deactivate-not-delete / rename from Settings), not
-- a fixed enum — a clinic's own retention vocabulary varies more than
-- referring_source's fixed channel list did. is_closed lets a clinic mark
-- which of its own reasons mean "no longer an active lead" (Resolved,
-- Relocated) vs. still worth a follow-up (Plans to return, Lost contact) —
-- a per-item flag rather than the dashboard hardcoding specific reason
-- names, which would silently stop working the moment a clinic renames or
-- removes the item the code was matching on.
-- ---------------------------------------------------------------------------
create table public.no_return_reason_catalog (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  is_closed boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create index no_return_reason_catalog_clinic_updated_idx
  on public.no_return_reason_catalog (clinic_id, updated_at);

create trigger no_return_reason_catalog_updated
  before insert or update on public.no_return_reason_catalog
  for each row execute function public.set_updated_at();

alter table public.no_return_reason_catalog enable row level security;

-- Same shape as service_catalog's RLS: any clinic member can read the list
-- (it needs to show up in a picker for anyone), only an admin can edit it.
create policy no_return_reason_catalog_select on public.no_return_reason_catalog
  for select using (is_clinic_member(clinic_id));
create policy no_return_reason_catalog_insert on public.no_return_reason_catalog
  for insert with check (is_clinic_admin(clinic_id));
create policy no_return_reason_catalog_update on public.no_return_reason_catalog
  for update using (is_clinic_admin(clinic_id));
create policy no_return_reason_catalog_delete on public.no_return_reason_catalog
  for delete using (is_clinic_admin(clinic_id));

alter table public.patients
  add column no_return_reason_id uuid references public.no_return_reason_catalog (id);
