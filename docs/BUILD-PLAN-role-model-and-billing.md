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

## Second review pass: lighter list-entry cards, real bugs found (2026-08-15)

Four more items from a follow-up screenshot review.

**"Even the newly-fixed cells don't match."** True — the previous round
made Trauma/Surgical history *consistent with Previous Pain History*, but
never questioned whether that shared pattern (`.setup-card`: 16px radius,
20px padding, a shadow) belonged on a *repeated entry* at all. It's
`SectionCard`'s mirror — meant for one top-level page section, not a card
nested inside a section that's already a card. Every one of these
repeatable-entry widgets was rendering as a card-inside-a-card, visually
a different "system" from the flat `.field-block` fields around it (e.g.
Current medications, Allergies) even once internally consistent with
each other. New `.list-entry` class: same border, no shadow, 8px radius
(not 16), `--paper` background (not `--surface`) — reads as a grouped
sub-list, not a competing card. Swapped onto all 11 repeated-entry usages
(Secondary complaints, Trauma/Surgical history, Previous pain history,
Functional status activities, Palpation, ROM, Strength/MMT, Special
tests, HEP exercises, Goals); left `.setup-card` itself untouched on its
two genuine top-level uses (General health & triage, Attending
therapist) and the Free notes textarea, which isn't a repeated entry.

**The note editor really was narrower than every other page on mobile —
a real, separate bug.** `.app-header`/`.screen-body` (NoteEditorPage's
only two consumers, both plain-CSS, predating this session) carried
their own horizontal padding, stacked on top of `Shell.tsx`'s `<main
className="px-4">` which every page already sits inside. Every other
screen gets Shell's 16px once; the note editor was getting 16+16=32px
each side — 64px of its 375px viewport gone before content even started.
Likely predates the `<main>` wrapper becoming universal and nobody
caught it since. Dropped the redundant horizontal component at all three
breakpoint tiers, keeping the vertical rhythm as authored.

**Settings' description line sitting on the card border — an actual
Tailwind v4 semantics bug, not a typo.** `space-y-6` in this Tailwind
version applies `margin-bottom` to each non-last child via a
zero-specificity `:where()` selector (v3 used `margin-top` on
*subsequent* siblings — different mechanism entirely). The description
`<p>` had its own `-mb-2`, written under the v3 mental model of "trim 8px
off the incoming 24px gap." Under v4, a same-element class doesn't add to
the `:where()` rule, it fully overrides it — so the actual computed
margin was a literal **-8px**, not 16. Changed to `mb-2` (positive),
still tighter than the 24px default (matching the apparent original
intent) but no longer negative. Worth a quick grep for any other
`-m*`-style classes riding on `space-y-*` elsewhere before assuming this
pattern is safe to reuse — none found this pass.

**Therapist hard-delete: two separate, real problems, not one.**
1. Confirmed directly against the connected Supabase project
   (`select proname from pg_proc where proname = 'hard_delete_therapist'`
   → empty) — the RPC genuinely does not exist there yet. This branch's
   migrations, including this one, are not deployed (same fact already
   noted in the deferred list) — deleting a therapist can't work at all
   pre-deploy, full stop, not a code bug.
2. Independent of that: `deleteTherapist()`'s client-side pre-check only
   counted the therapist's own `visits` — the RPC's actual rule (visits
   where they're primary *or shared* therapist, plus consultation notes,
   plus invoices) is wider. A therapist with zero primary visits but a
   shared-split visit, a note, or an invoice would have passed the
   client check, gone through the confirm-by-typing-the-name prompt, and
   only then hit a less specific rejection from the server. Fixed the
   client check to fetch and count the same three sources the RPC does,
   so the same accurate "N linked records" message shows up-front.

**Service catalog: the seed data was one real clinic's real business,
not example data — and new clinics got nothing at all.**
`supabase/seed.sql` was never applied to production (it's a local-dev
`supabase db reset` fixture) but it hardcoded the actual pricing sheet
and clinic identity visible in the live screenshots — wrong to ship as
if it were generic sample data. Separately, and not previously covered
by any plan doc: `create_clinic_with_admin()` — the real self-service
signup path — inserted zero `service_catalog` rows, so every new clinic
started completely empty and had to build a price list from scratch
before logging a first visit. New migration
(`20260816000001_starter_service_catalog.sql`) seeds six clearly-generic
starter services (Initial/Follow-up Consultation, Physiotherapy
Session/Package, Manual Therapy, Exercise Therapy) in the same RPC
transaction that creates the clinic — editable/deactivatable from
Settings -> Services like any catalog item, same as before. `seed.sql`
itself rewritten to equally generic placeholder data ("Example
Physiotherapy Clinic," round example prices) so the checked-in dev
fixture no longer doubles as a real clinic's business records. The
user's *live* production catalog was deliberately left untouched — that's
real, currently-referenced billing data, and self-service
deactivate/edit from Settings -> Services already covers "I don't want
to see these active going forward" without a destructive server-side
action.

Verified: typecheck, lint, vitest (240 passed), production build clean;
the new `create_clinic_with_admin()` was functionally verified against a
throwaway local Postgres 16 replay of the full 33-migration history —
called the RPC as an authenticated user, confirmed both the admin
membership (via the existing trigger) and the six starter catalog rows
landed in the same transaction. Real headless-browser render at 375px
confirmed the description-spacing fix (positive gap, not text-on-border)
and the `.list-entry` card now reading as a lighter sub-group rather than
a nested card.

## Migrations deployed to production (2026-08-15)

At the user's request, applied the 7 new migrations
(`20260815000001`-`20260816000001`) directly to the connected Supabase
project rather than waiting for the normal merge/deploy path. Not a
blind replay: the remote's tracked migration history uses different
names and a different order than this repo's filenames (bootstrapped
through some other process at an earlier point, unrelated to this
session), so each migration's assumed starting schema — constraint
definitions, column presence, policy sets — was checked against the
live database's actual current state via direct SQL before applying
anything, and the end state re-verified after each one.

That check surfaced one genuine piece of drift: a `therapists_insert`
policy existed live with no corresponding migration anywhere in this
repo's history — added directly against the database at some point,
outside the tracked file set. Its check expression referenced a
`'therapist'` role value that didn't even exist yet in
`clinic_members`'s check constraint at the time, so it was inert (never
matched anything beyond what the pre-existing `therapists_all` policy
already permitted) — but it collided by name with migration 1's own
`create policy therapists_insert`. Fixed in the migration file itself
(`drop policy if exists therapists_insert` added before the create),
not just patched for this one apply, so a future fresh replay handles
either a clean database or this specific drifted one without
intervention.

Verified against the live project after applying: `hard_delete_therapist`
/`create_clinic_with_admin`/`issue_invoice` all present;
`clinic_members_role_check` allows admin/therapist/front_desk (zero rows
needed the `'staff'`→`'therapist'` backfill — this clinic had no `staff`
members going in); `visits`/`therapists`/`service_catalog`/
`consultation_notes` each carry exactly their new intended policy set,
no leftover `_all` or drifted policies; `clinics` has all three new
columns with correct defaults; zero `clinic_module_settings` rows still
say `'staff'` — the critical consultation-notes-blocking bug from the
"Post-ship review" section above is now actually fixed in production,
not just in this branch. Security advisor shows nothing new introduced
by the deploy.

## Third review pass: note-editor labeling, cramped visit cards (2026-08-15)

Two more real issues from a fresh screenshot.

**List entries still read as a different system — because they were.**
The previous two rounds fixed the box styling (`.setup-card` →
`.list-entry`) and the layout (hardcoded grids → responsive `.field-row`),
but never touched the actual labeling mechanism: every static field in
the note (Medical conditions, Pregnant, Current medications…) uses a
persistent `<label>` above its input, via `.field-block`. Every dynamic
list-entry field (Region, Onset, Mechanism, Body part, Movement, Goal…)
used `placeholder=` text *only* — the instant you type something in, the
only clue to what the field means disappears. That's a structural
difference no amount of border/shadow matching could fix. Converted
every sub-field across all 11 repeated-entry widgets (Secondary
complaints, Trauma/Surgical history, Previous pain history, Functional
status activities, Palpation, ROM, Strength/MMT, Special tests, HEP
exercises, Goals) from bare `placeholder`-only inputs to the same
`.field-block` + `<label>` pattern used everywhere else in the note. Four
`placeholder=` attributes remain, deliberately — format hints (*"e.g.
Wall slides"*) underneath a real label, the same pattern already used
elsewhere in this file (e.g. the walk-in ID prefix field in Settings).

**The Ledger/Workspace mobile visit card was genuinely broken, not just
dense.** `SharedVisitCard` (`VisitCard.tsx`, shared by every mobile visit
list in the app — Ledger, Workspace's Seen Today, Recent visits) packed
five elements into one unconditional flex row: a fixed-width date column,
a fixed-width avatar, the patient name/details, a payment-status column,
and an actions-menu button. On a 375px phone, the four fixed/shrink-0
elements alone ate roughly 250px before the flexible name/details column
got anything — rendered and measured directly (not just estimated): the
patient name wrapped mid-surname, and every word of the secondary detail
line ("Shoulder Pain · Physiotherapy 7 Days (3/7) · Prem · FM An/Re S,S")
landed on its own line, a dozen lines tall for what should be one. Fixed
by splitting the row below `sm:` (640px) into two: date + avatar + name
on one line, payment info + actions spread across a second full-width
line — reverting to the original single-row layout at `sm:` and up via
`sm:contents`, where there's actually room for it. Verified with a real
render at both 375px (now one clean name line, readable wrapped detail
text) and 700px (unchanged single-row layout) — zero horizontal overflow
at either width.

Verified: typecheck, lint, vitest (240 passed), production build clean;
real headless-browser renders at 375px and 700px for the visit card fix,
confirming both the bug (before) and the fix (after) rather than
assuming from the code alone.

## Fourth round: `.list-entry` still read as a different surface (2026-08-15)

User feedback, correctly: after three rounds of fixes, the note editor's
list entries still looked like "patch work" next to the plain fields
around them. Right diagnosis of what earlier rounds got wrong — round 2
gave `.list-entry` its own background (`--paper`, a light grey) and a
bordered, rounded box, deliberately lighter than `.setup-card`'s heavy
shadow-card treatment, but *any* distinct background+border+radius reads
as a separate surface sitting inside an otherwise flat white section, no
matter how light. Lightening a box is not the same as removing it, and
removing it is what "matches the rest of the note" actually requires.

`.list-entry` now carries no background, no border-radius, and no
standalone border at all — just `padding` and a `border-bottom` hairline,
the exact `divide-y` pattern already used for every other list in this
app (invoices, the visits table, a patient's note history). A repeated
entry's fields render with the literal same white bordered input boxes as
every static field around them; the only visual differentiators left are
the "+ Add" button on the group label and a thin divider line between
multiple entries — which is the correct amount of differentiation for
"this is a repeatable group," not "this is a different design system."
Rendered side by side with `Current medications`/`Allergies` (plain
fields) directly above a Trauma history entry at 500px to confirm:
visually indistinguishable input styling, no separate box.

Verified: typecheck, lint, vitest (240 passed), production build clean,
plus the direct side-by-side render described above.

## Fifth round: New Visit's grid, bottom nav, and naming audit (2026-08-15)

**New Visit's "Visit" card had the same auto-placement bug as Patient
Profile's gap, one round earlier in a different shape.** `grid-cols-1
sm:grid-cols-2` paired up whichever two fields happened to land in the
same row by grid auto-placement — stable while the form's shape was
fixed, but three of its fields (Adjustment reason, the Payment section,
an "unbilled" note) render conditionally. Depending on which combination
was active, unrelated fields of different heights landed side by side,
and a long dynamic label ("Adjustment reason * (discount of ₹500)") had
to wrap inside a half-width column, visually crowding its own input —
matching both "misaligned" and "text pushing the boxes." Dropped to a
single column throughout, matching the Patient panel above it exactly
(explicit ask: "build it mimicking the upper section"), removing the
row-pairing ambiguity entirely rather than trying to patch the grid
further.

**Bottom bar reconsidered — it was the wrong nav that moved.** The
earlier "shift tabs to bottom" request got applied to Settings' section
switcher and the note editor's jump-chips (both *secondary*, in-page
navigation). What was actually meant: the *primary* app nav
(Workspace/Ledger/Patients/Reports/Settings, previously a hamburger
dropdown on mobile) belongs at the bottom, native-app-tab-bar style, and
the secondary nav bars should revert to the top now that the bottom of
the viewport is spoken for. `Shell.tsx`'s mobile hamburger + dropdown is
gone; a fixed bottom tab bar with one icon+label per nav item takes its
place, `sm:hidden` (desktop keeps the header nav, now with matching
icons). The hamburger's old job — account info, sign out — moved to a
small standalone account-icon menu in the header, decoupled from
navigation. `<main>` gained matching bottom padding (`pb-24 sm:pb-6`) so
page content never sits under the fixed bar. Doesn't intercept touch
outside the bar itself, so native back-swipe/back-button gestures are
unaffected. Settings' section switcher and the note editor's jump-chips
both reverted to their pre-"bottom" state (top horizontal scroller /
sticky-under-header respectively), including the note editor's
`scroll-mt-28` mobile clearance that only makes sense with a top-pinned
chip nav.

Five simple stroke icons (home/document/people/bar-chart/sliders) built
inline in `Shell.tsx`, matching the existing hamburger glyph's visual
language (currentColor, ~1.6px stroke, round caps, no fill) rather than
pulling in an icon library for five glyphs.

**Naming audit** — the concrete, high-confidence fixes (declined to
homogenize genuinely-different concepts, e.g. patients "Hide" vs.
therapists/services "Deactivate" — different real-world meaning, not
drift):
- `NoteEditorPage.tsx` called itself "Assessment" when accessible and
  "Clinical notes" in its own permission-denied guard — same page, same
  feature, self-contradictory. Guard now says "Assessment" too.
- `PatientProfilePage.tsx`'s patient-header chip said "MRN"; all 13+
  other occurrences across the app (search boxes, tables, forms, print
  documents) say "Patient ID" for the exact same field. Fixed to match.
- Three components that used to be standalone top-level routes
  (`InvoicesPage`, `DashboardPage`, `ReportsPage`) kept their own `<h1>`
  after becoming permanently-embedded sub-tabs of Ledger/Reports —
  redundant under the parent page's own heading, and drifted from the
  tab label used to reach them ("Overview" tab → "Dashboard" heading;
  "Monthly statement" tab → "Monthly report" heading). Confirmed via
  grep that none of the three is ever rendered standalone anymore before
  removing/demoting their headings.

Verified: typecheck, lint, vitest (240 passed), production build clean,
plus a real headless-browser render of the new bottom tab bar at 375px
confirming legible icons and correct active-state coloring.

## Sixth round: repeat-visit pre-fill, and screening/general health in the jump-nav (2026-08-15)

**Repeat visit** — `NewVisitPage.tsx`'s repeat-visit effect (triggered by
`?repeatVisitId=` from `VisitCard.tsx`'s "Repeat" action) unconditionally
set `mode` to `'continuation'`, regardless of whether the repeated visit
actually belonged to a package. For a plain one-off repeat this left the
form stuck showing an "Open package" selector with nothing in it — a
dead end — and never carried over the service or bill amount either, so
"Repeat visit" saved no time for the common non-package case. Fixed:
mode is now derived from whether the repeated visit has a
`packageGroupId`, service + bill are pre-filled unconditionally in both
cases, and the package-matching effect falls back to `'new'` mode if the
original package has since closed (no longer present in the open-package
list) instead of leaving the form pointed at a package that's gone.

**Screening / General health in the note's jump-nav** — both sections
sat above the note's accordion with no way to jump back to them once
scrolled past, unlike every other section. Added them as two extra
entries (`EXTRA_JUMP_TARGETS`) in both the mobile chip nav and the
desktop rail in `NoteEditorPage.tsx`, sharing the exact same
active/status-dot styling as the nine `NoteSectionKey` entries. They
aren't part of the Core Assessment payload's SOAP structure and were
deliberately kept out of the `NoteSectionKey` domain type — instead
`activeSection`/`sectionRefs` were widened to a locally-scoped `JumpKey =
NoteSectionKey | 'generalHealth' | 'screening'` union, so the scroll-spy
mechanism treats all eleven the same without touching
`coreAssessment.ts`'s exhaustiveness-checked domain list. Status dot for
the two extras is hand-derived (`extraJumpDot`) rather than reusing
`sectionCompletion`, which is defined over `NoteSectionKey` only:
Screening mirrors the red/amber/clear the banner itself already shows,
General health reads complete once any vital (weight/height/waist) has
been entered.

Verified: typecheck, lint, vitest (240 passed), production build clean,
plus a real headless-browser render of both the mobile chip nav and
desktop rail confirming the two new entries render with correct
active-state and status-dot coloring alongside the existing nine.

## Are notes connected to visits? (2026-08-15)

Investigated in response to: "Are notes connected to Visits? There is
only therapist assign option but no date or visit linked. Shouldn't
therapist be automatically linked based on the visits data?"

Short answer: partially, and invisibly. `ConsultationNote.visitId`
already exists in the domain model, and gets set whenever a note is
opened via a visit's "Add note" row action (`VisitCard.tsx` passes
`?visitId=` through to `NoteEditorPage`). But nothing in the note editor
ever showed that link — no date, no visit reference anywhere on the
page — and the "Attending therapist" selector always defaulted to
whichever therapist happened to be first in the clinic's list,
completely independent of which visit (and which visit's therapist) the
note was actually for. Separately, the more common "New note" entry
point on Patient Profile passes no visit context at all, so most notes
still won't carry a `visitId` — that's an existing model gap, not
something this round changed (a note documents an episode/enrollment,
not necessarily one specific visit, and there's no visit-picker UI to
attach one after the fact).

Fixed the two things actually broken: `NoteEditorPage.tsx` now looks up
the linked visit (`existingNote.visitId` for a saved note, the
`?visitId=` prompt for a new one) and (1) shows that visit's date in the
Attending therapist card's subtext instead of the generic "who is
recording this" copy, explicitly saying "not linked to a visit" when
there isn't one, and (2) defaults the therapist selector to that visit's
own `therapistId` rather than the first therapist in the list — still
editable, since the person recording the assessment isn't always
guaranteed to be the treating therapist. The old first-in-list fallback
only applies now when there's no visit to wait for at all.

Verified: typecheck, lint, vitest (240 passed), production build clean,
plus a real headless-browser render of both the visit-linked and
unlinked subtext states.

## Mobile homescreen app icon (2026-08-15)

The app had no manifest, no favicon, no apple-touch-icon at all —
`index.html` linked nothing beyond the Google Fonts stylesheet, and
there was no `public/` directory. Added one from scratch off a design
brief: an "Rx" monogram in the app's own Fraunces display serif (the
same family every page heading already uses) on the app's actual teal
(`#2c5f63`, matching `--teal`), rather than a generic sans-serif
prescription-pad graphic — reads as this app's mark specifically, not a
generic medical icon, and a single glyph stays legible down to a 16px
favicon where a literal pad-and-lines illustration would turn to mush.

Generated as PNGs (favicon 16/32, apple-touch-icon 180, icon 192/512,
plus a 512 maskable variant) by rendering the design in a real headless
Chromium at each target viewport size rather than resizing a master
image — no image-manipulation library was available in this
environment, and rendering natively at each size keeps every asset
pixel-crisp. The maskable variant reuses the same 512 file: measured
the glyph's bounding-box diagonal from center (≈37% of the icon's half-
width) against Android's 40%-radius maskable safe zone before deciding
a second, more-padded design wasn't needed.

`public/manifest.json` added (name, theme/background colors matching
`--teal`/`--paper`, standalone display, all three icon entries).
`index.html` gained favicon/apple-touch-icon/manifest links plus
`theme-color` and `apple-mobile-web-app-*` meta tags.

Verified: production build copies all assets into `dist/` correctly;
served the build and loaded it in headless Chromium, confirming
`manifest.json` resolves, the favicon/apple-touch-icon `<link>` tags
resolve to 200s, and no new console errors. Preview images at 512/192/32
sent to the user for sign-off on the design before committing.

## Seventh round: icon redraw, note-nav placement, Workspace density (2026-08-16)

Four requests this round, three implemented directly:

**Icon redraw.** The user sent reference images (a notepad-with-pen glyph)
and asked to replace the "Rx" monogram with that concept, improved. Redrew
as flat vector shapes (ruled notepad + a pencil resting at its corner,
tip on the last line) in the same teal/cream palette as the Rx version,
scaled 0.82x from center so the composition's farthest point (the
pencil's eraser cap, ~41% from center unscaled) clears Android's 40%
maskable safe radius. Regenerated all sizes the same way as before
(headless Chromium at each target viewport, no image library needed) and
replaced every file in `public/`.

**Note editor jump-nav placement.** "Shift the tabs... above the general
health so it stays on top always visible" — the jump-nav (mobile chips
and desktop rail, added two rounds ago) sat *after* General
Health/Screening/Attending therapist, so scrolling through those three
cards had no nav visible at all; it only appeared once you'd already
scrolled past them. Restructured `NoteEditorPage.tsx` so all three cards
now live inside the accordion's own column (after the desktop rail, after
the mobile chip nav) instead of above both — the mobile nav is `sticky
top-14` and the desktop rail `sticky top-20`, so now that General
Health/Screening/Attending are inside the same scroll extent as the
accordion, both stay visible through the whole page, not just the SOAP
sections. No visual change to the cards themselves, purely a DOM reorder.

**Workspace density.** Three related complaints — stat tiles "occupy the
entire screen," Needs Attention "missed out," Expected Today's manual-add
form crowding the list — traced to one root cause: `StatTile` was sized
for a handful of tiles in a loose flex row, but on a phone (`grid-cols-1`
below `sm:`) each tile took its own full-width row, so 4 stacked tiles
really could fill a phone screen before any real content appeared.
Shrunk `StatTile` (rounded-xl, `px-2.5 py-2`, value down from `text-2xl`
to `text-base`) and switched Workspace's stat row to
`grid-cols-[repeat(auto-fill,minmax(86px,1fr))]` — sized off a fixed
column width so tiles pack 3-4 to a row on a phone and a wrapped last
tile stays tile-sized instead of a flex row's lone leftover item
stretching to fill its own row alone (tried `flex flex-wrap` first,
confirmed via a real render that this was exactly that failure mode).

Needs Attention used to split into an admin-only full grid at `tab:` and
up vs. a tap-to-open summary chip everywhere else — replaced both with
one glance-level treatment for every role/width: up to 3 compact cards
(colored left border by kind, patient name, one line of detail) inline
on the page, tapping one opens the existing bottom-sheet Panel where
`PendingWorkRow`'s full actions (Mark paid, Add note, View) still live.
Never hidden behind a tap now, and no longer a per-role/per-breakpoint
split to reason about.

Expected Today's manual "+ Add expected" form used to render inside the
same card as the list, so mid-entry the list-you're-scanning and the
form-you're-filling competed for the same space. Split into two cards:
"Expected today" (list only, stays near the top) and "Add an expected
visit" (the form, moved to the bottom of the page — the least
time-sensitive action here, unlike reacting to who's actually arrived).
Left a comment on the new card flagging it as a placeholder: once a real
appointment-booking system exists, "Expected today" should populate
itself from confirmed bookings for the day, and this manual form becomes
the walk-in/phone-booking fallback rather than the only path in.

Verified: typecheck, lint, vitest (240 passed), production build clean,
plus a real headless-browser render of the full redesigned Workspace at
390px confirming the compact tile row, the three Needs Attention preview
cards, and the list/form split all render coherently together.

## Member display names + editable roles (2026-08-16)

The last request from the same round: replace the raw email shown near
Sign out with a name + role, let a member (not just an admin) set their
own, and let an admin edit any member's name and role.

**Schema.** `clinic_members` gained `display_name text` (migration
`20260816000002_member_display_name.sql`) — deliberately separate from
the existing `title` column added a round ago (`20260815000001`), which
turned out to be an unused job-title field ("Lead Physiotherapist"), not
a name; this is the everyday name shown in the header. Backfilled from
`therapists.name` for anyone already linked. RLS previously let an admin
update *any* member row (`members_update`) but gave a non-admin no way to
touch even their own — added `members_update_self` (`user_id =
auth.uid()`) so anyone can edit their own row, paired with a new
`clinic_members_role_guard` trigger that raises unless the acting user is
already a clinic admin whenever `role` actually changes — RLS alone can't
see which columns changed, only trigger logic can, so self-service
name-editing without opening a self-promotion hole needed both pieces
together. `list_clinic_members_with_email` (dropped and recreated, since
`CREATE OR REPLACE` can't add a return column) now also returns
`display_name`. Verified locally first: replayed all 34 migrations
against a from-scratch Postgres 16 database with the project's
auth/storage shim, then exercised the RLS+trigger combination directly —
confirmed a non-admin can rename themselves, cannot self-promote (trigger
raises), an admin can rename or reassign anyone, and a non-admin update
targeting *someone else's* row affects zero rows under RLS as the
`authenticated` role (not superuser, which would have silently bypassed
RLS and given a false pass) — before applying to production.

**Incidental discovery**: while touching the invite flow, `list_edge_functions`
on the live project came back empty — `invite-therapist` had never
actually been deployed. The "Invite a team member" UI has been calling a
function that doesn't exist in production this whole time. Deployed it
now (as part of this change, not a separate fix) — first live version.

**Frontend.** `useClinicRole` now also fetches/returns `displayName` and
a `setDisplayName()` function that writes straight to `clinic_members`
and updates the hook's own in-memory + Dexie-cached state from the
confirmed value, rather than waiting on the fetch effect to re-run (its
deps are clinicId/userId, which don't change on a name edit). The Dexie
cache value changed shape (`ClinicRole` string → `{role, displayName}`)
so it's now JSON-encoded into the same `string`-typed `meta.value`
column rather than widening that shared type for one caller — with a
parse-and-shape-check on read so a pre-upgrade cached plain-string entry
degrades to `'unknown'` instead of silently returning `undefined` where
the hook promises a `ClinicRole`.

`Shell.tsx`'s account area (both the desktop header and the mobile
dropdown) now shows `displayName ?? email-local-part` plus a role label
instead of the bare email, click-to-edit inline (`NameEditor`, mounted
once per breakpoint — each instance owns its own edit state
independently, harmless since only one is ever visible via
`hidden`/`sm:hidden`). `CLINIC_ROLE_LABELS` moved to live next to the
`ClinicRole` type in `useClinicRole.ts` so Shell and Settings → Team
share one copy instead of Settings keeping its own duplicate.

Settings → Team's invite form used to only collect a name when inviting
a therapist (front_desk/admin invites went out nameless, leaving their
`display_name` null until someone set it later). Now every invite
requires a name — for a therapist it still becomes both `therapists.name`
(the roster label) and the seed `display_name`; for admin/front_desk it's
just the seed `display_name`. The invited person can always rename
themselves afterward from the account menu — copy on the form says so.
The Team members list itself gained an "Edit" action per row
(`MemberRow`) alongside the existing "Revoke": an inline form to change
that member's display name and role, admin-only by construction (the
whole Team tab is behind Shell's `role === 'admin'` nav gate), backed by
the same `members_update`/role-guard-trigger pair the migration added.

Verified: typecheck, lint, vitest (240 passed), production build clean,
migration replayed locally end-to-end before deploying, plus real
headless-browser renders of the account menu (view/edit/fallback states,
both breakpoints) and the Team members list (view/edit rows).

## Invite button stuck on "Sending…", plus Workspace stat-tile follow-ups (2026-08-16)

**The invite bug.** `invite-therapist`'s own logs showed only bare
`OPTIONS | 546 | .../invite-therapist` entries, twice, no POST ever
landing — the browser's CORS preflight was failing before the real
request could even be sent. Root-caused in three layers, each a real bug
stacked on the last:

1. The function never called `Deno.serve(...)` on its exported handler —
   it just had `export default async function handler(...)`. Nothing
   ever registered it as the HTTP entrypoint, so every request (OPTIONS
   or POST alike) hung until the platform gateway's own idle timeout
   (confirmed directly: a raw curl OPTIONS request came back after ~150s
   with `{"code":"IDLE_TIMEOUT",...}` instead of an instant response).
   This was the actual root cause — nothing else here mattered while it
   was true.
2. Even with that fixed, the function had no CORS handling at all — no
   `OPTIONS` short-circuit, no `Access-Control-Allow-*` response headers
   on anything. A browser blocks a cross-origin POST carrying an
   `Authorization` header until its CORS preflight succeeds.
3. Deployed with `verify_jwt: true`, which makes Supabase's platform
   gateway require a valid JWT on *every* request including the
   preflight — but a CORS preflight never carries an Authorization
   header by spec, so that would have re-broken preflights even after
   fixing (1) and (2). Redeployed with `verify_jwt: false`; the function
   already does its own JWT + admin-role check internally, so the
   platform's redundant check wasn't adding anything besides breaking
   preflight.

Verified end-to-end with curl once deployed: OPTIONS now returns 204 in
~0.7s with correct CORS headers, and an unauthenticated POST returns 401
in ~0.3s instead of hanging — both would have been ~150s IDLE_TIMEOUTs
before.

**Workspace stat tiles.** Two more complaints about the tile row added
two rounds ago: too compressed on a laptop, and mobile should cap at 3.
Root cause of "compressed on laptop": the `auto-fill` grid sizes columns
off however many `minmax(86px, 1fr)` tracks fit the container width, and
`auto-fill` keeps generating tracks (and giving them a share of the `1fr`
space) whether or not there's a tile to put in them — on a wide screen
that meant far more tracks than tiles, so each real tile still only got a
narrow, cramped share. Fixed by dropping to a plain `grid-cols-3` (see
below for why it's always exactly 3 now) — no more phantom tracks, each
tile gets a full third of the row and actually grows on a wide screen.

Also removed the "Expected" tile per request (redundant with the Expected
Today list right below it) and simplified the admin/therapist branch from
"1 admin tile vs. 2 therapist tiles" down to 1-for-1, landing on exactly
3 tiles for every role: Collected today, New patients this month,
Packages this month (admin) / My open packages (therapist) — dropped "My
sessions this week" as the odd one out. While doing that, found
`monthlyNewCounts` never actually took a therapist filter — "New patients
this month" was showing the *whole clinic's* count to a therapist too,
contradicting "therapists see their own numbers" (already true for
Collected today via `scope.scopeTherapistId`, just not this one). Added
an optional `therapistId` param following the exact convention
`weeklySummary`/`todayWorklist` already use, and a test case covering it.

Verified: typecheck, lint, vitest (241 passed, new test covers the
therapist-scoped `monthlyNewCounts` case), production build clean, plus a
real headless-browser render comparing the tile row at 390px vs. 1280px
confirming tiles now grow to fill a wide row instead of staying clustered
and small.

## Therapist photos, and a Team/Settings redesign mockup (2026-08-16)

**Therapist photos.** `therapists` gained `photo_path text` (migration
`20260816000003_therapist_photo.sql`) — stored the exact same way the
clinic/partner logos already are, a path into the existing public
`clinic-assets` bucket, not the image itself. No new bucket or RLS policy
needed: `clinic_assets_write/_update/_delete` already scope by
`is_clinic_member()` on the upload path's first segment (the clinic id),
which `${clinicId}/therapist-${therapistId}-...` satisfies the same way
`${clinicId}/logo-...` does today. Replayed all 35 migrations locally
before applying, as usual.

Upload is admin-only, from Settings → Team → Service roster (matches
`therapists_update`'s RLS, which already requires `is_clinic_admin` for
any change to a therapist row, photo included) — not self-service the way
display name is. Added `resizeImageToBlob()` (`lib/resizeImage.ts`):
downscales client-side via `createImageBitmap` + canvas before upload
(max 256px, JPEG ~0.85 quality) — this only ever renders as a small
avatar, so there's no reason to ship a multi-MB phone photo to storage
and back down to every device that loads it. Each roster row now shows a
small circular avatar (the photo once uploaded, initials before that,
matching the same split-on-whitespace initials logic already duplicated
across the patient-avatar spots) that doubles as the upload trigger — a
`<label>` wrapping a hidden file input, clicking it opens the picker
directly.

**Team + Settings redesign — mockup, not yet implemented.** The user
asked for a simpler, more colorful redesign of Team and, in the same
style, the rest of Settings; asked to see a mockup before any real code
changes. Built one as a static HTML artifact rather than touching
`SetupPage.tsx`: a card-based member roster (avatar circles, colored role
pills — teal/moss/amber for admin/therapist/front_desk, reusing the
existing token palette rather than inventing a new one), a redesigned
invite panel with a pill-style role picker instead of a plain `<select>`,
and a left-rail preview of how the same treatment would extend across
Settings' other six sections (icons + grouping already established by
`SECTION_GROUPS`, just carrying matching accent colors). Deliberately
scoped to the existing design tokens (`--teal`/`--moss`/`--amber`/etc.,
Fraunces/IBM Plex Sans) rather than a new palette, per "keep it simple" —
colorful comes from finally *using* the five accent colors the app
already has for something semantic (role identity) instead of just teal
everywhere. Sent as a published artifact for review; real implementation
in `SetupPage.tsx` is pending sign-off on the direction.

Verified: typecheck, lint, vitest (241 passed), production build clean;
photo upload UI checked via a real headless-browser render of the roster
row (avatar circle + initials fallback); the mockup itself checked in
both light and dark theme via headless Chromium before publishing —
caught and fixed one real bug in the process (a `@media` block nested
*inside* a `:root` selector instead of the reverse, which silently no-
opped the entire dark-theme token override).

## Insights/Trends full restructure (2026-08-16)

Last item from the round: user picked "missing metrics + layout/nav +
better charts" for what Insights needed, then "full page restructure"
over a lighter option when asked to scope it.

**New metric: collection rate.** Genuinely didn't exist anywhere —
`MonthlyReport`/`revenueTrend` track the BM-split/tax rollup, not payment
status at all. Added `dashboardService.monthlyCollection(clinicId, month,
therapistId?)`: sums `actualBillPaise` as billed, and for each visit reuses
`computeVisitPaymentState` (the exact same function VisitCard's payment
chips and `pendingWork`'s outstanding-payment items already use) to decide
whether it's collected — one definition of "collected" instead of a second
one invented for this card that could drift from the first.
`collectionRatePct` is `null`, not `0`, when nothing was billed that
month — a rate of the empty set isn't a bad month, it's not a month yet.
4 new tests (direct-payment visit fully collected, outstanding-invoice
visit billed-not-collected, empty month, therapist scoping).

**New KPI strip.** Four `KpiCard`s at the top of the page — Revenue (this
month vs. last, using entries already in the existing 6-month `trend`
fetch, no new query), Collection rate, New patients (vs. last month, two
`monthlyNewCounts` calls), Open packages (+ a "N gone quiet" hint instead
of a trend badge, since packages aren't a time-bucketed metric — there's
no meaningful "vs last month" for a live open count). Trend badges use
`pctChange()`, which returns `null` rather than a number when the prior
period was zero — "up from nothing" isn't a percentage worth showing.

**Jump-nav.** The 6 section cards (Single-visit patients, Regulars,
Packages, Revenue trend, Therapist comparison, Referral sources) were one
undifferentiated scroll with no way to jump to a specific one — same
complaint the note editor had before its own jump-nav, so this reuses
that exact mechanism (sticky mobile chips, sticky desktop rail,
IntersectionObserver-driven active state) rather than inventing a second
pattern. Flat list, no SOAP-style grouping — six items reads fine as one
row. "Therapist comparison" is filtered out of the nav (and its own ref
wrapper skipped entirely) when `TherapistComparisonCard` itself wouldn't
render anything, mirroring its internal `!clinic.showTherapistComparison
|| scope.isFrontDesk` gate rather than adding a dead link.

**Naming.** The tab said "Overview" — renamed to "Trends", matching how
the user described this page ("Trends/insights/analytics") and what it
actually is: patient retention, packages, revenue trend, referral
sources. "Monthly statement" (the per-therapist payout breakdown)
untouched — it's a different job (accounting handoff, not browsing).

Verified: typecheck, lint, vitest (245 passed), production build clean,
plus real headless-browser renders of the KPI strip at both desktop
(4-across) and mobile (2×2) widths and the jump-nav chip row — caught and
fixed one bug in the *verification mockup itself* (a fixed-width wrapper
that made the responsive grid look broken when it wasn't) before trusting
the result.
