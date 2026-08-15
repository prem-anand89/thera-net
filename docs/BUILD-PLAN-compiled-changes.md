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
9. **Notes-completion gating** — a visit is flagged for a note prompt only
   when both `clinic.clinicalDocsEnabled` is on *and* the patient has a
   `consultation_notes` module enrollment. Without both, every walk-in
   massage would nag for a note that was never expected.
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

### PR 2 — Notes-completion prompting (new — not in source document)
Prompted by "how do we get therapists to write notes for logged visits."
The signal already exists in the schema and is dead:
`Visit.clinicalStatus` (`types.ts:250`) is never written by
`visitService.create`, so `dashboardService`'s `incomplete_note` item
(`:314`) can never fire, and `NoteEditorPage.tsx:307` never links a note
back to the visit it documents.
- Arm the signal — set `clinicalStatus: 'pending'` at visit creation, gated
  on decision 9 (`clinicalDocsEnabled` **and** a `consultation_notes`
  enrollment) so untracked visits don't generate false prompts.
- Close the loop — on note save-as-completed, write
  `visit.clinicalStatus`, `visit.consultationNoteId`, and `note.visitId`.
- Surface it: an "Add clinical note" offer on New Visit's save success path
  (highest-intent moment), a marker on undocumented Seen Today cards, and
  the `incomplete_note` Needs-attention entry (already built, just
  unreachable — `daysSince` escalation is free once the signal is real).
- Workspace Documentation panel ("N visits awaiting notes") — resolves
  former open item 3. In scope, sequenced as the last piece of this PR
  since the three items above deliver the actual behavior change.

### PR 3 — Settings reorganization (new — not in source document)
Prompted directly by user request — 899 lines in one scroll, one section
(`ClinicProfile`, `SetupPage.tsx:267`) carrying ~20 unrelated fields behind
one save button.
- Left-rail sub-nav at ≥768px (decision 10), stacking below it. Same rail
  component PR 5 builds for the note editor — one pattern in two places.
- Split into 8 sections: Clinic profile · Billing & invoicing · Partner &
  split · Team · Services · Features · Data · Danger zone. Interdependent
  billing fields (`hasPartner`, `bmSplitPct`, `tdsBasis`, …) stay together
  in Partner & split so one section's save can't leave the clinic in a
  half-consistent state.
- Per-section save/Cancel with a dirty-state guard (absorbs former §8
  scope) — most sections already behave this way; this is mechanical
  extraction, not new logic.
- A UI toggle for `clinicalDocsEnabled` (currently unset by any UI) in the
  new Features section, needed by PR 2.
- Consequence caption per section, templated on the one that already
  exists (`SetupPage.tsx:508`).

### PR 4 — Ledger hygiene (§7)
- CSV export for the Visits table (none exists today; `ReportsPage.tsx:38`
  is monthly-report only), with the active filter described in the header
  row.
- Totals row pinned so it survives scroll.
- Sync-basis caption sourced from `syncStatus` plus outbox count.

### PR 5 — Note editor navigation (§5)
- Sticky jump-nav rail at `md:` and above, one row per section (9 exist and
  match the source document's list).
- Four-state status dot per section using `--border` / `--amber` /
  `--moss` / `--rust`.
- `scroll-margin-top` on section headings; suppress scroll-spy briefly
  after a rail click.
- Collapse-all toggle.
- `--slate` banner for the repeat-visit-with-no-prior-note case.
- Carry-forward: keep the existing collapse-to-summary on
  `NoteEditorPage.tsx:89`'s three sections, add the pill (decision 8).

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
