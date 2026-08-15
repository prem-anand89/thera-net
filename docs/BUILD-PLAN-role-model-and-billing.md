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
| Responsive breakpoints | Two incompatible systems exist. `ResponsiveVisitList` (`VisitCard.tsx:472`) splits at Tailwind's `md:` (768px). A separate, older `.mobile-only`/`.desktop-only` CSS system (`index.css:288-312`, breakpoints at 720px/1000px) is used by `NoteEditorPage.tsx`. iPad Mini portrait is 744px — below `md:`, so it gets the phone card layout in Ledger/Workspace, but lands in the older system's 720–999 "tablet" bucket in the Note Editor. Same device, two different UIs. `.setup-accordion` (`index.css:185`) is dead CSS — referenced in a comment but not used by `SetupPage.tsx`, left over from before PR 3's left-rail rebuild. |
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

### PR 10 — Roles + RLS enforcement
- Migration: `role` check constraint gains `front_desk`; backfill `'staff'` → `'therapist'`.
- `title` free-text column on `clinic_members`.
- New RLS: scoped `update`/`delete` policies on `visits` (own `therapist_id` or admin); keep `select` clinic-wide.
- `usePermissions()` hook (decision 10); close the `SetupPage.tsx` gating hole.
- `useWorkspaceScope`'s admin/staff binary extends to the third role — front desk needs its own branch (no `myTherapistId`, not admin either), not a fallthrough to an empty Workspace.

### PR 11 — Responsive breakpoint standardization
- `--breakpoint-tab: 46.5rem` in the Tailwind `@theme` block.
- Migrate `VisitCard.tsx`, `SetupPage.tsx`, `WorkspacePage.tsx` from `md:` to `tab:`.
- Retire `.mobile-only`/`.desktop-only` in `NoteEditorPage.tsx` onto the same standard; remove dead `.setup-accordion` CSS.
- `PatientsPage.tsx` table gains a card view below `tab:`, reusing the `ResponsiveVisitList` split pattern (not necessarily the component itself, since patient rows aren't visit rows).

### PR 12 — Ledger payment-state correctness
- Payment chip and totals bar rebuilt against `payments` + invoice status (decision 6), not `invoiceId` alone.
- "Collected, no receipt" filter.
- No schema change — `payments` and `pendingPaymentNote` already exist and are already written to by New Visit and Workspace.

### PR 13 — Billing access toggle
- `billingEnabled`, `invoicingAccess` on `clinics`.
- Enforcement inside `issue_invoice()`.
- New Visit's payment-capture step conditionally skipped per decision 5.
- One-time transition banner when an admin flips `invoicingAccess` and a therapist who was billing loses the tab (sourced from a settings-change diff, not a permanent UI element).

### PR 14 — Nav restructure + Reports rename
- `InsightsPage` → Reports, Dashboard as first tab.
- Nav becomes role-aware per decision 7; Ledger sub-tabs become URL-addressable (`?tab=`) so the `/invoices` and `/reports` redirects from PR 8 can land on the correct sub-tab instead of always Visits.
- Nav: `Workspace | Ledger | Patients | Reports | Settings`, filtered by role and `billingEnabled`/`invoicingAccess`.

### PR 15 — Therapist comparison unlock
- `showTherapistComparison` toggle.
- Second chart (Visits) added alongside the existing Revenue chart, both visible to therapists when the toggle is on (decision 4).

## Sequencing rationale

Roles first, because every later PR keys off the role vocabulary and the
permissions hook. Responsive standardization second and on its own,
deliberately not folded into PR 14, since PR 14's nav work should be built
against the corrected `tab:` breakpoint from the start rather than
retrofitted. Payment-state before billing-access, since PR 13 needs
accurate Collected data to make the "who bills what" split legible in the
first place. Nav and the comparison-chart unlock go last, once the roles
and toggles they display actually exist.
