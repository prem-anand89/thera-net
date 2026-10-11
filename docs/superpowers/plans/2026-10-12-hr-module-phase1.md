# HR Module Phase 1 Implementation Plan (Gate, Manager Role, Compensation, Expenses, Payroll)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an opt-in HR module for a clinic: an admin enables `clinics.hr_enabled`, invites a `manager`, and admin or manager records therapist compensation, enters clinic expenses (with resized receipt photos in a private bucket), and runs monthly payroll as draft -> locked (only an admin finalizes or unlocks, unlock needs a reason and is audited). Therapists see only their own locked payslips.

**Architecture:** Five new Postgres tables (`therapist_compensation`, `expenses`, `payroll_runs`, `payroll_lines`, `payroll_adjustments`) plus `payroll_audit`, all **online-only** (never in Dexie, never in `ALL_SYNCED_TABLES`/`CLIENT_WRITABLE_TABLES`), read by admin/manager through RLS `select` policies and written exclusively through `security definer` RPCs that re-check `hr_enabled` and role server-side. A private `hr-receipts` bucket holds receipt JPEGs. A therapist reads payslips through one scoped RPC (`list_my_payslips`), not table RLS. The client talks to these through a new `hrService` (Supabase client directly, results in React state only). Billed totals come from the existing `reportService.monthly()` (Dexie). The `manager` role is threaded through every role union and hard-coded role check.

**Tech Stack:** Postgres/Supabase (`security definer` RPCs, RLS, Storage), Deno edge function (`invite-therapist`), React 18 + TypeScript, TanStack Router, Tailwind, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-12-hr-module-design.md`

## Global Constraints

- **Migrations need two things:** applied live (Supabase MCP `apply_migration`, or `supabase db push`) **and** a committed file in `supabase/migrations/` named `YYYYMMDDNNNNNN_description.sql`. This plan uses `20261012090000` onward; check `ls supabase/migrations | tail` first and bump if a later file exists. If the MCP apply is declined/unavailable, hand the SQL to the user to run, then verify live with `execute_sql` and reconcile `supabase_migrations.schema_migrations`.
- **Lesson (a) - helper privileges.** Internal mutator/guard functions (`hr_assert_manage`, `hr_assert_admin`, `hr_recompute_line`, `hr_write_audit`) are `revoke execute ... from public, anon, authenticated`, and each migration ends with a verification query using `has_function_privilege('authenticated', '<signature>', 'execute')` that must return `false`. The read-only boolean predicates that RLS calls as the invoking user (`is_manager`, `hr_can_manage`) are the deliberate exception and stay executable by `authenticated`, exactly like `is_clinic_admin`/`is_front_desk`; they return only a boolean about the caller and take no write path.
- **Lesson (b) - `updated_at`.** Every RPC write sets `updated_at = now()` on every row it touches (including the parent run when a line or adjustment changes), and each new table gets the `set_updated_at` trigger from `20260702000001_init.sql`. Each migration's verification block asserts `updated_at` advanced.
- **Lesson (c) - CHECK/NULL traps.** A CHECK passes when its expression is NULL. Every CHECK that must reject missing data uses `coalesce(...)` or compares two NOT NULL operands, and every RPC rejects null arguments explicitly (`if p_x is null then raise ...`). Each constraint and RPC has a null-input test in the migration's verification SQL (executed against live) - e.g. `unlock_payroll_run(run, null)` and `unlock_payroll_run(run, '   ')` must both fail.
- **Lesson (d) - Review Focus ownership.** Each Review Focus item below names its owning test file; a task is not done until that test exists and fails without the fix.
- **Lesson (e) - mocks.** Component tests that exercise `useLiveQuery` mock it synchronously, `vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }))`, and mock `@/services` repos with **synchronous** returns (pattern: `src/features/settings/ShiftAssignmentsSection.test.tsx`). `hrService` is mocked with plain `vi.fn()`s returning resolved promises.
- **Lesson (f) - duplicated unions.** The role union and nav/route lists are copied across files. Before and after Task 5, run:
  `grep -rnE "'front_desk'|\"front_desk\"|'admin' \| 'therapist'|Exclude<ClinicRole" src supabase/functions --include=*.ts --include=*.tsx` and `grep -rnE "role (===|!==) '(admin|front_desk|therapist)'" src` and account for **every** hit (update it or document why a manager correctly does not match it). The known set at planning time: `useClinicRole.ts` (union + cast), `usePermissions.ts`, `useWorkspaceScope.ts`, `Shell.tsx` (nav filter, redirects, NotificationBell, phone bar), `MorePage.tsx`, `AccountMenu.tsx`, `SchedulePage.tsx:116`, `InvoicePrintPage.tsx:348`, `MyNotificationsSheet.tsx`, `NewVisitPage.tsx`, `SettingsPage.tsx` (`ROLE_ACCENT`, two role `<select>`s, last-admin counts), `router.tsx` (index redirect), `navActive.ts`, `supabase/functions/invite-therapist/index.ts`, `supabase/functions/send-push/index.ts:66` (recipient roles - manager intentionally excluded), and tests `AccountMenu.test.tsx`, `me.test.tsx`.
- **Privacy:** compensation, expenses and payroll data are never written to Dexie, `localStorage`, `sessionStorage`, the outbox or the backup export. `src/lib/db.ts` is not touched by this plan (no Dexie version bump: `hrEnabled` is a non-indexed field on the existing `clinics` store).
- Every `<button>` has an explicit `type` (use `<Button type="button">` from `src/components/Button.tsx` in new code). Run `npm run typecheck && npm run lint && npm run test` after every task touching `src/`, and `npm run build` after Tasks 7, 8, 12, 13 (routing/nav/shared components) and at the end.
- Update `FEATURES_AND_SCHEMA.md` in the same change (Task 14) - **both** duplicated copies of every section touched (the file contains each of sections 9b/10, Application Architecture, App Routes and Database Schema twice; `grep -n "^### 9b\\." FEATURES_AND_SCHEMA.md` shows both).
- Use existing money helpers (`Paise`, `paiseToRupees`, `roundToRupeeHalfUp` in `src/domain/money.ts`) and the repo's date-display conventions (FEATURES_AND_SCHEMA.md "Date Display: Short On-Screen, Full On Paper"); never format money with raw floats.
- Supabase returns `bigint` as JS `number`; paise values stay far below 2^53, so no BigInt handling is needed, but never do float math on them (`Math.round(x * pct)` is forbidden; use integer basis-point math from `src/domain/payroll.ts`).

## Review Focus

- **A manager attempts `finalize_payroll_run` / `unlock_payroll_run` via direct RPC** (bypassing the hidden button). Must raise `42501`. Owner: live SQL verification in Task 3 plus `src/services/hrService.test.ts` (UI hides the controls for manager).
- **`unlock_payroll_run` with a NULL, empty or whitespace reason.** A naive `check (length(btrim(reason)) > 0)` evaluates to NULL for NULL and passes. Must fail at both the RPC and the `payroll_audit` CHECK. Owner: Task 3 live SQL null-input block.
- **An RPC edit that forgets `updated_at`** on the parent run when a line/adjustment changes - harmless today (tables are not synced) but the invariant must hold for future sync. Owner: Task 3 live SQL `updated_at` assertions.
- **`hr_enabled = false`** for an admin or a manager: every RPC, every table select and every storage operation must refuse; re-enabling restores access to the existing rows unchanged. Owner: Task 3/4 live SQL; `src/app/usePermissions.test.ts` for the client gate.
- **Cross-clinic leakage:** a manager of clinic A passing clinic B's run/line/expense id to an RPC. The RPC must resolve the clinic from the row and assert on that clinic. Owner: Task 3 live SQL with two clinics.
- **Compensation reaching IndexedDB** via a future `repos` addition or backup export. Owner: `src/services/hrService.privacy.test.ts` (asserts `db.tables` names and that calling every `hrService` method leaves all Dexie tables and `localStorage` untouched).
- **Receipt path outside the clinic folder** (`otherClinicId/x.jpg`) passed to `set_expense_receipt`, and an old receipt orphaned on replace/delete. Owner: Task 4 live SQL + `src/features/hr/ExpenseForm.test.tsx` (old path deleted after replace; delete removes object).
- **Manager role missed in a hard-coded check** (e.g. a manager sees the booking bell, the Reports tab, `/workspace` data of other therapists, or gets a `therapists` row). Owners: `src/app/useWorkspaceScope.test.ts`, `src/app/usePermissions.test.ts`, `src/app/navActive.test.ts`, `src/app/AccountMenu.test.tsx`, `src/features/more/MorePage.test.tsx`, edge-function role-validation unit test in Task 6.
- **Payroll rounding / sign errors:** share = round-half-up of `billed * bps / 10000`; deductions subtract, bonus and reimbursement add; net never computed in two places differently. Owner: `src/domain/payroll.test.ts` and the Task 3 SQL block comparing the SQL result to the same fixtures.
- **A therapist with no `therapist_compensation` row, a run month with no billed visits, or a clinic with zero active therapists.** Payroll start must produce zero-valued lines / a friendly empty state, not a crash or a NULL net. Owner: `src/features/hr/PayrollPage.test.tsx`, `src/domain/payroll.test.ts`.
- **A therapist opens My Payslips for a run an admin has since unlocked.** The payslip must disappear (list shows only `locked`). Owner: Task 3 live SQL.

---

## File Structure

New files:
- `supabase/migrations/20261012090000_hr_foundation.sql` - `hr_enabled`, `manager` role, predicates and assert helpers.
- `supabase/migrations/20261012091000_hr_schema.sql` - tables, triggers, RLS.
- `supabase/migrations/20261012092000_hr_rpcs_compensation_expenses.sql` - compensation and expense RPCs.
- `supabase/migrations/20261012093000_hr_rpcs_payroll.sql` - payroll RPCs, recompute/audit helpers, `list_my_payslips`.
- `supabase/migrations/20261012094000_hr_receipts_bucket.sql` - private bucket + storage policies.
- `src/domain/payroll.ts` (+ `payroll.test.ts`) - pure integer money math and types.
- `src/domain/expenseExport.ts` (+ `expenseExport.test.ts`) - month P&L CSV builder.
- `src/services/hrService.ts` (+ `hrService.test.ts`, `hrService.privacy.test.ts`) - online-only Supabase wrapper.
- `src/features/hr/HrPage.tsx` - tabbed shell, guards itself.
- `src/features/hr/TeamPayPanel.tsx` (+ test) - compensation editor.
- `src/features/hr/ExpensesPanel.tsx`, `ExpenseForm.tsx` (+ `ExpenseForm.test.tsx`), `ReceiptThumb.tsx` - expenses UI.
- `src/features/hr/PayrollPage.tsx` (+ `PayrollPage.test.tsx`), `PayrollLineCard.tsx`, `PayrollLineRow.tsx`, `AdjustmentSheet.tsx`, `UnlockDialog.tsx`.
- `src/features/hr/PayslipPrintPage.tsx`, `src/features/hr/PayslipView.tsx` - printable payslip.
- `src/features/me/MyPayslipsSheet.tsx` (+ test) - therapist read-only sheet.
- `src/app/usePermissions.test.ts`, `src/app/useWorkspaceScope.test.ts`, `src/features/more/MorePage.test.tsx` (if absent).

Modified files:
- `src/domain/types.ts` - `Clinic.hrEnabled`.
- `src/app/useClinicRole.ts`, `src/app/usePermissions.ts`, `src/app/useWorkspaceScope.ts` - manager role + `canManageHr`, `canFinalizePayroll`.
- `src/app/Shell.tsx`, `src/app/AccountMenu.tsx`, `src/app/navActive.ts`, `src/app/router.tsx`, `src/features/more/MorePage.tsx` - nav, routes, landing.
- `src/features/settings/SettingsPage.tsx`, `src/features/settings/sections.ts`, `src/features/settings/sections.test.ts` - HR toggle card, role selects, role pill.
- `supabase/functions/invite-therapist/index.ts` - manager role.
- `src/app/AccountMenu.test.tsx`, `src/features/me/me.test.tsx` - manager and HR rows.
- `FEATURES_AND_SCHEMA.md`, `README.md`.

---

### Task 1: Foundation migration (gate, manager role, predicates)

**Files:**
- Create: `supabase/migrations/20261012090000_hr_foundation.sql`

**Interfaces:**
- Consumes: `public.is_clinic_admin`, `public.is_clinic_member` (`20260702000001_init.sql`), constraint `clinic_members_role_check` (`20260815000001_role_model_and_visit_rls.sql`), trigger `guard_clinic_members_role_change` (`20260816000002_member_display_name.sql`).
- Produces: `clinics.hr_enabled boolean not null default false`; role `'manager'`; `public.is_manager(uuid)`, `public.hr_can_manage(uuid)` (both executable by `authenticated`); `public.hr_assert_manage(uuid)`, `public.hr_assert_admin(uuid)` (NOT executable by `authenticated`).

- [ ] **Step 1: Check current live state before writing SQL.**
  `execute_sql`: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.clinic_members'::regclass and contype='c';` and `select column_name from information_schema.columns where table_name='clinics' and column_name='hr_enabled';` (expect none). Confirm the constraint name is still `clinic_members_role_check`.
- [ ] **Step 2: Write the migration** using the exact SQL in spec section 3.4 "Gate + role" (alter `clinics`, drop/re-add the role CHECK, `is_manager`, `hr_can_manage`, `hr_assert_manage`, `hr_assert_admin`). Append:

```sql
revoke execute on function public.hr_assert_manage(uuid) from public, anon, authenticated;
revoke execute on function public.hr_assert_admin(uuid)  from public, anon, authenticated;
-- is_manager / hr_can_manage: called from RLS as the invoking user, so keep authenticated.
revoke execute on function public.is_manager(uuid)       from public, anon;
revoke execute on function public.hr_can_manage(uuid)    from public, anon;
grant  execute on function public.is_manager(uuid)       to authenticated;
grant  execute on function public.hr_can_manage(uuid)    to authenticated;
```

- [ ] **Step 3: Apply live**, then verify with `execute_sql`:
  - `select has_function_privilege('authenticated','public.hr_assert_manage(uuid)','execute'), has_function_privilege('authenticated','public.hr_assert_admin(uuid)','execute');` -> both `false`.
  - `has_function_privilege('authenticated','public.hr_can_manage(uuid)','execute')` -> `true`; same for `public.is_manager(uuid)`; `anon` -> `false` for both.
  - `insert`/`update` a throwaway `clinic_members` row with role `manager` succeeds; role `'bogus'` fails.
  - As an `authenticated` session impersonating a **manager** (`set local role authenticated; set local request.jwt.claims = '{"sub":"<uid>"}'`): `select hr_can_manage('<clinic>')` is `false` while `hr_enabled=false`, `true` after `update clinics set hr_enabled=true`.
  - Null input: `select hr_can_manage(null)` returns `false` (not an error, not `true`).
  - A manager calling `update clinic_members set role='admin'` on their own row is rejected by `guard_clinic_members_role_change`.
- [ ] **Step 4: Commit** `feat(hr): add hr_enabled gate, manager role and HR predicates`.

---

### Task 2: HR schema migration (tables, triggers, RLS)

**Files:**
- Create: `supabase/migrations/20261012091000_hr_schema.sql`

**Interfaces:**
- Consumes: Task 1 predicates; `public.set_updated_at()`.
- Produces: tables `therapist_compensation`, `expenses`, `payroll_runs`, `payroll_lines`, `payroll_adjustments`, `payroll_audit`, each with RLS enabled and a single `select` policy `using (hr_can_manage(clinic_id))`; **no** insert/update/delete policies.

- [ ] **Step 1: Write the migration** with the exact DDL from spec section 3.4 (Compensation, Expenses, Payroll, RLS). Add for every table:
  `create trigger <table>_updated before insert or update on public.<table> for each row execute function public.set_updated_at();` (check how `20260702000001_init.sql:144` attaches it and mirror it).
- [ ] **Step 2: Apply live** and verify:
  - `select tablename, policyname, cmd from pg_policies where tablename in (...)` -> exactly one `SELECT` policy per table, nothing else.
  - As authenticated therapist / front-desk: `select count(*) from payroll_lines` returns 0 rows (RLS), and `insert` fails.
  - **NULL traps:** `insert into payroll_audit(..., action, reason) values (..., 'unlocked', null)` must FAIL; same with `'   '`; `'created'` with null reason must succeed. `insert into payroll_adjustments(kind, deduction_type, ...)` with `('deduction', null)` and `('bonus','tds')` must both FAIL; `('deduction','tds')` and `('bonus', null)` succeed. `period_month` of `2026-10-15` must FAIL; `2026-10-01` succeeds. `status='locked'` with `finalized_at null` must FAIL. `receipt_path` starting with another clinic id must FAIL.
  - `net_paise` mismatch (`base 100, share 50, adj 10, net 1`) must FAIL.
- [ ] **Step 3: Commit** `feat(hr): add compensation, expense and payroll tables with read-only RLS`.

---

### Task 3: Compensation, expense and payroll RPCs

**Files:**
- Create: `supabase/migrations/20261012092000_hr_rpcs_compensation_expenses.sql`
- Create: `supabase/migrations/20261012093000_hr_rpcs_payroll.sql`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces (all `security definer set search_path = public`, `revoke ... from public, anon`, `grant execute ... to authenticated`):
  `upsert_therapist_compensation(uuid, uuid, bigint, integer, text) returns uuid`,
  `create_expense(uuid, date, text, text, bigint, text, text, text) returns uuid`,
  `update_expense(uuid, date, text, text, bigint, text, text, text) returns void`,
  `set_expense_receipt(uuid, text) returns text`, `delete_expense(uuid) returns text`,
  `create_payroll_run(uuid, date, jsonb) returns uuid`, `add_payroll_line(uuid, uuid, bigint) returns uuid`,
  `set_payroll_line(uuid, bigint, bigint, integer, text) returns void`,
  `add_payroll_adjustment(uuid, text, text, text, bigint) returns uuid`, `remove_payroll_adjustment(uuid) returns void`,
  `delete_payroll_run(uuid) returns void`, `finalize_payroll_run(uuid) returns void`,
  `unlock_payroll_run(uuid, text) returns void`, `list_my_payslips(uuid) returns jsonb`.
  Internal (NOT executable by authenticated): `hr_recompute_line(uuid)`, `hr_write_audit(uuid, uuid, text, text)`.

- [ ] **Step 1: Write the compensation/expense migration.** Pattern for each RPC (copy structure from `20261011091000_shift_scheduling_admin_rpcs.sql`):

```sql
create or replace function public.upsert_therapist_compensation(
  p_clinic uuid, p_therapist uuid, p_base_pay_paise bigint, p_share_bps integer, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform hr_assert_manage(p_clinic);
  if p_therapist is null or p_base_pay_paise is null or p_share_bps is null then
    raise exception 'Therapist, base pay and share are required';
  end if;
  if not exists (select 1 from therapists where id = p_therapist and clinic_id = p_clinic) then
    raise exception 'That therapist does not belong to this clinic';
  end if;
  insert into therapist_compensation (clinic_id, therapist_id, base_pay_paise, share_bps, notes, updated_by)
  values (p_clinic, p_therapist, p_base_pay_paise, p_share_bps, nullif(btrim(p_notes), ''), auth.uid())
  on conflict (clinic_id, therapist_id) do update
    set base_pay_paise = excluded.base_pay_paise, share_bps = excluded.share_bps,
        notes = excluded.notes, updated_by = auth.uid(), updated_at = now()
  returning id into v_id;
  return v_id;
end $$;
```

  Expense RPCs: resolve clinic from the row (`select clinic_id into v_clinic from expenses where id = p_expense; if not found then raise ...`) then `hr_assert_manage(v_clinic)`. `set_expense_receipt` rejects a non-null path not starting with `v_clinic::text || '/'` and returns the previous path. `delete_expense` returns the receipt path it removed. Date validation: not null, `<= current_date + 1`.
- [ ] **Step 2: Write the payroll migration.**
  - `hr_recompute_line(p_line)`: in one `UPDATE` set `share_paise = (billed_paise * share_bps + 5000) / 10000`, `adjustments_paise = coalesce((select sum(case kind when 'deduction' then -amount_paise else amount_paise end) from payroll_adjustments where line_id = p_line), 0)`, `net_paise = base_pay_paise + share_paise + adjustments_paise` - because the table CHECK compares columns of the same row, compute `net` from the new values in a CTE and update all three columns in a **single statement**; also `updated_at = now()` and `update payroll_runs set updated_at = now()` for the parent.
  - `create_payroll_run`: reject null month, non-first-of-month, `p_month > date_trunc('month', current_date)::date`, empty/null `p_lines`; for each element require `therapist_id` in the clinic and `billed_paise >= 0` (null -> error); snapshot `therapist_name` from `therapists.name`; base/share from `therapist_compensation` via `coalesce(..., 0)`; insert run + lines; call `hr_recompute_line` per line; `hr_write_audit(..., 'created', null)`. Unique-violation on `(clinic_id, period_month)` -> friendly `raise exception 'A payroll run already exists for that month'`.
  - Draft-only RPCs share one guard: `if v_run.status <> 'draft' then raise exception 'This payroll run is locked. An admin must unlock it first.'`.
  - `finalize_payroll_run`: `hr_assert_admin`; must be draft; has >= 1 line; sets `status='locked', finalized_by=auth.uid(), finalized_at=now(), updated_at=now()`; audit `finalized`.
  - `unlock_payroll_run`: `hr_assert_admin`; `if coalesce(length(btrim(p_reason)),0) < 5 then raise exception 'A reason of at least 5 characters is required'`; must be locked; set `status='draft', finalized_by=null, finalized_at=null, unlock_count=unlock_count+1, updated_at=now()`; audit `unlocked` with `btrim(p_reason)`.
  - `delete_payroll_run`: draft only; audit `deleted` **before** the delete (audit has no FK).
  - `list_my_payslips(p_clinic)`: null -> error; `if not coalesce((select hr_enabled from clinics where id = p_clinic), false) then raise`; find `therapists.id where clinic_id = p_clinic and user_id = auth.uid()`; if none return `'[]'::jsonb`; return `jsonb_agg` of `{run_id, line_id, period_month, therapist_name, base_pay_paise, billed_paise, share_bps, share_paise, adjustments_paise, net_paise, adjustments:[{kind, deduction_type, label, amount_paise}], finalized_at}` ordered by `period_month desc`, joining only `payroll_runs.status = 'locked'`.
  - Final block of the migration: the `revoke`/`grant` statements for every RPC and `revoke execute on function public.hr_recompute_line(uuid), public.hr_write_audit(uuid, uuid, text, text) from public, anon, authenticated;`.
- [ ] **Step 3: Apply both live, then run the verification script via `execute_sql`** (record the exact queries in the commit body or a `-- verification` comment block at the bottom of the migration file):
  1. `has_function_privilege('authenticated', ...)` is `false` for `hr_recompute_line`, `hr_write_audit`, `hr_assert_manage`, `hr_assert_admin`; `true` for each public RPC; `anon` is `false` for every one.
  2. Role matrix, impersonating each of admin / manager / therapist / front_desk in clinic A with `hr_enabled=true`: admin and manager succeed at create/edit/delete; manager `finalize_payroll_run` and `unlock_payroll_run` raise `42501`; therapist and front_desk fail at every RPC except `list_my_payslips` (therapist) which returns only their own locked lines.
  3. `hr_enabled=false`: every RPC fails for admin and manager; re-enable and the earlier rows are intact.
  4. Two-clinic isolation: manager of A calls `set_payroll_line`, `delete_expense`, `set_expense_receipt` with B's ids -> fails.
  5. Null inputs: each RPC with a null id / null amount / null month fails with a readable message, never silently succeeds. `unlock_payroll_run(id, null)`, `(id, '')`, `(id, '  ab ')` all fail.
  6. Math fixtures (must equal `src/domain/payroll.test.ts`): billed 123456, bps 3333 -> share 41147 (`(123456*3333+5000)/10000`); base 20000_00 + share + bonus 500_00 + reimbursement 120_00 - deduction (`tds`) 300_00 -> hand-computed net; a clinic with no compensation row yields base 0 and share 0 and `net = adjustments`.
  7. `updated_at`: capture `updated_at` of the run, line and adjustment before and after each mutating RPC; each touched row strictly advances (`pg_sleep(0.01)` between steps).
  8. Lock: after finalize, `set_payroll_line`, `add_payroll_adjustment`, `remove_payroll_adjustment`, `delete_payroll_run` all fail; after unlock they succeed; `payroll_audit` has `created, finalized, unlocked(reason)` in order; `list_my_payslips` omits the unlocked run for the therapist.
- [ ] **Step 4: Commit** `feat(hr): add compensation, expense and payroll RPCs`.

---

### Task 4: Private receipts bucket

**Files:**
- Create: `supabase/migrations/20261012094000_hr_receipts_bucket.sql`

**Interfaces:**
- Consumes: `hr_can_manage`; `storage.foldername` pattern from `20260702000001_init.sql:361`.
- Produces: private bucket `hr-receipts` (1 MiB limit, `image/jpeg` only) with select/insert/delete policies for admin/manager of the folder's clinic. No update policy.

- [ ] **Step 1: Write the migration** using the exact storage SQL from spec section 3.4.
- [ ] **Step 2: Apply live** and verify with `execute_sql` (`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='hr-receipts'` -> `public=false`). Then verify with the **storage API** from a scratch script using real user JWTs (document commands in the commit body): manager upload to `${clinicA}/probe.jpg` succeeds; therapist upload/read/list/delete fails; manager of A uploading to `${clinicB}/probe.jpg` fails; a path whose first folder is not a uuid (`junk/probe.jpg`) fails (policy cast error denies); `getPublicUrl` fetch returns 400/404; `createSignedUrl` for a manager works; with `hr_enabled=false` the same manager read fails; a 2 MB upload fails on the size limit. Clean up probe objects.
- [ ] **Step 3: Commit** `feat(hr): add private hr-receipts storage bucket`.

---

### Task 5: Role plumbing (types, hooks, permissions, scope)

**Files:**
- Modify: `src/domain/types.ts` (add `hrEnabled?: boolean` beside `billingEnabled`, ~line 85, with a doc comment "client display gate only; every HR RPC re-checks server-side")
- Modify: `src/app/useClinicRole.ts`, `src/app/usePermissions.ts`, `src/app/useWorkspaceScope.ts`
- Create/Modify tests: `src/app/usePermissions.test.ts`, `src/app/useWorkspaceScope.test.ts`

**Interfaces:**
- Consumes: Task 1 `manager` role value.
- Produces: `ClinicRole = 'admin' | 'therapist' | 'front_desk' | 'manager' | 'unknown'`; `CLINIC_ROLE_LABELS.manager = 'Manager'`; `WorkspaceScope.isManager`; `Permissions.isManager`, `canManageHr`, `canFinalizePayroll`.

- [ ] **Step 1: Write failing tests first.**
  - `useWorkspaceScope.test.ts` (mock `useClinic`, `useSession`, `useClinicRole`, `useLiveQuery` synchronously, `repos.therapists.list` synchronous): manager -> `isManager true`, `isAdmin false`, `isClinicWideView false`, `scopeTherapistId === '00000000-0000-0000-0000-000000000000'`, `myTherapistId undefined`, `isUnlinkedTherapist false` (a manager is not an unlinked therapist). Admin and front desk unchanged.
  - `usePermissions.test.ts` (mock `useClinic`, `useWorkspaceScope`, `useEntitlements`): manager with `hrEnabled true` -> `canManageHr true`, `canFinalizePayroll false`, `canViewClinicalNotes false`, `canBill false`, `canEditSettings false`, `canViewPayouts false`; admin with `hrEnabled true` -> `canManageHr true`, `canFinalizePayroll true`; admin with `hrEnabled` undefined/false -> both false; therapist/front desk -> both false.
- [ ] **Step 2: Implement.** In `useClinicRole.ts` widen the union, `CLINIC_ROLE_LABELS`, and the `.then(({ data }: { data: { role: 'admin' | 'therapist' | 'front_desk' | 'manager'; ...` cast (derive it from `Exclude<ClinicRole,'unknown'>` instead of re-spelling the union). In `useWorkspaceScope.ts` and `usePermissions.ts` do the same (`role: ClinicRole`). `canViewClinicalNotes: !scope.isFrontDesk && !scope.isManager`. `canBill` already fails for a manager only if the `invoicingAccess` branch is `scope.isAdmin || scope.isFrontDesk`; confirm and add a manager test case for `invoicingAccess: 'everyone'` (the first operand `invoicingAccess === 'everyone'` would otherwise let a manager bill - add `!scope.isManager &&` to `canBill`).
- [ ] **Step 3: Run the lesson (f) greps** (Global Constraints) and list every remaining hit in the commit message with its disposition. Do not move on until each is dispositioned. For this task fix only the hits that are hooks/types; later tasks own the rest.
- [ ] **Step 4:** `npm run typecheck && npm run lint && npm run test`. Commit `feat(hr): thread manager role through role/permission/scope hooks`.

---

### Task 6: `invite-therapist` edge function and Team settings UI

**Files:**
- Modify: `supabase/functions/invite-therapist/index.ts` (body type line 8, allow-list line 317, error text line 318, `linkTherapistRosterRow` call guarded by `role === 'therapist'` at ~line 495)
- Modify: `src/features/settings/SettingsPage.tsx` (`ROLE_ACCENT` ~line 2361, `RolePill`, both role `<select>`s at ~2800 and ~3040, `setBookable` effect ~2924, last-admin counts at ~3265/3370)
- Create: `supabase/functions/invite-therapist/roles.ts` + `roles.test.ts` (pure helper `isAllowedRole(role)` extracted so the allow-list is unit-testable; the Deno function imports it)

**Interfaces:**
- Consumes: Task 5 `ClinicRole`.
- Produces: invite accepts `manager`; manager invite creates **no** `therapists` row; Team UI can invite and re-role a member as Manager.

- [ ] **Step 1: Failing tests.** `roles.test.ts`: `isAllowedRole('manager') === true`, `'front_desk'`, `'admin'`, `'therapist'` true; `'owner'`, `''`, `undefined`, `null` false. A second test in `SettingsPage`-adjacent test (or a small pure `roleOptions.ts` helper + test) asserts the Team role options list contains Manager and that choosing Manager sets `bookable=false` and cannot be made bookable.
- [ ] **Step 2: Implement.** Allow-list -> `['admin','therapist','front_desk','manager']`; error message "must be admin, therapist, front_desk, or manager". Admin-only check at line 251 stays (`memberData.role !== 'admin'`; a manager cannot invite). `linkTherapistRosterRow` stays gated on `role === 'therapist'`. In `SettingsPage.tsx`: add `manager: 'amber'`? Use a distinct accent already in `ACCENT_VARS` (check available keys with `grep -n "ACCENT_VARS" src/features/settings/SettingsPage.tsx` and pick an unused one; if none free, reuse `'teal'` is NOT acceptable - add one). Add `<option value="manager">Manager</option>` to both selects, but render the option only when `clinic.hrEnabled` (otherwise a manager would have nothing to do). In the invite form disable the "bookable" toggle for manager (existing effect sets `false` for any non-therapist role; verify). Confirm the last-admin counters filter on `role === 'admin'` only (a manager is not an admin) - no change expected, add a comment-free test if a pure helper exists.
- [ ] **Step 3: Deploy** the edge function (`mcp__claude_ai_Supabase__deploy_edge_function` or `supabase functions deploy invite-therapist`); verify live: invite a manager to a scratch clinic, confirm `clinic_members.role='manager'` and **no** `therapists` row with that `user_id`; invite with role `owner` returns 400.
- [ ] **Step 4:** `npm run typecheck && npm run lint && npm run test`. Commit `feat(hr): invite and manage the manager role`.

---

### Task 7: Navigation, routes, landing (Shell, MorePage, AccountMenu, router, navActive)

**Files:**
- Modify: `src/app/Shell.tsx` (NAV array ~line 45, nav filter ~line 112, phone bar ~line 440, role redirects ~212-250, bell block ~line 400)
- Modify: `src/features/more/MorePage.tsx`, `src/app/AccountMenu.tsx`, `src/app/navActive.ts`, `src/app/router.tsx`
- Create: `src/features/hr/HrPage.tsx` (stub guard in this task: renders "HR" heading; full content arrives in Tasks 9-13)
- Tests: `src/app/navActive.test.ts` (extend), `src/app/AccountMenu.test.tsx` (extend), `src/features/more/MorePage.test.tsx` (create)

**Interfaces:**
- Consumes: Task 5 permissions.
- Produces: routes `/hr` (search `tab?: 'payroll' | 'expenses' | 'team-pay'`) and `/hr/payslip/$lineId/print`; `MainNavPath` and `PhoneTabPath` extended; account-menu rows "HR & payroll" (admin only, `canManageHr`) and "My payslips" (therapist, `clinic.hrEnabled`); MorePage row "HR & payroll"; manager nav/landing.

- [ ] **Step 1: Failing tests.**
  - `navActive.test.ts`: `isNavActive('/hr/payslip/x/print','/hr') === true`; `activePhoneTab('/hr') === '/hr'` (HR is a manager phone tab) while for the admin path HR is reached from More, so add an `isHrArea(pathname)` helper and assert `pageTitleFor('/hr') === 'HR'`.
  - `AccountMenu.test.tsx`: admin + `hrEnabled` -> "HR & payroll" link present; admin without `hrEnabled` -> absent; manager -> role label "Manager", no Settings link, no "HR & payroll" link in the menu (manager uses the header nav); therapist + `hrEnabled` -> "My payslips" button present, opens `MyPayslipsSheet` (mocked); therapist without `hrEnabled` -> absent. Update the existing `vi.mock('./clinicContext', ...)` to return `hrEnabled`.
  - `MorePage.test.tsx` (mock `usePermissions`): shows "HR & payroll" only when `canManageHr`; shows nothing HR for a therapist.
- [ ] **Step 2: Implement.**
  - `router.tsx`: add `hrRoute` (`path: '/hr'`, `validateSearch` accepting only the three tab strings, lazy `HrPage` like `SchedulePage` at line ~112) and `hrPayslipPrintRoute`; register both in `rootRoute.addChildren([...])` (line ~537). Change `indexRoute`'s redirect: managers cannot be known in `beforeLoad` (no hook there), so keep `/workspace` as the router default and add in `Shell.tsx` an effect: `if (role === 'manager' && (pathname === '/' || pathname.startsWith('/workspace') || pathname.startsWith('/schedule') || pathname.startsWith('/insights') || pathname.startsWith('/ledger') || pathname.startsWith('/patients')) ) navigate({ to: '/hr' })` once role is resolved (`role !== 'unknown'`, `!roleLoading`). Also redirect a non-HR user away from `/hr*` is done inside `HrPage` (see Task 9) and the print page.
  - `Shell.tsx`: add `{ to: '/hr', label: 'HR', Icon: <existing icon> }` to a separate `HR_NAV_ITEM` (do **not** add to `NAV`, which feeds admin/others); in the `nav` memo: for `role === 'manager'` return `[HR_NAV_ITEM]` only; otherwise existing filtering. Notification bell blocks stay `admin||front_desk` / `therapist` (manager gets none; leave unchanged and note it). Phone bar: for a manager render `PhoneTab to="/hr"` and `PhoneTab to="/more"` only (extend `PhoneTab`'s `to` union at ~line 492). Manager "+" new-visit button hidden.
  - `navActive.ts`: add `'/hr'` to `MainNavPath` and `PhoneTabPath`; `activePhoneTab`: `/hr` -> `'/hr'`; `PAGE_TITLES` gets `['/hr', 'HR']`. Keep `/more` mapping.
  - `MorePage.tsx`: add `canManageHr` from `usePermissions` and a `MoreItem to="/hr" label="HR & payroll"` (widen `MoreItem`'s `to` union). The existing `showReports = isAdmin || role === 'front_desk'` stays (manager excluded, intentional).
  - `AccountMenu.tsx`: add `useClinic().hrEnabled` row for admin (`<Link to="/hr">`), and for `role === 'therapist' && clinic.hrEnabled` a "My payslips" button opening `MyPayslipsSheet` (lazy import; sheet built in Task 13 - until then import a stub component file so the build passes). Reuse `rowCls`/`rowIcon`; every `<button>` has `type="button"`.
  - `SchedulePage.tsx:116` (`canSeeBookings = isAdmin || role === 'front_desk'`) and `InvoicePrintPage.tsx:348` need no change; add one-line assertions in Task 5's grep disposition list that they correctly exclude manager.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test && npm run build`. Commit `feat(hr): HR navigation, routes and manager landing`.

---

### Task 8: Settings toggle card

**Files:**
- Modify: `src/features/settings/sections.ts` (`SETTINGS_CARDS`), `src/features/settings/SettingsPage.tsx` (General tab; follow the `billingEnabled` form pattern at ~lines 1398-1530), `src/features/settings/sections.test.ts`

**Interfaces:**
- Consumes: `Clinic.hrEnabled`.
- Produces: General-tab card id `settings-card-general-hr` titled "HR & payroll" with a single toggle persisted through the same clinic-save path as `billingEnabled`.

- [ ] **Step 1: Failing test** in `sections.test.ts`: `matchSettingsCards('payroll')` returns the new card; `matchSettingsCards('manager')` too; every card id is unique and every card's tab exists (existing invariants must still pass).
- [ ] **Step 2: Implement.** Add `{ id: 'settings-card-general-hr', title: 'HR & payroll', tab: 'general', keywords: ['hr','payroll','salary','expenses','manager','payslip','leave'] }`. In `SettingsPage.tsx` add `'hrEnabled'` to the picked-form-keys union (next to `'billingEnabled'`), default `c.hrEnabled ?? false`, and a `SectionCard id="settings-card-general-hr"` with `Toggle`-style control copying the billing one, helper text: "Turns on expenses, payroll and the Manager role. Existing HR data is kept if you turn this off." Admin-only is already the case for Settings. After saving, nothing else is required: `Clinic` syncs to Dexie and `usePermissions` re-evaluates.
- [ ] **Step 3:** Browser check later (Task 14). `npm run typecheck && npm run lint && npm run test && npm run build`. Commit `feat(hr): Settings toggle for the HR module`.

---

### Task 9: Domain math and `hrService`

**Files:**
- Create: `src/domain/payroll.ts`, `src/domain/payroll.test.ts`, `src/domain/expenseExport.ts`, `src/domain/expenseExport.test.ts`
- Create: `src/services/hrService.ts`, `src/services/hrService.test.ts`, `src/services/hrService.privacy.test.ts`
- Modify: `src/services/index.ts` (`export { hrService };`)

**Interfaces:**
- Consumes: `getSupabase()` from `@/lib/supabase`; Task 3 RPC names.
- Produces (`src/domain/payroll.ts`): `shareFromBilled(billedPaise: number, shareBps: number): number` (integer round-half-up, same formula as SQL), `signedAdjustment(a: {kind; amountPaise}): number`, `lineNet(l: {basePayPaise; billedPaise; shareBps; adjustments}): { sharePaise; adjustmentsPaise; netPaise }`, types `PayrollLine`, `PayrollRun`, `PayrollAdjustment`, `AdjustmentKind`, `DeductionType`, `DEDUCTION_TYPES`, `EXPENSE_CATEGORIES`. `src/domain/expenseExport.ts`: `buildMonthPnlCsv({ monthLabel, clinicSharePaise, billedPaise, expenses, payrollNetPaise }): string` (RFC-4180 quoting, rupee amounts with 2 decimals via `paiseToRupees`). `hrService` methods: `listCompensation(clinicId)`, `upsertCompensation(...)`, `listExpenses(clinicId, month)`, `createExpense`, `updateExpense`, `attachReceipt(expenseId, clinicId, blob)`, `deleteExpense`, `receiptUrl(path)`, `listRuns(clinicId)`, `getRun(runId)`, `createRun(clinicId, month, lines)`, `setLine`, `addAdjustment`, `removeAdjustment`, `finalizeRun`, `unlockRun(runId, reason)`, `deleteRun`, `listAudit(runId)`, `listMyPayslips(clinicId)`.

- [ ] **Step 1: Failing tests.**
  - `payroll.test.ts` fixtures identical to Task 3 step 6: `shareFromBilled(123456, 3333) === 41147`; `shareFromBilled(0, 5000) === 0`; `shareFromBilled(1, 5000) === 1`? (`(1*5000+5000)/10000 = 1` - assert the half-up edge); bonus/reimbursement positive, deduction negative; `lineNet` with no adjustments, with all three kinds, with `shareBps 0`; **null/NaN guards:** `shareFromBilled(NaN, 10)` and negative inputs throw (never return `NaN` into UI).
  - `expenseExport.test.ts`: commas, quotes and newlines in vendor/note are quoted correctly; empty expense list still emits the header and income rows; amounts are two-decimal rupees.
  - `hrService.test.ts` (mock `@/lib/supabase`'s `getSupabase` to return a fake with `rpc`, `from().select()...`, `storage.from('hr-receipts')`): `unlockRun` rejects a blank reason client-side before calling `rpc`; each method maps snake_case rows to camelCase via `rowToDomain`; an RPC `error` is thrown as `Error(toFriendlyMessage(...))`-compatible; `deleteExpense` calls `rpc('delete_expense')` then `storage.remove([returnedPath])` and **skips** `remove` when the returned path is null; `attachReceipt` uploads to a path starting with `${clinicId}/` and `${expenseId}-` ending `.jpg`, calls `set_expense_receipt`, then removes the previous path if returned (owner of Review Focus "receipt orphaned").
  - `hrService.privacy.test.ts`: import `db` from `@/lib/db`; assert no `db.tables` name contains `compensation`, `expense`, `payroll`; install a spy on `localStorage.setItem`/`sessionStorage.setItem` and `indexedDB.open`; call every `hrService` method against the fake client; assert all spies were never called with HR data and every Dexie table count is unchanged (use `fake-indexeddb` if already a dev dependency, otherwise assert via `vi.spyOn(db, 'table')` not being called - check `package.json` and pick the one available).
- [ ] **Step 2: Implement** `payroll.ts` with integer arithmetic only (`Math.floor((billed * bps + 5000) / 10000)` on non-negative integers; guard `Number.isSafeInteger`). Implement `hrService` as a plain object created by `createHrService(getClient)` so tests inject the fake; results are returned, never cached at module scope.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test`. Commit `feat(hr): payroll math, CSV export and online-only hrService`.

---

### Task 10: HR page shell and Team pay (compensation)

**Files:**
- Modify: `src/features/hr/HrPage.tsx` (replace stub)
- Create: `src/features/hr/TeamPayPanel.tsx`, `src/features/hr/TeamPayPanel.test.tsx`, `src/features/hr/useHrGuard.ts`

**Interfaces:**
- Consumes: `usePermissions().canManageHr`, `useLiveQuery(() => repos.therapists.list(clinic.id))` (active therapists only), `hrService.listCompensation/upsertCompensation`.
- Produces: `HrPage` (guards itself like `ReportsPage.tsx`: while `role === 'unknown' || entitlementsLoading` render a skeleton; if `!canManageHr` render a "HR isn't enabled" notice with a link to `/workspace` - never silently blank; tabs `team-pay | expenses | payroll`, default `payroll`, URL search-param driven via `useSearch({ from: '/hr' })`); `TeamPayPanel`.

- [ ] **Step 1: Failing tests** `TeamPayPanel.test.tsx` (sync `useLiveQuery` and repo mocks): lists each active therapist with base pay (rupees) and share %; therapist with no compensation row shows "Not set" and saves as base 0 / share 0; entering share `33.33` stores `3333` bps (parse via integer math, reject > 100 and negatives, reject non-numeric with an inline message); save calls `hrService.upsertCompensation(clinicId, therapistId, basePaise, bps, notes)`; error from the service shows the friendly message and keeps the draft. `HrPage` guard test: `canManageHr=false` renders the notice and never calls `hrService`.
- [ ] **Step 2: Implement.** Money inputs convert rupees -> paise with `Math.round(Number(x) * 100)` only at the edit boundary after validating `^\d+(\.\d{1,2})?$` (no float accumulation anywhere else). Labels use "Share of billed %" with helper "Applied to each month's billed total; you can change it per month in payroll."
- [ ] **Step 3:** typecheck, lint, test. Commit `feat(hr): HR page shell and therapist compensation editor`.

---

### Task 11: Expenses (form, receipts, list, month summary, CSV)

**Files:**
- Create: `src/features/hr/ExpensesPanel.tsx`, `ExpenseForm.tsx`, `ReceiptThumb.tsx`, `ExpenseForm.test.tsx`, `ExpensesPanel.test.tsx`
- Modify: `src/features/hr/HrPage.tsx` (mount the tab)

**Interfaces:**
- Consumes: `hrService` (Task 9), `resizeImageToBlob(file, 1200, 0.7)` from `src/lib/resizeImage.ts`, `reportService.monthly(clinicId, month)` (`src/services/reportService.ts`, returns `MonthlyReport` with `total.billPaise` and `total.clinicSharePaise`), `FyMonth` and `monthName` from `src/domain/fiscalYear.ts`, `buildMonthPnlCsv`.
- Produces: expense CRUD UI, signed-URL receipt viewer, month P&L banner (clinic share vs billed shown side by side) and CSV download.

- [ ] **Step 1: Failing tests.**
  - `ExpenseForm.test.tsx` (mock `@/lib/resizeImage` to return a small Blob and spy on arguments): choosing a photo calls `resizeImageToBlob(file, 1200, 0.7)` **before** any upload; amount must be > 0 and a valid rupee value; class defaults to operating; save order is `createExpense` -> `attachReceipt`; if `attachReceipt` fails the expense still exists and the form shows "Saved, but the receipt didn't upload - retry" with a retry button (no duplicate expense on retry); replacing a receipt deletes the old object; non-image file is rejected before resize.
  - `ExpensesPanel.test.tsx`: month filter; category filter; delete asks for confirmation then calls `hrService.deleteExpense`; empty month shows a friendly empty state; summary shows **clinic share** as income with **billed** beside it, and net = clinic share - expenses - locked payroll net; a month with no payroll run shows payroll as "not run" and excludes it; a viewer without `canManageHr` never reaches this component (guard test in HrPage).
- [ ] **Step 2: Implement.** Receipt viewing: `hrService.receiptUrl(path)` -> `createSignedUrl(path, 300)`, fetched on demand when the thumbnail is opened, never stored. Camera input: `<input type="file" accept="image/*" capture="environment">`. CSV: `Blob` + temporary anchor download named `pnl-YYYY-MM.csv`. Layout follows the app's `tab:` breakpoint split (cards on phone, table at tablet+). Reuse `src/components/ui.tsx` primitives and `Button`.
- [ ] **Step 3:** typecheck, lint, test. Commit `feat(hr): expenses with resized private receipts and month P&L CSV`.

---

### Task 12: Payroll page (draft -> locked)

**Files:**
- Create: `src/features/hr/PayrollPage.tsx`, `PayrollLineRow.tsx` (tablet+ grid row with inline edit), `PayrollLineCard.tsx` (phone), `AdjustmentSheet.tsx`, `UnlockDialog.tsx`, `PayrollPage.test.tsx`
- Modify: `src/features/hr/HrPage.tsx`

**Interfaces:**
- Consumes: `hrService` run methods, `usePermissions().canFinalizePayroll`, `reportService.monthly`, `lineNet` from `src/domain/payroll.ts`.
- Produces: month picker, "Start payroll", editable lines, adjustments, Finalize (admin only), Unlock with reason (admin only), audit list, link to printable payslip.

- [ ] **Step 1: Failing tests** `PayrollPage.test.tsx` (sync mocks; `hrService` fakes): (1) Start payroll maps each active therapist's `billPaise` from `reportService.monthly` into `createRun`'s `lines` and includes therapists with no billed visits as `billedPaise: 0`; (2) zero active therapists -> empty state, "Start payroll" disabled; (3) manager (`canFinalizePayroll=false`) sees no Finalize/Unlock controls but can edit a draft; admin sees Finalize; (4) locked run: inputs disabled, no add/remove adjustment controls, shows "Locked by <name> on <date>"; (5) Unlock dialog: submit disabled until reason has >= 5 trimmed chars, whitespace-only keeps it disabled, success calls `unlockRun(runId, trimmedReason)`; (6) phone card shows `Base + Share ± Adjustments = Net` text and equals the grid's net for the same fixture; (7) editing billed/share % live-previews net using `lineNet` and the server value replaces it after save; (8) server error (e.g. "locked") surfaces via friendly message and reverts the field; (9) existing run for the month opens it instead of offering Start.
- [ ] **Step 2: Implement.** Responsive split at the `tab:` breakpoint using the shared card/table pattern (FEATURES_AND_SCHEMA.md "Responsive Breakpoints & the Mobile-Card/Table Split"). Billed figures labelled "Billed (snapshot)" with a "Refresh billed" action that re-reads `reportService.monthly` and calls `setLine`. Deduction type picker lists LOP, Advance recovery, Professional tax, TDS (helper: "Enter the amount your CA advises; no automatic calculation"), Other. Totals footer: sum of net, count of therapists. All `<button>`s typed.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test && npm run build`. Commit `feat(hr): payroll runs with draft/lock flow and audited unlock`.

---

### Task 13: Payslip print page and My Payslips

**Files:**
- Create: `src/features/hr/PayslipView.tsx`, `src/features/hr/PayslipPrintPage.tsx`, `src/features/me/MyPayslipsSheet.tsx`, `src/features/me/MyPayslipsSheet.test.tsx`
- Modify: `src/app/router.tsx` (wire `PayslipPrintPage` into the Task 7 route), `src/features/hr/PayrollPage.tsx` ("Print payslip" per locked line)

**Interfaces:**
- Consumes: `hrService.getRun`, `hrService.listMyPayslips`, `src/features/invoices/printChrome.tsx` print chrome conventions, `useClinic()` letterhead fields.
- Produces: `PayslipView({ clinicName, periodLabel, line, adjustments })` pure presentational component; admin/manager print route `/hr/payslip/$lineId/print` (guarded by `canManageHr`, shows only locked lines - a draft line shows "Finalize the run to issue payslips"); therapist `MyPayslipsSheet`.

- [ ] **Step 1: Failing tests.** `MyPayslipsSheet.test.tsx`: renders months newest first from `listMyPayslips`; empty list shows "No payslips yet"; shows the net and breakdown, no edit controls; a fetch error shows a retry; **does not render anything salary-related for a user without a linked therapist** (service returns `[]`). `PayslipView` snapshot-free test: renders base, share (`billed x %`), each adjustment with sign, and net equal to `lineNet`.
- [ ] **Step 2: Implement.** Dates short on screen, full on paper (existing convention). Print stylesheet via the same mechanism the invoice print pages use (`printChrome.tsx`). Therapist sheet is a bottom sheet on phone like `MyNotificationsSheet`.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test && npm run build`. Commit `feat(hr): printable payslips and therapist My Payslips`.

---

### Task 14: Docs, final verification and browser check

**Files:**
- Modify: `FEATURES_AND_SCHEMA.md` (both copies of each touched section), `README.md` (feature summary, one line)

- [ ] **Step 1: Docs.** Update in `FEATURES_AND_SCHEMA.md`: Team & Permissions (Manager role, invariants R1-R6), Settings & Configuration (HR card), a new feature section "HR & Payroll (Phase 1)", Application Architecture directory list (`src/features/hr`, `hrService`), App Routes (`/hr`, `/hr/payslip/$lineId/print`), Database Schema ("HR tables" with the DDL summary, RPC list with authorization, `hr-receipts` bucket), and a Key Design Pattern "Online-only private data (HR): never in Dexie; RPC-only writes; module gate re-checked server-side; helper-privilege rule". Use `grep -n` to find and edit **both** duplicated copies of each section. Add the one-line cross reference "Reports-phase utilisation and comparison work is specified separately."
- [ ] **Step 2: Full verification.** `npm run typecheck && npm run lint && npm run test && npm run build`. Re-run the lesson (f) greps and confirm no unaccounted hit. Re-run Task 1/3/4 live verification queries one final time against the live database (helper privileges, role matrix, `hr_enabled=false`, null inputs) and `get_advisors` (security) for the new tables/functions - fix any "RLS disabled" or "function search path" finding.
- [ ] **Step 3: Browser check** (use the `run` skill to launch the app, two profiles: admin and manager, plus a therapist): toggle the module in Settings -> General (nav rows appear/disappear for admin, More row on phone width); invite a manager (sees HR only, lands on `/hr`, no Reports/billing/clinical-notes affordances, no Schedule/Workspace data); set compensation; add an expense with a phone-sized photo and confirm the stored object is small (< 300 KB typical) and opens through a signed URL; delete the expense and confirm the storage object is gone; start payroll as manager, edit a line, add one adjustment of each kind; confirm Finalize is absent for the manager and present for the admin; finalize, try editing (blocked), unlock with and without a reason, confirm the audit list; print a payslip; sign in as a therapist and open My Payslips (own locked slip only, none after unlock); DevTools -> Application -> IndexedDB and Local Storage contain no compensation/expense/payroll data.
- [ ] **Step 4: Commit** `docs(hr): document the HR module in FEATURES_AND_SCHEMA and README`. Per repo memory preference, small changes go on `main`; this feature is large, so work on a branch `hr-module-phase1`, open a PR, and delete the branch after merge.
