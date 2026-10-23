-- Hardening for multi-service, multi-therapist visits (follows 20261023100000_visit_items_and_credits.sql).
--
-- 1. Front desk cannot delete a visit. 20261023100000 widened visits_update to front desk so they can correct
--    a visit, but the app deletes a visit by UPDATE-ing `deleted = true` (visits_delete only guards a hard
--    delete). A trigger now refuses that flip unless the caller is an admin or the visit's own therapist.
-- 2. visits.service_lines_count: how many live service lines the visit was saved with. The app checks it before
--    building an invoice, so a visit whose lines haven't all arrived on the invoicing device yet (the visit
--    reached the server before its lines) is not billed as a one-service visit.
-- 3. An UPDATE of an invoiced visit's line is refused only when it actually changes the line. A backup restore
--    or a sync retry re-puts identical rows and must not be refused.
-- 4. The "whoever created the visit may add its lines and shares" rule only holds until the visit is invoiced.
-- 5. hard_delete_therapist also counts service lines the therapist assisted on and revenue shares they hold, so
--    the admin gets the normal "linked records" message instead of a raw foreign-key error.
--
-- Idempotent: every statement can be re-run.

-- ---------------------------------------------------------------------------
-- 1. Soft-delete of a visit: admin or the visit's own therapist only
-- ---------------------------------------------------------------------------
-- Only the false -> true flip of `deleted` is checked; every other update keeps following visits_update.
-- `old.clinic_id` / `old.therapist_id` are the visit's clinic and therapist BEFORE this update, so changing
-- the therapist (or moving the visit to a clinic where the caller is admin) and deleting in one statement
-- can't be used to get round it.
-- auth.uid() is null for server-side work that runs without a signed-in user (the service role, migrations,
-- maintenance SQL); that is let through. No function in the schema soft-deletes visits today:
-- admin_delete_clinic and admin_wipe_clinic_data hard-delete them (DELETE, which this UPDATE trigger never
-- sees), and the invoice RPCs (issue_invoice, amend_invoice, void_invoice) only change visits.invoice_id.
create or replace function public.guard_visit_soft_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted and not old.deleted
     and auth.uid() is not null
     and not is_clinic_admin(old.clinic_id)
     and not is_own_therapist(old.clinic_id, old.therapist_id)
  then
    raise exception 'Only an admin or the visit''s therapist can delete a visit.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists visits_guard_soft_delete on public.visits;
create trigger visits_guard_soft_delete before update on public.visits
  for each row execute function public.guard_visit_soft_delete();

-- ---------------------------------------------------------------------------
-- 2. Number of live service lines the visit was saved with
-- ---------------------------------------------------------------------------
-- Written by the app whenever it writes a visit's lines (create, edit services). Null = an older visit, or
-- one saved by an older app version: no check. The server doesn't enforce it against visit_items (lines
-- legitimately arrive after their visit); it is read by the invoicing device only.
alter table public.visits
  add column if not exists service_lines_count smallint
    check (service_lines_count is null or service_lines_count >= 0);

-- ---------------------------------------------------------------------------
-- 3. Invoiced visits: services frozen, but an identical re-put passes
-- ---------------------------------------------------------------------------
-- Same as 20261023100000 except UPDATE: refused only when a content column changes. updated_at/updated_by
-- change on every write (set_updated_at) and created_by/clinic_id are not line content (clinic_id is checked
-- against the visit by check_visit_item), so they don't count. INSERT and DELETE are unchanged, including the
-- cascade exception (pg_trigger_depth() > 1) used by admin_delete_clinic / admin_wipe_clinic_data.
create or replace function public.protect_invoiced_visit_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_visit_ids uuid[];
begin
  if tg_op = 'INSERT' then
    -- The sync and backup restore push with an upsert (INSERT ... ON CONFLICT DO UPDATE), and a BEFORE
    -- INSERT trigger fires on the proposed row before the conflict check. When the id already exists, the
    -- row is judged by the BEFORE UPDATE firing that follows (DO UPDATE re-enters this trigger as an UPDATE,
    -- where the content comparison below applies); a plain INSERT with an existing id fails on the primary
    -- key anyway. Only an EXISTING id returns early: a brand-new line on an invoiced visit is still refused.
    if exists (select 1 from public.visit_items where id = new.id) then
      return new;
    end if;
    v_visit_ids := array[new.visit_id];
  elsif tg_op = 'UPDATE' then
    if (new.visit_id, new.service_catalog_id, new.service_name, new.catalog_price_paise, new.price_paise,
        new.assisting_therapist_id, new.duration_minutes, new.is_package_line, new.deleted, new.position)
       is not distinct from
       (old.visit_id, old.service_catalog_id, old.service_name, old.catalog_price_paise, old.price_paise,
        old.assisting_therapist_id, old.duration_minutes, old.is_package_line, old.deleted, old.position)
    then
      return new;
    end if;
    v_visit_ids := array[old.visit_id, new.visit_id];
  else
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    v_visit_ids := array[old.visit_id];
  end if;
  if exists (select 1 from visits where id = any (v_visit_ids) and invoice_id is not null) then
    raise exception 'This visit is on an invoice; its services are frozen.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The creator path for adding lines/shares ends once the visit is invoiced
-- ---------------------------------------------------------------------------
-- The admin / front desk / own-therapist path (can_edit_visit_children) is unchanged. Accepted residual: until
-- the visit is invoiced, a therapist who logged a visit for a colleague can still add a line or share to it
-- through the API (that is how the app adds them right after logging). Such a write is audit-logged and the
-- attribution audit flags it as "repaired".
create or replace function public.can_add_visit_children(p_visit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select can_edit_visit_children(p_visit_id)
      or exists (
        select 1 from visits v
        where v.id = p_visit_id and v.created_by = auth.uid() and v.invoice_id is null
      );
$$;

revoke execute on function public.can_add_visit_children(uuid) from public, anon;
grant execute on function public.can_add_visit_children(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. hard_delete_therapist counts assisted lines and revenue shares
-- ---------------------------------------------------------------------------
-- Copied from 20260815000006_hard_delete_therapist.sql (the latest definition) and extended. Both
-- visit_items.assisting_therapist_id and visit_credits.therapist_id reference therapists without a cascade,
-- so deleting a therapist named on any of them (live OR soft-deleted rows: a soft-deleted row still holds the
-- reference) failed with a raw foreign-key error. Visits are counted once each, however many ways the
-- therapist is linked to them.
create or replace function public.hard_delete_therapist(p_therapist_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
  v_records int;
begin
  select clinic_id into v_clinic from therapists where id = p_therapist_id;
  if v_clinic is null then
    raise exception 'therapist not found';
  end if;
  if not is_clinic_admin(v_clinic) then
    raise exception 'only clinic admins can permanently delete a therapist';
  end if;

  select
    (select count(*) from (
       select id from visits where therapist_id = p_therapist_id or shared_therapist_id = p_therapist_id
       union
       select visit_id from visit_items where assisting_therapist_id = p_therapist_id
       union
       select visit_id from visit_credits where therapist_id = p_therapist_id
     ) linked_visits)
    + (select count(*) from consultation_notes where therapist_id = p_therapist_id)
    + (select count(*) from invoices where therapist_id = p_therapist_id)
  into v_records;

  if v_records > 0 then
    raise exception 'therapist has % linked record(s); deactivate instead of deleting', v_records;
  end if;

  delete from therapists where id = p_therapist_id;
end $$;
