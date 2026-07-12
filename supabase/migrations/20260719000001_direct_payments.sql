-- ---------------------------------------------------------------------------
-- Direct payments: cash/UPI/card/etc received for a visit, independent of
-- invoices. Introduced so solo/small clinics can log what they actually
-- collected without needing to issue a formal invoice for every visit.
--
-- This table existed client-side (Dexie) and in CLIENT_WRITABLE_TABLES since
-- the feature shipped, but the Supabase table was never created — so every
-- payment logged so far has been sitting in the local outbox, permanently
-- failing to push, and never actually reaching the server. This migration
-- closes that gap; existing local rows will sync up the next time each
-- client comes online after this migration is applied.
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  visit_id uuid not null references public.visits (id) on delete cascade,
  amount_paise bigint not null check (amount_paise >= 0),
  method text not null check (method in ('cash', 'upi', 'card', 'bank_transfer', 'cheque')),
  received_date date not null,
  notes text,
  updated_at timestamptz not null default now()
);

create index payments_clinic_updated_idx on public.payments (clinic_id, updated_at);
create index payments_visit_idx on public.payments (visit_id);

create trigger payments_updated before insert or update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;

create policy payments_all on public.payments
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter publication supabase_realtime add table public.payments;
