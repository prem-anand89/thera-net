-- Thera.Net Phase 1 schema
-- Multi-tenant physiotherapy visit ledger: clinics, members, therapists,
-- service catalog, patients, visits (with revenue-split snapshots), invoices
-- with gap-free per-clinic per-FY sequential numbering, RLS throughout.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at is server-authoritative: it is the sync cursor for offline
-- clients, so client-supplied values are always overwritten here.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  email text,
  gst_no text,
  logo_path text,
  partner_hospital_name text,
  partner_hospital_logo_path text,
  invoice_prefix text not null default 'INV',
  bm_split_pct numeric(5, 2) not null default 75,
  tax_pct numeric(5, 2) not null default 10,
  tds_basis text not null default 'gross_bill' check (tds_basis in ('gross_bill', 'bm_share')),
  fy_start_month int not null default 4 check (fy_start_month between 1 and 12),
  updated_at timestamptz not null default now()
);

create table public.clinic_members (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'staff')),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table public.therapists (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null,
  active boolean not null default true,
  user_id uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  category text not null,
  name text not null,
  session_count int not null default 1 check (session_count >= 1),
  base_price_paise bigint not null check (base_price_paise >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  mrno text not null,
  mrno_source text not null default 'hospital' check (mrno_source in ('hospital', 'auto')),
  name text not null,
  age int check (age between 0 and 150),
  sex text check (sex in ('M', 'F', 'Other')),
  phone text,
  primary_condition text,
  updated_at timestamptz not null default now(),
  unique (clinic_id, mrno)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  invoice_no text not null,
  fy_label text not null,
  seq int not null,
  issued_at timestamptz not null default now(),
  patient_snapshot jsonb not null,
  line_items jsonb not null,
  total_paise bigint not null check (total_paise >= 0),
  payment_mode text not null check (payment_mode in ('Cash', 'Card', 'UPI', 'Insurance')),
  therapist_id uuid references public.therapists (id),
  updated_at timestamptz not null default now(),
  unique (clinic_id, fy_label, seq),
  unique (clinic_id, invoice_no)
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  therapist_id uuid not null references public.therapists (id),
  visit_date date not null,
  condition text,
  treatment_notes text,
  service_catalog_id uuid not null references public.service_catalog (id),
  catalog_price_paise bigint not null check (catalog_price_paise >= 0),
  actual_bill_paise bigint not null default 0 check (actual_bill_paise >= 0),
  adjustment_paise bigint not null default 0,
  adjustment_reason text,
  session_index int check (session_index >= 1),
  package_total int check (package_total >= 1),
  package_group_id uuid,
  bm_split_pct numeric(5, 2) not null,
  tax_pct numeric(5, 2) not null,
  tds_basis text not null check (tds_basis in ('gross_bill', 'bm_share')),
  bm_share_paise bigint not null,
  post_tax_paise bigint not null,
  tds_paise bigint not null,
  hv_paise bigint not null,
  invoice_id uuid references public.invoices (id),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table public.invoice_counters (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  fy_label text not null,
  next_seq int not null default 1,
  primary key (clinic_id, fy_label)
);

create index visits_clinic_date_idx on public.visits (clinic_id, visit_date);
create index visits_patient_idx on public.visits (patient_id);
create index visits_clinic_updated_idx on public.visits (clinic_id, updated_at);
create index patients_clinic_updated_idx on public.patients (clinic_id, updated_at);
create index invoices_clinic_updated_idx on public.invoices (clinic_id, updated_at);
create index catalog_clinic_updated_idx on public.service_catalog (clinic_id, updated_at);

-- updated_at triggers
create trigger clinics_updated before insert or update on public.clinics
  for each row execute function public.set_updated_at();
create trigger clinic_members_updated before insert or update on public.clinic_members
  for each row execute function public.set_updated_at();
create trigger therapists_updated before insert or update on public.therapists
  for each row execute function public.set_updated_at();
create trigger service_catalog_updated before insert or update on public.service_catalog
  for each row execute function public.set_updated_at();
create trigger patients_updated before insert or update on public.patients
  for each row execute function public.set_updated_at();
create trigger invoices_updated before insert or update on public.invoices
  for each row execute function public.set_updated_at();
create trigger visits_updated before insert or update on public.visits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer so RLS policies can consult
-- clinic_members without recursing into its own policies)
-- ---------------------------------------------------------------------------
create or replace function public.is_clinic_member(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clinic_members
    where clinic_id = p_clinic and user_id = auth.uid()
  );
$$;

create or replace function public.is_clinic_admin(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clinic_members
    where clinic_id = p_clinic and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Whoever creates a clinic becomes its first admin (skipped for service-role
-- inserts such as seeds, where there is no auth.uid()).
create or replace function public.add_creator_as_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into clinic_members (clinic_id, user_id, role)
    values (new.id, auth.uid(), 'admin')
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger clinics_creator_admin after insert on public.clinics
  for each row execute function public.add_creator_as_admin();

-- ---------------------------------------------------------------------------
-- Invoice immutability: an issued invoice never changes; a visit attached to
-- an issued invoice keeps its financial fields frozen (clinical notes may
-- still be corrected).
-- ---------------------------------------------------------------------------
create or replace function public.reject_invoice_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'issued invoices are immutable; corrections require an amendment record';
end $$;

create trigger invoices_immutable before update or delete on public.invoices
  for each row execute function public.reject_invoice_mutation();

create or replace function public.protect_invoiced_visit()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then
      raise exception 'visit is on issued invoice %; it cannot be deleted', old.invoice_id;
    end if;
    return old;
  end if;
  if old.invoice_id is not null then
    if new.deleted
      or new.invoice_id is distinct from old.invoice_id
      or new.actual_bill_paise is distinct from old.actual_bill_paise
      or new.catalog_price_paise is distinct from old.catalog_price_paise
      or new.adjustment_paise is distinct from old.adjustment_paise
      or new.service_catalog_id is distinct from old.service_catalog_id
      or new.visit_date is distinct from old.visit_date
      or new.patient_id is distinct from old.patient_id
      or new.therapist_id is distinct from old.therapist_id
      or new.bm_split_pct is distinct from old.bm_split_pct
      or new.tax_pct is distinct from old.tax_pct
      or new.tds_basis is distinct from old.tds_basis
      or new.bm_share_paise is distinct from old.bm_share_paise
      or new.post_tax_paise is distinct from old.post_tax_paise
      or new.tds_paise is distinct from old.tds_paise
      or new.hv_paise is distinct from old.hv_paise
    then
      raise exception 'visit is on issued invoice %; financial fields are frozen', old.invoice_id;
    end if;
  end if;
  return new;
end $$;

create trigger visits_protect_invoiced before update or delete on public.visits
  for each row execute function public.protect_invoiced_visit();

-- ---------------------------------------------------------------------------
-- Invoice issuance: allocates the next gap-free sequential number for the
-- clinic + fiscal year under a row lock, inserts the invoice, and stamps the
-- visits — atomically. Online-only by design; offline clients must not mint
-- invoice numbers.
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
-- Row Level Security: every row is visible/writable only to members of its
-- clinic. Patient/visit data is health data — no anonymous access anywhere.
-- ---------------------------------------------------------------------------
alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.therapists enable row level security;
alter table public.service_catalog enable row level security;
alter table public.patients enable row level security;
alter table public.visits enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_counters enable row level security;

create policy clinics_select on public.clinics
  for select using (is_clinic_member(id));
create policy clinics_insert on public.clinics
  for insert with check (auth.uid() is not null);
create policy clinics_update on public.clinics
  for update using (is_clinic_admin(id));

create policy members_select on public.clinic_members
  for select using (user_id = auth.uid() or is_clinic_admin(clinic_id));
create policy members_insert on public.clinic_members
  for insert with check (is_clinic_admin(clinic_id));
create policy members_update on public.clinic_members
  for update using (is_clinic_admin(clinic_id));
create policy members_delete on public.clinic_members
  for delete using (is_clinic_admin(clinic_id));

create policy therapists_all on public.therapists
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy catalog_all on public.service_catalog
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy patients_all on public.patients
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));
create policy visits_all on public.visits
  for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

-- Invoices: readable by members; created only through issue_invoice();
-- never updated or deleted (immutability trigger backs this up).
create policy invoices_select on public.invoices
  for select using (is_clinic_member(clinic_id));

create policy counters_select on public.invoice_counters
  for select using (is_clinic_member(clinic_id));

-- ---------------------------------------------------------------------------
-- Storage: public-read bucket for clinic/partner logos, writes restricted to
-- clinic members within their own clinic's folder (path: <clinic_id>/...).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('clinic-assets', 'clinic-assets', true)
on conflict (id) do nothing;

create policy clinic_assets_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'clinic-assets'
    and is_clinic_member(((storage.foldername(name))[1])::uuid)
  );

create policy clinic_assets_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'clinic-assets'
    and is_clinic_member(((storage.foldername(name))[1])::uuid)
  );

create policy clinic_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'clinic-assets'
    and is_clinic_member(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- Realtime: change notifications wake the client's sync pull.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.clinics,
  public.therapists,
  public.service_catalog,
  public.patients,
  public.visits,
  public.invoices;
