-- ---------------------------------------------------------------------------
-- Audit trail: who created/last touched each row.
--
-- created_by is set once on insert and never overwritten again; updated_by
-- refreshes on every insert/update. Both extend the existing set_updated_at()
-- trigger already attached to every syncable table (clinics, clinic_members,
-- therapists, service_catalog, patients, invoices, visits, invoice_payments,
-- settlements), so no new triggers are needed — just the columns and one
-- function change.
-- ---------------------------------------------------------------------------
alter table public.clinics add column if not exists created_by uuid references auth.users (id);
alter table public.clinics add column if not exists updated_by uuid references auth.users (id);

alter table public.clinic_members add column if not exists created_by uuid references auth.users (id);
alter table public.clinic_members add column if not exists updated_by uuid references auth.users (id);

alter table public.therapists add column if not exists created_by uuid references auth.users (id);
alter table public.therapists add column if not exists updated_by uuid references auth.users (id);

alter table public.service_catalog add column if not exists created_by uuid references auth.users (id);
alter table public.service_catalog add column if not exists updated_by uuid references auth.users (id);

alter table public.patients add column if not exists created_by uuid references auth.users (id);
alter table public.patients add column if not exists updated_by uuid references auth.users (id);

alter table public.invoices add column if not exists created_by uuid references auth.users (id);
alter table public.invoices add column if not exists updated_by uuid references auth.users (id);

-- visits.updated_by already exists (init.sql); only created_by is new here.
alter table public.visits add column if not exists created_by uuid references auth.users (id);

alter table public.invoice_payments add column if not exists created_by uuid references auth.users (id);
alter table public.invoice_payments add column if not exists updated_by uuid references auth.users (id);

alter table public.settlements add column if not exists created_by uuid references auth.users (id);
alter table public.settlements add column if not exists updated_by uuid references auth.users (id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;
