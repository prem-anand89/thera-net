# Team Settings — Shift Templates & Assignments Refinement (Design)

**Date:** 2026-10-11
**Status:** Approved spec — awaiting branch merge before implementation
**Scope:** Phases A–C (client-only, no new migrations/RPCs)
**Relates to (read-only):** `2026-10-10-shift-based-scheduling-design.md` — this spec must not alter its data model or RPC contracts.

## 1. Problem

The Team tab (`SettingsPage.tsx` → `<Therapists/>`, `<ShiftTemplatesSection/>`, `<ShiftAssignmentsSection/>`) is functionally complete but hard for an admin to operate:

1. Rare setup (templates) is above frequent work (assignments); the add-template form is always expanded.
2. No coverage view: assignments are prose ("General Shift — Wed/Sat/Fri").
3. Weekdays render in click order (unsorted) in `summarize()`.
4. `assign_shift` silently supersedes overlapping weekdays and pending requests — no preview or confirmation.
5. Editing/deactivating a template cascades to all assigned therapists with no impact warning or usage count.
6. Weekday picker = seven small checkboxes, no presets; disabled Assign button gives no reason.
7. "Reset to clinic hours" is unexplained; empty-state copy references custom hours that this section can't set.
8. Mixed 12h / 24h time formats.
9. No client-side validation (end > start, break fits within shift); per-assignment break override (`p_break_start_minute`) is not exposed.
10. Pending requests are buried inside each therapist row; decline reason input always visible.
11. Inactive (e.g. test) templates render at full size.

## 2. Goals / Non-goals

**Goals:** admin can see coverage at a glance, assign in few clicks, understand consequences before committing, and handle requests quickly.

**Non-goals (this spec):**
- New RPCs (remove-assignment is Phase D, separate spec).
- Changing `therapist_shift_assignments` / `shift_templates` schema or RPC behavior.
- **Strict Module Boundary:** Shift management stays strictly within `Settings > Team`. We are **not** adding shift overlays or shift editing controls to the main Schedule booking table (deferred until a future dedicated HR Module).
- **Separation from Week View:** The `Multi-Therapist Week View` (`2026-10-11-multi-therapist-week-view.md`) remains exclusively focused on giving an overview of *booked patient appointment slots* across therapists, not staff shift schedules.

## 3. Design

### 3.1 Page order (Team tab)
1. Unlinked-login banner (existing)
2. `<Therapists/>` (existing, unchanged)
3. **Pending shift requests strip** (only if any pending)
4. **Weekly coverage** grid + "Assign shift…" button
5. **Shift templates** (collapsible, compact)

### 3.2 Pending requests strip
- One row per pending request: `<Therapist> requests <Shift> · <Days>` + optional note.
- Actions: **Approve**; **Decline** → reveals optional reason input + confirm.
- Reuses `bookingService.approveShiftAssignment` / `declineShiftAssignment`; keeps the double-tap `decidingRef` guard.

### 3.3 Weekly coverage grid
- Rows: active therapists. Columns: Mon–Sun (aligned with `src/domain/schedule.ts:getWeekStart()`; internal integer mapping `[1, 2, 3, 4, 5, 6, 0]`) + **Weekly Total** column.
- **Sticky header:** Day column headers (`<th>`) use `sticky top-0 bg-[var(--surface)] z-10` to retain weekday context during vertical scroll on teams with 8+ therapists.
- **Cell content & visual hierarchy:**
  - Template chip: color per template + short label (`General 9–5`).
  - Custom hours: neutral chip `Custom` with tooltip listing intervals.
  - Explicit off (`[]` interval): dashed grey `Off`.
  - Therapists with 100% default hours (no shift assignments or custom hours): render a subtle, low-contrast indicator (`Using clinic default hours`) across the row to avoid repetitive visual noise across 7 empty cells.
  - Multiple templates on one day: stacked chips.
- **Weekly Total Hours column (Right edge):** Live calculated badge per therapist (e.g. `35h (5 shifts)` or `Clinic default (40h)`). Shows true staff capacity without mental math.
- **Daily Clinic Coverage footer (Bottom row):** Summary cell under each weekday column:
  - e.g. `Mon: 3 on duty · 21h capacity` vs `Sat: 1 on duty · 7h capacity`.
  - Instantly reveals staffing bottlenecks and peak-day shortages.
- **Rich hover tooltip:** Hovering over any assigned chip shows full schedule details: `<Shift Name> · <Start>–<End> · <Break duration> @ <Break start>`.
- **Direct cell click:** Clicking a cell immediately opens the **Assign dialog** pre-filled with that `therapist` and `weekday` (no intermediate popover layers).
  - If clicking a cell with `Custom hours`, the dialog preview clearly warns: *"Will supersede custom hours for [Day] with [Shift Name]"*.
- Template color: deterministic from template index/id (shared palette util, reusable by the week view).
- Responsive: below `md`, collapse to per-therapist cards with a 7-chip day strip and weekly total badge; no horizontal scroll ($44\text{px}$ touch targets).
- Accessibility: grid has `role="grid"`; chips are buttons with `aria-label` ("Prem Anand, Wednesday, General Shift 9 AM to 5 PM").

### 3.4 Assign dialog
- Fields: Therapists (multi-select chips), Shift dropdown, Days (round chips) with presets:
  - **First-Class Clinic Default Shift:** The top option in the Shift dropdown is **"🏢 Clinic Default Hours (9:00 AM – 5:00 PM)"**. Selecting it cleanly resets to `working_hours = null` under the hood (`assignCustomHours(therapistId, null)`), naturally solving the "Revert to Default" need.
  - Followed by active custom templates (`General Shift`, `Morning Shift`, etc.).
  - **Open days preset:** Dynamically derived by filtering out `clinic.closedWeekdays` (`types.ts:147`).
  - **Mon–Fri preset:** Explicit weekday range.
  - **Every day preset:** All 7 days.
  - Optional collapsed **Break start override**.
- **Preview panel** (derived client-side from current approved assignments):
  - "Replaces Wed on Prem's General Shift."
  - "Will supersede custom hours for Wednesday with General Shift."
  - "Closes Kiran's pending request."
  - "Working time: 7h (8h − 1h break)."
- Submit label states the effect: `Assign to 2 therapists`. Disabled state shows inline reason ("Pick at least one day").
- Bulk submit = sequential `bookingService.assignShift` per therapist; per-therapist error reporting:
  - If one therapist succeeds and another fails, deselect the successful therapist, keep the failed therapist selected with an error banner, and update CTA to *"Retry assigning to 1 therapist"*.
- Validation: break override must fit within shift (mirrors RPC rule) — shown before submit.

### 3.5 Shift templates (collapsed by default)
- Compact row: name · `9:00 AM–5:00 PM` · `1h break` · **Used by N** · overflow menu (Edit, Deactivate).
- **Split Shift Recognition:** If `breakDurationMinutes >= 120`, the card and form label the schedule as a **Split Shift** (e.g. `Morning: 9:00 AM–1:00 PM & Evening: 4:00 PM–8:00 PM (3h split)`) instead of an awkward "180-min break". Matches real-world physio clinic schedules without any DB schema change.
- "+ Add shift template" opens the form in a dialog/inline panel instead of a permanent form.
- Edit/Deactivate: confirmation with impact: "Affects Prem, BM — their hours update immediately."
- Form: live "Working time" summary; inline validation (end > start; break + start fit in shift); defaults to blank times only for name.
- Inactive templates behind "Show inactive (N)" toggle.

### 3.6 Copy & formatting
- Single time-format helper (12h) used by cards, break text, custom-hours summaries.
- Weekdays always sorted Mon→Sun in summaries and column headers (matching `getWeekStart`).
- **Clinic Operating Hours Location:** Practice opening hours (`bookingStartHour`, `bookingEndHour`) and closed weekdays belong under **Settings > General** (Clinic Profile) as the physical business hours of the clinic, with `Team` referencing them directly as the baseline shift.
- "Reset to clinic hours" → "Clinic hours (9:00 AM – 5:00 PM)" with helper tooltip.
- Empty state: When 0 templates exist, `Assign shift…` button is disabled with tooltip *"Create your first shift template below"*. Grid displays *"Using clinic default hours"* across all rows.

## 4. Data & Architecture

- **No schema/RPC changes.** Reads existing: `repos.therapists`, `repos.shiftTemplates`, `repos.therapistShiftAssignments.listByClinic`. Writes via existing `bookingService.{assignShift, approveShiftAssignment, declineShiftAssignment, updateShiftTemplate, createShiftTemplate}`.
- New pure helpers (unit-testable, in `src/domain/` or `features/settings/shiftUtils.ts`):
  - `buildCoverage(therapists, assignments, templates) → Map<therapistId, Map<weekday, Cell[]>>`
  - `calculateWeeklyTotal(therapistId, assignments, templates) → { hours: number, shiftsCount: number }`
  - `calculateDailyCoverage(weekday, assignments, templates) → { staffCount: number, capacityHours: number }`
  - `formatShiftSummary(template) → string` (handles regular shifts + split shifts when break >= 120m)
  - `previewAssign({existing, therapistId, weekdays, templateId}) → { replaced: [...], closesPending: boolean }` — must mirror `assign_shift` / `supersede_overlapping_weekdays` semantics. **Verify against the final merged RPCs before implementing**, since Claude's branch is still changing them.
  - `templateUsage(templateId, assignments) → therapistIds[]`
  - shared time formatter + sort.
- Components: `PendingShiftRequests`, `CoverageGrid`, `AssignShiftDialog`, `ShiftTemplateList` (+ existing section files refactored/replaced).

## 5. Risks / Sequencing

- **Branch overlap:** `worktree-shift-based-scheduling` still touches these files. Implement after that branch merges (or rebase carefully). Preview logic depends on final supersede semantics.
- `SettingsPage.tsx` is ~3.5k lines; only change the Team tab composition lines.
- Dexie live queries: coverage grid memoized per therapist row to avoid re-render storms.

## 6. Testing

- Unit: `buildCoverage`, `calculateWeeklyTotal`, `calculateDailyCoverage`, `previewAssign` (overlap, multi-template day, custom hours, null sentinel), weekday sort, time formatter, break-fit validation, split shift formatting.
- Component: grid cell states, weekly total badge, daily coverage footer, dialog preview text, bulk assign partial failure, template impact warning, pending strip approve/decline (incl. double-click guard).
- Existing `ShiftAssignmentsSection.test.tsx` cases migrate to the new components.

## 7. Phases

| Phase | Scope | Backend |
|---|---|---|
| A | Reorder, sort weekdays, unified times, day presets, collapsed add form, hide inactive, "Used by N", disabled hints | none |
| B | Impact warnings, assign preview, form validation, split shift template recognition | none |
| C | Coverage grid (with Weekly Total column & Daily Coverage footer), pending strip, bulk assign dialog | none |
| D (later) | Remove assignment, break override persistence UX | new RPC |

## 8. Decisions & open questions

**Decided (2026-10-11):**
1. **Direct cell click:** Clicking a cell opens the Assign dialog directly prefilled with Therapist + Weekday (no intermediate popover layers).
2. **Bulk assign:** Multi-therapist bulk assignment ships in Phase C.
3. **Week start:** Grid columns start on Monday (`Mon, Tue, Wed, Thu, Fri, Sat, Sun`) matching `src/domain/schedule.ts:getWeekStart()` and the Schedule view (database integer mapping `[1, 2, 3, 4, 5, 6, 0]`).
4. **Day presets:** Derived dynamically using `clinic.closedWeekdays` (`Open days`, `Mon–Fri`, `Every day`).
5. **Sticky grid header:** Header row has `sticky top-0` for vertical scrolling on large teams.
6. **Role access:** Front-desk users receive full access to view coverage, assign shifts, and manage templates, matching the backend RPC security policies (`is_clinic_admin(...) or is_front_desk(...)`).
7. **Weekly totals & daily coverage:** Grid includes right-hand Weekly Total Hours badge per therapist and bottom Daily Clinic Coverage summary row.
8. **Split shifts:** Shifts with break $\ge 120$ mins are presented as Split Shifts in templates.
9. **Strict boundaries:** Shift scheduling is strictly contained within Settings > Team (no shifts in the booking table until an HR module is built). The Multi-Therapist Week View is strictly for booked patient appointments.
10. **Spec status:** Approved and finalized for implementation once Claude's shift-based scheduling branch merges.
