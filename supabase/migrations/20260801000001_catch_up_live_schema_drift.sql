-- ---------------------------------------------------------------------------
-- Catch-up migration: the live database had drifted from this repo's
-- migration history — some past changes were made directly against
-- production (dashboard SQL) without ever being captured as a committed
-- migration file, on any branch. This reconciles three gaps found while
-- investigating the clinic-creation bug:
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

create trigger invoice_payments_updated before insert or update on public.invoice_payments
  for each row execute function public.set_updated_at();

-- 3. settlements: drop the unused per-therapist shape, add the real one
alter table public.settlements drop constraint settlements_clinic_id_year_month_therapist_id_key;
alter table public.settlements drop constraint settlements_therapist_id_fkey;
drop index if exists public.settlements_clinic_year_month;

alter table public.settlements
  drop column therapist_id,
  drop column bill_paise,
  drop column shared_paise,
  drop column net_post_tax_paise,
  drop column created_at;

alter table public.settlements
  add column amount_received_paise bigint not null default 0 check (amount_received_paise >= 0),
  add column received_date date,
  add column notes text;

alter table public.settlements add constraint settlements_clinic_id_year_month_key unique (clinic_id, year, month);
create index settlements_clinic_updated_idx on public.settlements (clinic_id, updated_at);

create trigger settlements_updated before insert or update on public.settlements
  for each row execute function public.set_updated_at();
