# Build plan — role model, billing access, and payment-state (proposed)

Derived from an architecture-review conversation (2026-08-15) that followed
shipping all 9 PRs in `docs/BUILD-PLAN-compiled-changes.md`. That review
surfaced gaps the compiled-changes plan didn't cover — server-side role
enforcement, manual-invoice correctness, ledger payment-state accuracy, and
a responsive-breakpoint inconsistency — plus new feature requests that came
out of discussing them. This file is the reconciled build plan for that
follow-on work. Nothing in this plan is built yet; PRs get marked SHIPPED
here as they land, the same way the compiled-changes doc tracks its nine.

## Findings this plan responds to

Verified against the repo during the review, not assumptions:

| Area | Finding |
|---|---|
| RLS | Every data policy is `is_clinic_member(clinic_id)` `for all` — `patients_all`, `visits_all`, `therapists_all`, `catalog_all` (`supabase/migrations/20260702000001_init.sql:336-343`). Only `clinics`, `clinic_members`, and two settings tables check `is_clinic_admin`. PR 7's role scoping (`useWorkspaceScope`) is a **display convention only** — any clinic member can read or write any other therapist's data through the API directly. |
| Sync pull | `engine.ts` pulls with an unfiltered `select('*')` per table — every therapist's device holds the clinic's complete patient history in IndexedDB regardless of role. |
| Settings | `SetupPage.tsx` has **zero role gating** — any signed-in clinic member can edit prices, therapist splits, and clinic financial config today. Pre-existing bug, not a hypothetical. |
| Manual invoices | `InvoicesPage.tsx:105-115`'s "Add invoice" flow calls `visitService.create()` with `condition: 'Manual invoice'` first. That synthetic visit gets full revenue-split math and flows into therapist payouts, the therapist comparison chart, and the hospital-facing Monthly Ledger as a real patient encounter. Noted here as a related, currently out-of-sequence finding — see "Deferred" below. |
| Ledger payment state | `visitToCardData` derives payment state from `invoiceId` alone (`VisitsPage.tsx`: `v.invoiceId ? 'paid' : v.actualBillPaise === 0 ? 'zero_session' : 'uninvoiced'`). A visit paid in cash with no invoice shows as **uninvoiced** (reads as unpaid); a visit invoiced but marked outstanding shows as **paid**. Both wrong. The `payments` table (`supabase/migrations/20260719000001_direct_payments.sql`) and `directPaymentService.logPayment` already capture cash/UPI collected without an invoice — the gap is that the Ledger UI never reads it. |
| Responsive breakpoints | `ResponsiveVisitList` (`VisitCard.tsx:472`) splits at Tailwind's `md:` (768px). iPad Mini portrait is 744px — below `md:`, so it gets the phone card layout in Ledger/Workspace. **Corrected during PR 11**: this row originally also claimed `NoteEditorPage.tsx` runs a second, conflicting breakpoint system via `.mobile-only`/`.desktop-only` (720px/1000px) — false. Those two classes are defined in `index.css` but have zero usages anywhere in `src/`; `NoteEditorPage.tsx` has no `@media`/`matchMedia` logic of its own at all. The real (narrower) version of this finding: `.screen-body`/`.modal-card`, which *are* live (used by `NoteEditorPage.tsx` and `AddPatientDetailsModal.tsx`), had their own plain-CSS tablet threshold at 720px — which happened to already catch iPad Mini correctly, unlike `md:`. `.setup-accordion` (`index.css:185`) is **not** dead — also corrected during PR 11 — it's a live, single-use static style in `NoteEditorPage.tsx`, just confusingly named; not touched. |
| Patients table | `PatientsPage.tsx` has no card view at all — `overflow-x-auto` at every width. The PR 6 responsive pattern was never extended to it; PR 9 moved it verbatim. |

## Locked decisions

1. **Role vocabulary — three roles, not a title hierarchy.** `admin` / `therapist` / `front_desk`. Seniority (HOD, lead therapist, consultant) is a free-text `title` field on `clinic_members` for display, not a permission tier — titles proliferate, permissions shouldn't. `role` check constraint migrates from `('admin','staff')` to `('admin','therapist','front_desk')`; existing `'staff'` rows backfill to `'therapist'`.
2. **Reads stay clinic-wide; only writes get scoped.** Patient records and visit history remain fully readable by every clinical role — a therapist covering for a colleague or picking up a speciality case needs the full history, and partitioning reads would actively harm care. RLS scoping applies to `update`/`delete` on `visits` (own `therapist_id`, or admin) and to `patients`/`therapists`/`service_catalog` writes (admin only for delete/deactivate; member for create/update, per existing behavior). This directly answers "same patient seen by different therapists" — nothing needs to change there, it already works, it just needs the write boundary added alongside it.
3. **Money stays on the visit row.** The split columns (`bmSharePaise`, `postTaxPaise`, `tdsPaise`) live on `visits`, so hiding a colleague's earnings would mean hiding the visit itself — not worth it. Accepted tradeoff: per-visit bill amounts are visible to any clinical role (already true via decision 2); what gets restricted is *aggregates* — payouts, settlements — which stay admin-only via `scope.isAdmin`-style checks in the UI, same precedent PR 7 already set for the packages/trend sections.
4. **Therapist comparison chart is the explicit exception to decision 3.** Visible to therapists, not just admins — deliberately, for competitive visibility. Ships as two small charts, not one: **Revenue** (existing `postTaxPaise` series) and **Visits** (`visitCount` series, same `TherapistMonthRow` data, no new query). Gated by one clinic-wide toggle, `showTherapistComparison: boolean`, same pattern as `clinicalDocsEnabled` — off means neither chart renders for anyone.
5. **Billing is two independent settings, not one.** `billingEnabled: boolean` — does this clinic use the invoice module at all (some bill entirely through the partner hospital's own system). `invoicingAccess: 'everyone' | 'billing_staff'` — where `billing_staff` = `admin` + `front_desk`. Enforced inside `issue_invoice()` (already `SECURITY DEFINER` with an `is_clinic_member()` check — one choke point), not just hidden in the UI. A therapist without billing access still needs to see a visit is unbilled; New Visit's payment-capture step is skipped for them and the visit saves as unbilled for front desk to collect later.
6. **Payment state is three separate facts, not one boolean.** Billed (`visit.actualBillPaise`), Collected (`payments` rows + invoice payment status), Receipted (`invoiceId` present). The Ledger card/table payment chip and totals bar are rebuilt against Collected, not `invoiceId` alone. New filter: "Collected, no receipt." GST note: the invoice remains the legal document — collected-without-receipt amounts are reported separately, never folded into invoiced revenue for tax purposes. The hospital-facing Monthly Ledger already sums visit bills rather than invoices, so partner settlement figures are unaffected by this change.
7. **Nav visibility rule.** A clinic-wide module switch (`billingEnabled`, `clinicalDocsEnabled`) hides completely for everyone when off — no ghosted, unclickable nav items. A role boundary within an enabled module reframes rather than hides, following PR 7's existing precedent (Packages → "My packages", trend chart stays but relabels) — a therapist who can't bill still needs to see a visit is unbilled, so Invoices-as-a-concept doesn't disappear for them even if the Invoices *tab* does when `invoicingAccess: billing_staff`. Financial aggregates (payouts, settlements) are the one full-hide-for-non-admin case, per decision 3 — except therapist comparison, per decision 4.
8. **Reports, not Insights.** Rename `InsightsPage` → Reports; Dashboard becomes its first tab rather than the only thing there. Nav splits by verb: Ledger is what you *act on* daily (visits, invoices, payments), Reports is what you *read* periodically (overview, monthly statement, settlements). Nav becomes `Workspace | Ledger | Patients | Reports | Settings`, and is role-aware (front desk sees Billing more prominently if that's their job; a therapist without invoicing access doesn't see an Invoices tab at all).
9. **One `tab:` breakpoint at 744px, not a redefined `md:`.** Tailwind's `md:` keeps its documented 768px meaning elsewhere in the app; a new `--breakpoint-tab: 46.5rem` (744px) token in the `@theme` block is added specifically for the "does this count as a working tablet" decision, so iPad Mini portrait (744px) lands as tablet, matching what the older `.mobile-only`/`.desktop-only` system already got right by accident. All four current breakpoint call sites (`VisitCard.tsx`, `SetupPage.tsx`, `WorkspacePage.tsx`, `NoteEditorPage.tsx`'s CSS) migrate onto this one name. `PatientsPage`'s table gains the same card/table split.
10. **Permissions centralize into one hook.** `usePermissions()` returns named booleans (`canBill`, `canViewPayouts`, `canEditSettings`, `canViewClinicalNotes`, …) computed once from role + clinic flags, replacing the scattered `scope.isAdmin` checks and closing the currently-ungated `SetupPage.tsx` access hole in the same pass rather than as an afterthought.

## Deferred, not silently dropped

- **Manual invoices creating synthetic visits** (see Findings table). Real correctness bug, but it wasn't part of this review's discussion thread — flagged here so it isn't lost, not sequenced into the numbered plan below. Candidate fix: either don't route manual invoices through `visitService.create()`, or tag the resulting visit (e.g. `source: 'manual_invoice'`) and exclude tagged visits from payout/comparison/hospital-ledger aggregation.
- **Moving split columns off the visit row** into a separate `visit_financials` table, which would let per-visit amounts be hidden from colleagues without hiding the visit. Rejected for now per decision 3 — large migration touching every report, and no clinic has asked for this level of privacy yet.

## PR sequence

### PR 10 — Roles + RLS enforcement — SHIPPED
- Migration (`20260815000001_role_model_and_visit_rls.sql`): `role` check
  constraint gains `front_desk`; backfilled `'staff'` → `'therapist'`;
  `title` free-text column added to `clinic_members`.
- New RLS: `visits` split from one `_all` policy into
  select/insert (clinic-wide, unchanged) and update/delete (own
  `therapist_id`, via a new `is_own_therapist()` helper, or admin).
- **Widened beyond the plan's literal text**: decision 2 as written said
  "member for create/update" for `therapists`/`service_catalog`, which
  can't coexist with its own "admin only for delete/deactivate" clause
  under one blanket policy (Postgres RLS can't distinguish an update to
  `active` from an update to `base_price_paise`). Resolved by making
  `therapists`/`service_catalog` insert/update/delete **admin-only**,
  select clinic-wide — this is what actually closes the Settings gap
  (any member could edit prices/splits/roster through Setup, since both
  tables had an unrestricted `_all` policy since creation). Also gated
  `hard_delete_patient()` to `is_clinic_admin` (was `is_clinic_member`
  only), same rule.
- `usePermissions()` hook (`src/app/usePermissions.ts`) — `canEditSettings`,
  `canManageTeam`, `canViewPayouts`, `canViewClinicalNotes`. `SetupPage.tsx`
  now guards a direct URL hit; `Shell.tsx`'s nav hides Settings for
  non-admins.
- `useWorkspaceScope` gained `isFrontDesk` and `isClinicWideView`
  (`isAdmin || isFrontDesk`). `WorkspacePage.tsx`/`DashboardPage.tsx`'s
  "clinic-wide vs. mine" branches (packages tile, revenue trend, package
  section title/copy) now key off `isClinicWideView`, not `isAdmin` —
  front desk gets the same clinic-wide tiles an admin gets rather than
  "My open packages: 0" / "My revenue trend: ₹0" (they have no clinical
  work of their own to narrow to). The therapist comparison chart stays
  `isAdmin`-gated for now — PR 15 revisits it.
- Follow-through not in the original bullet list but required once the
  role vocabulary changed: the Team section's invite-role `<select>`,
  member-list role labels, and the `invite-therapist` edge function's
  role validation all updated from admin/staff to admin/therapist/
  front_desk. The new `title` column has no editing UI yet — deliberate
  deferral, the migration adds the column but exposing it wasn't
  load-bearing for this PR's access-control purpose.
- **Verification went beyond typecheck/lint/vitest/build** (all clean,
  221 tests): the migration was validated by actually replaying the
  full 26-file migration history plus this one against a throwaway
  local Postgres 16 database with a minimal Supabase shim
  (`auth.users`/`auth.uid()`, `storage`, roles) — confirmed it applies
  cleanly and produces exactly the intended policies (inspected via
  `pg_policies`). Then functionally verified enforcement itself, not
  just that it parses: switched to a non-superuser `authenticated` role
  and confirmed a therapist editing a colleague's visit is rejected (0
  rows updated), the same therapist editing their own visit succeeds,
  an admin editing anyone's visit succeeds, and a non-admin inserting a
  `service_catalog` row is rejected.
- **Found, not fixed**: the replay also surfaced that
  `20260801000001_catch_up_live_schema_drift.sql` doesn't apply cleanly
  on a truly fresh database — it duplicates a trigger `20260703000001`
  already created, and drops a `settlements` constraint/columns against
  a shape that migration assumes exists but `20260703000001` already
  created in its final form. Pre-existing, unrelated to this PR;
  rewriting a migration that already ran against production isn't
  something to do opportunistically. Flagged here, not silently
  patched — a new environment or CI-based from-scratch migration replay
  will hit this until it's addressed on purpose.

### PR 11 — Responsive breakpoint standardization — SHIPPED
- `--breakpoint-tab: 46.5rem` (744px) added to the Tailwind `@theme` block
  in `index.css`. Migrated `VisitCard.tsx`, `SetupPage.tsx`,
  `WorkspacePage.tsx` from `md:` to `tab:`.
- **Correction, not what the plan bullet said**: there was no
  `NoteEditorPage.tsx` breakpoint system to retire, and `.setup-accordion`
  was not dead CSS — see the corrected Findings row above. What actually
  shipped instead: removed `.mobile-only`/`.desktop-only` (confirmed zero
  usages) plus two other dead selectors sharing the same CSS blocks
  (`.dir-toolbar`, `.panel-sheet`, also zero usages), and retuned
  `.screen-body`/`.modal-card`'s real, live tablet threshold from 720px to
  744px so it's the same number as `tab:` rather than a coincidentally
  close one. `.setup-accordion` left untouched — it's working code.
- `PatientsPage.tsx`'s table gains a card view below `tab:` (new
  `PatientCard`, matching `SharedVisitCard`'s visual language — avatar
  initials, name/mrno header, muted secondary line) — previously
  horizontal-scroll at every width, the one screen PR 6's responsive
  pattern never reached.
- Verified: typecheck, lint, vitest (221 passed), production build all
  clean, plus confirmed in the compiled CSS that all four `tab:` utilities
  actually generated against `(min-width:46.5rem)` — not just that the
  theme token was declared.

### PR 12 — Ledger payment-state correctness — SHIPPED
- New `src/domain/paymentState.ts`: `computeVisitPaymentState()`, a pure,
  unit-tested function implementing decision 6's three-fact model
  (Billed/Collected/Receipted) as five states — `paid`,
  `collected_no_receipt`, `outstanding`, `uninvoiced`, `zero_session` —
  plus `isCollected()`. Ledger's payment chip and totals bar rebuilt
  against it; new "Collected, no receipt" filter checkbox. No schema
  change, as planned — `payments` and `pendingPaymentNote` already
  existed and were already written to by New Visit and Workspace.
- **Scope grew well beyond "Ledger's chip and totals bar"**: the exact
  same bug — payment state (or an "outstanding" amount) derived from
  `invoiceId`/invoice-status alone, blind to direct payments — turned
  out to be independently reimplemented in four more places: New
  Visit's "last session" chip, Patient Profile's visit history *and*
  its outstanding-balance total, and
  `dashboardService.recentVisits`/`recentVisitsWindow` (Workspace's
  "Recently seen" panel). All four now call the shared function instead
  of their own copy. Also exported `VisitCard`'s `PAYMENT_CHIP` — it had
  been deliberately kept un-exported ("rather than adding a cross-module
  export for one shared constant across two files") until New Visit's
  own duplicate copy of it turned up needing the same fix a second time.
  Duplicated business logic is exactly how the bug reached five places
  instead of one; consolidating removes the trap, not just this one
  instance of it.
- Verified: typecheck, lint, vitest (231 passed, 9 new), production
  build all clean.

### PR 13 — Billing access toggle — SHIPPED
- `billingEnabled`, `invoicingAccess` (`'everyone' | 'billing_staff'`) added
  as plain columns on `clinics`, not the existing `clinic_module_settings`/
  `can_use_module()` Tier-1+Tier-2 mechanism that models the same shape —
  considered it (`'invoicing'` is already a registered module key), but it
  has zero client-side integration (no Dexie table, repo, or sync) and
  standing that up is real, separate scope belonging to the assessment-
  module gating it was built for, not something to bolt this onto.
- Enforcement inside `issue_invoice()`, reading both fields off the same
  `clinics` row already queried for `invoice_prefix`. Functionally
  verified (not just compiled) against a throwaway local Postgres: a
  plain therapist rejected under `billing_staff`, front desk succeeds, an
  admin rejected outright when `billing_enabled` is false, default
  `'everyone'` unchanged.
- New `usePermissions().canBill`. Ledger's Invoices tab hides when it's
  false (with a live-sync edge case handled — flipping the setting on
  another device doesn't strand someone on a tab that just vanished).
  `VisitCard`'s clickable "Collect ₹X" becomes a static "Awaiting billing"
  pill for a non-billing viewer, threaded through
  `ResponsiveVisitList`/`SharedVisitCard`/`VisitTable` into all three real
  consumers — Ledger, Workspace's Seen-today, and Patient Profile's visit
  history (which also had its own bulk-invoice checkbox, gated the same
  way; a local `canInvoice` variable there was renamed to
  `eligibleForInvoicing` to stop it colliding with the new prop).
- New Visit's payment-capture step conditionally skipped per decision 5 —
  with a one-line note explaining why instead of the field silently
  vanishing. The visit still saves with its computed bill amount, just
  with no payment logged.
- Settings gained a "Billing module" on/off select and a "Who can issue
  invoices" select (shown only when the module is on).
- **Deferred, not silently dropped**: the one-time transition banner ("an
  admin flipped `invoicingAccess` and you lost the tab"). Needs a toast/
  banner primitive that doesn't exist in this codebase yet, plus
  cross-session change-detection state — real, separable scope, not core
  to the access-control fix itself.
- Verified: typecheck, lint, vitest (231 passed), production build all
  clean.

### PR 14 — Nav restructure + Reports rename — SHIPPED
- `Shell.tsx`'s nav label renamed "Insights" → "Reports". Route path
  stays `/insights` — `/reports` is already the Ledger-sub-tab redirect
  and can't be reused. Same rename-only-where-it-matters treatment as
  `LedgerPage`/`SettingsPage` from PR 8.
- **Resolved a doc-internal tension**, not built as literally written:
  decision 8's prose ("Reports is what you read periodically — overview,
  monthly statement, settlements") reads as moving the monthly-statement
  generator out of Ledger and under Reports. But this PR's own bullet
  list explicitly wants the `/reports` redirect to land on a *Ledger*
  sub-tab — those can't both be true if the generator moves out of
  Ledger. Followed the concrete bullet list: `ReportsPage.tsx` (the
  monthly-statement generator) stays exactly where PR 8 put it, as
  Ledger's Reports sub-tab. "Dashboard as first tab" was already true
  going in (PR 8 already dropped Insights' old tab switcher down to just
  Dashboard) — no single-item tab bar added around it, since a tab you
  can't switch away from isn't an improvement.
- The concrete, valuable piece: Ledger's Visits/Invoices/Reports
  sub-tabs are now URL-addressable via a `tab` search param on `/ledger`
  (validated against a fixed set, same pattern as the existing
  `patientId` param) — the URL is now the source of truth for which
  sub-tab shows, replacing local `useState`. The `/reports` and
  `/invoices` redirects from PR 8 now set `tab: 'reports'`/`tab:
  'invoices'`, so an old bookmark lands on the right sub-tab instead of
  always defaulting to Visits like it has since PR 8. Tab switches use
  `replace: true` so clicking through tabs doesn't pile up back-history
  entries. PR 13's invoicing-access-changed-mid-session guard now
  navigates (clearing the URL's `tab`) instead of calling local
  `setState`, since there's no local state left.
- Nav role-awareness ("filtered by role and `billingEnabled`/
  `invoicingAccess`") was already fully satisfied by prior PRs —
  Settings hides for non-admins (PR 10), the Invoices sub-tab hides
  without billing access (PR 13). Nothing new needed here.
- Verified: typecheck, lint, vitest (231 passed), production build all
  clean.

### PR 15 — Therapist comparison unlock — SHIPPED
- `clinics.show_therapist_comparison`, off by default — an admin opts in
  explicitly from Settings → Features, same yes/no-select pattern as
  `clinicalDocsEnabled`. No server-side enforcement needed (unlike PRs
  10/13's RLS/RPC work) — this only widens what's shown on a chart built
  from data every clinical member can already read under existing RLS.
- `DashboardPage`'s gate changed from `scope.isAdmin` to
  `clinic.showTherapistComparison && !scope.isFrontDesk` — front desk
  excluded, no clinical work of their own to compare against colleagues.
- Second chart (Visits, `visitCount`) added alongside the existing
  Revenue (`postTaxPaise`) chart per decision 4 — same `TherapistMonthRow`
  trend data already being fetched, no new query. Kept as two labeled
  sections inside one "Therapist comparison" card, and kept as two
  separate bar charts rather than one combined chart, since ₹ and visit
  counts are on wildly different scales.
- Verified: migration replayed cleanly against the full history on a
  throwaway local Postgres. typecheck, lint, vitest (231 passed),
  production build all clean.

**All 6 PRs (10–15) in this document are now shipped**, on top of the 9
in `docs/BUILD-PLAN-compiled-changes.md` — 15 PRs total across both
plans.

## Post-ship review (2026-08-15)

A full read-through of the 15-PR build for bugs, inconsistencies, and dead
code, done after PR 15 shipped. One finding required a migration; the rest
were small cleanups.

**Critical: `clinic_module_settings.allowed_roles` still said `'staff'`
after PR 10's role rename — silently blocking every therapist from saving
consultation notes.** PR 10 (`20260815000001_role_model_and_visit_rls.sql`)
renamed every `clinic_members.role` from `staff` to `therapist` and
dropped `staff` from the check constraint, but never touched
`clinic_module_settings.allowed_roles`, which defaults to
`array['admin','staff']` (`module_registry.sql`) and is what every clinic's
`consultation_notes` row — seeded true for all clinics since PR 2 — relies
on, since none of the seed inserts specify `allowed_roles` explicitly.
`can_use_module()` checks `m.role = any(s.allowed_roles)`, so from the
moment PR 10 shipped, no `clinic_members` row could ever match `'staff'`
again, and every non-admin therapist's insert/update to `consultation_notes`
was rejected by RLS — clinical documentation, an actively used feature,
not the still-client-unwired assessment modules this table was built for.
Fixed in `20260815000004_fix_allowed_roles_staff_rename.sql`: backfills
every existing row's `allowed_roles` array and changes the column default
to `array['admin','therapist']`. Verified against a full replay on a
throwaway local Postgres 16 database: (1) a freshly created clinic seeds
`consultation_notes.allowed_roles = {admin,therapist}`; (2) a `therapist`-
role user (simulated via `SET ROLE authenticated` + `set_config('app.uid',
...)`) can insert a consultation note; (3) manually reverting one row back
to `{admin,staff}` reproduces the exact rejection (`new row violates
row-level security policy for table "consultation_notes"`), confirming the
bug was live, not theoretical.

Smaller fixes made in the same pass:
- `SetupPage.tsx`'s page heading still read "Setup" after PR 8 renamed the
  nav item to "Settings" — only the nav label had been updated at the time.
- `WorkspacePage.tsx` had a comment pointing at "Archive's Invoices tab",
  left over from before PR 14 renamed Archive → Ledger.
- `VisitCard.tsx` exported `VisitCardPaymentState`, a type alias for
  `VisitPaymentState` that became a dead re-export once PR 12 consolidated
  payment-state derivation into `src/domain/paymentState.ts`. Removed.

Checked and found *not* to be problems: the duplicate `20260807000001_*`
migration filename prefix (two distinct files, sorts deterministically —
cosmetic only); `useClinicRole.ts`'s separately-declared `ClinicRole` union
type (pre-existing, still in active use, not part of this build's role
rename). No other binary admin/staff assumptions found in client code —
grepped for `'staff'` across `src/` and confirmed the only remaining
references are in historical (already-applied) migrations, correctly left
untouched per this repo's convention.

Verified: typecheck, lint, vitest (231 passed), production build all
clean after every fix in this pass.

## Workflow review (2026-08-15, round 2)

Follow-up review, this time walking the actual end-to-end workflows for
each role (admin, therapist, front desk) plus an architectural read of
how the role model interacts with the offline outbox — rather than
grepping for stale text. Found six issues, all fixed:

1. **Sign-out didn't clear all clinical data.** `Shell.tsx`'s clear list
   was hand-maintained separately from the sync engine's table list and
   had drifted: `consultation_notes`, `patient_module_enrollments`, and
   `expected_visits` were never cleared, so on a shared front-desk
   machine, clinical notes stayed in IndexedDB after sign-out. Both
   lists now derive from one export (`db.ts`'s `ALL_SYNCED_TABLES`),
   with a type-level exhaustiveness check that fails to compile if a
   future synced table is added without updating it — verified by
   temporarily removing an entry and confirming the build breaks.

2. **Front desk could read full clinical note content.**
   `usePermissions` declared `canViewClinicalNotes` but nothing
   consumed it — `ConsultationNotePanel` rendered unconditionally.
   Now gated in `PatientProfilePage` and `NoteEditorPage` (the latter
   guards the route directly, since RLS SELECT stays open — front
   desk's contraindications banner is a narrow derived subset of the
   same notes and still needs read access, so this is a UI-level gate,
   not an RLS change).

3. **`consultation_notes_update` was still `is_clinic_member`** after
   PR 10 scoped the equivalent `visits_update` policy to owner-or-admin
   — a therapist could edit a colleague's clinical note (a medico-legal
   record) despite being blocked from editing that same colleague's
   billing row. Migration `20260815000005_scope_consultation_notes_
   update.sql` brings it in line with `visits_update`'s exact shape.
   Verified against a live local Postgres 16 database with three
   simulated users: the note's own therapist and an admin can update
   it; a different therapist gets `UPDATE 0` (RLS silently rejects the
   row) — confirmed both the write and that the row stayed untouched.

4. **A permission rejection in the offline outbox looked identical to
   a transient one.** `OutboxEntry` now keeps the Postgrest error code;
   `errors.ts` has a friendly pattern for the RLS rejection string
   instead of showing it raw; `SyncBadge` labels a permission-denied
   entry "won't succeed by retrying" instead of implying it'll clear on
   its own like every other queued failure.

5. **`scopeTherapistId` conflated "clinic-wide" with "unresolved."**
   `undefined` meant both "admin/front_desk, deliberately clinic-wide"
   and "role is therapist but no `therapists` row is linked to this
   login (or the link hasn't loaded yet)." `repos.visits.list`'s filter
   only applies when `therapistId` is truthy, so the second case fell
   through to clinic-wide — an unlinked or still-loading therapist's
   Workspace briefly or permanently showed every other therapist's
   visits. Now uses a sentinel UUID: truthy (so the filter still
   applies) but never matches a real row, failing closed instead of
   open. `WorkspacePage` also surfaces the permanently-unlinked case as
   a visible notice pointing at Settings → Team, instead of a silently
   empty page with no explanation.

6. **Delete/Split had no ownership pre-check.** They were offered on
   every visit in a clinic-wide list (Ledger, a patient's history,
   admin's Today) regardless of who logged it, so a therapist would
   click Delete on a colleague's visit and only find out it was
   rejected after the round-trip to the server. All three call sites
   that build `VisitCardData` now mirror `visits_update`/`delete`'s RLS
   check (admin or the visit's own therapist) before showing the
   action.

**Found but left alone, out of scope for a bug-fix pass:**
`EditVisitModal.tsx` is a fully built, imported component in
`VisitsPage.tsx`, but nothing anywhere calls `setEditing()` with a real
id — it's unreachable dead code, likely orphaned when the
`RowActionsMenu` (Repeat/Edit patient/Split/Delete) refactor replaced
whatever used to open it. Wiring it up or deleting it is a product
decision, not a correctness fix, so it's flagged here rather than
touched.

Verified: typecheck, lint, vitest (233 passed — 2 new cases added for
the RLS-message pattern), production build all clean; the new migration
replayed cleanly against the full history and was functionally tested
with three simulated users against a local Postgres 16 database.

## EditVisitModal wired up (2026-08-15, follow-up)

Product decision on the item flagged above: wire it up, so a therapist
can go back and fill in a visit's condition/treatment notes they missed
at point of care — the request that prompted this. Added an "Edit
visit" row action alongside Repeat/Edit patient/Split/Delete, gated by
the same admin-or-own-therapist pre-flight check as Split/Delete —
Ledger-only, matching where Split already lives rather than adding it
to every visit list in the app.

Not gated on invoice status the way Split/Delete are: a visit's
clinical fields should stay editable after invoicing, only its billing
shouldn't. That exposed a second, independent bug in
`visitService.updateBilling` — its "frozen" guard rejected *any* change
to an invoiced visit, including a clinical-only one, contradicting
`EditVisitModal`'s own "only billing is frozen" docstring (which was
apparently never actually true). Now the guard only fires when a
billing-affecting field (bill amount, adjustment reason, therapist
reassignment, visit date) is part of the change; two new tests cover
both the still-frozen and now-allowed cases.

Verified: typecheck, lint, vitest (235 passed — 3 new), production
build clean. Not verified in a live browser — no Supabase project is
configured in this environment, so an authenticated click-through
wasn't possible; the dev server does boot clean.

## Sequencing rationale

Roles first, because every later PR keys off the role vocabulary and the
permissions hook. Responsive standardization second and on its own,
deliberately not folded into PR 14, since PR 14's nav work should be built
against the corrected `tab:` breakpoint from the start rather than
retrofitted. Payment-state before billing-access, since PR 13 needs
accurate Collected data to make the "who bills what" split legible in the
first place. Nav and the comparison-chart unlock go last, once the roles
and toggles they display actually exist.
