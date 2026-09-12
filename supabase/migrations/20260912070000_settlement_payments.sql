-- ---------------------------------------------------------------------------
-- Settlement reconciliation, split into tranches. `settlements` (one row
-- per clinic/year/month) assumed a partner hospital pays a single lump sum —
-- in practice payouts arrive as an advance plus a final tranche, sometimes
-- with an unrelated deduction that only makes sense noted against the
-- specific payment it applied to. `settlement_payments` allows any number
-- of rows per [clinic_id, year, month]; a month's total received is their
-- sum (settlementService.totalReceived), not a single stored figure.
--
-- `settlements` itself is left in place (not dropped) — existing rows are
-- backfilled below as each period's first payment, but the table stays for
-- audit/rollback rather than being deleted outright.
-- ---------------------------------------------------------------------------
create table public.settlement_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  amount_received_paise bigint not null default 0 check (amount_received_paise >= 0),
  received_date date,
  notes text,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create index settlement_payments_clinic_period_idx
  on public.settlement_payments (clinic_id, year, month);
create index settlement_payments_clinic_updated_idx
  on public.settlement_payments (clinic_id, updated_at);

create trigger settlement_payments_updated before insert or update on public.settlement_payments
  for each row execute function public.set_updated_at();

alter table public.settlement_payments enable row level security;

create policy settlement_payments_all on public.settlement_payments
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter publication supabase_realtime add table public.settlement_payments;

-- One-time backfill: every existing settlements row becomes that period's
-- first settlement_payments tranche, so switching the UI over doesn't make
-- previously-recorded settlements disappear.
insert into public.settlement_payments
  (id, clinic_id, year, month, amount_received_paise, received_date, notes, updated_at)
select id, clinic_id, year, month, amount_received_paise, received_date, notes, updated_at
from public.settlements;
