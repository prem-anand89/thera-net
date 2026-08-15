-- ---------------------------------------------------------------------------
-- Role model: clinic_members gains a third role, front_desk, alongside the
-- existing admin/staff. Existing 'staff' rows become 'therapist' -- nobody
-- has been assigned to front_desk before this migration, so there is
-- nothing to backfill there; a clinic admin reassigns specific members to
-- it afterward from Settings > Team.
--
-- A free-text `title` column is added for display (e.g. "Lead
-- Physiotherapist", "HOD", "Consultant") -- deliberately NOT a permission
-- tier. Job titles proliferate; the three roles above are the only thing
-- RLS or the app's permission checks ever look at.
--
-- Constraint dropped by looking up its actual name rather than assuming
-- Postgres's default naming, per the precedent in
-- 20260721000001_entitlements_audit_log.sql.
-- ---------------------------------------------------------------------------
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'public.clinic_members'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%';
  if v_constraint is not null then
    execute format('alter table public.clinic_members drop constraint %I', v_constraint);
  end if;
end $$;

update public.clinic_members set role = 'therapist' where role = 'staff';

alter table public.clinic_members
  add constraint clinic_members_role_check check (role in ('admin', 'therapist', 'front_desk'));

alter table public.clinic_members add column title text;

-- ---------------------------------------------------------------------------
-- Own-therapist helper, mirroring is_clinic_admin's shape: true when the
-- calling user is linked (therapists.user_id) to the given therapist row
-- inside the given clinic. Used below to scope visit edits to "your own
-- patients' visits, or an admin's" -- reads stay clinic-wide (a patient can
-- be, and routinely is, seen by more than one therapist over their
-- history, so hiding other therapists' visits from each other would break
-- continuity of care, not just annoy people).
-- ---------------------------------------------------------------------------
create or replace function public.is_own_therapist(p_clinic uuid, p_therapist_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from therapists
    where id = p_therapist_id and clinic_id = p_clinic and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Visits: was one `visits_all` policy open to every clinic member for every
-- operation. Splits into select/insert (unchanged -- any clinical member
-- logs and reads visits, clinic-wide) and update/delete (now: your own
-- visits, or an admin's). Soft-delete goes through UPDATE (the app never
-- issues a raw SQL delete on visits), so this also stops one therapist from
-- marking a colleague's visit deleted.
-- ---------------------------------------------------------------------------
drop policy visits_all on public.visits;

create policy visits_select on public.visits
  for select using (is_clinic_member(clinic_id));
create policy visits_insert on public.visits
  for insert with check (is_clinic_member(clinic_id));
create policy visits_update on public.visits
  for update using (is_clinic_admin(clinic_id) or is_own_therapist(clinic_id, therapist_id));
create policy visits_delete on public.visits
  for delete using (is_clinic_admin(clinic_id) or is_own_therapist(clinic_id, therapist_id));

-- ---------------------------------------------------------------------------
-- Therapists and service_catalog: roster and pricing configuration, not
-- clinical or billing day-to-day work. Reads stay clinic-wide (the app
-- needs every therapist and every price visible to log a visit); writes
-- become admin-only. This closes a real gap -- both tables had an
-- unrestricted `_all` policy since they were created, meaning any signed-in
-- clinic member could edit prices, revenue splits, or the therapist roster
-- through Settings, not just admins.
-- ---------------------------------------------------------------------------
drop policy therapists_all on public.therapists;
-- Defensive: a therapists_insert policy referencing the not-yet-existing
-- 'therapist' role value was found live on the production project during
-- deploy, untracked by any migration in this history (likely added
-- directly via the dashboard at some point) -- dormant today (therapists_all
-- already permitted inserts to any member, so this extra permissive policy
-- changed nothing in practice), but it collides with the create below on a
-- fresh apply. Drop it if present so this migration is safe to run against
-- either a clean database or this specific drifted one.
drop policy if exists therapists_insert on public.therapists;

create policy therapists_select on public.therapists
  for select using (is_clinic_member(clinic_id));
create policy therapists_insert on public.therapists
  for insert with check (is_clinic_admin(clinic_id));
create policy therapists_update on public.therapists
  for update using (is_clinic_admin(clinic_id));
create policy therapists_delete on public.therapists
  for delete using (is_clinic_admin(clinic_id));

drop policy catalog_all on public.service_catalog;

create policy catalog_select on public.service_catalog
  for select using (is_clinic_member(clinic_id));
create policy catalog_insert on public.service_catalog
  for insert with check (is_clinic_admin(clinic_id));
create policy catalog_update on public.service_catalog
  for update using (is_clinic_admin(clinic_id));
create policy catalog_delete on public.service_catalog
  for delete using (is_clinic_admin(clinic_id));

-- ---------------------------------------------------------------------------
-- hard_delete_patient() checked only is_clinic_member -- any clinical
-- member could permanently delete a patient with no visit history, guarded
-- only by the app's confirm-by-typing-the-name UI prompt, not a real access
-- boundary. Permanent deletion is an admin action, matching the
-- delete-is-admin-only rule just applied to therapists and catalog above.
-- ---------------------------------------------------------------------------
create or replace function public.hard_delete_patient(p_patient_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
  v_visits int;
begin
  select clinic_id into v_clinic from patients where id = p_patient_id;
  if v_clinic is null then
    raise exception 'patient not found';
  end if;
  if not is_clinic_admin(v_clinic) then
    raise exception 'only clinic admins can permanently delete a patient';
  end if;
  select count(*) into v_visits from visits where patient_id = p_patient_id;
  if v_visits > 0 then
    raise exception 'patient has % visit(s); hide the patient instead of deleting', v_visits;
  end if;
  delete from patients where id = p_patient_id;
end $$;
