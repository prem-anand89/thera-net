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

Status as of the 2026-08-15 deferred-list follow-through — three items resolved, one confirmed already resolved earlier than tracked, two re-confirmed as correctly left alone (not silently forgotten):

- ~~**Manual invoices creating synthetic visits**~~ — **RESOLVED, then superseded.** First pass added an `is_manual_invoice` column plus a `reportService.monthly()` filter to stop the synthetic visit from polluting reports. User review round (2026-08-15) went further: the "Add invoice" flow already required patient+therapist+service (same fields as a real visit) and only existed to skip New Visit's intake screen — now genuinely redundant with issuing an invoice from a real visit, which already works from three places (Workspace, Ledger, Patient Profile). Removed entirely rather than patched further; `is_manual_invoice` and its never-applied migration (`20260815000007`) were deleted outright rather than left as dead infrastructure, since nothing set the flag anymore.
- ~~**`canManageTeam` and `canViewPayouts` never consumed anywhere**~~ — **RESOLVED**, and worth the read: `canViewPayouts` gates Ledger's Reports sub-tab now (the full per-therapist Bill/BM Share/TDS/Post-Tax/HV monthly breakdown had **zero** permission gating — any therapist could already see every colleague's individual earnings). `canManageTeam` was removed rather than wired up — it was never referenced outside its own declaration, and the Team section it was meant to gate already sits fully behind `canEditSettings` (also `isAdmin`); there's no third role tier in this app that would ever make the two diverge.
- ~~**The offline outbox's stale-display gap**~~ — **RESOLVED.** `SyncEngine.push()` now reverts a permanently-rejected row to server truth immediately instead of leaving it stale until the next pull that will never come (`pull()` deliberately skips rows with a pending outbox entry). The outbox entry itself — and the "won't succeed by retrying" notice — stays until discarded or the row is edited again; only the stale local data is what this fixes. `isPermanentFailure` extracted to `sync/status.ts` as a shared, tested function so the engine and `SyncBadge` can't drift onto two different definitions of "permanent."
- ~~**`.mobile-only`/`.desktop-only` dead CSS**~~ — **Already resolved**, just not marked as such here: PR 11's own responsive-breakpoint pass removed them outright ("removed rather than migrated" — see the comment at `index.css`'s responsive-breakpoints section). This list entry was stale, not the code.
- **`my_memberships` Dexie table** — re-investigated, still correctly left alone. Confirmed (again) zero references anywhere in `src/` beyond its own schema declaration, and no class property on `ClinicDB` even exposes it. The risk in removing it is real, not hypothetical: Dexie version blocks are a migration history, and editing what an already-shipped version declares needs care around browsers that already went through it — for a table that costs nothing sitting empty and unused, that risk isn't worth taking just for cosmetic cleanup.
- **`EditVisitModal`'s therapist-reassignment field has no `WITH CHECK`** — still a product call, not a bug fix (should a therapist be able to hand a visit to a colleague at all?). Not touched.
- **`invite-therapist`'s `inviteUserByEmail(email, { autoConfirm: true })`** — not touched. Correction: an earlier round of this list claimed this environment has no live Supabase project to verify against — wrong. `mcp__Supabase__list_projects` confirms a connected, `ACTIVE_HEALTHY` project (`thera-net`, `kzsldbdjrignwxjgbqof`); its migration history simply hasn't caught up to this branch yet (stops before `20260815000001`, since none of this session's migrations are deployed — expected for an unmerged draft PR). Still not investigated, but for lack of time/priority, not lack of access.
- **Moving split columns off the visit row** — still rejected per decision 3, unchanged.

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
  **Corrected 2026-08-15 (user review round)**: this call was wrong. The
  user confirmed decision 8's literal reading was the intended one —
  `ReportsPage.tsx` moved to `/insights` as a second tab ("Monthly
  statement") alongside Dashboard ("Overview"); `/reports` now redirects
  to `/insights?tab=monthly` instead of `/ledger?tab=reports`; Ledger's
  own Reports sub-tab and its `canViewPayouts`-redirect guard were
  removed. See "Reports relocated" below.
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

## Onboarding, New Visit redesign, and therapist lifecycle (2026-08-15)

Four requested changes, shipped as three commits:

**Sign-in flash fix.** `Shell.tsx` showed `CreateClinicForm` whenever
`clinic` resolved to `null` — but that value meant two different
things: "Dexie's `clinics`/`activeClinicId` live queries haven't
resolved yet" and "this account genuinely has zero clinics." The
`syncKicked` guard that was supposed to cover the loading gap only
tracked session resolution, which (from localStorage) is typically
faster than Dexie's IndexedDB open — so on a hard refresh,
`CreateClinicForm` could flash before the real clinic loaded in. Now
`clinics === undefined || activeClinicId === undefined` is treated as
part of the same "Preparing…" state.

**Onboarding: auto-link the therapist roster row.** Root-caused to the
same gap the "workflow review round 2" `isUnlinkedTherapist` fix
detected and notified about — this fixes it at the source instead.
Inviting a `therapist`-role member previously only created the
`clinic_members` auth row; an admin had to separately remember a
manual "add to roster, then link" step. The invite form now asks for a
name when the role is `therapist`, and `invite-therapist`'s edge
function creates and links the `therapists` row in the same request
(best-effort — a failure here surfaces as a warning, doesn't undo the
invite).

**New Visit page redesign**, per a supplied reference mock: two-column
layout once a patient is confirmed (reference panel left, form right,
collapsing to stacked below `tab:`), no outstanding-balance tile (per
explicit direction — replaced with "Last visit" and "Package" tiles),
segmented pill toggles replacing the mode/payment radio-button rows.

**Therapist hard delete**, mirroring `hard_delete_patient`'s exact
shape: new `hard_delete_therapist` RPC, admin-only, blocked if any
visit/note/invoice references the therapist. Verified against a live
local Postgres 16 database: zero-history delete succeeds, a
history-bearing therapist is blocked with a mapped friendly error, a
non-admin is blocked outright.

**Settings: a scoped simplification pass**, not a restructure. Added a
one-line description per section (shown above the active section's
content) so an admin doesn't have to click through all 8 tabs to find
the right one. Disambiguated "GST / Tax ID" from "Tax / TDS %" — two
unrelated concepts (a registration number vs. a revenue-share
percentage) that share the word "tax" across different sections.
Deliberately did *not* restructure "Partner & split"'s ten fields into
smaller sections — the code already documents why they're saved
together (`clinicBillingConfig()` reads them as one unit; splitting
the save action risks the exact mid-edit desync that comment warns
about) — and did not reduce the 8-section count, since collapsing
distinct concerns to shrink a tab list isn't actually simpler.

Verified: typecheck, lint, vitest (236 passed), production build all
clean. Not verified in a live browser — no Supabase project is
configured in this environment; the invite-therapist edge function
change in particular hasn't been exercised end-to-end.

## Screenshot-driven follow-ups (2026-08-15)

The user shared two live screenshots (an actual deployed build, not
this branch) and three more requests:

1. **New Visit's structure changed drastically once a patient was
   picked.** Confirmed as a real regression in the two-column redesign
   above: the page jumped from one full-width column to two columns
   the moment `patient` went from null to set. Fixed — the two-column
   shape is now constant; only the left panel's *content* changes.
   `NewVisitPage.tsx`.
2. **No way to write a note from Workspace or Ledger.** Traced to
   `needsNote` only ever being true when `clinicalDocsEnabled` is on
   *and* the visit predates a completed note — a clinic with the
   feature off, or any visit whose note is already done, had zero
   notes affordance outside Patient Profile. Added an always-available
   "Add note" / "View note" row action, gated by `canViewClinicalNotes`.
   `VisitCard.tsx`, `dashboardService.ts`, `WorkspacePage.tsx`,
   `VisitsPage.tsx`.
3. **"Fix the alignment/organisation/structure" of Patient Profile and
   the clinical note.** Investigated both against the actual
   screenshots rather than guessing blind:
   - `NoteEditorPage.tsx`'s Therapist selector was a bare label+select
     with no card wrapper — the one piece of the page with no visual
     boundary next to General health & triage's card and the screening
     banner. Fixed: wrapped in the same `.setup-card` styling.
   - The Patient Profile screenshot's apparent large empty gap between
     the header and "Visit history" was attributed to the sync-status
     popup (open in that screenshot) overlaying the Consultation notes
     / Care plan cards, and not changed. **This was wrong — see the
     next section.** The reasoning at the time (don't reverse the
     documented mobile ordering on the strength of one ambiguous
     screenshot) was sound, but it stopped short: the popup was a
     plausible explanation, not a verified one, and the grid's
     placement rules were never actually checked.

Verified: typecheck, lint, vitest (236 passed), production build all
clean.

## Layout fixes from a second screenshot round (2026-08-15)

The user re-sent the Patient Profile screenshot with the sync popup
closed and the badge reading "Synced" — the gap was still there,
disproving the previous section's guess.

**Patient Profile gap — CSS Grid auto-placement.** The side column is
first in DOM with `lg:col-start-2`, so it occupies row 1. The main
column then requests `lg:col-start-1`, but the auto-placement cursor
has already advanced past that slot, and sparse packing therefore puts
it in *row 2* — a tall blank on the left, with Visit history pushed
below the side cards. Both columns now carry `lg:row-start-1`
explicitly. Nothing to do with the popup, `SideCard`, or the mobile
ordering, all of which were fine.

**Assessment scroll anchoring — two colliding sticky headers.** Shell's
app nav (`sticky top-0 z-10`) and the note editor's `.app-header`
(`sticky top:0 z-2`) both stuck to the viewport top, overlapping rather
than stacking. Consequences: the note header's back-link rendered
*behind* the nav and was unreachable, and the true sticky obstruction
(~110px) exceeded the 80px assumed by both the jump-nav's `md:top-20`
and every section's `scroll-mt-20` — so the first rail item was clipped
off the top and rail clicks landed sections under the header. Fixed by
making `.app-header` non-sticky (it's used only by NoteEditorPage),
leaving the nav as the sole sticky chrome at ~57px, which both 80px
offsets clear.

**Jump-nav grouped by SOAP.** Nine flat items reorganized into
Subjective / Objective / Plan / Progress, matching how a physio note is
actually structured. The `subjective` section is relabeled "Pain & Body
Chart" (what it holds) to avoid colliding with the new group heading.
Section order and the accordion are unchanged; a startup assertion
fails the build if the grouping drifts from `NOTE_SECTION_KEYS`.

**Notes list restructured.** Answering "how are notes organised once
they're written": previously the latest note was a special-cased header
(status + date) and older ones were bare dates — no note mode, and a
silent cap at five with no indication anything was hidden. Now every
note is one uniform row (date · Initial/Follow-up · status), capped at
six with an explicit "+N older" line.

**Settings grouped; Danger zone merged into Data.** Eight flat peer
sections now group as Clinic / People & services / System, with
headings rendered only in the vertical rail (the phone-width horizontal
scroller would just lose width to them). Data and Danger zone merge
into "Data & maintenance" — import, backup/restore, cache reset and
wipe are one occasional-maintenance job, and splitting them across
adjacent tabs meant guessing which held "restore a backup". This is the
"link multiple similar settings" ask from the earlier round, which the
first pass had explicitly declined to act on; the merge is defensible
where the earlier candidates (splitting Partner & split) were not,
because these two sections share a job rather than merely a screen.

Verified: typecheck, lint, vitest (236 passed), production build all
clean; confirmed in the compiled CSS that the new `tab:` variants land
in the same 46.5rem media block as the existing ones.

## Design-system unification (2026-08-15)

Root cause of "there's a lot of difference between the structures built
recently vs the old ones, and it's reflected everywhere": the app has
**two parallel design systems** that had drifted apart.

- Tailwind primitives in `components/ui.tsx` (`Field`, `inputCls`,
  `SectionCard`, `btnPrimary`, `btnSecondary`) — used by every screen
  except the note editor.
- Plain-CSS classes in `index.css` (`.field-block`, `.setup-card`,
  `.btn-primary`, `.field-row`) — used by `NoteEditorPage` and
  `BodyChart`.

Same widgets, different geometry. Reconciled the CSS side to the ui.tsx
values (they are now documented as a mirror pair, with a comment on each
side saying so):

| | was | now |
|---|---|---|
| input radius | 8px | 6px |
| input bg | `--paper` | `--surface` |
| input padding | 8/10px | 8/12px |
| input font | 13px | 14px |
| input focus | *none* | teal border |
| label | 10.5px UPPERCASE 600 | 12px sentence-case 500 |
| card radius / pad | 14px / 14–16px | 16px / 20px |
| button | pill 999px, 12.5px | radius 6px, 14px |

`.field-input` / `.field-label` were a **third** variant of the same
controls; folded into the same rules. One input in `NoteEditorPage`
bypassed both systems entirely with hardcoded inline styles.

**The mobile clipping bug** (fields cut mid-word inside Secondary
complaints) was `.field-row { grid-template-columns: 1fr 1fr }` applied
unconditionally — two input columns on a 360px phone. Now single-column
below Tailwind's `sm:` breakpoint so both stacks flip at the same width.
Verified in a real browser at 360px and 390px: `document.scrollWidth`
equals the viewport and no form element overflows.

**Uniform block structure.** Screening, General health & triage, and
Attending therapist were three different widget styles stacked down the
page. They now share one card + title/subtitle header shape
(`.ne-block-head`, deliberately matching `.setup-section-head`'s
typography minus the chevron). Screening keeps its status tint — that
colour *is* the signal — but loses its bespoke radius/padding scale.

**Mobile section nav.** Below `md:` the jump-nav rail is `hidden`, so
phones had no way to navigate a nine-section form except scrolling the
whole thing. Added a sticky horizontally-scrolling chip row — the same
pattern Settings already uses at that width — carrying the same status
dots as the desktop rail. Section `scroll-margin` raised to 28 on mobile
(20 at `md:`) to clear the extra sticky chrome it introduces.

**Left alone, deliberately:** `.mini-table` inputs stay at 12px — they
are dense table cells where the smaller scale is the point, not drift.
The remaining `border-radius: 999px` rules are all chips/pills/toggles,
which are *supposed* to be pills and match Tailwind's `Pill`.

Verified: typecheck, lint, vitest (236 passed), production build clean,
plus a real-browser render at mobile widths.

## Sequencing rationale

Roles first, because every later PR keys off the role vocabulary and the
permissions hook. Responsive standardization second and on its own,
deliberately not folded into PR 14, since PR 14's nav work should be built
against the corrected `tab:` breakpoint from the start rather than
retrofitted. Payment-state before billing-access, since PR 13 needs
accurate Collected data to make the "who bills what" split legible in the
first place. Nav and the comparison-chart unlock go last, once the roles
and toggles they display actually exist.

## User review round (2026-08-15)

Six questions from a user review of the deferred-list round, three of
which changed code:

**Manual invoice removed, not just excluded.** The prior round stopped
short — `is_manual_invoice` kept the synthetic visit out of reports, but
the "Add invoice" flow itself stayed. On inspection it already required
patient+therapist+service (same fields as a real visit), so it was never
really "invoice without a visit" — it just skipped New Visit's intake
screen and issue-invoice-from-a-real-visit already works from three other
places. Removed the whole flow from `InvoicesPage.tsx`, along with
`Visit.isManualInvoice`, its `reportService.monthly()` filter, and the
never-deployed migration that added the column.

**Reports relocated from Ledger to the Reports nav tab.** PR 14 (see its
entry above) made a call that turned out wrong: it kept the monthly
per-therapist statement (`ReportsPage.tsx`) as a Ledger sub-tab, reasoning
that its own bullet list demanded the `/reports` redirect land there. User
confirmed decision 8's literal reading — Reports (`/insights`) should hold
both "what you read periodically": Dashboard (now the "Overview" tab) and
the monthly statement (now "Monthly statement", still `canViewPayouts`
i.e. admin-gated). `InsightsPage.tsx` grew a small tab switcher mirroring
Ledger's; `/reports` now redirects to `/insights?tab=monthly`;
`VisitsPage.tsx`'s Reports sub-tab, its `canViewPayouts` redirect guard,
and the "Generate report" button's `setRecordsView('reports')` (now a
`<Link to="/insights">`) all came out of Ledger.

**Reports/Dashboard hidden from plain therapists, not just scoped down.**
Before this round, `/insights` had zero nav-level role gating — a
therapist could open it and see "My revenue trend" / "My packages" (scoped
to their own data, same pattern as front desk's clinic-wide view). User
clarified the intent was full hide, not scope-down: Ledger (visits,
bills) stays clinic-wide for every clinical role per decision 2 — that was
never in question — but Reports' aggregates are admin/front_desk only,
full stop, per decision 3. `Shell.tsx`'s nav now filters `/insights` to
`role === 'admin' || role === 'front_desk'`; `InsightsPage.tsx` gained the
same direct-URL guard pattern `SetupPage.tsx` already uses for Settings.
The one deliberate exception is the therapist comparison chart (decision
4) — extracted into `TherapistComparisonCard.tsx` (also moved
`SERIES_COLORS` into a shared `chartColors.ts` so Dashboard and this card
can't drift onto two palettes) and rendered on `/workspace` instead for a
plain therapist, since they can no longer reach it via Reports. Admin and
front_desk still see it once, on Reports, not duplicated onto Workspace.

**Confirmed Supabase is connected.** An earlier deferred-list entry
claimed this environment had no live Supabase project to check
`invite-therapist`'s `autoConfirm` behavior against — wrong.
`mcp__Supabase__list_projects` shows a connected, healthy `thera-net`
project; it just hasn't had this branch's migrations applied yet (expected
for an unmerged draft PR — its migration history stops before
`20260815000001`). The `autoConfirm` question itself remains
uninvestigated, now correctly recorded as a priority gap, not an access
gap.

**Three answered without a code change:** "Collected, no receipt" (Ledger
Visits filter) is decision 6's three-facts payment model working as
designed — cash/UPI logged directly against a visit with no invoice raised
yet, meant for front desk/admin to catch before month-end. Patient-to-
therapist assignment has no persistent concept in this app — it's decided
fresh per visit at New Visit intake (defaults to whoever saw the patient
last, or the creating user), which any clinical role can set; there's no
admin-exclusive "assign a patient" action separate from that. Visit-edit
scoping (`isAdmin || v.therapistId === myTherapistId`, `VisitsPage.tsx`)
was confirmed already matching the described behavior — other therapists
can't edit a colleague's visit at all, which is what RLS's
`visits_update`/`visits_delete` policies enforce server-side too.

**Found and fixed while auditing for residual design drift:**
`EditPatientModal.tsx` (used from Patient Profile, Workspace, and New
Visit) had a fixed `w-96` shell with no responsive downgrade and an
unconditional `grid-cols-2` Age/Sex row — the same bug class as the
`.field-row` mobile-clipping fix from the design-system-unification round,
just in a file no screenshot had covered. Shell now scales
(`w-full max-w-sm`, `p-4` on the overlay for viewport margin,
`max-h-[90vh] overflow-y-auto` matching `EditVisitModal.tsx`'s pattern);
the grid drops to one column below `sm:`.

Verified: typecheck, lint, vitest (240 passed — down from 242, the two
manual-invoice-specific `reportService.test.ts` cases were removed along
with the feature), production build all clean.

## Note editor cell audit + bottom-docked mobile tabs (2026-08-15)

A fresh screenshot round on `NoteEditorPage.tsx` surfaced exactly what
"few cells were added by haiku" meant: Trauma history, Surgical history,
and Goals rendered their dynamic list rows with **no styling class at
all** — bare `<input>`/`<select>` elements with neither `.field-input`
nor a `.field-block` ancestor, so they picked up zero border/background/
padding from either design system. Next to Previous Pain History's
properly-boxed card (added later, correctly styled), they looked like a
completely different, unstyled widget — which is exactly what the
screenshot showed. Same three widgets also hardcoded a fixed multi-column
`gridTemplateColumns` (`90px 1fr 1fr auto`, `1fr 120px 140px auto`)
bypassing `.field-row`'s own responsive breakpoint entirely, so on a
narrow phone the later columns (a third input, the delete button)
overflowed off the right edge instead of wrapping — the literal "text
crossing off the box."

Audited the whole file programmatically (every `<input>`/`<select>`/
`<textarea>` checked for a `.field-input` class or a `.field-block`/
`.mini-table` ancestor) rather than fixing only what a screenshot
happened to catch. Found and fixed the same two bugs (missing class,
hardcoded grid) in: Secondary complaints' Onset/Mechanism/Episode
pattern/Notes, Previous pain history's Timeline onset/duration/intensity/
treatment, Palpation's Region/painOnPalpation, ROM/Strength-MMT/Special
tests (objective exam), HEP exercises, and the Pain Profile/PSFS NRS
scale triplets (`repeat(3, 1fr)` inline override, same class of bug).
Five stray labels using the pre-unification inline style (`fontSize:
10.5, uppercase`) switched to the shared `.field-label` class. Left
alone, confirmed correct: `.mini-table` inputs (dense table cells, 12px
by design, already have their own CSS rule) and one `.stat-row` pinned
at 2 columns (matches its own responsive base, doesn't scale up like
siblings, but that's a density choice not a mobile bug).

Root-caused a second, separate bug from the same screenshots:
`SetupPage.tsx`'s four `grid-cols-2 gap-3 lg:grid-cols-3` section grids
(Clinic profile, Billing & invoicing, Partner & settlement, Features)
had no `sm:` step — 2 columns unconditionally, including on a 360–375px
phone. Wrongly cleared earlier in the design-system-unification round by
pattern-matching against a different, genuinely-safe 2-col stat-tile grid
elsewhere without checking what these actually contained (real form
fields, not stat tiles). The visible symptom: a native `<input
type="file">`'s "Choose File / No file chosen" text doesn't shrink,
so squeezed into a ~165px half-width column it overflowed its box.
Fixed to `grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3`, matching the
pattern used correctly everywhere else in the app.

**Mobile tab bars moved to the bottom of the viewport**, per explicit
request — both Settings' section switcher and the note editor's mobile
section-jump chips were a horizontally-scrolling row pinned to the top
(cut off mid-label at the viewport edge in both screenshots). Both are
now `fixed inset-x-0 bottom-0`, reverting to their normal in-flow
position (vertical rail / desktop sidebar) at `tab:`/`md:` and above.
Each page's root gained `pb-16` (mobile only) so the fixed bar doesn't
cover the last field on screen. The note editor's mobile-only
`scroll-mt-28` (extra clearance for the old top-pinned chip nav)
reverted to the same `scroll-mt-20` used at every other breakpoint, since
nothing sticky sits at the top of the viewport below `md:` anymore
(Shell's own header is the only thing left to clear, already accounted
for). Jump-to-section behavior is unaffected — `scroll-mt` clearance is
about the target section, not where the nav triggering the jump sits.

`NewVisitPage.tsx` was checked against the same "old build" complaint
and came back clean — zero unstyled form controls (confirmed
programmatically), the two-column patient/visit layout consistent
throughout. If it still looks misaligned on the deployed preview after
this round, that's most likely a stale deployment rather than a source
issue worth chasing blind.

Verified: typecheck, lint, vitest (240 passed), production build clean,
plus a real headless-browser render at 375px width for both the Settings
grid (fields now stack to one column, file input fits its box, tab bar
docked at bottom) and the note editor's Trauma history card (now
properly boxed, matching Previous Pain History) — zero horizontal
overflow measured on both.
