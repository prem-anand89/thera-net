# Opt-in HR Module Design (Expenses + Payroll first; Leave/Attendance; Reviews)

> Supersedes `docs/superpowers/specs/2026-09-26-theranet-hr-module-design.md` (never built; it duplicated the shift tables we shipped in `2026-10-10-shift-based-scheduling-design.md`).
> Reports-phase work (utilisation, therapist comparison, retention) is specified and implemented separately and is independent of HR; see the Reports plan. Nothing in this document depends on it.

## 1. Problem and scope

Small clinics have no HR person or manager, so the admin does expenses, therapist pay and leave by hand. This module is **optional per clinic**, run by an **admin** or a new **manager** role. Three phases, each with its own implementation plan:

| Phase | Contents | Plan |
|---|---|---|
| 1 | Module gate, `manager` role, therapist compensation, clinic expenses (+ receipts), payroll (draft -> locked), My Payslips | `docs/superpowers/plans/2026-10-12-hr-module-phase1.md` |
| 2 | Leave requests (block availability) + attendance clock-in/out | later |
| 3 | Performance reviews + shift-based utilisation | later |

### Confirmed product decisions

- Separate opt-in module; new `manager` role; three phases.
- Payroll = optional base pay + a share % of the therapist's **billed** visits (editable at payroll time) + **typed manual adjustments**. Pure salary, pure split and hybrid all work.
- Expenses carry an optional receipt photo that is **always resized before upload**.
- **No automated incentives.** A bonus is a manually typed adjustment line.
- Phase 1 expenses are **manager/admin-entered only**. Therapist expense claims, the approval queue and claim-sourced reimbursements are deferred; payroll reimbursement lines stay manual. There is no `expense_claims` table in Phase 1.

### Explicitly rejected (do not re-propose without a CA-reviewed spec)

- **TDS nudge at a fixed threshold (Sec 194J).** The threshold was raised (believed Rs 50,000 from April 2025) and salaried staff fall under Sec 192, not 194J. TDS is a plain manual deduction type, default 0, with a free-text label.
- **GST / Sec 44AB turnover meters.** The app's docs treat healthcare billing as GST-exempt and the quoted professional audit limits look wrong. A wrong statutory meter is worse than none.
- **Hard-coded utilisation benchmark bands** (e.g. a 70-85 percent "healthy" band, unverified). Phase 3 makes bands configurable defaults.
- **Depreciation** for equipment expenses. Equipment is a class flag only.

## 2. Verified facts about the current codebase

These were checked against code; the design leans on them.

- `therapists` is a synced Dexie table (`src/lib/db.ts`, listed in `ALL_SYNCED_TABLES`), so base pay stored there would land on every clinician's device. Compensation therefore lives in its own online-only table.
- `clinics` rows reach the client verbatim: `rowToDomain` (`src/repositories/rowMapping.ts`) camel-cases every column, and `Clinic` (`src/domain/types.ts`) carries per-clinic flags such as `billingEnabled`. A new `clinics.hr_enabled` column therefore arrives as `Clinic.hrEnabled` with no new sync plumbing. `clinics_update` RLS is `is_clinic_admin(id)`, so only an admin can flip the flag.
- Per-clinic flags are display-only today, so every HR RPC and RLS policy re-checks `hr_enabled` server-side.
- Storage policies in `20260702000001_init.sql` cast the first path folder to uuid (`((storage.foldername(name))[1])::uuid`). Receipt paths must start with the clinic UUID.
- The existing `clinic-assets` bucket is **public** and its write policies let **any clinic member** insert/update/delete. Receipts (and anything financial) must not go there.
- `UNRESOLVED_THERAPIST_SENTINEL` exists in `src/app/useWorkspaceScope.ts`; a user whose role is neither clinic-wide nor a linked therapist gets it as `scopeTherapistId`, so Dexie queries narrow to an impossible id and return nothing.
- `reportService.monthly(clinicId, month)` (`src/services/reportService.ts`) returns `TherapistMonthRow[]` with `billPaise` and `clinicSharePaise`. It reads Dexie, so it works offline-first and requires no new server aggregation.
- Existing RLS helpers (`is_clinic_admin`, `is_clinic_member`, `is_front_desk`, `is_own_therapist`) are `language sql stable security definer set search_path = public` and are called from policies, so they stay executable by `authenticated`.
- `clinic_members.role` is constrained by `clinic_members_role_check check (role in ('admin','therapist','front_desk'))` (`20260815000001_role_model_and_visit_rls.sql`). The trigger `guard_clinic_members_role_change` (`20260816000002`) already stops a non-admin changing a role; `members_select` lets a member read only their own row (admins read all).
- Clinical-notes and visit **reads** are `is_clinic_member(clinic_id)` in RLS (`consultation_notes_select`, `visits_select`). `canViewClinicalNotes` is a display gate (front desk is hidden from notes the same way). Managers get the same posture as front desk; see Non-goals.

## 3. Phase 1 design

### 3.1 Module gate

`clinics.hr_enabled boolean not null default false`. Surfaced as `Clinic.hrEnabled?: boolean` (optional so older cached rows read as off). Toggled by an admin in Settings -> General (new card "HR & payroll"). Server enforcement: `hr_can_manage(clinic)` and the internal assert helpers all require `hr_enabled`. Turning the module off hides the UI and makes every HR RPC/policy refuse; **no data is deleted**, and turning it back on restores everything. `list_my_payslips` also refuses when off.

### 3.2 Manager role

`manager` joins the `clinic_members.role` CHECK. A manager:

- can use every HR surface (compensation, expenses, payroll **drafting**), but **cannot finalize or unlock** payroll and cannot change settings, invite members, or flip `hr_enabled`.
- has `canViewClinicalNotes = false` and `canBill = false`, `canEditSettings = false`, `canViewPayouts = false` (HR gives them payroll instead).
- gets **no `therapists` row** from `invite-therapist` (so they never appear in a patient-facing roster or the booking page).
- gets `UNRESOLVED_THERAPIST_SENTINEL` as `scopeTherapistId` and `isClinicWideView = false`, so any workspace-scoped Dexie query fails closed.
- is excluded from admin/front-desk-only affordances (booking queue, notification bell for requests, invoice void) because those checks are explicit `role === 'admin' || role === 'front_desk'` comparisons and a new role simply does not match them. (Verified by grep; the plan lists every site.)

Invariants (each has a test in the Phase 1 plan):

| # | Invariant |
|---|---|
| R1 | `manager` appears in every role union: `ClinicRole`, `Permissions.role`, `WorkspaceScope.role`, `useClinicRole` fetch cast, `CLINIC_ROLE_LABELS`, the `invite-therapist` body type + allow-list + error text, Team settings role selects. |
| R2 | A manager can never finalize or unlock (server-enforced: `hr_assert_admin`). |
| R3 | `invite-therapist` creates no `therapists` row for `manager`. |
| R4 | `useWorkspaceScope` returns the sentinel `scopeTherapistId` and `isClinicWideView=false` for a manager. |
| R5 | A therapist or front-desk user cannot call any HR RPC or read any HR table. |
| R6 | A clinic with `hr_enabled=false` rejects every HR RPC for admin and manager alike. |

### 3.3 Navigation

- **Phone:** the 5-item bottom bar is unchanged for admin/front desk/therapist. HR is a row in `MorePage.tsx` ("HR & payroll") shown when `canManageHr`. A **manager's** bottom bar is `HR` + `More` only (their other tabs would be empty).
- **Desktop, admin:** HR is a row in the account menu (`AccountMenu.tsx`), under Settings, alongside the existing admin-only Settings link. The header nav stays at five items.
- **Desktop, manager:** the header nav shows a single `HR` item (Reports and Schedule are hidden for managers in Phase 1; Schedule returns for managers in Phase 2 with leave).
- **Therapist:** an account-menu row "My payslips" (only when the clinic has `hr_enabled`) opens a read-only sheet.
- Login landing for a manager is `/hr` (the index route currently redirects to `/workspace`).
- Page titles, `activePhoneTab`, `isAccountAreaActive` and `PAGE_TITLES` in `src/app/navActive.ts` learn `/hr`.

### 3.4 Data model (exact SQL sketch)

All amounts are **integer paise (`bigint`)**. Percentages are **basis points** (`share_bps`, 0..10000) so no floats touch money. None of the tables below is added to Dexie, `ALL_SYNCED_TABLES` or `CLIENT_WRITABLE_TABLES`.

```sql
-- Gate + role ---------------------------------------------------------
alter table public.clinics add column hr_enabled boolean not null default false;

alter table public.clinic_members drop constraint clinic_members_role_check;
alter table public.clinic_members
  add constraint clinic_members_role_check
  check (role in ('admin', 'therapist', 'front_desk', 'manager'));

create or replace function public.is_manager(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clinic_members
    where clinic_id = p_clinic and user_id = auth.uid() and role = 'manager'
  );
$$;

-- Read-only boolean predicate used by RLS (so it MUST stay executable by authenticated).
create or replace function public.hr_can_manage(p_clinic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (is_clinic_admin(p_clinic) or is_manager(p_clinic))
     and coalesce((select c.hr_enabled from clinics c where c.id = p_clinic), false);
$$;

-- Internal mutators' guards: raise, never returned to clients. REVOKED from authenticated.
create or replace function public.hr_assert_manage(p_clinic uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_clinic is null or not hr_can_manage(p_clinic) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end $$;

create or replace function public.hr_assert_admin(p_clinic uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_clinic is null
     or not is_clinic_admin(p_clinic)
     or not coalesce((select c.hr_enabled from clinics c where c.id = p_clinic), false) then
    raise exception 'Only a clinic admin can do this' using errcode = '42501';
  end if;
end $$;

-- Compensation (online-only, never synced) ----------------------------
create table public.therapist_compensation (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics(id) on delete cascade,
  therapist_id   uuid not null references public.therapists(id) on delete cascade,
  base_pay_paise bigint  not null default 0 check (base_pay_paise >= 0),
  share_bps      integer not null default 0 check (share_bps between 0 and 10000),
  notes          text,
  updated_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (clinic_id, therapist_id)
);
alter table public.therapist_compensation enable row level security;
create policy therapist_compensation_select on public.therapist_compensation
  for select using (hr_can_manage(clinic_id));
-- no insert/update/delete policies: RPC-only writes.

-- Expenses (online-only) ----------------------------------------------
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  expense_date date not null,
  category     text not null check (category in
    ('rent','utilities','consumables','equipment','marketing','software','maintenance','professional_fees','travel','other')),
  expense_class text not null default 'operating' check (expense_class in ('operating','equipment')),
  amount_paise bigint not null check (amount_paise > 0),
  vendor       text,
  note         text,
  payment_mode text check (payment_mode is null or payment_mode in ('cash','upi','card','bank','other')),
  receipt_path text,        -- hr-receipts object key; first folder = clinic_id
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (receipt_path is null or receipt_path like clinic_id::text || '/%')
);
create index expenses_clinic_date_idx on public.expenses (clinic_id, expense_date desc);
alter table public.expenses enable row level security;
create policy expenses_select on public.expenses for select using (hr_can_manage(clinic_id));

-- Payroll --------------------------------------------------------------
create table public.payroll_runs (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  period_month  date not null check (period_month = date_trunc('month', period_month)::date),
  status        text not null default 'draft' check (status in ('draft','locked')),
  created_by    uuid references auth.users(id),
  finalized_by  uuid references auth.users(id),
  finalized_at  timestamptz,
  unlock_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, period_month),
  check ((status = 'locked') = (finalized_at is not null))   -- both operands non-null: safe
);

create table public.payroll_lines (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.payroll_runs(id) on delete cascade,
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  therapist_id    uuid not null references public.therapists(id),
  therapist_name  text not null,                       -- snapshot for the payslip
  base_pay_paise  bigint  not null default 0 check (base_pay_paise >= 0),
  billed_paise    bigint  not null default 0 check (billed_paise >= 0),
  share_bps       integer not null default 0 check (share_bps between 0 and 10000),
  share_paise     bigint  not null default 0 check (share_paise >= 0),
  adjustments_paise bigint not null default 0,         -- signed sum of adjustments
  net_paise       bigint  not null,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (run_id, therapist_id),
  check (net_paise = base_pay_paise + share_paise + adjustments_paise)
);

create table public.payroll_adjustments (
  id              uuid primary key default gen_random_uuid(),
  line_id         uuid not null references public.payroll_lines(id) on delete cascade,
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  kind            text not null check (kind in ('bonus','reimbursement','deduction')),
  deduction_type  text check (deduction_type is null or deduction_type in
                    ('lop','advance_recovery','professional_tax','tds','other')),
  label           text not null check (length(btrim(label)) > 0),
  amount_paise    bigint not null check (amount_paise > 0),   -- magnitude; sign comes from kind
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((kind = 'deduction') = (deduction_type is not null))
);

create table public.payroll_audit (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  run_id     uuid not null,                  -- deliberately NO fk: audit outlives a deleted draft
  action     text not null check (action in ('created','finalized','unlocked','deleted')),
  actor      uuid references auth.users(id),
  reason     text,
  created_at timestamptz not null default now(),
  -- NULL-safe: a bare `length(btrim(reason)) > 0` yields NULL for a null reason and a CHECK
  -- treats NULL as pass, silently allowing an unlock with no reason.
  check (action <> 'unlocked' or coalesce(length(btrim(reason)), 0) > 0)
);
create index payroll_audit_run_idx on public.payroll_audit (run_id, created_at);

-- RLS: managers/admins read; nobody writes directly.
alter table public.payroll_runs        enable row level security;
alter table public.payroll_lines       enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_audit       enable row level security;
create policy payroll_runs_select        on public.payroll_runs        for select using (hr_can_manage(clinic_id));
create policy payroll_lines_select       on public.payroll_lines       for select using (hr_can_manage(clinic_id));
create policy payroll_adjustments_select on public.payroll_adjustments for select using (hr_can_manage(clinic_id));
create policy payroll_audit_select       on public.payroll_audit       for select using (hr_can_manage(clinic_id));
```

`set_updated_at` triggers (`public.set_updated_at()` from `20260702000001_init.sql`) are attached to every table above **and** each RPC sets `updated_at = now()` explicitly on every row it touches (belt and braces; the sync-pull cursor is `updated_at`, and a missed bump is silent).

**Storage (private bucket):**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-receipts', 'hr-receipts', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy hr_receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'hr-receipts' and hr_can_manage(((storage.foldername(name))[1])::uuid));
create policy hr_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-receipts' and hr_can_manage(((storage.foldername(name))[1])::uuid));
create policy hr_receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hr-receipts' and hr_can_manage(((storage.foldername(name))[1])::uuid));
-- No update policy: a receipt is replaced by uploading a new object and deleting the old.
```

Receipts are viewed with `createSignedUrl(path, 300)`; never a public URL. Key format: `${clinicId}/${expenseId}-${Date.now()}.jpg`.

### 3.5 RPCs and authorization rules

Every RPC is `language plpgsql security definer set search_path = public`, `revoke ... from public, anon`, `grant execute ... to authenticated` (convention from `20261011091000_shift_scheduling_admin_rpcs.sql`). Every one resolves the clinic **server-side from the target row** (never trusting a client-supplied clinic id for row-targeted calls), calls the right assert, validates inputs (including NULL), and bumps `updated_at`.

| RPC | Caller | Rules |
|---|---|---|
| `upsert_therapist_compensation(p_clinic, p_therapist, p_base_pay_paise, p_share_bps, p_notes)` | admin or manager | `hr_assert_manage`; therapist must belong to `p_clinic`; null args rejected |
| `create_expense(p_clinic, p_expense_date, p_category, p_class, p_amount_paise, p_vendor, p_note, p_payment_mode) returns uuid` | admin or manager | `hr_assert_manage`; date not null, not > today + 1 day |
| `update_expense(p_expense, ...same fields)` | admin or manager | clinic from row |
| `set_expense_receipt(p_expense, p_path) returns text` | admin or manager | path must start with the row's `clinic_id/`; returns the **previous** path so the client can delete the old object; `null` clears |
| `delete_expense(p_expense) returns text` | admin or manager | hard delete; returns `receipt_path` so the client deletes the object |
| `create_payroll_run(p_clinic, p_month, p_lines jsonb) returns uuid` | admin or manager | `p_month` must be first-of-month and not in the future; `p_lines` = `[{therapist_id, billed_paise}]`, each therapist must belong to the clinic; base/share snapshotted from `therapist_compensation` (zero if no row); one run per month; audit `created` |
| `add_payroll_line(p_run, p_therapist, p_billed_paise) returns uuid` | admin or manager | draft only |
| `set_payroll_line(p_line, p_base_pay_paise, p_billed_paise, p_share_bps, p_note)` | admin or manager | draft only; recomputes `share_paise`, `net_paise` |
| `add_payroll_adjustment(p_line, p_kind, p_deduction_type, p_label, p_amount_paise) returns uuid` | admin or manager | draft only; recomputes line |
| `remove_payroll_adjustment(p_adjustment)` | admin or manager | draft only; recomputes line |
| `delete_payroll_run(p_run)` | admin or manager | draft only; writes audit `deleted` |
| `finalize_payroll_run(p_run)` | **admin only** (`hr_assert_admin`) | draft -> locked; sets `finalized_by/at`; audit `finalized` |
| `unlock_payroll_run(p_run, p_reason)` | **admin only** | locked -> draft; `p_reason` non-blank (min 5 chars after trim); `unlock_count + 1`; clears `finalized_*`; audit `unlocked` with reason |
| `list_my_payslips(p_clinic) returns jsonb` | the signed-in **therapist** (linked via `therapists.user_id = auth.uid()`) | requires `hr_enabled`; returns only that therapist's lines whose run is `locked`, with adjustments and period; no other therapist's data is reachable |

**Internal helpers (never callable by clients):** `hr_assert_manage`, `hr_assert_admin`, `hr_recompute_line(p_line)` (single place that derives `share_paise = (billed_paise * share_bps + 5000) / 10000` using integer division on non-negative bigints = round half up; sums signed adjustments; updates `net_paise`; bumps `updated_at`), `hr_write_audit(...)`. All are `revoke execute ... from public, anon, authenticated` and verified with `has_function_privilege('authenticated', oid, 'execute') = false`. This is **different from** `is_manager` / `hr_can_manage`, which RLS policies call as the invoking user and which therefore must stay executable; they return only a boolean about the caller.

**Why `list_my_payslips` is an RPC and not an `is_own_therapist` RLS policy on the payroll tables:** a therapist-visible policy on `payroll_lines` would have to read `payroll_runs.status` and `payroll_adjustments` through other RLS-protected tables (recursion/visibility problems unless more security-definer predicates are added), and every extra select policy widens the surface that must be tested. One RPC returns exactly the safe shape.

**Net formula (the only place it is defined):** `net = base_pay + share_paise + signed(adjustments)`; `signed` = `+amount` for `bonus` and `reimbursement`, `-amount` for `deduction`. The client mirrors this in `src/domain/payroll.ts` for live previews; the server value is authoritative.

### 3.6 Payroll flow

1. Manager/admin opens `/hr?tab=payroll`, picks a month, taps **Start payroll**.
2. Client reads `reportService.monthly(clinicId, month)` (Dexie), maps each active therapist's `TherapistMonthRow.billPaise` into `p_lines`, and calls `create_payroll_run`. The server fills base/share from `therapist_compensation`.
3. The grid shows per-therapist `Base + Share (billed x %) +/- Adjustments = Net`. **Billed and share % are editable per line** (`set_payroll_line`), as are typed adjustments (bonus / reimbursement / deduction with `lop`, `advance_recovery`, `professional_tax`, `tds`, `other`). Responsive: inline-edit grid at tablet and up (`tab:` breakpoint); stacked per-therapist cards with the same summary line at phone width.
4. Manager can edit until an admin **Finalizes**. A locked run is read-only everywhere (RPCs reject; UI disables).
5. Admin **Unlock** requires a reason and writes `payroll_audit` (who, when, why). The run history shows the audit trail.
6. A locked run offers a printable **payslip** per therapist (reusing print-page chrome from `src/features/invoices/printChrome.tsx`).
7. Therapists see their own locked payslips in **My Payslips**.

Billed figures are a **snapshot at run creation** (the reported month can shift when backdated visits arrive); the line stays editable while draft, and "Refresh billed" in the UI simply re-reads Dexie and calls `set_payroll_line`.

### 3.7 Expenses

Entry form: date, category, class (operating or equipment), amount, vendor, payment mode, note, optional photo. The photo goes through `resizeImageToBlob(file, 1200, 0.7)` (`src/lib/resizeImage.ts`), is uploaded to `hr-receipts` at `${clinicId}/${expenseId}-${Date.now()}.jpg`, then `set_expense_receipt` records the path. Deleting an expense calls `delete_expense`, then removes the returned object from storage. List is filterable by month and category.

**Month summary + CSV:** Income is the clinic's own share (`clinicSharePaise` after the partner-hospital share, from `reportService.monthly().total`), **not** gross billed; gross billed is shown next to it so the difference is visible. Indicative net = clinic share - expenses - locked payroll net. "Export month P&L (CSV)" produces rows for income, each expense, and payroll totals. No depreciation, no tax meters.

### 3.8 My Payslips and printing

`MyPayslipsSheet` (account menu, therapist role, `hrEnabled` only) calls `list_my_payslips`, lists months newest first, and shows a read-only breakdown. Payslip print route `/hr/payslip/$lineId/print` is admin/manager (fetches under RLS); a therapist's own printable view reuses the same component fed from `list_my_payslips` data.

### 3.9 Privacy invariants

| # | Invariant | Enforcement |
|---|---|---|
| P1 | Compensation, expenses and all `payroll_*` data are **never** written to Dexie, `localStorage`, the outbox, or backup export. | Not in `ALL_SYNCED_TABLES`/`CLIENT_WRITABLE_TABLES`; `hrService` uses the Supabase client directly and holds results in React state only; test asserts no `db.tables` name matches and that `db.tables` are unchanged after HR service calls. |
| P2 | Compensation is not a column on `therapists`. | Schema (separate table). |
| P3 | A therapist can never read a colleague's payslip, nor an unlocked one, nor compensation. | No therapist RLS; `list_my_payslips` scoped to `auth.uid()` and `status='locked'`. |
| P4 | Receipts are private; only admin/manager of that clinic (and only while `hr_enabled`) can read/write. | Private bucket + policies keyed on the first folder. |
| P5 | Clinic isolation: a manager of clinic A cannot touch clinic B. | `hr_can_manage` takes the target row's clinic id; RPC tests with two clinics. |
| P6 | Flipping `hr_enabled` off blocks reads too, not only writes. | `hr_can_manage` embeds the flag. |

### 3.10 Non-goals / known limits (Phase 1)

- Managers can still **read** clinical rows over the wire (RLS `is_clinic_member`), exactly as front desk can today; the UI hides them. Tightening `consultation_notes_select`/`visits_select` for non-clinical roles is a separate hardening item, not in this phase.
- No therapist-facing editing of anything HR; no leave/attendance; no automated incentive, TDS or GST logic.

## 4. Phase 2: Leave + Attendance (short)

- `leave_requests` (calendar dates `from_date`..`to_date`, `half_day` flag, type, reason, `status` pending/approved/declined/cancelled, `decided_by/at`). Therapist requests, manager/admin decides. Approved leave **subtracts availability**: `get_booking_availability` (already exists) excludes those dates for that therapist; recurring weekday shifts remain in `therapist_shift_assignments` and are not duplicated.
- Approved leave suggests (never auto-applies) an `lop` payroll deduction on the matching month's draft run.
- Attendance: clock-in/out against the day's shift (`derive_working_hours` shape), optional geofence flag (warn, not block). Own-row writes via RPC; manager/admin read.
- Managers regain a Schedule nav item. Its own spec and plan.

## 5. Phase 3: Reviews + utilisation (short)

- Review form: admin/manager authored, therapist sees their own (RPC like `list_my_payslips`). Embeds billed totals and clinic-share profitability from `reportService`.
- Utilisation for reviews = completed visit minutes / scheduled shift minutes, with `duration_mins` added to `service_catalog` (the real table; the old spec's `billing_packages` was wrong) and **configurable** bands. Overlaps with the independent Reports-phase utilisation work; Phase 3 reuses that aggregator rather than re-implementing it. Its own spec and plan.

## 6. Documentation duties

Per `CLAUDE.md`, `FEATURES_AND_SCHEMA.md` (both duplicated copies of each affected section) is updated in the same change: Team & Permissions (manager role), Settings (HR card), new "HR & Payroll" feature section, Database Schema (new tables/RPCs/bucket), App Routes, and a Key Design Pattern entry "Online-only private data (HR)".
