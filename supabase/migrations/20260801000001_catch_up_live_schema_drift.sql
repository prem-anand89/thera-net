-- ---------------------------------------------------------------------------
-- Catch-up migration: the live database had drifted from this repo's
-- migration history — some past changes were made directly against
-- production (dashboard SQL) without ever being captured as a committed
-- migration file, on any branch. This reconciles three gaps found while
-- investigating the clinic-creation bug:
--
-- Every step below is now guarded (IF EXISTS / IF NOT EXISTS, or an
-- existence check for the two statements Postgres has no direct guard
-- syntax for). This was originally unguarded, which is harmless replayed
-- once against the actual drifted production database this was written
-- for, but breaks a from-scratch replay of the full migration history
-- (a new environment, or CI) — 20260703000001_payments_settlements.sql
-- already creates invoice_payments/settlements in their final, correct
-- shape directly, so on such a database every step in sections 2 and 3
-- below is a no-op and the tables end up identical either way. Found
-- while validating 20260815000001_role_model_and_visit_rls.sql by
-- replaying the whole history against a throwaway local database.
--
-- 1. clinics.has_partner was missing. clinicType/hasPartner (domain/types.ts)
--    is the current billing-config model; clinic_type existed live but its
--    partner half didn't, so any save touching hasPartner was failing
--    silently against production.
--
-- 2. invoice_payments was missing paid_at (paymentService.ts writes it on
--    every "mark paid" action) AND had only a SELECT RLS policy — no INSERT
--    or UPDATE policy existed at all, meaning every "Mark Paid" action in
--    the app has been unconditionally rejected by RLS in production. Same
--    failure shape as the clinic-creation bug, different table.
--
-- 3. settlements lived as an entirely different, unused design: a
--    per-therapist monthly rollup (therapist_id/bill_paise/shared_paise/
--    net_post_tax_paise) that no current app code reads or writes — those
--    numbers are computed on the fly in reportService.ts from visits, never
--    persisted. The actual settlementService.ts/SettlementRepo the app uses
--    expects amount_received_paise/received_date/notes, unique per
--    (clinic_id, year, month) — the HV-settlement-reconciliation feature
--    this table was originally designed for (see
--    20260703000001_payments_settlements.sql). Table was empty (0 rows) at
--    migration time, so converting it is lossless.
-- ---------------------------------------------------------------------------

-- 1. clinics.has_partner
alter table public.clinics add column if not exists has_partner boolean not null default false;

-- 2. invoice_payments: paid_at, missing INSERT/UPDATE policies, missing trigger
alter table public.invoice_payments add column if not exists paid_at timestamptz;

create policy invoice_payments_insert on public.invoice_payments
  for insert with check (is_clinic_member(clinic_id));
create policy invoice_payments_update on public.invoice_payments
  for update using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

drop trigger if exists invoice_payments_updated on public.invoice_payments;
create trigger invoice_payments_updated before insert or update on public.invoice_payments
  for each row execute function public.set_updated_at();

-- 3. settlements: drop the unused per-therapist shape, add the real one
alter table public.settlements drop constraint if exists settlements_clinic_id_year_month_therapist_id_key;
alter table public.settlements drop constraint if exists settlements_therapist_id_fkey;
drop index if exists public.settlements_clinic_year_month;

alter table public.settlements
  drop column if exists therapist_id,
  drop column if exists bill_paise,
  drop column if exists shared_paise,
  drop column if exists net_post_tax_paise,
  drop column if exists created_at;

alter table public.settlements
  add column if not exists amount_received_paise bigint not null default 0 check (amount_received_paise >= 0),
  add column if not exists received_date date,
  add column if not exists notes text;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS -- looked up the same way
-- as the role check constraint in 20260815000001_role_model_and_visit_rls.sql.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.settlements'::regclass
      and conname = 'settlements_clinic_id_year_month_key'
  ) then
    alter table public.settlements add constraint settlements_clinic_id_year_month_key unique (clinic_id, year, month);
  end if;
end $$;

create index if not exists settlements_clinic_updated_idx on public.settlements (clinic_id, updated_at);

drop trigger if exists settlements_updated on public.settlements;
create trigger settlements_updated before insert or update on public.settlements
  for each row execute function public.set_updated_at();
