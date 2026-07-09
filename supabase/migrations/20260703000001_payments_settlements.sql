-- ---------------------------------------------------------------------------
-- Invoice payment status: simple paid/outstanding per invoice. Lives in its
-- own table rather than a column on invoices — invoices are immutable
-- (reject_invoice_mutation() blocks every UPDATE unconditionally and there
-- is no UPDATE/DELETE RLS policy on invoices at all), so payment status must
-- be tracked separately to keep that invariant intact.
-- ---------------------------------------------------------------------------
create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  invoice_id uuid not null unique references public.invoices (id) on delete cascade,
  status text not null default 'outstanding' check (status in ('paid', 'outstanding')),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- HV settlement reconciliation: what Health Valley actually paid out for a
-- fiscal month, to compare against the computed BM Post-Tax total for that
-- month (reportService.monthly(...).total.postTaxPaise).
-- ---------------------------------------------------------------------------
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  amount_received_paise bigint not null default 0 check (amount_received_paise >= 0),
  received_date date,
  notes text,
  updated_at timestamptz not null default now(),
  unique (clinic_id, year, month)
);

create index invoice_payments_clinic_updated_idx on public.invoice_payments (clinic_id, updated_at);
create index settlements_clinic_updated_idx on public.settlements (clinic_id, updated_at);

create trigger invoice_payments_updated before insert or update on public.invoice_payments
  for each row execute function public.set_updated_at();
create trigger settlements_updated before insert or update on public.settlements
  for each row execute function public.set_updated_at();

alter table public.invoice_payments enable row level security;
alter table public.settlements enable row level security;

create policy invoice_payments_all on public.invoice_payments
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy settlements_all on public.settlements
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter publication supabase_realtime add table
  public.invoice_payments,
  public.settlements;
