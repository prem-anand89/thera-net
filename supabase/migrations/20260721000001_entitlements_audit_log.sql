-- ---------------------------------------------------------------------------
-- M0: entitlement/registry layer + generic audit log.
--
-- Two independent gates, checked in this order (fail fast on the cheaper,
-- coarser one first):
--   1. clinic_entitlements — does this clinic's plan/contract permit this
--      module at all? Fails OPEN: no row means entitled (the ceiling
--      defaults to "yes"; a row only ever narrows it for a specific
--      clinic/module, it never needs to grant what's already the default).
--   2. clinic_module_settings — within what the clinic is entitled to, has
--      an admin actually turned it on, and for which roles? Fails CLOSED,
--      unchanged from the existing model: no row means off.
-- can_use_module() now checks both, entitlement first, so a caller can tell
-- "not entitled" (contract-level, admin can't self-serve fix it) apart from
-- "not enabled" (admin-level, fixable in Setup) apart from "wrong role".
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- modules: normalizes what was a hardcoded check(module_key in (...)) on
-- clinic_module_settings into real reference data, so adding a module is a
-- data insert instead of a migration-every-time.
-- ---------------------------------------------------------------------------
create table public.modules (
  key text primary key,
  name text not null,
  kind text not null check (kind in ('assessment', 'documentation', 'core')),
  description text
);

insert into public.modules (key, name, kind, description) values
  ('gut_screening', 'Gut Screening', 'assessment', 'Flat questionnaire screening tool.'),
  ('return_to_sport', 'Return to Sport', 'assessment', 'Multi-page return-to-sport assessment.'),
  ('scoliosis_screening', 'Scoliosis Screening', 'assessment', 'Multi-page scoliosis screening.'),
  ('face_scale', 'Face Scale', 'assessment', 'Facial function outcome measure.'),
  ('facial_palsy', 'Facial Palsy', 'assessment', 'Facial palsy grading assessment.'),
  ('consultation_notes', 'Consultation Notes', 'documentation',
    'Structured clinical note per patient, independent of visit billing.'),
  ('invoicing', 'Invoicing', 'core', 'Core visit-ledger invoice issuance.');

-- Swap clinic_module_settings' hardcoded check for a real FK against the
-- reference table above. Same allowed set today; new modules no longer
-- need a migration to become valid. Constraint dropped by looking up its
-- actual name rather than assuming Postgres's default naming, in case it
-- was declared or renamed differently.
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'public.clinic_module_settings'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%module_key%';
  if v_constraint is not null then
    execute format('alter table public.clinic_module_settings drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.clinic_module_settings
  add constraint clinic_module_settings_module_key_fkey
  foreign key (module_key) references public.modules (key);

-- consultation_notes joins the same pluggable-module gating the assessment
-- modules already use (per the consultation-notes brief's resolved open
-- question #4). Defaults to enabled so existing note-taking behavior for
-- every current clinic is unaffected by this migration.
insert into public.clinic_module_settings (clinic_id, module_key, enabled)
select id, 'consultation_notes', true from public.clinics
on conflict (clinic_id, module_key) do nothing;

create or replace function public.seed_default_module_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into clinic_module_settings (clinic_id, module_key, enabled)
  values
    (new.id, 'face_scale', true),
    (new.id, 'facial_palsy', true),
    (new.id, 'consultation_notes', true),
    (new.id, 'gut_screening', false),
    (new.id, 'return_to_sport', false),
    (new.id, 'scoliosis_screening', false)
  on conflict (clinic_id, module_key) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- clinic_entitlements: the contract-tier ceiling above clinic_module_settings.
-- No row for a clinic/module means entitled (fail OPEN) — this table exists
-- to narrow access for specific clinics/modules, not to grant what every
-- clinic already has by default.
-- ---------------------------------------------------------------------------
create table public.clinic_entitlements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  module_key text not null references public.modules (key),
  entitled boolean not null default true,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  created_by uuid references auth.users (id),
  unique (clinic_id, module_key)
);

create index clinic_entitlements_clinic_idx on public.clinic_entitlements (clinic_id, updated_at);

create trigger clinic_entitlements_updated before insert or update on public.clinic_entitlements
  for each row execute function public.set_updated_at();

alter table public.clinic_entitlements enable row level security;

create policy clinic_entitlements_select on public.clinic_entitlements
  for select using (is_clinic_member(clinic_id));
create policy clinic_entitlements_admin_write on public.clinic_entitlements
  for all using (is_clinic_admin(clinic_id)) with check (is_clinic_admin(clinic_id));

alter publication supabase_realtime add table public.clinic_entitlements;

-- ---------------------------------------------------------------------------
-- can_use_module(): entitlement check, then module-settings + role check,
-- in that order. Behavior is unchanged from before this migration as long
-- as clinic_entitlements has no rows narrowing anything — this only takes
-- effect once a clinic-specific entitlement restriction is actually added.
-- ---------------------------------------------------------------------------
create or replace function public.can_use_module(p_clinic_id uuid, p_module_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    coalesce(
      (select entitled from clinic_entitlements
       where clinic_id = p_clinic_id and module_key = p_module_key),
      true
    )
    and exists (
      select 1
      from clinic_module_settings s
      join clinic_members m on m.clinic_id = s.clinic_id
      where s.clinic_id = p_clinic_id
        and s.module_key = p_module_key
        and s.enabled
        and m.user_id = auth.uid()
        and m.role = any (s.allowed_roles)
    );
$$;

-- ---------------------------------------------------------------------------
-- consultation_notes RLS: move from the single blanket policy to the split
-- select/insert/update shape face_scale/facial_palsy already use. Read stays
-- open to any clinic member (clinical record retention); write requires
-- can_use_module(), which — per the seed above — every existing clinic
-- passes today.
-- ---------------------------------------------------------------------------
drop policy consultation_notes_all on public.consultation_notes;

create policy consultation_notes_select on public.consultation_notes
  for select using (is_clinic_member(clinic_id));
create policy consultation_notes_insert on public.consultation_notes
  for insert with check (is_clinic_member(clinic_id) and can_use_module(clinic_id, 'consultation_notes'));
create policy consultation_notes_update on public.consultation_notes
  for update using (is_clinic_member(clinic_id))
  with check (is_clinic_member(clinic_id) and can_use_module(clinic_id, 'consultation_notes'));

-- ---------------------------------------------------------------------------
-- issue_invoice() is security definer with no RLS policy of its own to gate
-- separately — this is the only enforcement point available for it. Checks
-- the 'invoicing' entitlement directly (bypassing clinic_module_settings/
-- role, which don't apply to core billing): no row means entitled, so this
-- is a no-op for every clinic until an entitlement row explicitly restricts
-- one.
-- ---------------------------------------------------------------------------
create or replace function public.issue_invoice(
  p_clinic_id uuid,
  p_fy_label text,
  p_patient_snapshot jsonb,
  p_line_items jsonb,
  p_total_paise bigint,
  p_payment_mode text,
  p_therapist_id uuid,
  p_visit_ids uuid[]
) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
  v_prefix text;
  v_invoice public.invoices;
  v_stamped int;
begin
  if not is_clinic_member(p_clinic_id) then
    raise exception 'not a member of this clinic';
  end if;

  if not coalesce(
    (select entitled from clinic_entitlements
     where clinic_id = p_clinic_id and module_key = 'invoicing'),
    true
  ) then
    raise exception 'clinic is not entitled to invoicing';
  end if;

  select invoice_prefix into v_prefix from clinics where id = p_clinic_id;

  insert into invoice_counters (clinic_id, fy_label)
  values (p_clinic_id, p_fy_label)
  on conflict (clinic_id, fy_label) do nothing;

  update invoice_counters
  set next_seq = next_seq + 1
  where clinic_id = p_clinic_id and fy_label = p_fy_label
  returning next_seq - 1 into v_seq;

  insert into invoices (
    clinic_id, invoice_no, fy_label, seq, patient_snapshot, line_items,
    total_paise, payment_mode, therapist_id
  ) values (
    p_clinic_id,
    v_prefix || '/' || p_fy_label || '/' || lpad(v_seq::text, 4, '0'),
    p_fy_label, v_seq, p_patient_snapshot, p_line_items,
    p_total_paise, p_payment_mode, p_therapist_id
  ) returning * into v_invoice;

  update visits
  set invoice_id = v_invoice.id
  where id = any (p_visit_ids)
    and clinic_id = p_clinic_id
    and invoice_id is null
    and not deleted;
  get diagnostics v_stamped = row_count;
  if v_stamped <> coalesce(array_length(p_visit_ids, 1), 0) then
    raise exception 'one or more visits are missing, deleted, or already invoiced';
  end if;

  return v_invoice;
end $$;

-- ---------------------------------------------------------------------------
-- audit_log: genuine before/after row history (old_data/new_data jsonb) —
-- a different thing from the created_by/updated_by columns added in
-- migration 20260706000001_audit_trail.sql, which only answer "who last
-- touched this row." This answers "what did it look like before and after
-- every change." One generic trigger function, attached per-table, matching
-- the existing set_updated_at() pattern rather than one trigger per table.
--
-- Invoices are deliberately excluded — already append-only/immutable via
-- protect_invoiced_visit()-style enforcement, so a before/after log would
-- only ever show old_data = new_data on the fields that can change (or
-- nothing on the frozen ones). This confirms the existing immutability
-- design rather than adding a parallel mechanism for it.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  clinic_id uuid,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);

create index audit_log_table_row_idx on public.audit_log (table_name, row_id, changed_at);
create index audit_log_clinic_idx on public.audit_log (clinic_id, changed_at);

-- Row identifier extracted via to_jsonb rather than direct old.id/new.id
-- field access — clinic_members has no single id column (its primary key
-- is the (clinic_id, user_id) pair), so this falls back to user_id there.
-- clinic_id is likewise pulled from the jsonb rather than assumed present as
-- a plain column, with one deliberate exception: the clinics table itself
-- has no clinic_id column (its own id IS the clinic) — leaving that null
-- would make clinics-table audit rows readable by every clinic member
-- everywhere under audit_log_select's "clinic_id is null" clause, a
-- cross-clinic leak. So for that one table, row id doubles as clinic_id.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into audit_log (clinic_id, table_name, row_id, action, old_data, new_data, changed_by)
  values (
    case when TG_TABLE_NAME = 'clinics' then (v_row->>'id')::uuid else (v_row->>'clinic_id')::uuid end,
    TG_TABLE_NAME,
    coalesce((v_row->>'id')::uuid, (v_row->>'user_id')::uuid),
    lower(TG_OP),
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    auth.uid()
  );
  return case when TG_OP = 'DELETE' then old else new end;
end $$;

alter table public.audit_log enable row level security;

-- clinic_id is always populated for every table this trigger is attached to
-- (see audit_row_change's clinics special-case above) — no "or clinic_id is
-- null" escape hatch here, since that would let any clinic member read
-- every clinic's audit rows the moment a future table without a resolvable
-- clinic_id got attached.
create policy audit_log_select on public.audit_log
  for select using (is_clinic_member(clinic_id));

-- Attached to every mutable clinic-scoped table that already carries
-- set_updated_at — the same set, minus invoices (see note above).
do $$
declare
  t text;
begin
  foreach t in array array[
    'clinics', 'clinic_members', 'therapists', 'service_catalog', 'patients', 'visits',
    'invoice_payments', 'settlements', 'payments',
    'consent_form_templates', 'consents',
    'consultation_notes', 'patient_module_enrollments', 'screening_responses',
    'return_to_sport_responses', 'scoliosis_screening_responses',
    'face_scale_responses', 'facial_palsy_assessments',
    'clinic_module_settings', 'clinic_entitlements'
  ]
  loop
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
       for each row execute function public.audit_row_change()',
      t, t
    );
  end loop;
end $$;
