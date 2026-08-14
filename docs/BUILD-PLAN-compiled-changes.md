# Build plan — compiled changes (verified against codebase)

Derived from `theranetchangescompiled2.md` after an audit of the actual
repo. That document was explicitly a planning artifact, not a technical
audit; this file is the reconciled build plan.

## Corrections carried forward

Findings that change scope from the source document:

| § | Source claim | Verified reality |
|---|---|---|
| 3 | New Visit shows search + Name/ID/Age/Phone simultaneously | Already a 3-state machine (`NewVisitPage.tsx:292`). Only the residual items below remain. |
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

## PR sequence

### PR 1 — New Visit residual (§3)
- `local.ts:89` — extend `patients.search` to match phone (digit-normalized,
  tolerant of spacing and country prefix).
- Duplicate detection — add exact-phone match alongside the existing
  `nameSimilarity` check.
- Recent-patients quick-pick on the search state.
- Confirmed-state chip — add condition plus last-session detail (date,
  amount, paid/due, package session index). Payment state mirrors
  `visitPaymentState` in `PatientProfilePage.tsx:22`.
- "Edit details" action opening the existing `EditPatientModal`.
- Non-blocking phone warning; caption marking remaining fields optional.

### PR 2 — Ledger hygiene + Settings guard (§7, §8)
- CSV export for the Visits table (none exists today; `ReportsPage.tsx:38`
  is monthly-report only), with the active filter described in the header
  row.
- Totals row pinned so it survives scroll.
- Sync-basis caption sourced from `syncStatus` plus outbox count.
- Dirty-state guard and Cancel on the Clinic profile section.

### PR 3 — Note editor navigation (§5)
- Sticky jump-nav rail at `md:` and above, one row per section (9 exist and
  match the source document's list).
- Four-state status dot per section using `--border` / `--amber` /
  `--moss` / `--rust`.
- `scroll-margin-top` on section headings; suppress scroll-spy briefly
  after a rail click.
- Collapse-all toggle.
- `--slate` banner for the repeat-visit-with-no-prior-note case.
- Carry-forward already exists (`NoteEditorPage.tsx:89`) as
  collapse-to-summary on three sections. Extend rather than replace —
  see open item 5.

### PR 4 — Seen Today / Ledger parity (§4)
- Extract a shared visit table so both surfaces read one column config.
- Below 768px: existing `SharedVisitCard`. At 768px and above: table.
- Migrate `Needs attention` from `lg:` to `md:`.
- Per-user column prefs in Dexie, migrating from `clinic.visitColumnPrefs`.
- Widen `VisitColumnKey` past `condition`/`treatment`.

### PR 5 — Role scoping (§2, §6)
- Cache clinic role in Dexie; `useClinicRole` reads cache when offline.
- Shared scope hook returning role, own therapist id, and the resulting
  query scope — one implementation used by both Workspace tiles and
  Insights, per the source document's closing note.
- Tiles scoped per the source document's table.
- Insights: same hook, plus packages breakdown; replace raw hex
  `SERIES_COLORS` with design tokens (see open item 4).
- Thin-data empty states.

### PR 6 — Navigation restructure (§1a)
- `/archive` → `/ledger`; `/setup` → `/settings`; both old paths kept as
  permanent redirects preserving search params.
- Invoices and Reports become Ledger sub-views; delete the orphaned
  `/reports` route.
- Update `NAV` in `Shell.tsx:13`.
- Grep Dexie `meta` for any route-keyed state before shipping.
- Fix the stale `'Visits'` link assertion in `e2e/smoke.spec.ts:30`.

### PR 7 — Patients tab (§1b)
- Extract `AllPatientsSection` to `/patients`; drop the Ledger toggle.
- Ships only after PR 6 is confirmed stable.

## Open items

1. Insights currently renders three raw tables (outstanding, single-visit,
   regulars). §1 says Insights carries no raw tables — move to Ledger,
   keep, or drop?
2. Ledger sub-views: `useState` tabs (consistent with `InsightsPage`) or
   introduce nested routes as a new pattern?
3. Workspace Documentation panel — in scope, or deferred?
4. Only five categorical tokens exist; therapist comparison can exceed
   five series. Keep the current hex ramp, or use tokens with generated
   variants beyond five?
5. Carry-forward: keep collapse-to-summary and add the pill, or convert
   all nine sections to the dimmed-with-pill treatment?

## Deliberately unchanged

Everything under §9 of the source document stays rejected or deferred:
SaaS tiering, granular RBAC, a third breakpoint, the multi-clinic
switcher, the six-report buildout, and any role-switching affordance.
