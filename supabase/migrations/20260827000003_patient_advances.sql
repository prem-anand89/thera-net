-- ---------------------------------------------------------------------------
-- Billing & Notes Rebuild Phase 1, step 1.6: advance payments. An advance
-- isn't a `payments` row until drawn down against a real visit/invoice --
-- computeVisitPaymentState and everything derived from it (badges,
-- needs-receipt queue, KPIs) stays untouched until draw-down writes a real
-- payment row.
--
-- created_by/updated_by present from the first migration deliberately --
-- set_updated_at() unconditionally assigns both, and omitting them has
-- silently broken every outbox insert on a new table twice already in this
-- repo (payments itself, then clinic_plans). This is not a third occurrence.
-- ---------------------------------------------------------------------------

create table public.patient_advances (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null check (method in ('cash','upi','card','bank_transfer','cheque')),
  received_date date not null,
  receipt_no text,
  notes text,
  status text not null default 'open' check (status in ('open','exhausted','refunded','void')),
  deleted boolean not null default false,
  created_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (id, clinic_id)
);

create trigger patient_advances_updated before insert or update on public.patient_advances
  for each row execute function public.set_updated_at();

alter table public.patient_advances enable row level security;

create policy patient_advances_all on public.patient_advances
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter publication supabase_realtime add table public.patient_advances;

-- Draw-downs link via payments.advance_id rather than a separate allocation
-- table -- visit_id stays not null, computeVisitPaymentState needs no
-- change, remaining balance = amount_paise - sum(payments where advance_id
-- = a.id). Composite FK (not a plain `references patient_advances (id)`)
-- so a payment can never reference a different clinic's advance -- a data-
-- integrity gap, not a security bypass (RLS already scopes reads), but
-- cheap to close outright while this column is new.
alter table public.payments add column advance_id uuid;
alter table public.payments
  add constraint payments_advance_clinic_fk
  foreign key (advance_id, clinic_id) references public.patient_advances (id, clinic_id);
