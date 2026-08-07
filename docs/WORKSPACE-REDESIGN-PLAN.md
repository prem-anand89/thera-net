# Workspace/Patient Profile/Archive redesign — tracking doc

## Why this file exists

`docs/BUILD-BRIEF-workspace-profile-archive.md` is the design brief (uploaded verbatim,
unchanged). An audit (2026-08-07) found almost none of it built — Workspace, Patient
Profile, and Archive each have their own bespoke `<table>`, no shared row component,
no collapsible-panel pattern. This is a multi-chunk effort; this file tracks what's
actually landed, chunk by chunk, the same way `CORE-ASSESSMENT-PORT-PLAN.md` does for
that port. If a chat message or commit message disagrees with this file, this file wins.

User's chosen order: **foundation components first, then Workspace → Patient Profile →
Archive, one PR-sized chunk at a time.**

## Chunk 1 — Foundation + Workspace (this PR, branch `feature/workspace-redesign`)

- [x] **`SharedVisitCard`** (`src/components/VisitCard.tsx`) — flat hairline-divided
      row, normalized `VisitCardData` prop (screens map their own row shapes into it,
      the component doesn't import `dashboardService` types). Date/patient-avatar
      conditionally shown, secondary line wraps (condition/service+`PackageThread`/
      therapist/treatment note), payment chip + separate invoice-status element,
      kebab menu (Repeat as a real `<Link>`, Split/Delete as callbacks, only the
      applicable ones per row).
- [x] **`SummaryBar` + `Panel`** (`src/components/ui.tsx`) — collapsed tappable bar
      (rust/neutral tone) opening a bottom-sheet panel (bottom-anchored, not
      centered — distinct from the existing invoice modal's centered-overlay pattern).
- [x] **Workspace wired**: heading "Today" → "Seen today"; Seen-today list uses
      `SharedVisitCard`; Needs-attention moved behind a rust `SummaryBar` → `Panel`,
      recolored 3 ways per brief (`outstanding_payment` rust / `stale_package` amber /
      `incomplete_note` slate — added real `--amber`/`--amber-light` tokens to
      `index.css` since the existing `Pill` "amber" tone is actually rust-colored);
      Recently-seen moved behind a neutral `SummaryBar` → `Panel`, backed by
      `dashboardService.recentVisits(clinicId, 8)` (existing function, was dead code —
      the one place the brief's "no backend change" claim held exactly).
- [x] `dashboardService.recentVisits()`/`recentVisitsWindow()` gained `invoiceId` and
      `outstandingPaise` fields on `RecentVisitRow` (needed for the card's invoice
      link and the brief's ₹0-hidden balance rule) — 3 new unit tests.
- [x] **Expected-today section** — new `expected_visits` table (migration
      `20260807000001_expected_visits.sql`: `id, clinic_id, patient_id?, patient_name?,
      time_note, visit_date, status ('expected'|'arrived'|'no-show'), updated_at,
      created_by, updated_by`, RLS via `is_clinic_member`, added to the realtime
      publication) plus `clinics.enable_expected_today` (opt-in, off by default, same
      Setup `<select>` pattern as `enableTherapistSplit`). Full new-synced-table wiring
      (`domain/types.ts` → `db.ts` Dexie v8 → `repositories/types.ts`/`local.ts` →
      `sync/engine.ts`) plus `src/services/expectedVisitsService.ts`
      (`listForToday`/`add`/`setStatus`, 4 unit tests). Workspace renders an inline
      (not collapsed) "Expected today" `SectionCard` when the toggle is on: list of
      expected entries (linked-patient name or free-text name, time note, arrived/
      no-show actions), a "+ Add expected" inline form reusing the existing patient-
      search pattern. Tapping an entry navigates to `/visits/new` pre-filled —
      `NewVisitPage.tsx`/`router.tsx` gained `patientId`/`prefillName` search params
      for this (also fixes the same pre-fill gap flagged for Patient Profile's "New
      visit" button in chunk 2 — reused when that chunk lands, not duplicated).
- [x] **Therapist/admin tier scoping** — role system already existed server-side
      (`clinic_members.role`, RLS-readable via the existing `members_select` policy)
      but was never exposed to the client. New `src/app/useClinicRole.ts`
      (`useClinicRole(clinicId) => { role: 'admin'|'staff'|'unknown', loading }`,
      best-effort/online-only, same shape as `NoteEditorPage.tsx`'s
      `useTreatmentConsentStatus`). Mapping: `role='staff'` ≡ brief's "therapist
      tier", `role='admin'` ≡ "admin tier"; `'unknown'` (not yet resolved, or
      offline) is treated the same as `'staff'` — the narrower view — so nothing
      flashes clinic-wide data before the real role loads.
  - `dashboardService.todayWorklist(clinicId, asOf?, therapistId?)` gained an
    optional 3rd-position therapist filter (kept 3rd, not 2nd, so the 6 existing
    `asOf`-passing call sites in `dashboardService.test.ts` didn't need touching);
    threads into `repos.visits.list({ ..., therapistId })`, which `VisitFilter`
    already supported. 2 new unit tests (unfiltered when omitted; scoped to one
    therapist when passed).
  - Workspace resolves "which therapist is me" via `Therapist.userId === session
    .user.id` (same pattern `VisitsPage.tsx` already used elsewhere) and calls
    `todayWorklist` with that therapist's id when `role !== 'admin'`.
  - Stat pills reduced to the brief's 3 for row 1 (Expected — hidden when the
    Expected-today toggle is off, since the table has no therapist column to
    scope by anyway — Seen today, Collected today; both of the latter two are
    tier-scoped through `todayWorklist`'s new filter). Row 2 keeps New patients
    this month / Packages this month, unchanged and always clinic-wide — a
    monthly count isn't a "whose visit is it" concept, and the brief's "3, not 4"
    reads as replacing the old *today-scoped* 4-tile set, not deleting the
    monthly counts nobody asked to remove.
  - Needs-attention: `role === 'admin'` gets a `lg:`-only inline 3-column card
    grid (reusing `PendingWorkRow`) alongside the usual collapsed `SummaryBar`→
    `Panel` on narrower widths; every other role/state always gets the collapsed
    version regardless of width. Needs-attention's *content* (`pendingWork()`)
    stays clinic-wide for every tier — only the stat pills are "mine"-scoped.
- [x] `npm run typecheck && lint && test && build` all pass (187 tests).

**Real capability change, not a bug**: Workspace's old "Recent" section
(`RecentVisitsSection`) was a sortable 9-column, 7/15/30-day-toggleable table. It's
gone from Workspace now, replaced by the brief's lightweight 8-row Recently-seen
panel. The brief is explicit this is deliberate ("Rejected idea, for the record" —
a fuller Recently-seen table was considered and rejected to avoid duplicating
Archive). `recentVisitsWindow()` itself was **not deleted** — no longer called from
any page, but kept as a tested, working function in case Archive's date-grouping
work (chunk 3) wants it.

## Chunk 2 — Patient Profile (not started)

From brief §3: patient-edit capability (repo `update` mutation + pencil-icon UI),
fix "New visit" button to pass patient context, outstanding-balance header badge,
mobile-only Care-plan/Visit-history reorder, Visit History → `SharedVisitCard`,
"Recent activity" → "Documentation activity" rename, bulk invoice issuance
(checkbox multi-select → one invoice for N visits).

Note from the audit: a real `patientService.update()` mutation and a working edit
modal **already exist** — on Archive (`EditPatientModal` in `VisitsPage.tsx`), not
Patient Profile. This chunk is mostly "add the UI here too," not new mutation work.
Also: `invoiceService`'s multi-visit support only auto-bundles by `packageGroupId`
today — an arbitrary user-picked visit-ID array (what a real checkbox multi-select
needs) isn't there yet; the brief's "no service-layer change needed" claim doesn't
hold for the general case.

## Chunk 3 — Archive (not started)

From brief §4: date-range grouping tabs (This week/Last week/This month/Last
month/All, "All" = clear filter not a bucket), group-header totals (replacing the
`<tfoot>` "Totals (N visits)" row), Custom date-range option, Visit table →
`SharedVisitCard`, Reports cross-link on month group headers. No bulk invoice here
— confirmed already true today (nothing to remove).
