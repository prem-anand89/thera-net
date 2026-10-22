-- A visit can carry several services, and more than one therapist can be credited for it.
--
-- visit_items: one row per service on a visit. assisting_therapist_id null = the visit's own (primary)
-- therapist delivered it; set = an assistant was tagged on that service (must be someone else). Name, catalog
-- price and duration are snapshots taken when the line is entered, like the visit's own snapshot. At most one
-- line per visit is the package line (purchase or session); the visit's package columns describe it.
--
-- visit_credits: one row per therapist credited on a visit, amount_paise = their share of the visit's bill.
-- The rows sum to actual_bill_paise (kept by the app, as the visit's own money columns are).
--
-- visits.credits_mode: 'auto' = credits follow the lines; 'manual' = someone edited them by hand.
-- service_catalog.duration_minutes: optional, per session for a package service.
--
-- Both new tables sync like visits: soft delete (deleted flag) because a hard delete doesn't reach other
-- devices on its own, server-set updated_at/by, the sync tombstone trigger for the cascade from a visit,
-- and the audit trail.
--
-- Permissions: any clinic member reads lines/credits. Adding them takes an admin, front desk, the visit's own
-- therapist or whoever created the visit; changing them takes an admin, front desk, or the visit's own
-- therapist. An assisting therapist can do neither. Lines and shares name a therapist of the visit's clinic. visits_update gains front
-- desk with the same rule, so front desk can correct a visit (visits_delete is unchanged). Once a visit is on
-- an invoice its lines are frozen; its credits stay editable (who gets paid is internal, not on the invoice).

alter table public.visits
  add column if not exists credits_mode text not null default 'auto'
    check (credits_mode in ('auto', 'manual'));

alter table public.service_catalog
  add column if not exists duration_minutes smallint
    check (duration_minutes between 1 and 480);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.visit_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  visit_id uuid not null references public.visits (id) on delete cascade,
  position int not null default 0 check (position >= 0),
  service_catalog_id uuid not null references public.service_catalog (id),
  service_name text not null,
  catalog_price_paise bigint not null check (catalog_price_paise >= 0),
  price_paise bigint not null check (price_paise >= 0),
  assisting_therapist_id uuid references public.therapists (id),
  duration_minutes smallint check (duration_minutes between 1 and 480),
  is_package_line boolean not null default false,
  deleted boolean not null default false,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create index visit_items_visit_idx on public.visit_items (visit_id);
create index visit_items_pull_idx on public.visit_items (clinic_id, updated_at, id);
-- One package line per visit.
create unique index visit_items_one_package_line on public.visit_items (visit_id)
  where is_package_line and not deleted;

create table public.visit_credits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  visit_id uuid not null references public.visits (id) on delete cascade,
  therapist_id uuid not null references public.therapists (id),
  amount_paise bigint not null check (amount_paise >= 0),
  deleted boolean not null default false,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create index visit_credits_visit_idx on public.visit_credits (visit_id);
create index visit_credits_pull_idx on public.visit_credits (clinic_id, updated_at, id);

create trigger visit_items_updated before insert or update on public.visit_items
  for each row execute function public.set_updated_at();
create trigger visit_credits_updated before insert or update on public.visit_credits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row checks: a line or credit belongs to its visit's clinic, the therapist it names belongs to that clinic,
-- and a line's assistant is not the visit's own therapist. A deleted line is exempt from the assistant check,
-- so a line left behind by a change of primary can still be removed.
-- ---------------------------------------------------------------------------
create or replace function public.check_visit_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_visit record;
begin
  select clinic_id, therapist_id into v_visit from visits where id = new.visit_id;
  if not found then
    raise exception 'Visit not found.' using errcode = '23503';
  end if;
  if new.clinic_id is distinct from v_visit.clinic_id then
    raise exception 'A service line must belong to its visit''s clinic.' using errcode = '23514';
  end if;
  if new.assisting_therapist_id is not null and not exists (
    select 1 from therapists where id = new.assisting_therapist_id and clinic_id = new.clinic_id
  ) then
    raise exception 'The assisting therapist must belong to the visit''s clinic.' using errcode = '23514';
  end if;
  if not new.deleted and new.assisting_therapist_id = v_visit.therapist_id then
    raise exception 'The assisting therapist must be someone other than the visit''s therapist.'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger visit_items_check before insert or update on public.visit_items
  for each row execute function public.check_visit_item();

create or replace function public.check_visit_credit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from visits where id = new.visit_id;
  if not found then
    raise exception 'Visit not found.' using errcode = '23503';
  end if;
  if new.clinic_id is distinct from v_clinic then
    raise exception 'A revenue share must belong to its visit''s clinic.' using errcode = '23514';
  end if;
  if not exists (select 1 from therapists where id = new.therapist_id and clinic_id = new.clinic_id) then
    raise exception 'The credited therapist must belong to the visit''s clinic.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger visit_credits_check before insert or update on public.visit_credits
  for each row execute function public.check_visit_credit();

-- ---------------------------------------------------------------------------
-- Invoiced visits: their services are frozen (the invoice lines were built from them).
-- A delete cascading from a parent (pg_trigger_depth() > 1) is let through: an invoiced visit can only be
-- removed by admin_delete_clinic / admin_wipe_clinic_data, which switch off visits_protect_invoiced for it.
-- ---------------------------------------------------------------------------
create or replace function public.protect_invoiced_visit_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_visit_ids uuid[];
begin
  if tg_op = 'INSERT' then
    v_visit_ids := array[new.visit_id];
  elsif tg_op = 'UPDATE' then
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

create trigger visit_items_protect_invoiced before insert or update or delete on public.visit_items
  for each row execute function public.protect_invoiced_visit_items();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.visit_items enable row level security;
alter table public.visit_credits enable row level security;

-- Who may change a visit's lines/shares: an admin, front desk, or the visit's own (primary) therapist.
-- Who may add them: the same, or whoever created the visit (a therapist logging a visit for a colleague
-- adds its lines and shares right after; visits.created_by is set by set_updated_at() on the server insert,
-- so this holds for a visit logged offline and pushed later). An assisting or unrelated therapist can do
-- neither, so nobody can credit themselves on someone else's visit.
create or replace function public.can_edit_visit_children(p_visit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from visits v
    where v.id = p_visit_id
      and (is_clinic_admin(v.clinic_id) or is_front_desk(v.clinic_id) or is_own_therapist(v.clinic_id, v.therapist_id))
  );
$$;

create or replace function public.can_add_visit_children(p_visit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select can_edit_visit_children(p_visit_id)
      or exists (select 1 from visits v where v.id = p_visit_id and v.created_by = auth.uid());
$$;

revoke execute on function public.can_edit_visit_children(uuid) from public, anon;
revoke execute on function public.can_add_visit_children(uuid) from public, anon;
grant execute on function public.can_edit_visit_children(uuid) to authenticated;
grant execute on function public.can_add_visit_children(uuid) to authenticated;

-- with check repeats the rule on the new row, so a line or share can't be moved onto a visit the caller
-- couldn't edit. The app soft-deletes; a hard delete follows the same rule (and the invoiced freeze above).
create policy visit_items_select on public.visit_items
  for select using (is_clinic_member(clinic_id));
create policy visit_items_insert on public.visit_items
  for insert with check (is_clinic_member(clinic_id) and can_add_visit_children(visit_id));
create policy visit_items_update on public.visit_items
  for update using (can_edit_visit_children(visit_id))
  with check (is_clinic_member(clinic_id) and can_edit_visit_children(visit_id));
create policy visit_items_delete on public.visit_items
  for delete using (can_edit_visit_children(visit_id));

create policy visit_credits_select on public.visit_credits
  for select using (is_clinic_member(clinic_id));
create policy visit_credits_insert on public.visit_credits
  for insert with check (is_clinic_member(clinic_id) and can_add_visit_children(visit_id));
create policy visit_credits_update on public.visit_credits
  for update using (can_edit_visit_children(visit_id))
  with check (is_clinic_member(clinic_id) and can_edit_visit_children(visit_id));
create policy visit_credits_delete on public.visit_credits
  for delete using (can_edit_visit_children(visit_id));

-- Front desk can now correct a visit. visits_delete stays admin or own therapist.
drop policy if exists visits_update on public.visits;
create policy visits_update on public.visits
  for update using (
    is_clinic_admin(clinic_id) or is_front_desk(clinic_id) or is_own_therapist(clinic_id, therapist_id)
  );

-- ---------------------------------------------------------------------------
-- Sync tombstones, audit trail, realtime
-- ---------------------------------------------------------------------------
create trigger visit_items_tombstone after delete on public.visit_items
  for each row execute function public.record_sync_tombstone();
create trigger visit_credits_tombstone after delete on public.visit_credits
  for each row execute function public.record_sync_tombstone();

create trigger visit_items_audit after insert or update or delete on public.visit_items
  for each row execute function public.audit_row_change();
create trigger visit_credits_audit after insert or update or delete on public.visit_credits
  for each row execute function public.audit_row_change();

alter publication supabase_realtime add table public.visit_items, public.visit_credits;
