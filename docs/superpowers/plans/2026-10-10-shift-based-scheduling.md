# Shift-Based Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a therapist's unilateral, free-form self-editing of their own working hours/breaks with an admin-controlled model: admins assign (immediately) a reusable shift template or custom hours to each therapist; therapists can request a shift change (admin-approved) and self-service move their break's placement within an already-approved shift without approval.

**Architecture:** Two new Supabase tables (`shift_templates`, `therapist_shift_assignments`), both RPC-gated like `appointment_requests` (reads sync to Dexie, all writes go through `security definer` RPCs — not `CLIENT_WRITABLE_TABLES`, since every write has server-computed side effects on `therapists.working_hours`). A single shared `derive_working_hours()` SQL function builds the same JSON shape `therapists.working_hours` already holds today, so every downstream consumer (`TimeGrid`, booking form, slot generation) needs zero changes. `set_therapist_working_hours`'s `is_own_therapist` branch is removed — a therapist can no longer write `working_hours` directly.

**Tech Stack:** Postgres/Supabase (`security definer` RPCs, RLS), Dexie (IndexedDB, offline-first sync), React 18 + TypeScript, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-10-shift-based-scheduling-design.md`

## Global Constraints

- Every RPC is `language plpgsql security definer set search_path = public`, `revoke`d from `public, anon`, `grant execute ... to authenticated` only — exact convention from `supabase/migrations/20261002100000_therapist_working_hours.sql` and `20260928000000_audit_p0_fixes.sql`.
- `shift_templates`/`therapist_shift_assignments` get **no insert/update/delete RLS policies** — only a `select` policy. All writes are RPC-only (mirrors `appointment_requests`'s "no client INSERT policy exists" convention, per `src/domain/types.ts:716` doc comment).
- Every derived `working_hours` value must pass the existing `working_hours_valid()` check (from `20261002100000_therapist_working_hours.sql`) before being written — never skip it, even though `derive_working_hours()` should always produce valid output.
- Both new tables go in `ALL_SYNCED_TABLES` (pulled) in `src/lib/db.ts`, **not** `CLIENT_WRITABLE_TABLES` (no outbox writes) — matches the `appointment_requests`/`appointments` convention documented at `db.ts:114-131`.
- Dexie schema addition is `this.version(22).stores({...})` — version 21 is the current highest (`db.ts:274-280`).
- `ScheduleBookingsView.tsx`'s `handleHoursSave` (lines 322-345) appointment-conflict-check wrapper must still run before any admin-side hours change takes effect — do not call a new `bookingService` method directly from the admin UI without routing through (an updated) `handleHoursSave`.
- Run `npm run typecheck && npm run lint && npm run test` after every task that touches `src/`; `npm run build` after any task touching `AccountMenu.tsx`, `ScheduleBookingsView.tsx`, or `SettingsPage.tsx`.
- Apply each migration via the Supabase MCP `apply_migration` tool; if declined (this project's established pattern), hand the SQL to the user to run manually, then verify live via `execute_sql` and reconcile `supabase_migrations.schema_migrations`.

## Review Focus

- **A therapist with two approved assignments on different weekdays** (e.g. Morning Mon/Wed + Evening Thu) — editing or superseding one must never touch the other's weekdays in `working_hours`. A careless cascade or supersede that re-derives from scratch instead of merging would silently delete Thursday's hours.
- **A break placement that was valid, then becomes invalid after an admin shrinks the shift template** — `update_shift_template`'s cascade must reset it to the new default, not silently write an out-of-bounds derived JSON that then fails `working_hours_valid()` and leaves the therapist's hours stale from a half-failed cascade.
- **A therapist requesting a shift change while they're the currently-logged-in session on a shared/kiosk device** — `is_own_therapist` must be re-checked server-side on every RPC, not assumed from client state (mirrors `set_therapist_working_hours`'s existing pattern exactly).
- **Admin assigns a shift that fully overlaps a pending (not yet approved) request from the same therapist** — the pending request should still get superseded/closed out (so the therapist doesn't see a stale "waiting on approval" state for days already resolved by the admin's direct action), not just approved assignments.
- **A clinic with zero shift templates defined** — the therapist-side "pick a shift" UI and the admin "assign shift" UI must degrade to "no shift templates yet — use custom hours" rather than rendering an empty, broken picker.

---

## File Structure

New files:
- `supabase/migrations/20261011090000_shift_scheduling_schema.sql` — tables, RLS, `derive_working_hours()`, supersede helpers.
- `supabase/migrations/20261011091000_shift_scheduling_admin_rpcs.sql` — `create_shift_template`, `update_shift_template` (cascade), `assign_shift`, `assign_custom_hours`.
- `supabase/migrations/20261011092000_shift_scheduling_request_rpcs.sql` — `request_shift_assignment`, `request_custom_hours`, `approve_shift_assignment`, `decline_shift_assignment`, and removal of `set_therapist_working_hours`'s `is_own_therapist` branch.
- `supabase/migrations/20261011093000_shift_scheduling_break_placement.sql` — `set_break_placement`.
- `src/components/schedule/ShiftRequestSheet.tsx` — therapist-side: pick a shift + weekdays, or fall through to custom hours.
- `src/components/schedule/AssignShiftSheet.tsx` — admin-side: assign a shift to a therapist, immediate.
- `src/components/schedule/BreakPlacementControl.tsx` — self-service break-move control.
- `src/features/settings/ShiftTemplatesSection.tsx` — admin CRUD for shift templates, rendered in Settings → Team.
- `src/features/settings/ShiftAssignmentsSection.tsx` — per-therapist current assignment + pending-request review, rendered in Settings → Team.

Modified files:
- `src/domain/types.ts` — `ShiftTemplate`, `TherapistShiftAssignment`, `ShiftAssignmentStatus` types.
- `src/lib/db.ts` — `version(22)`, `SyncedTable`, `ALL_SYNCED_TABLES`.
- `src/repositories/types.ts`, `src/repositories/local.ts` — `shiftTemplates`, `therapistShiftAssignments` read-only repos.
- `src/services/bookingService.ts` — wrapper methods for every new RPC.
- `src/app/AccountMenu.tsx` — "My working hours" opens `ShiftRequestSheet` instead of `WorkingHoursSheet` directly.
- `src/features/schedule/ScheduleBookingsView.tsx` — `handleHoursSave` routes to `assignCustomHours`; new "Assign shift" kebab action; pending-assignment-requests banner.
- `src/features/settings/SettingsPage.tsx` — render `ShiftTemplatesSection`/`ShiftAssignmentsSection` inside the `'team'` tab.

---

### Task 1: Schema, RLS, and derivation function

**Files:**
- Create: `supabase/migrations/20261011090000_shift_scheduling_schema.sql`

**Interfaces:**
- Produces: tables `public.shift_templates`, `public.therapist_shift_assignments`; functions `public.derive_working_hours(jsonb, integer[], integer, integer, integer, integer) returns jsonb`, `public.supersede_overlapping_weekdays(uuid, integer[]) returns void`, `public.supersede_all_assignments(uuid) returns void`, `public.apply_shift_hours(uuid, integer[], integer, integer, integer, integer) returns void`, `public.apply_custom_hours(uuid, jsonb) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- Shift-based scheduling: admin-assigned shift templates (or custom hours)
-- replace unilateral therapist self-editing of working hours. See
-- docs/superpowers/specs/2026-10-10-shift-based-scheduling-design.md.

create table public.shift_templates (
  id                          uuid primary key default gen_random_uuid(),
  clinic_id                   uuid not null references public.clinics(id) on delete cascade,
  name                        text not null,
  start_minute                integer not null check (start_minute >= 0 and start_minute < 1440),
  end_minute                  integer not null check (end_minute > start_minute and end_minute <= 1440),
  break_duration_minutes      integer not null default 0 check (break_duration_minutes >= 0),
  default_break_start_minute  integer check (
    default_break_start_minute is null
    or (default_break_start_minute >= start_minute
        and default_break_start_minute + break_duration_minutes <= end_minute)
  ),
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (break_duration_minutes = 0 or default_break_start_minute is not null)
);

create index shift_templates_clinic_idx on public.shift_templates (clinic_id, active);

alter table public.shift_templates enable row level security;
create policy shift_templates_select on public.shift_templates
  for select using (is_clinic_member(clinic_id));
-- No insert/update/delete policies — all writes go through security definer RPCs.

create table public.therapist_shift_assignments (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  therapist_id        uuid not null references public.therapists(id) on delete cascade,
  shift_template_id   uuid references public.shift_templates(id),
  custom_hours        jsonb,
  weekdays            integer[] check (
    weekdays is null
    or (array_length(weekdays, 1) > 0 and weekdays <@ array[0,1,2,3,4,5,6])
  ),
  break_start_minute  integer,
  status              text not null default 'pending' check (status in ('pending','approved','declined','superseded')),
  note                text,
  requested_by        uuid references auth.users(id),
  decided_by          uuid references auth.users(id),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((shift_template_id is null) <> (custom_hours is null)),
  check (shift_template_id is null or weekdays is not null),
  check (shift_template_id is not null or weekdays is null)
);

create index therapist_shift_assignments_therapist_idx
  on public.therapist_shift_assignments (therapist_id, status);
create index therapist_shift_assignments_clinic_pending_idx
  on public.therapist_shift_assignments (clinic_id, status);

alter table public.therapist_shift_assignments enable row level security;
create policy therapist_shift_assignments_select on public.therapist_shift_assignments
  for select using (
    is_clinic_admin(clinic_id) or is_front_desk(clinic_id) or is_own_therapist(clinic_id, therapist_id)
  );
-- No insert/update/delete policies — all writes go through security definer RPCs.

-- Builds { "<weekday>": [[start,break_start],[break_start+duration,end]], ... }
-- (or a single [[start,end]] interval when there's no break) for each
-- weekday in p_weekdays, merged into whichever weekdays p_existing already
-- held for other assignments. Callers resolve the break-start fallback
-- chain (assignment override, else template default) before calling this.
create or replace function public.derive_working_hours(
  p_existing jsonb,
  p_weekdays integer[],
  p_start_minute integer,
  p_end_minute integer,
  p_break_start integer,
  p_break_duration integer
) returns jsonb language plpgsql immutable as $$
declare
  v_result jsonb := coalesce(p_existing, '{}'::jsonb);
  v_day integer;
  v_intervals jsonb;
begin
  if p_break_duration > 0 and p_break_start is not null then
    v_intervals := jsonb_build_array(
      jsonb_build_array(p_start_minute, p_break_start),
      jsonb_build_array(p_break_start + p_break_duration, p_end_minute)
    );
  else
    v_intervals := jsonb_build_array(jsonb_build_array(p_start_minute, p_end_minute));
  end if;
  foreach v_day in array p_weekdays loop
    v_result := jsonb_set(v_result, array[v_day::text], v_intervals, true);
  end loop;
  return v_result;
end $$;

-- Weekdays in p_weekdays are being claimed by a new/edited shift
-- assignment: strip them from this therapist's other approved
-- shift-template assignments (partial overlap shrinks weekdays; full
-- overlap flips status to 'superseded' rather than leaving an invalid
-- zero-day row — the weekdays check constraint requires >=1 day whenever
-- shift_template_id is set). Custom-hours assignments are untouched here;
-- see supersede_all_assignments for the custom-hours path.
create or replace function public.supersede_overlapping_weekdays(
  p_therapist_id uuid,
  p_weekdays integer[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_remaining integer[];
begin
  for v_row in
    select id, weekdays from therapist_shift_assignments
    where therapist_id = p_therapist_id and status = 'approved' and shift_template_id is not null
    for update
  loop
    select array_agg(d) into v_remaining from unnest(v_row.weekdays) d where d <> all(p_weekdays);
    if v_remaining is null then
      update therapist_shift_assignments set status = 'superseded', updated_at = now() where id = v_row.id;
    elsif v_remaining <> v_row.weekdays then
      update therapist_shift_assignments set weekdays = v_remaining, updated_at = now() where id = v_row.id;
    end if;
  end loop;
end $$;

-- Custom hours and shift templates are mutually exclusive per therapist:
-- approving either one supersedes every other currently-approved
-- assignment for that therapist (shift or custom), full stop.
create or replace function public.supersede_all_assignments(p_therapist_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update therapist_shift_assignments
    set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'approved';
end $$;

-- Shared by assign_shift (Task 2) and approve_shift_assignment's
-- shift-template path (Task 3) — both reach the same "supersede, derive,
-- validate, write" sequence, one directly and one via the request queue.
-- Caller has already authorized and validated the shift/break-placement
-- bounds before calling this.
create or replace function public.apply_shift_hours(
  p_therapist_id uuid,
  p_weekdays integer[],
  p_shift_start integer,
  p_shift_end integer,
  p_break_start integer,
  p_break_duration integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_hours jsonb;
begin
  perform supersede_overlapping_weekdays(p_therapist_id, p_weekdays);
  select working_hours into v_hours from therapists where id = p_therapist_id;
  v_hours := derive_working_hours(v_hours, p_weekdays, p_shift_start, p_shift_end, p_break_start, p_break_duration);
  if not working_hours_valid(v_hours) then
    raise exception 'Derived working hours are invalid.';
  end if;
  update therapists set working_hours = v_hours, updated_at = now() where id = p_therapist_id;
end $$;

-- Shared by assign_custom_hours (Task 2) and approve_shift_assignment's
-- custom-hours path (Task 3).
create or replace function public.apply_custom_hours(
  p_therapist_id uuid,
  p_custom_hours jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not working_hours_valid(p_custom_hours) then
    raise exception 'Working hours must be non-overlapping times within the day, earliest first.';
  end if;
  perform supersede_all_assignments(p_therapist_id);
  update therapists set working_hours = p_custom_hours, updated_at = now() where id = p_therapist_id;
end $$;

revoke execute on function public.derive_working_hours(jsonb, integer[], integer, integer, integer, integer) from public, anon;
revoke execute on function public.supersede_overlapping_weekdays(uuid, integer[]) from public, anon;
revoke execute on function public.supersede_all_assignments(uuid) from public, anon;
revoke execute on function public.apply_shift_hours(uuid, integer[], integer, integer, integer, integer) from public, anon;
revoke execute on function public.apply_custom_hours(uuid, jsonb) from public, anon;
grant execute on function public.apply_shift_hours(uuid, integer[], integer, integer, integer, integer) to authenticated;
grant execute on function public.apply_custom_hours(uuid, jsonb) to authenticated;
grant execute on function public.derive_working_hours(jsonb, integer[], integer, integer, integer, integer) to authenticated;
grant execute on function public.supersede_overlapping_weekdays(uuid, integer[]) to authenticated;
grant execute on function public.supersede_all_assignments(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool (`project_id` from `mcp__claude_ai_Supabase__list_projects`, `name: "shift_scheduling_schema"`). If declined, give the SQL to the user to run manually in the Supabase SQL editor, then continue.

- [ ] **Step 3: Verify live**

```sql
select table_name from information_schema.tables where table_schema = 'public' and table_name in ('shift_templates', 'therapist_shift_assignments');
select routine_name from information_schema.routines where routine_schema = 'public' and routine_name in ('derive_working_hours', 'supersede_overlapping_weekdays', 'supersede_all_assignments');
```
Expected: both tables and all three functions present.

- [ ] **Step 4: Smoke-test `derive_working_hours` directly**

```sql
select derive_working_hours(null, array[1,3], 540, 780, 660, 30);
```
Expected: `{"1": [[540,660],[690,780]], "3": [[540,660],[690,780]]}`.

```sql
select derive_working_hours('{"4": [[600,900]]}'::jsonb, array[1], 540, 780, null, 0);
```
Expected: `{"1": [[540,780]], "4": [[600,900]]}` — confirms merge preserves an untouched weekday.

- [ ] **Step 5: Reconcile migration tracking (only if applied manually)**

```sql
insert into supabase_migrations.schema_migrations (version, name) values ('20261011090000', 'shift_scheduling_schema') on conflict do nothing;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261011090000_shift_scheduling_schema.sql
git commit -m "feat(schedule): add shift-template schema, RLS, and working-hours derivation"
```

---

### Task 2: Admin RPCs — create/update shift template, immediate assignment

**Files:**
- Create: `supabase/migrations/20261011091000_shift_scheduling_admin_rpcs.sql`

**Interfaces:**
- Consumes: `apply_shift_hours`, `apply_custom_hours` (Task 1); `working_hours_valid`, `is_clinic_admin`, `is_front_desk` (existing).
- Produces: `create_shift_template(uuid, text, integer, integer, integer, integer) returns uuid`, `update_shift_template(uuid, text, integer, integer, integer, integer, boolean) returns void`, `assign_shift(uuid, uuid, integer[], integer) returns uuid`, `assign_custom_hours(uuid, jsonb) returns uuid`.

- [ ] **Step 1: Write the migration**

```sql
create or replace function public.create_shift_template(
  p_clinic_id uuid,
  p_name text,
  p_start_minute integer,
  p_end_minute integer,
  p_break_duration_minutes integer default 0,
  p_default_break_start_minute integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not (is_clinic_admin(p_clinic_id) or is_front_desk(p_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  insert into shift_templates (
    clinic_id, name, start_minute, end_minute, break_duration_minutes, default_break_start_minute
  ) values (
    p_clinic_id, trim(p_name), p_start_minute, p_end_minute, p_break_duration_minutes, p_default_break_start_minute
  ) returning id into v_id;
  return v_id;
end $$;

-- Updates the template, then cascades to every approved assignment bound
-- to it: re-reads each therapist's CURRENT working_hours (not a value
-- captured before the loop) as the merge base, so an unrelated weekday
-- from a different assignment is never clobbered. An assignment's own
-- break_start_minute is re-validated against the template's NEW bounds;
-- if it no longer fits, it's reset to null (falls back to the template's
-- new default) rather than producing an invalid derivation.
create or replace function public.update_shift_template(
  p_template_id uuid,
  p_name text,
  p_start_minute integer,
  p_end_minute integer,
  p_break_duration_minutes integer,
  p_default_break_start_minute integer,
  p_active boolean default true
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_row record;
  v_hours jsonb;
  v_break_start integer;
begin
  select clinic_id into v_clinic_id from shift_templates where id = p_template_id for update;
  if not found then raise exception 'Shift template not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;

  update shift_templates set
    name = trim(p_name),
    start_minute = p_start_minute,
    end_minute = p_end_minute,
    break_duration_minutes = p_break_duration_minutes,
    default_break_start_minute = p_default_break_start_minute,
    active = p_active,
    updated_at = now()
  where id = p_template_id;

  for v_row in
    select therapist_id, id, weekdays, break_start_minute
    from therapist_shift_assignments
    where shift_template_id = p_template_id and status = 'approved'
  loop
    v_break_start := v_row.break_start_minute;
    if v_break_start is not null and (
      v_break_start < p_start_minute or v_break_start + p_break_duration_minutes > p_end_minute
    ) then
      v_break_start := null;
      update therapist_shift_assignments set break_start_minute = null, updated_at = now() where id = v_row.id;
    end if;

    select working_hours into v_hours from therapists where id = v_row.therapist_id;
    v_hours := derive_working_hours(
      v_hours, v_row.weekdays, p_start_minute, p_end_minute,
      coalesce(v_break_start, p_default_break_start_minute), p_break_duration_minutes
    );
    if not working_hours_valid(v_hours) then
      raise exception 'Derived working hours are invalid for therapist %.', v_row.therapist_id;
    end if;
    update therapists set working_hours = v_hours, updated_at = now() where id = v_row.therapist_id;
  end loop;
end $$;

-- Admin/front-desk assigning a shift takes effect immediately (the admin
-- IS the approver). Supersedes overlapping weekdays on the therapist's
-- other approved shift assignments, and closes out any pending request
-- for this therapist (a direct admin assignment resolves what the
-- therapist was asking for, even if the admin picked something different).
create or replace function public.assign_shift(
  p_therapist_id uuid,
  p_shift_template_id uuid,
  p_weekdays integer[],
  p_break_start_minute integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_shift record;
  v_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  select * into v_shift from shift_templates where id = p_shift_template_id and clinic_id = v_clinic_id and active;
  if not found then raise exception 'Shift template not found.'; end if;
  if p_weekdays is null or array_length(p_weekdays, 1) is null then
    raise exception 'At least one weekday is required.';
  end if;
  if p_break_start_minute is not null and (
    p_break_start_minute < v_shift.start_minute
    or p_break_start_minute + v_shift.break_duration_minutes > v_shift.end_minute
  ) then
    raise exception 'Break placement must fit within the shift.';
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, shift_template_id, weekdays, break_start_minute,
    status, decided_by, decided_at
  ) values (
    v_clinic_id, p_therapist_id, p_shift_template_id, p_weekdays,
    p_break_start_minute, 'approved', auth.uid(), now()
  ) returning id into v_id;

  perform apply_shift_hours(
    p_therapist_id, p_weekdays, v_shift.start_minute, v_shift.end_minute,
    coalesce(p_break_start_minute, v_shift.default_break_start_minute), v_shift.break_duration_minutes
  );

  return v_id;
end $$;

-- Custom hours replace working_hours wholesale (unlike a shift
-- assignment, which merges by weekday) — it's a full weekly override, the
-- same meaning free-form hours always had. Supersedes every other
-- approved assignment for this therapist, shift or custom.
create or replace function public.assign_custom_hours(
  p_therapist_id uuid,
  p_custom_hours jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, custom_hours, status, decided_by, decided_at
  ) values (
    v_clinic_id, p_therapist_id, p_custom_hours, 'approved', auth.uid(), now()
  ) returning id into v_id;

  perform apply_custom_hours(p_therapist_id, p_custom_hours);

  return v_id;
end $$;

revoke execute on function public.create_shift_template(uuid, text, integer, integer, integer, integer) from public, anon;
revoke execute on function public.update_shift_template(uuid, text, integer, integer, integer, integer, boolean) from public, anon;
revoke execute on function public.assign_shift(uuid, uuid, integer[], integer) from public, anon;
revoke execute on function public.assign_custom_hours(uuid, jsonb) from public, anon;
grant execute on function public.create_shift_template(uuid, text, integer, integer, integer, integer) to authenticated;
grant execute on function public.update_shift_template(uuid, text, integer, integer, integer, integer, boolean) to authenticated;
grant execute on function public.assign_shift(uuid, uuid, integer[], integer) to authenticated;
grant execute on function public.assign_custom_hours(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Apply and verify**

Apply via `apply_migration` (name `shift_scheduling_admin_rpcs`). Verify:
```sql
select routine_name from information_schema.routines where routine_schema = 'public'
  and routine_name in ('create_shift_template','update_shift_template','assign_shift','assign_custom_hours');
```
Expected: all four present. Reconcile `supabase_migrations.schema_migrations` if applied manually (same pattern as Task 1, version `20261011091000`).

- [ ] **Step 3: SQL-level test — assign_shift + cascade**

Run as a clinic admin (via `execute_sql`, using a real test clinic/therapist/admin session, or the Supabase SQL editor's role-switching if testing locally):
```sql
-- Create a template, assign it, confirm working_hours, edit the template, confirm cascade.
select create_shift_template('<clinic_id>', 'Morning', 540, 780, 30, 660);
-- → note the returned id as <template_id>
select assign_shift('<therapist_id>', '<template_id>', array[1,3], null);
select working_hours from therapists where id = '<therapist_id>';
-- Expected: {"1": [[540,660],[690,780]], "3": [[540,660],[690,780]]}
select update_shift_template('<template_id>', 'Morning', 540, 840, 30, 660, true);
select working_hours from therapists where id = '<therapist_id>';
-- Expected: end_minute now 840 on both weekdays: {"1": [[540,660],[690,840]], "3": [[540,660],[690,840]]}
```

- [ ] **Step 4: SQL-level test — break-placement reset on shrink**

```sql
select assign_shift('<therapist_id>', '<template_id>', array[5], 700);  -- custom break at 700
select update_shift_template('<template_id>', 'Morning', 540, 720, 30, 660, true);  -- shrink end to 720, 700 no longer fits
select break_start_minute from therapist_shift_assignments where therapist_id = '<therapist_id>' and weekdays @> array[5];
-- Expected: null (reset, fell back to the new default of 660)
```

- [ ] **Step 5: SQL-level test — editing one template never touches a therapist's unrelated second assignment**

A therapist on two different shifts (different templates, different weekdays) — editing one must not disturb the other's weekday in `working_hours`. This is the exact bug `update_shift_template`'s sequential re-derivation exists to prevent.

```sql
select create_shift_template('<clinic_id>', 'Evening', 840, 1080, 0, null);
-- → note the returned id as <evening_template_id>
select assign_shift('<therapist_id>', '<evening_template_id>', array[4], null);  -- Thursday, Evening shift
select working_hours from therapists where id = '<therapist_id>';
-- Expected: now holds BOTH weekday 3 (Morning, from Step 3/4 above) and weekday 4 (Evening): {"3": [[540,660],[690,840]], "4": [[840,1080]], "5": [...]}
select update_shift_template('<template_id>', 'Morning', 540, 900, 30, 660, true);  -- edit the Morning template again
select working_hours -> '4' from therapists where id = '<therapist_id>';
-- Expected: still exactly [[840,1080]] — Thursday's Evening-shift hours are untouched by the Morning template's edit
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261011091000_shift_scheduling_admin_rpcs.sql
git commit -m "feat(schedule): add shift-template CRUD and immediate admin-assignment RPCs"
```

---

### Task 3: Therapist request + admin approve/decline RPCs; remove self-write

**Files:**
- Create: `supabase/migrations/20261011092000_shift_scheduling_request_rpcs.sql`

**Interfaces:**
- Consumes: `apply_shift_hours`, `apply_custom_hours` (Task 1); `working_hours_valid`, `is_own_therapist`, `is_clinic_admin`, `is_front_desk` (existing).
- Produces: `request_shift_assignment(uuid, uuid, integer[], integer, text) returns uuid`, `request_custom_hours(uuid, jsonb, text) returns uuid`, `approve_shift_assignment(uuid) returns void`, `decline_shift_assignment(uuid, text) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- Therapist requesting a shift change — pending until approved. Replaces
-- (supersedes) any existing unactioned pending row for this therapist so
-- requests don't stack.
create or replace function public.request_shift_assignment(
  p_therapist_id uuid,
  p_shift_template_id uuid,
  p_weekdays integer[],
  p_break_start_minute integer default null,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_shift record;
  v_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not is_own_therapist(v_clinic_id, p_therapist_id) then
    raise exception 'Not authorized.';
  end if;
  select * into v_shift from shift_templates where id = p_shift_template_id and clinic_id = v_clinic_id and active;
  if not found then raise exception 'Shift template not found.'; end if;
  if p_weekdays is null or array_length(p_weekdays, 1) is null then
    raise exception 'At least one weekday is required.';
  end if;
  if p_break_start_minute is not null and (
    p_break_start_minute < v_shift.start_minute
    or p_break_start_minute + v_shift.break_duration_minutes > v_shift.end_minute
  ) then
    raise exception 'Break placement must fit within the shift.';
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, shift_template_id, weekdays, break_start_minute, note, status, requested_by
  ) values (
    v_clinic_id, p_therapist_id, p_shift_template_id, p_weekdays, p_break_start_minute, nullif(trim(both from p_note), ''), 'pending', auth.uid()
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function public.request_custom_hours(
  p_therapist_id uuid,
  p_custom_hours jsonb,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
  v_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not is_own_therapist(v_clinic_id, p_therapist_id) then
    raise exception 'Not authorized.';
  end if;
  if not working_hours_valid(p_custom_hours) then
    raise exception 'Working hours must be non-overlapping times within the day, earliest first.';
  end if;

  update therapist_shift_assignments set status = 'superseded', updated_at = now()
    where therapist_id = p_therapist_id and status = 'pending';

  insert into therapist_shift_assignments (
    clinic_id, therapist_id, custom_hours, note, status, requested_by
  ) values (
    v_clinic_id, p_therapist_id, p_custom_hours, nullif(trim(both from p_note), ''), 'pending', auth.uid()
  ) returning id into v_id;

  return v_id;
end $$;

-- Approves either path (shift or custom hours) — branches on
-- shift_template_id, then delegates to the same apply_shift_hours/
-- apply_custom_hours helpers (Task 1) that assign_shift/assign_custom_hours
-- (Task 2) use directly, since approving IS the same effect as an admin
-- assigning it directly, just reached via the request queue.
create or replace function public.approve_shift_assignment(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
  v_shift record;
begin
  select * into v_req from therapist_shift_assignments where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if not (is_clinic_admin(v_req.clinic_id) or is_front_desk(v_req.clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been actioned.';
  end if;

  if v_req.shift_template_id is not null then
    select * into v_shift from shift_templates where id = v_req.shift_template_id;
    if not found or not v_shift.active then raise exception 'Shift template no longer available.'; end if;
    if v_req.break_start_minute is not null and (
      v_req.break_start_minute < v_shift.start_minute
      or v_req.break_start_minute + v_shift.break_duration_minutes > v_shift.end_minute
    ) then
      raise exception 'Break placement no longer fits the shift.';
    end if;
    perform apply_shift_hours(
      v_req.therapist_id, v_req.weekdays, v_shift.start_minute, v_shift.end_minute,
      coalesce(v_req.break_start_minute, v_shift.default_break_start_minute), v_shift.break_duration_minutes
    );
  else
    perform apply_custom_hours(v_req.therapist_id, v_req.custom_hours);
  end if;

  update therapist_shift_assignments set status = 'approved', decided_by = auth.uid(), decided_at = now()
    where id = p_request_id;
end $$;

create or replace function public.decline_shift_assignment(p_request_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  select * into v_req from therapist_shift_assignments where id = p_request_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if not (is_clinic_admin(v_req.clinic_id) or is_front_desk(v_req.clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been actioned.';
  end if;
  update therapist_shift_assignments
    set status = 'declined', decided_by = auth.uid(), decided_at = now(), note = coalesce(nullif(trim(both from p_note), ''), note)
    where id = p_request_id;
end $$;

-- Therapists can no longer write working_hours directly — every path now
-- goes through a request/assign RPC above, which all converge on
-- derive_working_hours. Admin/front-desk keep direct access (they ARE
-- the approver) for any remaining callers during migration, though new
-- UI should prefer assign_shift/assign_custom_hours.
create or replace function public.set_therapist_working_hours(
  p_therapist_id uuid,
  p_hours jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from therapists where id = p_therapist_id for update;
  if not found then raise exception 'Therapist not found.'; end if;
  if not (is_clinic_admin(v_clinic_id) or is_front_desk(v_clinic_id)) then
    raise exception 'Not authorized.';
  end if;
  if not working_hours_valid(p_hours) then
    raise exception 'Working hours must be non-overlapping times within the day, earliest first.';
  end if;
  update therapists set working_hours = p_hours, updated_at = now() where id = p_therapist_id;
end $$;

revoke execute on function public.request_shift_assignment(uuid, uuid, integer[], integer, text) from public, anon;
revoke execute on function public.request_custom_hours(uuid, jsonb, text) from public, anon;
revoke execute on function public.approve_shift_assignment(uuid) from public, anon;
revoke execute on function public.decline_shift_assignment(uuid, text) from public, anon;
grant execute on function public.request_shift_assignment(uuid, uuid, integer[], integer, text) to authenticated;
grant execute on function public.request_custom_hours(uuid, jsonb, text) to authenticated;
grant execute on function public.approve_shift_assignment(uuid) to authenticated;
grant execute on function public.decline_shift_assignment(uuid, text) to authenticated;
```

- [ ] **Step 2: Apply and verify**

Apply via `apply_migration` (name `shift_scheduling_request_rpcs`). Verify:
```sql
select routine_name from information_schema.routines where routine_schema = 'public'
  and routine_name in ('request_shift_assignment','request_custom_hours','approve_shift_assignment','decline_shift_assignment');
select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'set_therapist_working_hours';
```
Expected: all four new functions present; `set_therapist_working_hours` still takes exactly `(therapist_id uuid, hours jsonb)` (signature unchanged — only the body's authorization check changed, confirming it no longer has an `is_own_therapist` branch requires reading the function body via `pg_get_functiondef`, not just the signature).

- [ ] **Step 3: SQL-level test — replace-pending behavior**

```sql
select request_shift_assignment('<therapist_id>', '<template_id>', array[2], null, 'first request');
select request_shift_assignment('<therapist_id>', '<template_id>', array[4], null, 'second request');
select status, note from therapist_shift_assignments where therapist_id = '<therapist_id>' order by created_at;
-- Expected: first row 'superseded', second row 'pending' — not two pending rows.
```

- [ ] **Step 4: SQL-level test — approve applies hours, decline does not**

```sql
select approve_shift_assignment('<the pending request id from Step 3>');
select working_hours from therapists where id = '<therapist_id>';
-- Expected: weekday 4's interval reflects the template.
```

- [ ] **Step 5: SQL-level test — a pending request is closed out by a direct admin assignment**

A therapist asks for Saturday on the Evening shift (pending); before anyone approves it, the admin directly assigns Saturday to the Morning shift instead via `assign_shift` (Task 2). The now-moot pending request must not linger as 'pending' — the admin's direct action already resolved what it was asking for.

```sql
select request_shift_assignment('<therapist_id>', '<evening_template_id>', array[6], null, 'wants Saturdays too');
select assign_shift('<therapist_id>', '<template_id>', array[6], null);
select status from therapist_shift_assignments where therapist_id = '<therapist_id>' and shift_template_id = '<evening_template_id>' and weekdays = array[6];
-- Expected: 'superseded', not 'pending'
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261011092000_shift_scheduling_request_rpcs.sql
git commit -m "feat(schedule): add therapist shift-request/approve RPCs, remove self-write"
```

---

### Task 4: Self-service break placement RPC

**Files:**
- Create: `supabase/migrations/20261011093000_shift_scheduling_break_placement.sql`

**Interfaces:**
- Produces: `set_break_placement(uuid, integer) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- Self-service, immediate, no approval — moving a fixed-duration break
-- within an already-approved shift never changes total capacity. Only
-- valid on an approved, shift_template_id-based assignment; duration is
-- never a parameter here, it cannot be changed through this RPC.
create or replace function public.set_break_placement(
  p_assignment_id uuid,
  p_break_start_minute integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_assignment record;
  v_shift record;
  v_hours jsonb;
begin
  select * into v_assignment from therapist_shift_assignments where id = p_assignment_id for update;
  if not found then raise exception 'Assignment not found.'; end if;
  if not (
    is_clinic_admin(v_assignment.clinic_id)
    or is_front_desk(v_assignment.clinic_id)
    or is_own_therapist(v_assignment.clinic_id, v_assignment.therapist_id)
  ) then
    raise exception 'Not authorized.';
  end if;
  if v_assignment.status <> 'approved' or v_assignment.shift_template_id is null then
    raise exception 'Break placement only applies to an approved shift assignment.';
  end if;

  select * into v_shift from shift_templates where id = v_assignment.shift_template_id;
  if p_break_start_minute < v_shift.start_minute
     or p_break_start_minute + v_shift.break_duration_minutes > v_shift.end_minute then
    raise exception 'Break placement must fit within the shift.';
  end if;

  update therapist_shift_assignments set break_start_minute = p_break_start_minute, updated_at = now()
    where id = p_assignment_id;

  select working_hours into v_hours from therapists where id = v_assignment.therapist_id;
  v_hours := derive_working_hours(
    v_hours, v_assignment.weekdays, v_shift.start_minute, v_shift.end_minute,
    p_break_start_minute, v_shift.break_duration_minutes
  );
  if not working_hours_valid(v_hours) then
    raise exception 'Derived working hours are invalid.';
  end if;
  update therapists set working_hours = v_hours, updated_at = now() where id = v_assignment.therapist_id;
end $$;

revoke execute on function public.set_break_placement(uuid, integer) from public, anon;
grant execute on function public.set_break_placement(uuid, integer) to authenticated;
```

- [ ] **Step 2: Apply and verify**

Apply via `apply_migration` (name `shift_scheduling_break_placement`). Verify presence via `information_schema.routines` as in prior tasks.

- [ ] **Step 3: SQL-level test — bounds rejection and valid move**

```sql
select set_break_placement('<approved assignment id>', 500);  -- outside shift bounds
-- Expected: raises "Break placement must fit within the shift."
select set_break_placement('<approved assignment id>', 670);  -- valid
select break_start_minute from therapist_shift_assignments where id = '<approved assignment id>';
-- Expected: 670
```

- [ ] **Step 4: SQL-level test — rejected on a pending assignment**

```sql
select set_break_placement('<a pending (not approved) assignment id>', 670);
-- Expected: raises "Break placement only applies to an approved shift assignment."
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261011093000_shift_scheduling_break_placement.sql
git commit -m "feat(schedule): add self-service break-placement RPC"
```

---

### Task 5: Domain types, Dexie schema, and read-only repos

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/repositories/types.ts`
- Modify: `src/repositories/local.ts`
- Test: `src/repositories/local.test.ts` (if it exists — check first; if not, cover via the Task 9 service-layer tests instead, since this repo's convention is thin repos with service-level test coverage, confirmed by `appointmentRequests`'s repo having no dedicated test file).

**Interfaces:**
- Consumes: nothing new.
- Produces: `ShiftTemplate`, `TherapistShiftAssignment`, `ShiftAssignmentStatus` types; `repos.shiftTemplates.list(clinicId, includeInactive?)`, `repos.therapistShiftAssignments.listByClinic(clinicId)`, `repos.therapistShiftAssignments.listByTherapist(therapistId)`.

- [ ] **Step 1: Add domain types**

In `src/domain/types.ts`, near `WorkingHours` (line 253):

```ts
export interface ShiftTemplate {
  id: UUID;
  clinicId: UUID;
  name: string;
  startMinute: number;
  endMinute: number;
  breakDurationMinutes: number;
  defaultBreakStartMinute: number | null;
  active: boolean;
  updatedAt: string;
}

export type ShiftAssignmentStatus = 'pending' | 'approved' | 'declined' | 'superseded';

/**
 * A therapist's shift (or custom-hours) assignment/request. Exactly one
 * of shiftTemplateId / customHours is set. Writes are RPC-only (assign/
 * request/approve/decline/set_break_placement) — mirrors AppointmentRequest's
 * "no client INSERT policy exists" convention, see that type's own doc
 * comment. Read-only sync, same as AppointmentRequest.
 */
export interface TherapistShiftAssignment {
  id: UUID;
  clinicId: UUID;
  therapistId: UUID;
  shiftTemplateId: UUID | null;
  customHours: WorkingHours | null;
  weekdays: number[] | null;
  breakStartMinute: number | null;
  status: ShiftAssignmentStatus;
  note: string | null;
  requestedBy: UUID | null;
  decidedBy: UUID | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add Dexie tables and sync registration**

In `src/lib/db.ts`:
- Add to the `SyncedTable` union (near line 58, alongside `'referring_source_catalog'`): `| 'shift_templates' | 'therapist_shift_assignments'`.
- Add to `ALL_SYNCED_TABLES` (near line 90): `'shift_templates', 'therapist_shift_assignments',`.
- Do **not** add to `CLIENT_WRITABLE_TABLES` — these are RPC-gated, not outbox-written.
- Add table property declarations on `ClinicDB` (near line 156): `shift_templates!: Table<ShiftTemplate, string>;` and `therapist_shift_assignments!: Table<TherapistShiftAssignment, string>;`.
- Add a new version bump (after the existing `version(21)` block, near line 280):

```ts
this.version(22).stores({
  shift_templates: 'id, clinicId, active',
  therapist_shift_assignments: 'id, clinicId, therapistId, status, shiftTemplateId',
});
```

- [ ] **Step 3: Run typecheck to confirm the exhaustiveness check passes**

Run: `npx tsc --noEmit`
Expected: no errors — if `_AssertAllSyncedTablesCovered` fails, it means `ALL_SYNCED_TABLES` is missing one of the two new `SyncedTable` members; fix before continuing.

- [ ] **Step 4: Add repo interfaces**

In `src/repositories/types.ts`, near `ReferringSourceCatalogRepo` (line 64):

```ts
export interface ShiftTemplatesRepo {
  list(clinicId: UUID, includeInactive?: boolean): Promise<ShiftTemplate[]>;
}

export interface TherapistShiftAssignmentsRepo {
  listByClinic(clinicId: UUID): Promise<TherapistShiftAssignment[]>;
  listByTherapist(therapistId: UUID): Promise<TherapistShiftAssignment[]>;
}
```

Register both on the aggregate repo type (near line 264): `shiftTemplates: ShiftTemplatesRepo;` and `therapistShiftAssignments: TherapistShiftAssignmentsRepo;`.

- [ ] **Step 5: Implement the repos**

In `src/repositories/local.ts`, near `referringSourceCatalog` (line 117):

```ts
const shiftTemplates: ShiftTemplatesRepo = {
  async list(clinicId, includeInactive = false) {
    const all = await db.shift_templates.where('clinicId').equals(clinicId).toArray();
    return all.filter((t) => includeInactive || t.active).sort((a, b) => a.name.localeCompare(b.name));
  },
};

const therapistShiftAssignments: TherapistShiftAssignmentsRepo = {
  listByClinic: (clinicId) => db.therapist_shift_assignments.where('clinicId').equals(clinicId).toArray(),
  listByTherapist: (therapistId) => db.therapist_shift_assignments.where('therapistId').equals(therapistId).toArray(),
};
```

Register both in the exported `repos` object (near line 421): `shiftTemplates, therapistShiftAssignments,`.

- [ ] **Step 6: Run the full check**

Run: `npx tsc --noEmit && npx eslint src/domain/types.ts src/lib/db.ts src/repositories/types.ts src/repositories/local.ts && npm run test`
Expected: clean, all existing tests still pass (no behavior changed for existing tables).

- [ ] **Step 7: Commit**

```bash
git add src/domain/types.ts src/lib/db.ts src/repositories/types.ts src/repositories/local.ts
git commit -m "feat(schedule): add shift template/assignment domain types, sync, and repos"
```

---

### Task 6: `bookingService` wrapper methods

**Files:**
- Modify: `src/services/bookingService.ts`
- Test: `src/services/bookingService.test.ts` (check if it exists; if not, mirror the testing approach used for `submitAppointmentRequest`/`addWaitlistEntry` — likely no dedicated unit test, since these are thin RPC wrappers covered by the UI-level tests in later tasks. Confirm by grepping for an existing `bookingService.test.ts` before deciding.)

**Interfaces:**
- Consumes: all RPCs from Tasks 2-4; `ShiftTemplate`, `TherapistShiftAssignment` types.
- Produces: `bookingService.createShiftTemplate`, `.updateShiftTemplate`, `.assignShift`, `.assignCustomHours`, `.requestShiftAssignment`, `.requestCustomHours`, `.approveShiftAssignment`, `.declineShiftAssignment`, `.setBreakPlacement`.

- [ ] **Step 1: Add the wrapper methods**

In `src/services/bookingService.ts`, near `setWorkingHours` (line 302):

```ts
async createShiftTemplate(params: {
  clinicId: UUID;
  name: string;
  startMinute: number;
  endMinute: number;
  breakDurationMinutes?: number;
  defaultBreakStartMinute?: number | null;
}): Promise<UUID> {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase.rpc('create_shift_template', {
    p_clinic_id: params.clinicId,
    p_name: params.name,
    p_start_minute: params.startMinute,
    p_end_minute: params.endMinute,
    p_break_duration_minutes: params.breakDurationMinutes ?? 0,
    p_default_break_start_minute: params.defaultBreakStartMinute ?? null,
  });
  if (error) throw new Error(`Could not create shift template: ${error.message}`);
  syncEngine.schedule(0);
  return data as UUID;
},

async updateShiftTemplate(params: {
  templateId: UUID;
  name: string;
  startMinute: number;
  endMinute: number;
  breakDurationMinutes: number;
  defaultBreakStartMinute: number | null;
  active: boolean;
}): Promise<void> {
  const supabase = supabaseOrThrow();
  const { error } = await supabase.rpc('update_shift_template', {
    p_template_id: params.templateId,
    p_name: params.name,
    p_start_minute: params.startMinute,
    p_end_minute: params.endMinute,
    p_break_duration_minutes: params.breakDurationMinutes,
    p_default_break_start_minute: params.defaultBreakStartMinute,
    p_active: params.active,
  });
  if (error) throw new Error(`Could not update shift template: ${error.message}`);
  syncEngine.schedule(0);
},

async assignShift(params: {
  therapistId: UUID;
  shiftTemplateId: UUID;
  weekdays: number[];
  breakStartMinute?: number | null;
}): Promise<UUID> {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase.rpc('assign_shift', {
    p_therapist_id: params.therapistId,
    p_shift_template_id: params.shiftTemplateId,
    p_weekdays: params.weekdays,
    p_break_start_minute: params.breakStartMinute ?? null,
  });
  if (error) throw new Error(`Could not assign shift: ${error.message}`);
  syncEngine.schedule(0);
  return data as UUID;
},

async assignCustomHours(therapistId: UUID, hours: WorkingHours | null): Promise<UUID> {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase.rpc('assign_custom_hours', {
    p_therapist_id: therapistId,
    p_custom_hours: hours,
  });
  if (error) throw new Error(`Could not assign custom hours: ${error.message}`);
  syncEngine.schedule(0);
  return data as UUID;
},

async requestShiftAssignment(params: {
  therapistId: UUID;
  shiftTemplateId: UUID;
  weekdays: number[];
  breakStartMinute?: number | null;
  note?: string | null;
}): Promise<UUID> {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase.rpc('request_shift_assignment', {
    p_therapist_id: params.therapistId,
    p_shift_template_id: params.shiftTemplateId,
    p_weekdays: params.weekdays,
    p_break_start_minute: params.breakStartMinute ?? null,
    p_note: params.note ?? null,
  });
  if (error) throw new Error(`Could not submit shift request: ${error.message}`);
  syncEngine.schedule(0);
  return data as UUID;
},

async requestCustomHours(therapistId: UUID, hours: WorkingHours | null, note?: string | null): Promise<UUID> {
  const supabase = supabaseOrThrow();
  const { data, error } = await supabase.rpc('request_custom_hours', {
    p_therapist_id: therapistId,
    p_custom_hours: hours,
    p_note: note ?? null,
  });
  if (error) throw new Error(`Could not submit hours request: ${error.message}`);
  syncEngine.schedule(0);
  return data as UUID;
},

async approveShiftAssignment(requestId: UUID): Promise<void> {
  const supabase = supabaseOrThrow();
  const { error } = await supabase.rpc('approve_shift_assignment', { p_request_id: requestId });
  if (error) throw new Error(`Could not approve request: ${error.message}`);
  syncEngine.schedule(0);
},

async declineShiftAssignment(requestId: UUID, note?: string | null): Promise<void> {
  const supabase = supabaseOrThrow();
  const { error } = await supabase.rpc('decline_shift_assignment', { p_request_id: requestId, p_note: note ?? null });
  if (error) throw new Error(`Could not decline request: ${error.message}`);
  syncEngine.schedule(0);
},

async setBreakPlacement(assignmentId: UUID, breakStartMinute: number): Promise<void> {
  const supabase = supabaseOrThrow();
  const { error } = await supabase.rpc('set_break_placement', {
    p_assignment_id: assignmentId,
    p_break_start_minute: breakStartMinute,
  });
  if (error) throw new Error(`Could not move break: ${error.message}`);
  syncEngine.schedule(0);
},
```

- [ ] **Step 2: Run the full check**

Run: `npx tsc --noEmit && npx eslint src/services/bookingService.ts && npm run test`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/services/bookingService.ts
git commit -m "feat(schedule): add bookingService wrappers for shift RPCs"
```

---

### Task 7: Settings → Team — Shift Templates CRUD

**Files:**
- Create: `src/features/settings/ShiftTemplatesSection.tsx`
- Test: `src/features/settings/ShiftTemplatesSection.test.tsx`
- Modify: `src/features/settings/SettingsPage.tsx` (render inside the `'team'` tab, near line 493-502)

**Interfaces:**
- Consumes: `repos.shiftTemplates.list`, `bookingService.createShiftTemplate`, `bookingService.updateShiftTemplate`, `useClinic()`, `Field`/`inputCls`/`btnPrimary`/`CatalogStats`/`CatalogAddCard` conventions from `@/components/ui` and `CatalogSection.tsx`'s existing pattern.
- Produces: `<ShiftTemplatesSection />` (no props — reads clinic from context like `ReferringSourcesCatalog`).

- [ ] **Step 1: Write the component**, mirroring `ReferringSourcesCatalog`/`ReferralSourceCard`/`ReferralSourceAddForm`'s structure (`CatalogSection.tsx:1069-1283`) but for shift fields. List each template as a card showing name, time range (formatted from minutes, e.g. "9:00 AM – 1:00 PM"), break info ("30-min break, defaults to 11:00 AM"), Edit/Deactivate buttons. Edit mode shows inline inputs for name + four `<input type="time">`-backed minute fields (start, end, break duration in minutes, default break start). Add form at the bottom creates a new template via `bookingService.createShiftTemplate`. Use `useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id])` for the list (matches `ReferringSourcesCatalog`'s own live-query pattern exactly).

```tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { Field, inputCls, btnPrimary, btnSecondary } from '@/components/ui';
import type { ShiftTemplate } from '@/domain/types';

function minutesToTimeInput(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}
function timeInputToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function formatRange(startMinute: number, endMinute: number): string {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${min.toString().padStart(2, '0')} ${period}`;
  };
  return `${fmt(startMinute)} – ${fmt(endMinute)}`;
}

function ShiftTemplateCard({ template }: { template: ShiftTemplate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [start, setStart] = useState(minutesToTimeInput(template.startMinute));
  const [end, setEnd] = useState(minutesToTimeInput(template.endMinute));
  const [breakDuration, setBreakDuration] = useState(String(template.breakDurationMinutes));
  const [breakStart, setBreakStart] = useState(
    template.defaultBreakStartMinute !== null ? minutesToTimeInput(template.defaultBreakStartMinute) : ''
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await bookingService.updateShiftTemplate({
        templateId: template.id,
        name: name.trim(),
        startMinute: timeInputToMinutes(start),
        endMinute: timeInputToMinutes(end),
        breakDurationMinutes: Number(breakDuration) || 0,
        defaultBreakStartMinute: breakStart ? timeInputToMinutes(breakStart) : null,
        active: template.active,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    await bookingService.updateShiftTemplate({
      templateId: template.id,
      name: template.name,
      startMinute: template.startMinute,
      endMinute: template.endMinute,
      breakDurationMinutes: template.breakDurationMinutes,
      defaultBreakStartMinute: template.defaultBreakStartMinute,
      active: !template.active,
    });
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End"><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Break (minutes)"><input type="number" min={0} className={inputCls} value={breakDuration} onChange={(e) => setBreakDuration(e.target.value)} /></Field>
          <Field label="Default break start"><input type="time" className={inputCls} value={breakStart} onChange={(e) => setBreakStart(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 ${!template.active ? 'opacity-60' : ''}`}>
      <p className="font-medium text-[var(--ink)]">{template.name}</p>
      <p className="text-sm text-[var(--muted)]">{formatRange(template.startMinute, template.endMinute)}</p>
      {template.breakDurationMinutes > 0 && (
        <p className="text-xs text-[var(--muted)]">
          {template.breakDurationMinutes}-min break
          {template.defaultBreakStartMinute !== null ? `, defaults to ${minutesToTimeInput(template.defaultBreakStartMinute)}` : ''}
        </p>
      )}
      <div className="mt-2 flex gap-3 text-xs font-medium">
        <button type="button" className="text-[var(--teal)]" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="text-[var(--rust)]" onClick={() => void toggleActive()}>
          {template.active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
    </div>
  );
}

function ShiftTemplateAddForm({ clinicId }: { clinicId: string }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [breakDuration, setBreakDuration] = useState('0');
  const [breakStart, setBreakStart] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await bookingService.createShiftTemplate({
        clinicId,
        name: name.trim(),
        startMinute: timeInputToMinutes(start),
        endMinute: timeInputToMinutes(end),
        breakDurationMinutes: Number(breakDuration) || 0,
        defaultBreakStartMinute: breakStart ? timeInputToMinutes(breakStart) : null,
      });
      setName(''); setBreakDuration('0'); setBreakStart('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-4 space-y-3">
      <Field label="Name"><input className={inputCls} placeholder="Morning shift" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start"><input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End"><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Break (minutes)"><input type="number" min={0} className={inputCls} value={breakDuration} onChange={(e) => setBreakDuration(e.target.value)} /></Field>
        <Field label="Default break start"><input type="time" className={inputCls} value={breakStart} onChange={(e) => setBreakStart(e.target.value)} /></Field>
      </div>
      <button type="button" className={btnPrimary} onClick={() => void add()} disabled={saving || !name.trim()}>
        {saving ? 'Adding…' : '+ Add shift template'}
      </button>
    </div>
  );
}

export function ShiftTemplatesSection() {
  const clinic = useClinic();
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id]);

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-[var(--ink)]">Shift templates</h2>
      <p className="text-sm text-[var(--muted)]">Reusable hours + break patterns you can assign to therapists.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(templates ?? []).map((t) => <ShiftTemplateCard key={t.id} template={t} />)}
      </div>
      <ShiftTemplateAddForm clinicId={clinic.id} />
    </div>
  );
}
```

- [ ] **Step 2: Write the test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftTemplatesSection } from './ShiftTemplatesSection';
import type { ShiftTemplate } from '@/domain/types';

let templates: ShiftTemplate[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
const createShiftTemplate = vi.fn();
const updateShiftTemplate = vi.fn();
vi.mock('@/services', () => ({
  repos: { shiftTemplates: { list: async () => templates } },
  bookingService: { createShiftTemplate: (...args: unknown[]) => createShiftTemplate(...args), updateShiftTemplate: (...args: unknown[]) => updateShiftTemplate(...args) },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ShiftTemplatesSection', () => {
  it('lists existing templates with their hours and break', () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 30, defaultBreakStartMinute: 660, active: true, updatedAt: '' }];
    render(<ShiftTemplatesSection />);
    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(screen.getByText('9:00 AM – 1:00 PM')).toBeInTheDocument();
    expect(screen.getByText(/30-min break/)).toBeInTheDocument();
  });

  it('creates a template from the add form', () => {
    templates = [];
    render(<ShiftTemplatesSection />);
    fireEvent.change(screen.getByPlaceholderText('Morning shift'), { target: { value: 'Evening' } });
    fireEvent.click(screen.getByRole('button', { name: /add shift template/i }));
    expect(createShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'c1', name: 'Evening' }));
  });

  it('deactivates a template', () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(updateShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1', active: false }));
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/settings/ShiftTemplatesSection.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 4: Wire into Settings**

In `src/features/settings/SettingsPage.tsx`, near line 493-502, add `<ShiftTemplatesSection />` inside the `activeTab === 'team'` block, after `<Therapists />`. Import it at the top of the file.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit && npx eslint src/features/settings/ShiftTemplatesSection.tsx src/features/settings/SettingsPage.tsx && npm run test && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/ShiftTemplatesSection.tsx src/features/settings/ShiftTemplatesSection.test.tsx src/features/settings/SettingsPage.tsx
git commit -m "feat(settings): add Shift Templates admin CRUD section"
```

---

### Task 8: Settings → Team — per-therapist assignment + pending-request review

**Files:**
- Create: `src/features/settings/ShiftAssignmentsSection.tsx`
- Test: `src/features/settings/ShiftAssignmentsSection.test.tsx`
- Modify: `src/features/settings/SettingsPage.tsx` (render alongside `ShiftTemplatesSection`)

**Interfaces:**
- Consumes: `repos.therapists.list` (existing), `repos.shiftTemplates.list`, `repos.therapistShiftAssignments.listByClinic`, `bookingService.assignShift`, `.assignCustomHours`, `.approveShiftAssignment`, `.declineShiftAssignment`.
- Produces: `<ShiftAssignmentsSection />`.

- [ ] **Step 1: Write the component.** One row per active therapist: current assignment summary (shift name + weekdays, "Custom hours", or "No shift assigned"), an "Assign shift" picker (`<select>` of active shift templates + weekday checkboxes, calling `bookingService.assignShift`), and — when a `pending` assignment exists for that therapist — a "Pending change" badge showing old vs. requested with Approve/Decline buttons calling `bookingService.approveShiftAssignment`/`declineShiftAssignment`.

```tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { inputCls, btnPrimary } from '@/components/ui';
import type { ShiftTemplate, TherapistShiftAssignment, Therapist } from '@/domain/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function summarize(assignment: TherapistShiftAssignment | undefined, templateById: Map<string, ShiftTemplate>): string {
  if (!assignment) return 'No shift assigned';
  if (assignment.shiftTemplateId) {
    const t = templateById.get(assignment.shiftTemplateId);
    const days = (assignment.weekdays ?? []).map((d) => WEEKDAY_LABELS[d]).join('/');
    return `${t?.name ?? 'Unknown shift'} — ${days}`;
  }
  return 'Custom hours';
}

function TherapistShiftRow({
  therapist, templates, approved, pending,
}: {
  therapist: Therapist;
  templates: ShiftTemplate[];
  approved: TherapistShiftAssignment[];
  pending: TherapistShiftAssignment | undefined;
}) {
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const [shiftId, setShiftId] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [assigning, setAssigning] = useState(false);

  async function assign() {
    if (!shiftId || weekdays.length === 0) return;
    setAssigning(true);
    try {
      await bookingService.assignShift({ therapistId: therapist.id, shiftTemplateId: shiftId, weekdays });
      setShiftId(''); setWeekdays([]);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
      <p className="font-medium text-[var(--ink)]">{therapist.name}</p>
      <p className="text-sm text-[var(--muted)]">{approved.map((a) => summarize(a, templateById)).join('; ') || 'No shift assigned'}</p>

      {pending && (
        <div className="rounded-lg bg-[var(--amber-light)] p-2 text-sm">
          <p className="font-medium text-[var(--amber)]">Pending: {summarize(pending, templateById)}</p>
          <div className="mt-1 flex gap-3 text-xs font-medium">
            <button type="button" className="text-[var(--teal)]" onClick={() => void bookingService.approveShiftAssignment(pending.id)}>Approve</button>
            <button type="button" className="text-[var(--rust)]" onClick={() => void bookingService.declineShiftAssignment(pending.id)}>Decline</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select className={inputCls} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          <option value="">Assign a shift…</option>
          {templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {WEEKDAY_LABELS.map((label, day) => (
          <label key={day} className="text-xs">
            <input
              type="checkbox"
              checked={weekdays.includes(day)}
              onChange={(e) => setWeekdays((current) => e.target.checked ? [...current, day] : current.filter((d) => d !== day))}
            />
            {label}
          </label>
        ))}
        <button type="button" className={btnPrimary} onClick={() => void assign()} disabled={assigning || !shiftId || weekdays.length === 0}>
          {assigning ? 'Assigning…' : 'Assign'}
        </button>
      </div>
    </div>
  );
}

export function ShiftAssignmentsSection() {
  const clinic = useClinic();
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id), [clinic.id]);
  const assignments = useLiveQuery(() => repos.therapistShiftAssignments.listByClinic(clinic.id), [clinic.id]);

  if (!therapists || !templates || !assignments) return null;

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-[var(--ink)]">Shift assignments</h2>
      {templates.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No shift templates yet — add one above, or use custom hours per therapist.</p>
      )}
      <div className="space-y-2">
        {therapists.filter((t) => t.active !== false).map((therapist) => (
          <TherapistShiftRow
            key={therapist.id}
            therapist={therapist}
            templates={templates}
            approved={assignments.filter((a) => a.therapistId === therapist.id && a.status === 'approved')}
            pending={assignments.find((a) => a.therapistId === therapist.id && a.status === 'pending')}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftAssignmentsSection } from './ShiftAssignmentsSection';
import type { ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

let therapists: Therapist[];
let templates: ShiftTemplate[];
let assignments: TherapistShiftAssignment[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
const approveShiftAssignment = vi.fn();
const declineShiftAssignment = vi.fn();
vi.mock('@/services', () => ({
  repos: {
    therapists: { list: async () => therapists },
    shiftTemplates: { list: async () => templates },
    therapistShiftAssignments: { listByClinic: async () => assignments },
  },
  bookingService: {
    assignShift: vi.fn(),
    approveShiftAssignment: (...a: unknown[]) => approveShiftAssignment(...a),
    declineShiftAssignment: (...a: unknown[]) => declineShiftAssignment(...a),
  },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ShiftAssignmentsSection', () => {
  it('shows a pending-change badge with Approve/Decline', () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    assignments = [{ id: 'a1', clinicId: 'c1', therapistId: 'th1', shiftTemplateId: 't1', customHours: null, weekdays: [1, 3], breakStartMinute: null, status: 'pending', note: null, requestedBy: null, decidedBy: null, decidedAt: null, createdAt: '', updatedAt: '' }];
    render(<ShiftAssignmentsSection />);
    expect(screen.getByText(/Pending: Morning/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approveShiftAssignment).toHaveBeenCalledWith('a1');
  });

  it('shows no pending badge when there is none', () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Priya', active: true, userId: null, updatedAt: '' } as Therapist];
    templates = [];
    assignments = [];
    render(<ShiftAssignmentsSection />);
    expect(screen.queryByText(/Pending:/)).not.toBeInTheDocument();
    expect(screen.getByText(/No shift templates yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/settings/ShiftAssignmentsSection.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 4: Wire into Settings** (next to `ShiftTemplatesSection` from Task 7).

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit && npx eslint src/features/settings/ShiftAssignmentsSection.tsx src/features/settings/SettingsPage.tsx && npm run test && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/ShiftAssignmentsSection.tsx src/features/settings/ShiftAssignmentsSection.test.tsx src/features/settings/SettingsPage.tsx
git commit -m "feat(settings): add per-therapist shift assignment and approval review"
```

---

### Task 9: Therapist self-service — `ShiftRequestSheet` in `AccountMenu`

**Files:**
- Create: `src/components/schedule/ShiftRequestSheet.tsx`
- Test: `src/components/schedule/ShiftRequestSheet.test.tsx`
- Modify: `src/app/AccountMenu.tsx`

**Interfaces:**
- Consumes: `repos.shiftTemplates.list`, `bookingService.requestShiftAssignment`, `bookingService.requestCustomHours`, existing `WorkingHoursSheet` (for the custom-hours fallback, reused unchanged).
- Produces: `<ShiftRequestSheet open therapistId clinicId value onClose />` (mirrors `AddToWaitlistSheet`'s self-contained-service-call + `open`/`onClose` shape, per Task 2's agent findings).

- [ ] **Step 1: Write the sheet**, mirroring `ClosedDaysSheet`/`AddToWaitlistSheet`'s pattern (self-contained service call, `open`/`onClose`, reset-on-open). Shows a shift picker (template + weekday checkboxes) submitting via `requestShiftAssignment`; a "My hours don't match any shift" link toggles to rendering the existing `WorkingHoursSheet` configured with `onSave={(hours) => bookingService.requestCustomHours(therapistId, hours)}`.

```tsx
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { WorkingHoursSheet } from './WorkingHoursSheet';
import { ErrorNote, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import type { UUID } from '@/domain/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ShiftRequestSheet({
  open, therapistId, therapistName, clinicId, clinic, onClose,
}: {
  open: boolean;
  therapistId: UUID;
  therapistName: string;
  clinicId: UUID;
  clinic: { startHour: number; endHour: number; closedWeekdays?: number[] };
  onClose: () => void;
}) {
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinicId), [clinicId]);
  const [shiftId, setShiftId] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [customMode, setCustomMode] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setShiftId(''); setWeekdays([]); setCustomMode(false); setSubmitted(false); setError(null); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  if (customMode) {
    return (
      <WorkingHoursSheet
        open
        therapistName={therapistName}
        value={null}
        clinic={clinic}
        onSave={async (hours) => { await bookingService.requestCustomHours(therapistId, hours); setSubmitted(true); }}
        onClose={onClose}
      />
    );
  }

  async function submit() {
    if (!shiftId || weekdays.length === 0) return setError('Pick a shift and at least one day.');
    setBusy(true);
    setError(null);
    try {
      await bookingService.requestShiftAssignment({ therapistId, shiftTemplateId: shiftId, weekdays });
      setSubmitted(true);
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full rounded-t-2xl bg-[var(--surface)] p-4 sm:max-w-md sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold text-[var(--ink)]">My working hours</h2>
        {submitted ? (
          <p className="mt-3 text-sm text-[var(--ink)]">Submitted — waiting on approval. Your current hours stay in effect until then.</p>
        ) : (templates ?? []).length === 0 ? (
          <div>
            <p className="mt-2 text-sm text-[var(--muted)]">No shift templates set up yet.</p>
            <button type="button" className="mt-2 text-sm font-medium text-[var(--teal)] underline" onClick={() => setCustomMode(true)}>Set custom hours instead</button>
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-3">
              <select className={inputCls} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                <option value="">Pick a shift…</option>
                {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((label, day) => (
                  <label key={day} className="text-sm">
                    <input type="checkbox" checked={weekdays.includes(day)} onChange={(e) => setWeekdays((c) => e.target.checked ? [...c, day] : c.filter((d) => d !== day))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <button type="button" className="mt-2 text-xs font-medium text-[var(--teal)] underline" onClick={() => setCustomMode(true)}>My hours don't match any shift</button>
            <ErrorNote message={error} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftRequestSheet } from './ShiftRequestSheet';
import type { ShiftTemplate } from '@/domain/types';

let templates: ShiftTemplate[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('./WorkingHoursSheet', () => ({ WorkingHoursSheet: () => <div>custom-hours-sheet</div> }));
const requestShiftAssignment = vi.fn();
vi.mock('@/services', () => ({
  repos: { shiftTemplates: { list: async () => templates } },
  bookingService: { requestShiftAssignment: (...a: unknown[]) => requestShiftAssignment(...a), requestCustomHours: vi.fn() },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const clinic = { startHour: 9, endHour: 17 };

describe('ShiftRequestSheet', () => {
  it('submits a shift request with the picked template and weekdays', async () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));
    await screen.findByText(/waiting on approval/i);
    expect(requestShiftAssignment).toHaveBeenCalledWith({ therapistId: 'th1', shiftTemplateId: 't1', weekdays: [1] });
  });

  it('falls through to custom hours when no templates exist', () => {
    templates = [];
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/set custom hours instead/i));
    expect(screen.getByText('custom-hours-sheet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/components/schedule/ShiftRequestSheet.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 4: Wire into `AccountMenu`**

Replace the direct `<WorkingHoursSheet>` usage (lines 224-237) with `<ShiftRequestSheet open={hoursOpen} therapistId={myTherapist.id} therapistName={myTherapist.name} clinicId={clinicId} clinic={{...}} onClose={() => setHoursOpen(false)} />`, keeping the same `{myTherapist && (...)}` gating and `hoursOpen` state. Remove the now-unused direct `bookingService.setWorkingHours` call and the `WorkingHoursSheet` import if nothing else in this file still uses it.

- [ ] **Step 5: Update `AccountMenu.test.tsx`**

The existing test mocks `WorkingHoursSheet` to render `null` (per the Task 2 agent's earlier finding this file already mocks it) — add a mock for `./ShiftRequestSheet` the same way, and update any assertion that referenced `WorkingHoursSheet` directly.

- [ ] **Step 6: Run the full check**

Run: `npx tsc --noEmit && npx eslint src/components/schedule/ShiftRequestSheet.tsx src/app/AccountMenu.tsx && npm run test && npm run build`

- [ ] **Step 7: Commit**

```bash
git add src/components/schedule/ShiftRequestSheet.tsx src/components/schedule/ShiftRequestSheet.test.tsx src/app/AccountMenu.tsx src/app/AccountMenu.test.tsx
git commit -m "feat(schedule): replace therapist self-service hours editing with shift requests"
```

---

### Task 10: Admin assign-shift entry point + pending-requests banner in `ScheduleBookingsView`

**Files:**
- Create: `src/components/schedule/AssignShiftSheet.tsx`
- Test: `src/components/schedule/AssignShiftSheet.test.tsx`
- Modify: `src/features/schedule/ScheduleBookingsView.tsx`

**Interfaces:**
- Consumes: `repos.shiftTemplates.list`, `repos.therapistShiftAssignments.listByClinic`, `bookingService.assignShift`, `bookingService.assignCustomHours` (replacing `setWorkingHours` inside `handleHoursSave`).
- Produces: `<AssignShiftSheet open therapistId therapistName clinicId onClose />`.

- [ ] **Step 1: Write `AssignShiftSheet`** — same shift-picker UI as `ShiftRequestSheet` (Task 9), but calls `bookingService.assignShift` (immediate) instead of `requestShiftAssignment`, and has no custom-hours fallback link (admin custom-hours assignment stays reachable via the existing `WorkingHoursSheet`/kebab-menu "Working hours, {name}" entry, now rewired in Step 3 below). Mirror the component structure from Task 9's non-custom branch, swapping the service call and removing the "My hours don't match any shift" link and the `submitted` waiting-on-approval copy (replace with immediate success → close).

- [ ] **Step 2: Write the test**, mirroring Task 9 Step 2's first test but asserting `assignShift` is called and the sheet closes immediately (no "waiting on approval" state) — call `onClose` and assert it fired after submit.

- [ ] **Step 3: Update `handleHoursSave` in `ScheduleBookingsView.tsx`** (lines 322-345) to call `bookingService.assignCustomHours(therapistId, hours)` instead of `bookingService.setWorkingHours(therapistId, hours)`, keeping its conflict-detection logic (the `workingIntervals`/`withinWorking` check and `pendingHoursSave` confirmation flow) completely unchanged — only the final save call's target method changes.

- [ ] **Step 4: Add an "Assign shift" kebab menu item** next to the existing "Working hours, {t.name}" item (lines 708-713), opening `AssignShiftSheet` via a new `assignShiftTherapistId` state (same shape as `hoursTherapistId`).

- [ ] **Step 5: Add the pending-requests banner.** Near the existing waitlist-match banner (search for `waitlistMatches.length > 0` in this file), add a `useMemo` counting pending `therapist_shift_assignments` for the clinic (via `repos.therapistShiftAssignments.listByClinic`, loaded with `useLiveQuery` alongside the file's other live queries), and render a second small banner when count > 0: `"{n} pending shift request(s)"` linking to Settings → Team (`<Link to="/settings" search={{ tab: 'team' }}>`).

- [ ] **Step 6: Run the full check**

Run: `npx tsc --noEmit && npx eslint src/components/schedule/AssignShiftSheet.tsx src/features/schedule/ScheduleBookingsView.tsx && npm run test && npm run build`

- [ ] **Step 7: Commit**

```bash
git add src/components/schedule/AssignShiftSheet.tsx src/components/schedule/AssignShiftSheet.test.tsx src/features/schedule/ScheduleBookingsView.tsx
git commit -m "feat(schedule): add admin shift-assignment entry point and pending-request banner"
```

---

### Task 11: Self-service break-placement control

**Files:**
- Create: `src/components/schedule/BreakPlacementControl.tsx`
- Test: `src/components/schedule/BreakPlacementControl.test.tsx`
- Modify: `src/app/AccountMenu.tsx` (render below the "My working hours" menu item, or inside `ShiftRequestSheet`'s closed state — place it in `AccountMenu`'s sheet area, visible once `myTherapist` has at least one approved shift-template assignment with `breakDurationMinutes > 0`)

**Interfaces:**
- Consumes: `repos.therapistShiftAssignments.listByTherapist`, `repos.shiftTemplates.list`, `bookingService.setBreakPlacement`.
- Produces: `<BreakPlacementControl therapistId clinicId />` (no `open`/`onClose` — renders inline, not a sheet).

- [ ] **Step 1: Write the component** — loads the therapist's approved shift-template assignments and their templates, renders nothing if none have `breakDurationMinutes > 0`; otherwise shows one row per such assignment with a `<input type="time">` pre-filled from `breakStartMinute ?? defaultBreakStartMinute`, calling `bookingService.setBreakPlacement(assignment.id, minutes)` on change (debounced or on blur, not on every keystroke).

```tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { inputCls } from '@/components/ui';
import type { UUID } from '@/domain/types';

function minutesToTimeInput(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}
function timeInputToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function BreakPlacementControl({ therapistId, clinicId }: { therapistId: UUID; clinicId: UUID }) {
  const assignments = useLiveQuery(() => repos.therapistShiftAssignments.listByTherapist(therapistId), [therapistId]);
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinicId), [clinicId]);
  const [saved, setSaved] = useState<string | null>(null);

  const templateById = new Map((templates ?? []).map((t) => [t.id, t]));
  const movable = (assignments ?? []).filter((a) => {
    if (a.status !== 'approved' || !a.shiftTemplateId) return false;
    const t = templateById.get(a.shiftTemplateId);
    return (t?.breakDurationMinutes ?? 0) > 0;
  });

  if (movable.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[var(--muted)]">Break time</p>
      {movable.map((a) => {
        const t = templateById.get(a.shiftTemplateId!)!;
        const current = a.breakStartMinute ?? t.defaultBreakStartMinute ?? t.startMinute;
        return (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">{t.name}</span>
            <input
              type="time"
              className={inputCls}
              defaultValue={minutesToTimeInput(current)}
              onBlur={async (e) => {
                await bookingService.setBreakPlacement(a.id, timeInputToMinutes(e.target.value));
                setSaved(a.id);
                setTimeout(() => setSaved((s) => (s === a.id ? null : s)), 2000);
              }}
            />
            {saved === a.id && <span className="text-xs text-[var(--teal)]">Saved</span>}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write the test**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BreakPlacementControl } from './BreakPlacementControl';
import type { ShiftTemplate, TherapistShiftAssignment } from '@/domain/types';

let assignments: TherapistShiftAssignment[];
let templates: ShiftTemplate[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
const setBreakPlacement = vi.fn();
vi.mock('@/services', () => ({
  repos: { therapistShiftAssignments: { listByTherapist: async () => assignments }, shiftTemplates: { list: async () => templates } },
  bookingService: { setBreakPlacement: (...a: unknown[]) => setBreakPlacement(...a) },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BreakPlacementControl', () => {
  it('renders nothing when no approved shift has a break', () => {
    assignments = [{ id: 'a1', clinicId: 'c1', therapistId: 'th1', shiftTemplateId: 't1', customHours: null, weekdays: [1], breakStartMinute: null, status: 'approved', note: null, requestedBy: null, decidedBy: null, decidedAt: null, createdAt: '', updatedAt: '' }];
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    const { container } = render(<BreakPlacementControl therapistId="th1" clinicId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('moves the break and calls setBreakPlacement on blur', () => {
    assignments = [{ id: 'a1', clinicId: 'c1', therapistId: 'th1', shiftTemplateId: 't1', customHours: null, weekdays: [1], breakStartMinute: null, status: 'approved', note: null, requestedBy: null, decidedBy: null, decidedAt: null, createdAt: '', updatedAt: '' }];
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 30, defaultBreakStartMinute: 660, active: true, updatedAt: '' }];
    render(<BreakPlacementControl therapistId="th1" clinicId="c1" />);
    const input = screen.getByDisplayValue('11:00');
    fireEvent.change(input, { target: { value: '11:30' } });
    fireEvent.blur(input);
    expect(setBreakPlacement).toHaveBeenCalledWith('a1', 690);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/components/schedule/BreakPlacementControl.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 4: Wire into `AccountMenu`** — render `<BreakPlacementControl therapistId={myTherapist.id} clinicId={clinicId} />` inside the `{myTherapist && (...)}` block, near the "My working hours" menu item.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit && npx eslint src/components/schedule/BreakPlacementControl.tsx src/app/AccountMenu.tsx && npm run test && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/components/schedule/BreakPlacementControl.tsx src/components/schedule/BreakPlacementControl.test.tsx src/app/AccountMenu.tsx
git commit -m "feat(schedule): add self-service break-placement control"
```

---

### Task 12: Full-branch verification

**Files:** none (verification only).

- [ ] **Step 1: Run the complete checklist**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```
Expected: all green.

- [ ] **Step 2: Manual check against the spec's own Verification section**

Walk through, in order: admin creates a shift template (Task 7 UI) → assigns it to a therapist (Task 10, immediate, `working_hours` updates) → therapist requests a different shift (Task 9, pending, old hours still active — confirm the calendar/booking form still reflects the OLD hours while pending) → admin approves (Task 8, new hours take effect) → therapist moves their break within the approved shift (Task 11, immediate, no approval banner appears) → admin edits the shift template's end time (Task 7) and confirms the assigned therapist's calendar picks up the new end time without any further action (the cascade from Task 2) → a custom-hours request for an odd pattern goes through the same Settings → Team queue as a shift request (Task 8/9's custom-hours fallback path).

- [ ] **Step 3: Confirm no regression in existing working-hours consumers** — open the public booking page for a therapist with an assigned shift and confirm available slots match the shift's hours minus its break; open `ScheduleBookingsView`'s day/week grid for that therapist and confirm the off-hours/break shading (`TimeGrid.tsx`'s existing `data-break` classification) still renders correctly against the shift-derived `working_hours` — this is the "zero changes to downstream consumers" claim from the spec, worth confirming empirically once, not just by code inspection.
