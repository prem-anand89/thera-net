# Build plan — compiled changes (verified against codebase)

Derived from `theranetchangescompiled2.md` after an audit of the actual
repo. That document was explicitly a planning artifact, not a technical
audit; this file is the reconciled build plan.

## Corrections carried forward

Findings that change scope from the source document:

| § | Source claim | Verified reality |
|---|---|---|
| 3 | New Visit shows search + Name/ID/Age/Phone simultaneously | **Accurate as of `main`.** An earlier reading of this repo found a 3-state machine, but that predated `2ee204a` ("Refactor NewVisitPage patient selection UI: always visible form fields"), which removed it. Search box, "Selected:" line, and the full field grid now render together. §3 is in scope as written. |
| 8 | Setup may use one page-wide save | Already 6 independent sections with per-section saves (`SetupPage.tsx:37`). Consequence caption already present (`:508`). |
| 6 | Referrals needs a pie chart; palette needs broadening | Both built (`DashboardPage.tsx:273`, `:251`). |
| 4 | Columns picker needs building | Exists clinic-wide in Setup (`SetupPage.tsx:502`), limited to `condition`/`treatment`. |
| 1 | `/insights/dashboard` sub-route pattern exists | It is `useState`, not routing (`InsightsPage.tsx:6`). No nested routes exist in the app. |
| 1 | Patient list is new UI | Built as `AllPatientsSection` (`VisitsPage.tsx:922`), including last-visit column. `/patients` is an extraction. |
| 4, 5 | "768px, the existing breakpoint (`lg:`)" | Tailwind v4 defaults: `lg:` = 1024px, `md:` = 768px. Existing splits are at 1024px. |
| 2 | Documentation panel already on Workspace | Does not exist. New build if wanted. |
| 3 | Provisional Patient ID until synced | Walk-in IDs are generated client-side and final (`patientService.ts:34`). Reframed below as an unsynced-row badge. |

Additional constraint the source document did not account for:
`useClinicRole` (`app/useClinicRole.ts:30`) queries Supabase directly and
returns `'unknown'` offline, which callers treat as staff. Role-scoping is
therefore not buildable until the role is cached.

## Locked decisions

1. **Breakpoint** — card→table switches at **768px (`md:`)**. `Needs
   attention` migrates from `lg:` to `md:` in the same PR so the app has
   one responsive rule.
2. **Column picker** — moves to a **per-user** control in the table
   header, stored in Dexie. Migrates off the clinic-wide
   `clinic.visitColumnPrefs`.
3. **Role offline** — role is **cached in Dexie** on first successful
   fetch, so an offline admin keeps the admin view. This is display
   scoping only; RLS remains the access boundary.
4. **Phone** — **strongly encouraged, non-blocking**. Inline warning when
   empty; save is never blocked, preserving the no-phone walk-in case.
5. **Insights raw tables** — outstanding-payments table moves to Ledger
   (it's a collections list, not analytics); single-visit and regulars
   stay in Insights, charted rather than left as raw tables.
6. **Ledger sub-views** — `useState` tabs, matching `InsightsPage`. No
   nested routes; sub-views don't need bookmarkable URLs.
7. **Chart colours** — keep the current hex ramp (`SERIES_COLORS`) rather
   than moving to design tokens. Only five categorical tokens exist and
   therapist comparison can exceed five series; a token swap would cost
   distinguishability for no real gain.
8. **Carry-forward** — keep the existing collapse-to-summary behavior on
   the three sections that already have it, and add the "Carried
   forward" pill on top. Not converting all nine sections to a
   dimmed-with-pill treatment.
9. **Notes-completion gating** — ~~a visit is flagged only when both
   `clinicalDocsEnabled` is on *and* the patient has a `consultation_notes`
   enrollment~~ **revised during PR 2**: gate on `clinicalDocsEnabled`
   alone. Enrollment is only ever created lazily when the note editor is
   first opened, so requiring it up front would mean a patient's very
   first visit could never trigger the very first note. See PR 2 below.
10. **Settings layout** — a left-rail sub-nav (one section visible at a
    time) at ≥768px, stacking below it, rather than accordion sections.
    Reuses the same rail pattern as PR 5's note-editor jump-nav instead of
    introducing a second collapsible pattern.

## PR sequence

### PR 1 — New Visit (§3) — SHIPPED
- Rebuilt the searching / creating / confirmed state machine. `main` had
  regressed to search box + full field grid rendering simultaneously
  (`2ee204a`); that's what produced the duplicate-warning confusion the
  source document set out to fix.
- `local.ts:89` — `patients.search` now also matches phone, digit-normalized
  so spacing/country-prefix differences don't matter (3+ digit minimum to
  avoid area-code false positives).
- Duplicate detection — exact-phone match added alongside the existing
  `nameSimilarity` check; phone match wins when both fire.
- Recent-patients quick-pick on the search state, built on
  `dashboardService.recentVisits` (previously unused in any UI), deduped to
  one entry per patient.
- Confirmed-state chip — name, ID, age/sex, condition, and last-session
  detail (date, service, package session index, paid/due chip). Reuses
  `VisitCardPaymentState`/tone semantics from `VisitCard.tsx` rather than
  re-declaring a fourth copy of the same union.
- "Edit details" opens the existing `EditPatientModal`; the page refetches
  the patient on save so the chip and last-session detail stay current.
- Phone is encouraged, not required — inline note when empty, save never
  blocked.
- Incidental fix: the therapist-autofill effect no longer overwrites the
  therapist set by a "repeat last visit" flow — it now skips when
  `search.repeatVisitId` is present, since that flow already picked the
  correct therapist for the specific visit being repeated, which isn't
  always the patient's most recent one.

### PR 2 — Notes-completion prompting (new — not in source document) — SHIPPED
Prompted by "how do we get therapists to write notes for logged visits."
The signal already existed in the schema and was dead:
`Visit.clinicalStatus` (`types.ts:250`) was never written by
`visitService.create`, so `dashboardService`'s `incomplete_note` item
(`:314`) could never fire, and `NoteEditorPage.tsx:307` never linked a note
back to the visit it documents.

**Correction to decision 9 during implementation:** the doc's gate —
`clinicalDocsEnabled` **and** an existing `consultation_notes` enrollment —
turned out to be backwards. `consultationNoteService.getOrCreateActiveEnrollment`
only creates an enrollment lazily, the first time the note editor is
opened for a patient — so gating on "enrollment exists" would mean a
patient's very first visit could never be flagged, which defeats the
point. **Shipped gate is `clinicalDocsEnabled` alone**, clinic-wide, per
visit.

- Armed the signal — `visitService.create` sets `clinicalStatus: 'pending'`
  when `clinic.clinicalDocsEnabled` is on.
- Closed the loop — `consultationNoteService.saveAssessment` now writes
  `visit.clinicalStatus: 'documented'` and `visit.consultationNoteId` when
  a note is saved *completed* against a linked visit. A draft save leaves
  the visit pending on purpose. `visitService.updateBilling` was checked
  and already spreads the existing visit first, so it can't clobber either
  field.
- Linked notes to visits — `/patients/$patientId/notes/new` now accepts a
  `?visitId=` search param, threaded through to `saveAssessment`. Every
  "add a note" entry point below passes it.
- Surfaced it in four places: an "Add clinical note" offer on New Visit's
  save-success screen (replaces the immediate redirect to Workspace only
  when the clinic has the feature on); a `+ Note` link on `SharedVisitCard`
  wherever a card shows a pending visit (Workspace, Patient Profile,
  Ledger — one shared component, all three for free); an "Add note" action
  on the `incomplete_note` Needs-attention row; and a new Workspace
  **Documentation** panel below Seen Today, grouping pending visits by
  patient and linking to the oldest one per patient.
- **Sequencing fix**: the doc's plan put the `clinicalDocsEnabled` toggle in
  PR 3's Settings reorg, which would have shipped this entire feature
  behind a flag nobody could turn on. Added a minimal toggle to the
  existing `SetupPage.tsx` now (same pattern as the neighboring `Expected
  today` toggle); PR 3 relocates it into the new Features section, no
  behavior change.
- Tests: `visitService.create` (flag on/off), `consultationNoteService
  .saveAssessment` (completed-with-visit closes the loop, draft doesn't,
  no-visit note doesn't touch the visits table).

### PR 3 — Settings reorganization (new — not in source document) — SHIPPED
Prompted directly by user request — 899 lines in one scroll, one section
(`ClinicProfile`, then `SetupPage.tsx:267`) carrying ~20 unrelated fields
behind one save button. On inspection, that monolith was the only actual
offender — `Catalog`/`Therapists` were already independent, instant-commit
sections with nothing to guard (no pending form, nothing to discard), and
`DataBackup`/`DangerZone` are one-shot actions, not forms. All four kept
their internals unchanged, just relocated under the new rail.

- Left-rail sub-nav (buttons, not routes — same `useState`-tabs reasoning
  as decision 6) that stacks as a horizontal scrollable pill row above the
  content below `md:`, sits beside it as a sidebar at `md:` and up.
- Split the monolith into 8 sections: **Clinic profile** (name, address,
  phone, email, logo, walk-in ID prefix) · **Billing & invoicing**
  (invoice prefix, GST, fiscal year start) · **Partner & split** (clinic
  type, partner toggle + fields, therapist-split toggle, split %, tax %,
  TDS basis) · **Team** (`Therapists`, unchanged) · **Services**
  (`Catalog`, unchanged) · **Features** (Expected today,
  `clinicalDocsEnabled`, visit-column defaults) · **Data** (historical
  import + backup/restore) · **Danger zone** (unchanged).
  `clinicType`/`hasPartner`/`enableTherapistSplit` stay together in
  Partner & split because `clinicBillingConfig()` reads all three as one
  unit — splitting them further would let the split computation see an
  inconsistent combination mid-edit.
- **Architecture correction made during implementation**: the Clinic row
  has no partial-patch API (`repos.clinics.put()` writes the whole row).
  Four independently-saved sections holding four independent snapshots of
  that row is a real data-loss trap — saving section A with its own stale
  copy of section B's fields would silently revert whatever B had already
  saved. Fixed by having every section's save re-fetch the current row and
  merge in only the fields that section owns
  (`useClinicSectionForm`/`saveFieldNow` in `SetupPage.tsx`), never
  round-tripping a full-row snapshot. Same fix applied to logo uploads,
  which previously wrote the entire in-progress form as a side effect of
  picking a file.
- Per-section Save/Cancel, disabled until dirty; a rust dot on the rail tab
  marks a section with unsaved changes; switching tabs away from a dirty
  section prompts to discard. Scoped to switching sections *within* the
  page — a full browser-navigation/tab-close guard (`beforeunload`) was
  considered and deliberately deferred as separate, larger scope.
- Consequence caption on Partner & split, carried over from the original
  form's caption.

### PR 4 — Ledger hygiene (§7) — SHIPPED
- CSV export for the Visits table (`domain/visitsCsv.ts`, a pure function
  with 6 tests) — none existed before this; `ReportsPage.tsx:38` is a
  different, monthly-aggregated shape. First line is the active filter
  description (date range/preset, therapist, patient), followed by a
  header row, per-visit rows, and a totals line.
- Totals row is now `sticky bottom-0`, surviving scroll.
- A `--slate` sync-basis caption above the visit list: unsynced visit
  count when there are any (takes priority — a stale "as of" time would
  understate what's actually showing), otherwise last-sync time. Sourced
  from the existing `syncStatus` store and the outbox table, same data
  `SyncBadge` already reads.

### PR 5 — Note editor navigation (§5) — SHIPPED
- Sticky jump-nav rail (`md:` and up; hidden below it, not a stepper — free
  jumping between sections), one row per section, all 9 present.
- Four-state status dot per section, driven by `sectionCompletion()` — new
  pure function in `domain/coreAssessment.ts` (7 tests), following that
  file's existing pattern (`computeDerivedFields`, `outcomeTrend`). Only
  Chief Complaint can read `required-empty`; every other section only has
  empty/partial/complete since nothing else is validation-required.
- Sections now default to expanded (previously 2 of 9 were) with a
  Collapse all / Expand all toggle.
- `scroll-mt-20` on each section clears Shell's sticky app header; a rail
  click opens the target section and suppresses the
  IntersectionObserver-driven active-section highlight briefly so it
  doesn't fight the programmatic scroll.
- **Correction found while wiring the carry-forward pill**: a fresh
  follow-up note started from `emptyPayload()` with nothing copying the
  prior note's Chief Complaint/History into it — the collapsed "carried
  forward" summary always read as empty regardless of what the prior note
  actually had. That's precisely the gap the "no usable prior note" banner
  was supposed to flag as an *exception*, except every follow-up note
  would have hit it. Fixed: a fresh follow-up note now copies those two
  sections forward from the most recent prior note in the same enrollment;
  the `--slate` banner shows only when there's genuinely nothing to carry
  (data gap, or first note on record).
- Carry-forward pill (decision 8): kept the existing collapse-to-summary
  on Chief Complaint and History, added the "Carried forward" pill next to
  each heading. Screening's own bespoke collapse UI (the red/amber/clear
  banner) already communicates carried-forward status and was left as is.

### PR 6 — Seen Today / Ledger parity (§4)
- Extract a shared visit table so both surfaces read one column config.
- Below 768px: existing `SharedVisitCard`. At 768px and above: table.
- Migrate `Needs attention` from `lg:` to `md:`.
- Per-user column prefs in Dexie, migrating from `clinic.visitColumnPrefs`.
- Widen `VisitColumnKey` past `condition`/`treatment`.

### PR 7 — Role scoping (§2, §6)
- Cache clinic role in Dexie; `useClinicRole` reads cache when offline
  (decision 3).
- Shared scope hook returning role, own therapist id, and the resulting
  query scope — one implementation used by both Workspace tiles and
  Insights, per the source document's closing note.
- Tiles scoped per the source document's table.
- Insights: same hook, plus packages breakdown. Outstanding-payments table
  moves to Ledger; single-visit/regulars stay, charted (decision 5). Chart
  colours unchanged (decision 7).
- Thin-data empty states.

### PR 8 — Navigation restructure (§1a)
- `/archive` → `/ledger`; `/setup` → `/settings`; both old paths kept as
  permanent redirects preserving search params.
- Invoices and Reports become Ledger sub-views as `useState` tabs
  (decision 6); delete the orphaned `/reports` route.
- Update `NAV` in `Shell.tsx:13`.
- Grep Dexie `meta` for any route-keyed state before shipping.
- Fix the stale `'Visits'` link assertion in `e2e/smoke.spec.ts:30`.

### PR 9 — Patients tab (§1b)
- Extract `AllPatientsSection` to `/patients`; drop the Ledger toggle.
- Ships only after PR 8 is confirmed stable.

## Deliberately unchanged

Everything under §9 of the source document stays rejected or deferred:
SaaS tiering, granular RBAC, a third breakpoint, the multi-clinic
switcher, the six-report buildout, and any role-switching affordance.
