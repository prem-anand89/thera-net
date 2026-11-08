# In-App Platform Admin Implementation Plan

**Status (2026-11-08):** Rewritten, not built (no `platform_superadmins` table or `admin_*` RPCs exist). Migration number corrected to `20261109100000`. Next after the Patient Profile work; the server part (Task 1) goes to Opus.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the founder monitor clinics and renewals, change plans and limits, record and void subscription payments, and lock or unlock clinics, from a phone or desktop inside the app.

**Architecture:** `public.platform_superadmins` names who may enter. `public.admin_*` SECURITY DEFINER RPCs check that server-side, then call the private `platform_admin` schema (already live) and log the action. The UI is one online-only route, `/platform-admin`, linked from the account menu for superadmins only.

**Tech Stack:** PostgreSQL (Supabase), React 19, TypeScript, TanStack Router, Vitest, Testing Library.

**Spec:** "Decisions" below (owner decisions, 2026-11-06), building on `20261106100000_platform_admin_subscriptions.sql`.

## Decisions

1. **Two tabs:** Clinics (opens on "Needs attention") and Payments. Tapping a clinic opens a detail sheet with usage, its payments, its history and all its actions. There is no separate Renewals or Audit tab.
2. **No multi-factor login** in this plan.
3. **Locking stays by hand, clinic by clinic:** the founder ticks clinics from the overdue list. The server re-checks each one, so it can only lock what is still overdue.
4. **Clinics with no payment stay exempt** and can never be locked by this flow.
5. **Who did it is recorded:** every action writes who, what, which clinic and why to `platform_admin.admin_actions`.
6. **Zero-Friction Founder Operations & Support Superpowers:**
   - **UPI Payment Deep Links:** WhatsApp reminders embed a direct `upi://pay` intent link (`pa`, `pn`, `am`, `cu`, `tn`) so doctors can tap once in WhatsApp to open GPay/PhonePe with the exact amount and clinic reference pre-filled.
   - **1-Click +7 / +14 Days Extension:** Fast trial or grace extension without manual date math, logging a waived entry and updating validity atomically.
   - **Stalled Onboarding & Dormancy Alerts:** Badges clinics that signed up $\ge 3$ days ago with 0 visits logged (`stalled`), and active clinics with no visits in $> 7$ days (`dormant`), enabling proactive founder outreach before churn.
   - **1-Click Support Mode ("Switch to Clinic"):** Superadmin can enter any clinic into `clinic_members` as admin with one click to troubleshoot issues in their live Workspace/Reports, and exit when done.
   - **Export Payments CSV:** One-tap CSV download of the complete payments ledger for quarterly accounting and tax reporting.

## Global Constraints

- Every `admin_*` RPC checks superadmin first and raises errcode `42501`. Non-superadmins get no cross-clinic data.
- Cross-clinic data is never written to Dexie or `db.meta`, and never added to sync. Offline, the page shows "You're offline" with no data.
- The founder's account is assumed to belong to a clinic: the route sits under `Shell`, which shows clinic creation to an account with none.
- Money: `formatAmount` / `currencySymbol()` and `rupeesToPaise`; never type the rupee sign. Phones: `clinicCountryCode` / `splitPhone`; verify their signatures before use. Payment methods such as UPI go in the India-only list (`FEATURES_AND_SCHEMA.md` section 0e).
- No sixth mobile tab. No new npm dependencies. CSS variables only (`text-white` on teal is fine). Explicit `type` on every button. Errors via `<ErrorNote>` inside dialogs, with `toFriendlyMessage`. Dialogs use `useDialogBehavior`. No delete or void beside Save in a footer. Primary controls are 44px.
- The working tree holds other work: stage by explicit path. Do not push. The migration number is `20261109100000` because every version up to `20261108100000` is taken (`20261106130000` is the clinic tagline); re-check `ls supabase/migrations | tail -3` before committing.

## Review Focus

1. **Self-promotion:** an authenticated user cannot insert into `platform_superadmins`, directly or through any RPC.
2. **Retry safety:** the same `request_id` twice records one payment and extends validity once.
3. **Lock safety:** an exempt, in-grace, just-renewed or already locked clinic passed to `admin_lock_clinics` is left alone and reported `locked = false`.
4. **Data on device:** after using the page, `db.meta` and Dexie hold no other clinic's data.
5. **Phone use:** cards, the detail sheet and dialogs work below 640px, with Save reachable above the keyboard.

---

### Task 1: Superadmin table, action log and RPCs

**Files:**
- Create: `supabase/migrations/20261109100000_platform_superadmin_rpc.sql`
- Create: `supabase/tests/platform_superadmin_checks.sql`

**Interfaces — Produces:** the RPCs in Step 1, called by Task 2.

- [ ] **Step 1: Write the migration**

```sql
-- 1. Who may use the in-app founder tools. Rows are added by hand in Studio only.
create table public.platform_superadmins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_superadmins enable row level security;
revoke all on public.platform_superadmins from public, anon, authenticated, service_role;

create function public.is_platform_superadmin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.platform_superadmins where user_id = auth.uid());
$$;

-- 2. Action log and helpers
create table platform_admin.admin_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  clinic_id uuid,
  payment_id uuid,
  reason text,
  details jsonb,
  actor_user_id uuid,
  actor_email text,
  created_at timestamptz not null default now()
);
create index admin_actions_clinic_idx on platform_admin.admin_actions (clinic_id, created_at desc);

create function platform_admin.assert_superadmin() returns void
language plpgsql stable set search_path = pg_catalog, public as $$
begin
  if not public.is_platform_superadmin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
end $$;

create function platform_admin.log_action(
  p_action text, p_clinic_id uuid, p_payment_id uuid, p_reason text, p_details jsonb
) returns void
language sql set search_path = pg_catalog, platform_admin as $$
  insert into platform_admin.admin_actions (action, clinic_id, payment_id, reason, details, actor_user_id, actor_email)
  values (p_action, p_clinic_id, p_payment_id, p_reason, p_details, auth.uid(),
          (select u.email::text from auth.users u where u.id = auth.uid()));
$$;

-- 3. Retry-safe payments. New parameters go last, so the documented Studio calls still work.
alter table platform_admin.subscription_payments add column request_id uuid unique;

drop function platform_admin.record_subscription_payment(uuid, text, bigint, text, text, int, text);
create function platform_admin.record_subscription_payment(
  p_clinic_id uuid, p_tier text, p_amount_paise bigint, p_payment_method text,
  p_payment_reference text default null, p_duration_days int default 30, p_notes text default null,
  p_request_id uuid default null, p_created_by text default current_user
) returns uuid
language plpgsql set search_path = pg_catalog, public, platform_admin as $$
declare
  v_id uuid; v_name text; v_today date; v_last date;
begin
  -- The clinic row lock makes two concurrent retries wait, so the check below sees the first.
  select name into v_name from public.clinics where id = p_clinic_id for update;
  if not found then raise exception 'No clinic with id %', p_clinic_id; end if;
  if p_request_id is not null then
    select id into v_id from platform_admin.subscription_payments where request_id = p_request_id;
    if found then return v_id; end if;
  end if;
  if p_duration_days is null or p_duration_days <= 0 then raise exception 'Duration must be above 0 days'; end if;
  v_today := platform_admin.clinic_today(p_clinic_id);
  select max(valid_until) into v_last from platform_admin.subscription_payments
   where clinic_id = p_clinic_id and voided_at is null and valid_until >= v_today;
  insert into platform_admin.subscription_payments (
    clinic_id, clinic_name, plan_tier, amount_paise, payment_method, payment_reference,
    paid_on, valid_until, duration_days, notes, request_id, created_by
  ) values (
    p_clinic_id, v_name, p_tier, p_amount_paise, p_payment_method, p_payment_reference,
    v_today, coalesce(v_last, v_today) + p_duration_days, p_duration_days, p_notes, p_request_id, p_created_by
  ) returning id into v_id;
  perform platform_admin.set_clinic_tier(p_clinic_id, p_tier, 'active', true);
  return v_id;
end $$;

-- 4. Read RPCs: explicit columns, so only these fields reach the browser. Columns are cast because
-- RETURN QUERY requires exact types (auth.users.email is varchar).
create function public.admin_get_clinics_overview()
returns table (
  clinic_id uuid, clinic_name text, clinic_phone text, clinic_email text, default_country_code text,
  admin_email text, plan_tier text, plan_status text,
  visits_this_month bigint, visit_cap_per_month int, near_visit_cap boolean,
  team_seats_used bigint, max_team_seats int, roster_therapists_used bigint, max_roster_therapists int,
  last_paid_on date, valid_until date, days_remaining int, renewal_status text,
  latest_visit_date date, latest_visit_change timestamptz
)
language plpgsql stable security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  return query
    select o.clinic_id, o.clinic_name::text, o.clinic_phone::text, o.clinic_email::text, c.default_country_code::text,
           o.admin_email::text, o.plan_tier::text, o.plan_status::text,
           o.visits_this_month::bigint, o.visit_cap_per_month::int, o.near_visit_cap,
           o.team_seats_used::bigint, o.max_team_seats::int, o.roster_therapists_used::bigint, o.max_roster_therapists::int,
           o.last_paid_on, o.valid_until, o.days_remaining::int, o.renewal_status::text,
           o.latest_visit_date::date, o.latest_visit_change::timestamptz
      from platform_admin.clinics_overview o
      join public.clinics c on c.id = o.clinic_id
     order by o.days_remaining asc nulls last, o.clinic_name;
end $$;

create function public.admin_get_payments(p_clinic_id uuid default null, p_limit int default 200)
returns table (
  id uuid, clinic_id uuid, clinic_name text, plan_tier text, amount_paise bigint, payment_method text,
  payment_reference text, paid_on date, valid_until date, duration_days int, notes text,
  voided_at timestamptz, void_reason text, created_by text
)
language plpgsql stable security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  return query
    select p.id, p.clinic_id, p.clinic_name, p.plan_tier, p.amount_paise, p.payment_method,
           p.payment_reference, p.paid_on, p.valid_until, p.duration_days, p.notes,
           p.voided_at, p.void_reason, p.created_by
      from platform_admin.subscription_payments p
     where p_clinic_id is null or p.clinic_id = p_clinic_id
     order by p.paid_on desc, p.created_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

-- One clinic's history: plan changes and founder actions, newest first.
create function public.admin_get_clinic_history(p_clinic_id uuid)
returns table (at timestamptz, kind text, summary jsonb, reason text, actor text)
language plpgsql stable security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  return query
    select h.at, h.kind, h.summary, h.reason, h.actor from (
      select a.changed_at as at, 'plan_change'::text as kind,
             jsonb_build_object('old_tier', a.old_tier, 'new_tier', a.new_tier, 'old_status', a.old_status,
               'new_status', a.new_status, 'old_limits', a.old_limits, 'new_limits', a.new_limits) as summary,
             null::text as reason, a.changed_by_role as actor
        from platform_admin.clinic_plans_audit a where a.clinic_id = p_clinic_id
      union all
      select x.created_at, x.action, x.details, x.reason, x.actor_email
        from platform_admin.admin_actions x where x.clinic_id = p_clinic_id
    ) h order by h.at desc limit 100;
end $$;

create function public.admin_payment_reference_exists(p_reference text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  return exists (
    select 1 from platform_admin.subscription_payments p
     where p.voided_at is null and lower(trim(p.payment_reference)) = lower(trim(p_reference))
  );
end $$;

-- 5. Actions
create function public.admin_set_clinic_tier(p_clinic_id uuid, p_tier text, p_preserve_custom_limits boolean default true)
returns void
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  perform platform_admin.set_clinic_tier(p_clinic_id, p_tier, null, p_preserve_custom_limits);
  perform platform_admin.log_action('set_tier', p_clinic_id, null, null,
    jsonb_build_object('tier', p_tier, 'preserve_custom_limits', p_preserve_custom_limits));
end $$;

-- Null visit cap or roster limit = unlimited.
create function public.admin_set_clinic_limits(
  p_clinic_id uuid, p_max_members int, p_visit_cap_per_month int, p_max_roster_therapists int, p_reason text
) returns void
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if p_max_members is null or p_max_members < 1 then raise exception 'Team seats must be at least 1'; end if;
  if p_visit_cap_per_month < 1 or p_max_roster_therapists < 0 then raise exception 'Limits cannot be below zero'; end if;
  update public.clinic_plans set max_members = p_max_members, visit_cap_per_month = p_visit_cap_per_month,
         max_roster_therapists = p_max_roster_therapists
   where clinic_id = p_clinic_id;
  if not found then raise exception 'This clinic has no plan'; end if;
  perform platform_admin.log_action('set_limits', p_clinic_id, null, trim(p_reason),
    jsonb_build_object('max_members', p_max_members, 'visit_cap_per_month', p_visit_cap_per_month,
      'max_roster_therapists', p_max_roster_therapists));
end $$;

create function public.admin_record_payment(
  p_request_id uuid, p_clinic_id uuid, p_tier text, p_amount_paise bigint, p_payment_method text,
  p_payment_reference text default null, p_duration_days int default 30, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
declare
  v_id uuid; v_actor text;
begin
  perform platform_admin.assert_superadmin();
  if p_request_id is null then raise exception 'A request id is required'; end if;
  if exists (select 1 from platform_admin.subscription_payments where request_id = p_request_id) then
    select id into v_id from platform_admin.subscription_payments where request_id = p_request_id;
    return v_id; -- a retry: nothing new to log
  end if;
  select u.email::text into v_actor from auth.users u where u.id = auth.uid();
  v_id := platform_admin.record_subscription_payment(
    p_clinic_id, p_tier, p_amount_paise, p_payment_method, p_payment_reference, p_duration_days, p_notes,
    p_request_id, coalesce(v_actor, 'superadmin'));
  perform platform_admin.log_action('record_payment', p_clinic_id, v_id, null,
    jsonb_build_object('tier', p_tier, 'amount_paise', p_amount_paise, 'duration_days', p_duration_days));
  return v_id;
end $$;

create function public.admin_void_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
declare
  v_clinic uuid;
begin
  perform platform_admin.assert_superadmin();
  select clinic_id into v_clinic from platform_admin.subscription_payments where id = p_payment_id;
  perform platform_admin.void_subscription_payment(p_payment_id, p_reason);
  perform platform_admin.log_action('void_payment', v_clinic, p_payment_id, trim(p_reason), null);
end $$;

-- Locks only those of the given clinics still overdue and not already locked.
create function public.admin_lock_clinics(p_clinic_ids uuid[], p_reason text)
returns table (clinic_id uuid, locked boolean)
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
declare
  v_id uuid; v_ok boolean;
begin
  perform platform_admin.assert_superadmin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  foreach v_id in array coalesce(p_clinic_ids, '{}') loop
    select exists (
      select 1 from platform_admin.clinics_overview o
       where o.clinic_id = v_id and o.renewal_status = 'overdue' and o.plan_status is distinct from 'read_only'
    ) into v_ok;
    if v_ok then
      update public.clinic_plans cp set status = 'read_only' where cp.clinic_id = v_id;
      perform platform_admin.log_action('lock', v_id, null, trim(p_reason), null);
    end if;
    clinic_id := v_id; locked := v_ok;
    return next;
  end loop;
end $$;

create function public.admin_unlock_clinic(p_clinic_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update public.clinic_plans cp set status = 'active' where cp.clinic_id = p_clinic_id and cp.status = 'read_only';
  if not found then raise exception 'This clinic is not locked'; end if;
  perform platform_admin.log_action('unlock', p_clinic_id, null, trim(p_reason), null);
end $$;

-- 6. Support Mode: Enter or exit any clinic to troubleshoot
create function public.admin_enter_clinic(p_clinic_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  if not exists (select 1 from public.clinics where id = p_clinic_id) then
    raise exception 'No clinic with id %', p_clinic_id;
  end if;
  insert into public.clinic_members (clinic_id, user_id, role)
  values (p_clinic_id, auth.uid(), 'admin')
  on conflict (clinic_id, user_id) do update set role = 'admin';
  perform platform_admin.log_action('enter_support_mode', p_clinic_id, null, null, null);
end $$;

create function public.admin_exit_clinic(p_clinic_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, platform_admin as $$
begin
  perform platform_admin.assert_superadmin();
  delete from public.clinic_members where clinic_id = p_clinic_id and user_id = auth.uid();
  perform platform_admin.log_action('exit_support_mode', p_clinic_id, null, null, null);
end $$;

-- 7. Private helpers stay private; only the public entry points are callable by signed-in users.
revoke all on all tables in schema platform_admin from public, anon, authenticated, service_role;
revoke all on all functions in schema platform_admin from public, anon, authenticated, service_role;

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'is_platform_superadmin',
       'admin_get_clinics_overview',
       'admin_get_payments',
       'admin_get_clinic_history',
       'admin_payment_reference_exists',
       'admin_set_clinic_tier',
       'admin_set_clinic_limits',
       'admin_record_payment',
       'admin_void_payment',
       'admin_lock_clinics',
       'admin_unlock_clinic',
       'admin_enter_clinic',
       'admin_exit_clinic'
     )
  loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
```

Confirmed that existing functions `public.admin_delete_clinic` and `public.admin_wipe_clinic_data` exist in the database, which is why the loop explicitly lists the exact 11 functions created here rather than using a wildcard. Also confirmed `clinics.default_country_code` is the live column name from `20261021100000_clinic_region.sql`.

- [ ] **Step 2: Write `supabase/tests/platform_superadmin_checks.sql`**

A `begin; ... rollback;` script of `do` blocks with `assert`, using `set local role authenticated` and `set local request.jwt.claims` to act as a test user. Assert:

1. Non-superadmin: every `admin_*` RPC raises `42501`; `is_platform_superadmin()` is false.
2. Non-superadmin: insert, update, delete and select on `platform_superadmins` are refused, as is any `platform_admin` table or function.
3. `anon` is denied execute on every RPC.
4. Superadmin: `admin_get_clinics_overview()` returns rows without a type error (this proves the casts), and an exempt clinic reads `exempt_unpaid`.
5. `admin_record_payment` with one `request_id` called twice gives the same id, one ledger row, one `record_payment` action, and validity extended once. `created_by` is the actor's email.
6. `admin_void_payment` voids, needs a reason and logs.
7. `admin_set_clinic_limits` sets 100 seats; a later `admin_set_clinic_tier` with preserve on keeps 100. A blank reason or 0 seats raises.
8. `admin_lock_clinics` with exempt, in-grace, overdue and already-locked clinics locks only the overdue one and reports `locked` for each. A blank reason raises.
9. `admin_unlock_clinic` restores `active`; on a clinic that isn't locked it raises.
10. `admin_get_clinic_history` returns plan changes and actions, newest first.

- [ ] **Step 3: Commit and report**

```bash
git add supabase/migrations/20261109100000_platform_superadmin_rpc.sql supabase/tests/platform_superadmin_checks.sql
git commit -m "feat(db): platform superadmin, action log and admin RPCs"
```

Report both paths. Claude runs the checks, applies the migration live, then adds the founder's row:
`insert into public.platform_superadmins (user_id) select id from auth.users where email = '<founder email>';`
The owner supplies which email.

---

### Task 2: Service and `useIsSuperadmin`

**Files:**
- Create: `src/services/platformAdminService.ts`, `src/services/platformAdminService.test.ts`
- Create: `src/features/platformAdmin/useIsSuperadmin.ts`, `src/features/platformAdmin/useIsSuperadmin.test.ts`
- Modify: `src/services/index.ts` only if services are exported there

**Interfaces — Produces:**
- `platformAdminService`: `fetchClinics(): Promise<AdminClinic[]>`, `fetchPayments(clinicId?: string): Promise<AdminPayment[]>`, `fetchClinicHistory(clinicId: string): Promise<AdminHistoryEntry[]>`, `paymentReferenceExists(reference: string): Promise<boolean>`, `setTier({ clinicId, tier, preserveCustomLimits })`, `setLimits({ clinicId, maxMembers, visitCapPerMonth, maxRosterTherapists, reason })`, `recordPayment({ requestId, clinicId, tier, amountPaise, method, reference, durationDays, notes }): Promise<string>`, `extendTrial({ clinicId, days, reason }): Promise<string>`, `voidPayment(paymentId, reason)`, `lockClinics(clinicIds, reason): Promise<{ clinicId: string; locked: boolean }[]>`, `unlockClinic(clinicId, reason)`, `enterClinic(clinicId): Promise<void>`, `exitClinic(clinicId): Promise<void>`.
- `useIsSuperadmin(): { isSuperadmin: boolean; loading: boolean }`.

- [ ] **Step 1: Write failing tests** (mock `@/lib/supabase`)

Service: each method calls the right RPC with the right parameter names; rows map to camelCase (`rowToDomain`); an RPC error rejects with its message; `recordPayment` takes paise and sends `requestId` unchanged (rupee conversion belongs to the dialog). No method touches `db`.

Hook (first line `// @vitest-environment jsdom`): loading then true; false when the RPC returns false, errors or there is no session; the result is cached per user id, so several mounts make one RPC call, and a different user fetches again.

- [ ] **Step 2: Run them, expect failure:** `npx vitest run src/services/platformAdminService.test.ts src/features/platformAdmin/useIsSuperadmin.test.ts`

- [ ] **Step 3: Implement.** The cache is a module-level `Map` in memory only, never `db.meta`.

- [ ] **Step 4: Run them, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/services/platformAdminService.ts src/services/platformAdminService.test.ts src/features/platformAdmin/useIsSuperadmin.ts src/features/platformAdmin/useIsSuperadmin.test.ts
git commit -m "feat(platformAdmin): service and useIsSuperadmin hook"
```

---

### Task 3: Action dialogs

**Files:** Create in `src/features/platformAdmin/`: `ChangePlanDialog.tsx`, `SetLimitsDialog.tsx`, `RecordPaymentDialog.tsx`, `VoidPaymentDialog.tsx`, `LockClinicsDialog.tsx`, `UnlockClinicDialog.tsx`, `recordPaymentPreview.ts`, `platformAdminDialogs.test.tsx`.

**Interfaces:** each dialog takes the clinic or payment it acts on, `onClose()` and `onDone()`. It shows errors inside itself, and disables its submit while busy.

`validUntilPreview(lastValidUntil: string | null, today: string, durationDays: number): string` lives in `recordPaymentPreview.ts`. It is display only; the server's date is the record.

- [ ] **Step 1: Write failing tests**
- **ChangePlanDialog:** shows the current tier and all four tiers; a "Keep custom limits" checkbox, on by default; submits; shows an RPC error inside.
- **SetLimitsDialog:** shows current limits; a blank cap or roster means unlimited and says so; a reason is required; seats below 1 block submit.
- **RecordPaymentDialog:**
  - the amount label uses `currencySymbol()` and is sent through `rupeesToPaise`
  - method choices, reference, notes, and 30 / 90 / 365 quick picks plus custom days
  - shows "Valid until {date} · status becomes active"
  - for an exempt clinic, adds "This starts the clinic's billing cycle"
  - a repeated reference shows a warning but does not block
  - `requestId` is created once when the dialog opens and is reused on retry after a failure
- **VoidPaymentDialog:** requires a reason. It states the effect: if this is the clinic's only valid payment, "The clinic becomes exempt and its plan stays active"; otherwise "Validity goes back to {date}". After voiding it offers "Change plan".
- **LockClinicsDialog:** lists overdue, unlocked clinics with checkboxes, none ticked to start; a reason is required; it says what read-only blocks; after submit it names any clinic the server skipped.
- **UnlockClinicDialog:** requires a reason, and says the clinic may still be overdue.

- [ ] **Step 2: Run, expect failure:** `npx vitest run src/features/platformAdmin/platformAdminDialogs.test.tsx`

- [ ] **Step 3: Implement** with `useDialogBehavior`, `Field`, `inputCls`, `ErrorNote`, `toFriendlyMessage`, and a sticky footer on phones.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** those files by path: `feat(platformAdmin): action dialogs`.

---

### Task 4: Page, two tabs, detail sheet, and founder utilities

**Files:** Create in `src/features/platformAdmin/`: `PlatformAdminPage.tsx`, `ClinicsTab.tsx`, `PaymentsTab.tsx`, `ClinicDetailSheet.tsx`, `clinicFilters.ts`, `clinicFilters.test.ts`, `reminderLinks.ts`, `reminderLinks.test.ts`, `paymentsCsv.ts`, `paymentsCsv.test.ts`, `PlatformAdminPage.test.tsx`.

**Interfaces:**
- `filterClinics(clinics: AdminClinic[], filter: ClinicFilter, query: string, todayIso?: string): AdminClinic[]`, where `ClinicFilter = 'attention' | 'all' | 'active' | 'due_soon' | 'grace' | 'overdue' | 'exempt' | 'locked' | 'stalled' | 'dormant'`. "attention" means due soon, in grace, overdue, stalled, dormant, or near visit cap.
- `buildWhatsAppReminderUrl({ phone, countryCode, clinicName, validUntil, amountPaise, upiId }): string` (includes `upi://pay` deep link for 1-tap mobile payment)
- `buildEmailReminderUrl({ adminEmail, clinicName, validUntil, amountPaise }): string`
- `formatAdminEmailsForBcc(clinics: AdminClinic[]): string` (comma-separated, deduplicated list of non-empty admin emails)
- `exportPaymentsToCsv(payments: AdminPayment[]): string` (properly escaped CSV with header)

- [ ] **Step 1: Write failing tests**
- `clinicFilters.test.ts`: each filter including `stalled` (signed up $\ge 3$ days ago with 0 visits) and `dormant` (active with no visits in $> 7$ days); search by name, phone or email; exempt clinics are never in "attention" for renewal alone.
- `reminderLinks.test.ts`:
  - `buildWhatsAppReminderUrl`: uses `splitPhone`, normalizes digits, URL-encodes clinic name, formatted date (`formatDateDMY`), formatted amount (`formatAmount`), and embeds `upi://pay?pa={upiId}&pn=TheraNet&am={rupees}&cu=INR&tn=TheraNet-{clinicName}`.
  - `buildEmailReminderUrl`: builds `mailto:` URL with subject `TheraNet Subscription Renewal - {clinicName}` and pre-drafted body.
  - `formatAdminEmailsForBcc`: takes clinics list, extracts valid `adminEmail`s, removes duplicates, and returns comma-separated string.
- `paymentsCsv.test.ts`: turns payments into formatted CSV rows with headers (`Date, Clinic, Tier, Amount (INR), Method, Reference, Validity, Status, Notes`).
- `PlatformAdminPage.test.tsx`:
  - Loading state; opens on Clinics with "attention" and falls back to a clear "Nothing needs attention" message.
  - Switches to Payments tab.
  - Shows "You're offline" and no data when offline; shows "Limits enforced: On/Off" from `useEntitlements().enforcementEnabled`.
  - "Copy Admin Emails" button in the toolbar copies comma-separated emails to clipboard and calls `notify()`.
  - Clinics tab: an "Overdue · Lock…" banner appears only when there are overdue unlocked clinics, and opens `LockClinicsDialog`.
  - Detail sheet: shows visits against cap, seats, roster, validity, payments and history; actions Change plan, Set limits, Record payment; **+7 Days / +14 Days Extension** buttons; **Open Clinic (Support Mode)** button calling `enterClinic`; Unlock only when locked; Void on each unvoided payment; **both** 1-click WhatsApp (with UPI link) and Email reminder buttons when clinic is due, in grace, or overdue.
  - Payments tab: **Export CSV** button downloads payments CSV.

- [ ] **Step 2: Run, expect failure:** `npx vitest run src/features/platformAdmin/clinicFilters.test.ts src/features/platformAdmin/reminderLinks.test.ts src/features/platformAdmin/paymentsCsv.test.ts src/features/platformAdmin/PlatformAdminPage.test.tsx`

- [ ] **Step 3: Implement.** Table from `tab:` up, cards below. Tabs live in component state. Reminders use `reminderLinks.ts` with editable WhatsApp (`wa.me` + `upi://pay`) and email (`mailto:`) links. "Copy Admin Emails" writes to `navigator.clipboard` with toast notice. Payments CSV download triggers file download. Quick extension buttons call `extendTrial`. Support mode enters clinic membership and updates active clinic. Dates use `formatDateDMY`; amounts use `formatAmount`. Fetch in the component, not `useLiveQuery`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** those files by path: `feat(platformAdmin): founder page with clinics, payments, and founder superpowers`.

---

### Task 5: Route and account menu

**Files:** Modify `src/app/router.tsx`, `src/app/AccountMenu.tsx`, `src/app/AccountMenu.test.tsx`. Create `src/features/platformAdmin/PlatformAdminRoute.tsx` and its test. Modify `src/components/NavIcons.tsx` only if a new icon is added (`IconShield` does not exist).

- [ ] **Step 1: Write failing tests**
- `AccountMenu`: a "Platform admin" link for a superadmin; none otherwise or while loading.
- `PlatformAdminRoute`: while loading shows `AppLoading`; a non-superadmin is replaced to `/workspace` and never mounts the page.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement.** Lazy-load `PlatformAdminRoute`, as other routes do, under `rootRoute` at `/platform-admin`. The guard is a component because it needs the hook. It is a convenience only; the RPCs are the real boundary. Do not touch the five-tab bar.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** by path: `feat(app): platform admin route and account menu link`.

---

### Task 6: Docs and full gate

**Files:** Modify `FEATURES_AND_SCHEMA.md` (all duplicate copies of a schema section; `grep -n` the headings) and `README.md`.

- [ ] **Step 1: Document** the table, `admin_actions`, `request_id`, all RPCs, the page, the rule that this data never reaches Dexie, how to add a superadmin, and that `platform_admin` is now reached in-app through the guarded RPCs as well as Studio. Add payment methods to section 0e.

- [ ] **Step 2: Run each on its own and read its exit status:** `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.

- [ ] **Step 3: Commit**

```bash
git add FEATURES_AND_SCHEMA.md README.md
git commit -m "docs: in-app platform admin"
```

- [ ] **Step 4: Manual check (owner, after the migration is live)**

As founder, on a phone: open Platform admin; record a payment on a test clinic with the network dropping mid-save and retry, confirming one payment; void it; set limits; change plan with that clinic open in another browser, which updates without a reload; lock and unlock it. Log in as a clinic admin: no menu link, and `/platform-admin` goes to Workspace. Then delete this plan file.
