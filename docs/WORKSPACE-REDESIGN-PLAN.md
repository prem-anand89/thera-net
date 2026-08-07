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
- [x] `npm run typecheck && lint && test && build` all pass (181 tests).

**Deliberately deferred, not silently dropped:**
- **Expected-today section** — genuinely new feature (new `expected_visits` table +
  migration, Setup toggle, new UI). Brief itself says "don't build toward the
  booking system now — just don't paint it into a corner," so deferring is
  explicitly fine. Not started.
- **Therapist/admin "tier" scoping** ("mine" vs clinic-wide stats, desktop-inline
  Needs-attention) — no role/tier concept exists anywhere in this codebase
  (`clinicContext.tsx` has no role field). Inventing one is a separate,
  cross-cutting auth decision, out of scope for this chunk.
- Stat pills stay at their current 4 (Today's visits/Collected today/New patients
  this month/Packages this month) rather than the brief's "exactly 3 + Expected" —
  reducing to 3 only makes sense once Expected-today's count exists.

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
