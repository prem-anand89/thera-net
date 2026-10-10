# Shift-based scheduling — Design

Date: 2026-10-10
Status: Draft for review

## Goal

Replace unilateral, free-form self-editing of a therapist's working hours/breaks with an admin-controlled model: admins default to assigning each therapist a reusable **shift template** (fixed hours + a pre-set break) or **custom hours** for the odd/part-time case that doesn't fit a template. Therapists can request a *change* of shift (goes to admin approval) and can self-service *move their break's placement* within their currently-assigned shift without approval, since that never changes total capacity.

## Context

**Today's gap, confirmed in code**: a linked therapist can already call `set_therapist_working_hours` directly and unilaterally — `AccountMenu`'s "My working hours" → `WorkingHoursSheet` → `bookingService.setWorkingHours(myTherapist.id, hours)`, and the RPC (`supabase/migrations/20261002100000_therapist_working_hours.sql`) explicitly authorizes `is_own_therapist(...)` alongside `is_clinic_admin`/`is_front_desk`, with immediate effect and no review step. `Therapist.workingHours` is a `Partial<Record<'0'..'6', [number, number][]>>` — a weekday → list of `[startMinute, endMinute]` intervals; a gap between two intervals on the same day is a break, a missing/empty weekday is a day off, `null` falls back to the clinic's own `bookingStartHour`/`bookingEndHour`.

**Why shifts, not free-form requests**: free-form hours (the originally-discussed approach) make every review a from-scratch read of arbitrary JSON. A small set of admin-defined shift templates (e.g. "Morning: 9:00–13:00, 15-min break") turns the common case into "pick a shift and which days" — both faster for the therapist and trivially reviewable for the admin ("Requested: Morning shift, Mon/Wed/Fri"). Custom hours stay available as an escape hatch for genuine part-timers/odd patterns, through the *same* approval queue, not a second system.

## Understanding (agreed scope)

- **Admin's default action is immediate, not a request**: admin assigning a shift template or custom hours to a therapist takes effect right away — the admin *is* the approver, so there's no approval loop on the admin's own action (mirrors how `set_therapist_working_hours` already works for `is_clinic_admin`/`is_front_desk` today).
- **Therapist-initiated changes go through approval**: a therapist requesting a different shift (or different days, or custom hours) creates a pending request; the previously-assigned hours stay in effect until approved.
- **Break placement is always self-service, immediate, no approval** — for a therapist on an assigned shift template, moving *where* their fixed-duration break sits within that shift's envelope never changes total capacity, so it doesn't need sign-off. (Not available for the custom-hours path — see Out of scope.)
- **Part-time by days** (fewer working days, full shift-length hours on the days worked) is handled natively by letting one assignment cover a subset of weekdays, and letting a therapist hold more than one approved assignment at once (e.g. Morning shift Mon/Wed + Evening shift Thu).
- **Part-time/odd hours that don't fit any template** use the custom-hours escape hatch — same request/approval table, `shiftTemplateId` null, a free-form hours payload instead. **Custom hours are exclusively for part-timers/odd schedules, not for tweaking a regular shift worker's schedule.** If a therapist on a regular shift works a half-day, that is handled via leave/time-off, not by overriding their Friday with Custom Hours. Therefore, Custom Hours and Shift Templates are mutually exclusive per therapist: approving a Custom Hours assignment supersedes all their active Shift Templates, and vice versa.
- **Review surfaces**: a "Pending change" badge on the therapist's row in Settings → Team (old vs. requested side by side, Approve/Decline there), *and* a small banner in the admin schedule view when ≥1 request is pending — same visual pattern as this session's waitlist-match banner in `ScheduleBookingsView.tsx`.
- **No forced migration**: a therapist never assigned to a shift keeps using their existing free-form `working_hours` exactly as today. Shifts are additive.
- **Zero changes to downstream consumers**: `TimeGrid`, the booking form, slot generation, and availability checks all read `therapists.working_hours` today and continue to do so unchanged. Shift/custom assignment is just a friendlier way to populate that same column — approving a request (or an admin's direct assignment) derives the same JSON shape and writes it there, through the same `working_hours_valid` check that exists today.
- **Out of scope for this design**: a utilization-rate metric was discussed separately — this design should keep `working_hours` trustworthy as an input to that metric later, but does not build it. Leave/time-off tracking was flagged as a related gap (capacity math over-counts a therapist on approved leave) but is not built here either; it's a natural candidate to reuse this same request/approval pattern in a later round.

## Data model

```sql
-- Clinic-defined, reusable shift envelopes. Mirrors the existing
-- "clinic's own editable list" pattern (referring_source_items,
-- no_return_reason_items): admin-managed, soft-deactivated not deleted.
create table public.shift_templates (
  id                        uuid primary key default gen_random_uuid(),
  clinic_id                 uuid not null references public.clinics(id) on delete cascade,
  name                      text not null,
  start_minute              integer not null check (start_minute >= 0 and start_minute < 1440),
  end_minute                integer not null check (end_minute > start_minute and end_minute <= 1440),
  break_duration_minutes    integer not null default 0 check (break_duration_minutes >= 0),
  default_break_start_minute integer check (
    default_break_start_minute is null
    or (default_break_start_minute >= start_minute
        and default_break_start_minute + break_duration_minutes <= end_minute)
  ),
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- A break with real duration must have a placement to default to —
  -- otherwise derivation has no sensible fallback when neither the
  -- template nor an assignment specifies where it goes.
  check (break_duration_minutes = 0 or default_break_start_minute is not null)
);

-- A therapist's shift (or custom-hours) assignment/request. One row per
-- distinct "which shift + which days" grouping; a therapist may hold
-- several approved rows at once for different weekday sets. Exactly one
-- of shift_template_id / custom_hours is set.
create table public.therapist_shift_assignments (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  therapist_id        uuid not null references public.therapists(id) on delete cascade,
  shift_template_id   uuid references public.shift_templates(id),
  custom_hours        jsonb,
  -- Only used (and only required) on the shift_template_id path — which
  -- weekdays this shift applies to. On the custom_hours path, the covered
  -- weekdays live inside custom_hours itself (same weekday-keyed shape as
  -- today's working_hours), so a separate array here would just be a second,
  -- potentially-contradictory source of truth. Must stay null for that path.
  weekdays            integer[] check (
    weekdays is null
    or (array_length(weekdays, 1) > 0 and weekdays <@ array[0,1,2,3,4,5,6])
  ),
  -- Only meaningful (and only settable) on the shift_template_id path;
  -- null = use the template's own default_break_start_minute.
  break_start_minute  integer,
  -- 'superseded': an approved assignment whose weekdays were fully taken
  -- over by a later assignment (see Overlapping weekdays below) — kept,
  -- not deleted, as a history trail; its weekdays array is left as the
  -- original set, since the status alone says it's no longer in effect.
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

create index on public.therapist_shift_assignments (therapist_id, status);
```

RLS: `shift_templates` — admin manage, all clinic members read. `therapist_shift_assignments` — a therapist may `select` their own rows and `insert` a pending one for themselves (enforced in the RPC, not raw table grants, same convention as `appointment_requests`); admin/front-desk may `select`/act on any row in their clinic. All writes go through RPCs below, not direct table access — matches this repo's standing convention (every sensitive mutation is a `security definer` RPC, never a raw client `insert`/`update`).

## Working-hours derivation (shared logic)

One function, used by both direct admin assignment and request approval, so there is exactly one place the JSON shape is built:

```sql
create or replace function public.derive_working_hours(
  p_existing jsonb,       -- current therapists.working_hours, to merge non-touched weekdays
  p_weekdays integer[],
  p_start_minute integer,
  p_end_minute integer,
  p_break_start integer,  -- nullable; null = no break
  p_break_duration integer
) returns jsonb language plpgsql immutable as $$
-- Builds { "<weekday>": [[start,break_start], [break_start+duration,end]], ... }
-- for each weekday in p_weekdays (two intervals if there's a break, one if
-- p_break_duration = 0), merged into whichever weekdays p_existing already
-- held for other shift assignments (so two assignments on different
-- weekdays for the same therapist compose correctly), validated by the
-- existing working_hours_valid() before the caller writes it. Callers pass
-- p_break_start = assignment.break_start_minute if set, else the shift
-- template's own default_break_start_minute (which the schema guarantees
-- is non-null whenever break_duration_minutes > 0) — the fallback chain is
-- resolved by the caller, this function just places one already-resolved
-- break.
$$;
```

## RPCs

All `security definer`, `search_path = public`, revoked from `anon`, following this repo's existing RPC conventions exactly (see `set_therapist_working_hours`, `confirm_appointment_request`).

- **`assign_shift(p_therapist_id, p_shift_template_id, p_weekdays, p_break_start_minute default null)`** — admin/front-desk only. Immediate: inserts an already-`approved` `therapist_shift_assignments` row (`decided_by` = caller, `decided_at` = now), derives and writes `therapists.working_hours`.
- **`assign_custom_hours(p_therapist_id, p_custom_hours)`** — admin/front-desk only. Same immediacy, `custom_hours` path; validates with the existing `working_hours_valid()`.
- **`request_shift_assignment(p_therapist_id, p_shift_template_id, p_weekdays, p_break_start_minute default null, p_note default null)`** — `is_own_therapist` only. Inserts a `pending` row; replaces (soft-closes) any existing unactioned pending row for that therapist so requests don't stack.
- **`request_custom_hours(p_therapist_id, p_custom_hours, p_note default null)`** — `is_own_therapist` only; same replace-pending behavior.
- **`approve_shift_assignment(p_request_id)`** / **`decline_shift_assignment(p_request_id, p_note default null)`** — admin/front-desk only. Approve derives and writes `working_hours` (same function as `assign_shift`), marks the row `approved`; decline just marks it `declined`.
- **`set_break_placement(p_assignment_id, p_break_start_minute)`** — `is_own_therapist` OR admin/front-desk, **self-service, immediate, no new approval row**. Only valid on an `approved`, `shift_template_id`-based assignment. Validates `p_break_start_minute >= shift.start_minute` and `p_break_start_minute + shift.break_duration_minutes <= shift.end_minute` server-side (duration itself is never a parameter — it cannot be changed here). Updates the assignment's `break_start_minute` and re-derives `working_hours`.
- **`update_shift_template(p_template_id, p_name, p_start_minute, p_end_minute, p_break_duration, p_default_break_start, p_active default true)`** — admin/front-desk only. Updates the template row, then cascades: for each `approved` assignment bound to this template, re-reads that therapist's *current* `working_hours` (not a value captured before the loop started) as `p_existing` before calling `derive_working_hours`, so an unrelated weekday from a different assignment (e.g. Thursday on a separate Evening-shift assignment) is never clobbered by Monday/Wednesday's re-derivation. Before re-deriving, each assignment's own `break_start_minute` is re-validated against the template's *new* bounds (`>= new start_minute`, `+ new break_duration <= new end_minute`); if it no longer fits, the assignment's `break_start_minute` is reset to `null` (falls back to the template's new `default_break_start_minute`) rather than silently producing an out-of-bounds derivation. Changing only `p_name` or `p_active` does not need to cascade — neither affects derived hours — but the RPC cascades unconditionally for simplicity rather than diffing which fields actually changed.

`set_therapist_working_hours`'s `is_own_therapist` branch is **removed** — a therapist can no longer write `working_hours` directly; every path now goes through one of the RPCs above, which all ultimately converge on the same column via `derive_working_hours`.

## Client / UI

- **Settings → Team**: new Shift Templates CRUD section (name, start/end, break duration, default break slot; archive not delete — same shape as the existing referring-source/no-return-reason editors). Each therapist row gains a "Pending change" badge when an unactioned request exists; clicking shows old vs. requested (shift name + weekdays, or "Custom hours") with Approve/Decline. Admin's own "assign" action (shift or custom) replaces today's direct `WorkingHoursSheet` editing for that therapist.
- **`AccountMenu` → "My working hours"**: replaces free-form time-block drawing with "pick a shift, pick weekdays" (submits a pending request via `request_shift_assignment`), with a "my hours don't match any shift" fallback reopening the free-form hours picker (submits via `request_custom_hours`). Shows "Submitted — waiting on approval" instead of closing straight to new hours; the calendar keeps using the last **approved** `working_hours` until then.
- **Break-placement control**: a small, separate self-service control (visible if a therapist has at least one approved shift-template assignment with `break_duration_minutes > 0`) — pick a new break start time within the shift's bounds, calls `set_break_placement` directly, takes effect immediately.
- **Schedule-view banner**: `ScheduleBookingsView.tsx` gains a second small banner (same visual treatment as the waitlist-match banner built this session) when ≥1 `therapist_shift_assignments` row is pending for the clinic, linking to Settings → Team.

## Edge cases & validation

- **Overlapping weekdays across a therapist's own assignments**: `assign_shift`/`approve_shift_assignment` **supersede**, not reject — a newly-approved assignment's weekdays are stripped from any other *approved* assignment(s) for the same therapist that currently cover them. A partial overlap shrinks that assignment's `weekdays` array (still `approved`, now covering fewer days); a full overlap flips its status to `superseded` instead of leaving an invalid zero-day row (the `weekdays` check constraint requires at least one day whenever `shift_template_id` is set). This is what an admin actually means by "move Priya's Monday to the Evening shift" — rejecting the overlap instead would leave them stuck unable to fix it without first manually editing the old assignment. Checked/applied server-side in the same transaction as the derive-and-write.
- **Custom Hours superseding**: Because Custom Hours and Shift Templates are mutually exclusive per therapist, approving a `custom_hours` request/assignment fully supersedes **all** existing active assignments (both shift templates and past custom hours) for that therapist. Conversely, assigning a shift template to a therapist currently on Custom Hours supersedes their Custom Hours entirely.
- **Replacing a pending request**: a therapist submitting a new request while one is still pending closes out the old one (not stacked) — avoids an admin reviewing a stale request.
- **Custom hours validation** reuses `working_hours_valid()` unchanged.
- **Break placement on a declined/pending (not yet approved) assignment**: rejected — `set_break_placement` only operates on an already-`approved` row, since there's no shift envelope in effect yet to bound it against.
- **A therapist with zero assignments** (never migrated): untouched, `working_hours` stays whatever it already was (admin-set or `null`/clinic default) — fully backward compatible.
- **Editing a shift template** (`update_shift_template`) must cascade to every `approved` assignment bound to it, or those therapists' derived `working_hours` silently goes stale against the template they think they're on — see the RPC entry above for the two concrete sub-cases (sequential re-derivation so unrelated weekdays aren't clobbered; an assignment's custom break placement falling back to `null` if the new bounds no longer fit it).

## Verification

- `npm run typecheck && npm run lint && npm run test`, `npm run build` (touches `AccountMenu`, `ScheduleBookingsView`, Settings).
- Pure-function tests for `derive_working_hours`'s client-side equivalent (if mirrored in TS for preview purposes) or a direct SQL test via `execute_sql` for the Postgres function: single weekday with break, multiple weekdays, zero-duration break (no gap), weekday composition against an existing `working_hours` value.
- RPC-level tests (SQL, run via Supabase MCP once applied): `request_shift_assignment` replaces a prior pending row; `approve_shift_assignment` writes `working_hours` and flips status; `set_break_placement` rejects an out-of-bounds start, rejects a pending (not approved) assignment, accepts a valid in-bounds move; weekday-overlap rejection across two assignments; `update_shift_template` propagates to every approved assignment's `working_hours` without disturbing a therapist's unrelated second assignment's weekdays, and resets an assignment's `break_start_minute` to `null` when the edited bounds no longer fit it.
- Manual check: admin creates a shift template, assigns it to a therapist (immediate); therapist requests a different shift (pending, old hours still active); admin approves (new hours take effect, calendar/booking reflect it); therapist moves their break within the approved shift (immediate, no approval banner appears); a custom-hours request for an odd pattern goes through the same Settings → Team queue as a shift request.

## Out of scope

- Utilization-rate metric (separate design, consumes `working_hours` as an input once this ships).
- Leave/time-off tracking (related gap, not built here — a strong candidate to reuse this same request/approval table shape later).
- Break-placement self-service for the custom-hours path (no fixed envelope/fixed break duration to validate a move against; a custom-hours therapist submits a new request instead).
