# Multi-service, Multi-therapist Visits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One visit can hold several services, an assisting therapist can be tagged on a service, revenue share and time are attributed per therapist, and every report, invoice and screen follows — with old visits and closed months unchanged.

**Architecture:** The visit stays the billing record (bill, discount, split snapshot, payment, invoice). Two new synced tables hang off it: `visit_items` (one row per service; `assisting_therapist_id` null = the primary delivered it) and `visit_credits` (one row per credited therapist, ₹ of the bill, summing exactly to it). One pure function (`payBase.ts`, the home-visits program's Plan 10) turns visits + lines + shares + package rules into per-therapist money, and every report, the attribution audit and future payroll read it. Reports change before screens.

**Tech Stack:** React + TypeScript, Dexie (offline store) + outbox sync, Supabase Postgres (RLS, triggers), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-multi-therapist-visits-design.md` (approved 2026-10-22). Read it first; this plan does not repeat its reasoning.

## Global Constraints

- Every schema change: applied live (Supabase MCP `apply_migration`, project `ajzcfbgjvnxgpebowwqc`) **and** a file `supabase/migrations/YYYYMMDDNNNNNN_description.sql` (CLAUDE.md).
- `FEATURES_AND_SCHEMA.md` (and README for the user-facing summary) updated in the same commit as the behaviour it describes. The schema section appears twice in that file; update both copies.
- Before every commit touching `src/`: `npm run typecheck && npm run lint && npm run test`; add `npm run build` for shared components/routing.
- Every `<button>` has an explicit `type`.
- Money is integer paise; rupee rounding uses the existing `roundToRupeeHalfUp` (`src/domain/money.ts`).
- Credits sum exactly to `actual_bill_paise`; the primary always has a credit row (the remainder).
- `price_paise` on a line = catalog price at entry (₹0 for a package continuation); not editable. The only discount is the visit-level adjustment, reason required (existing rule).
- At most one `is_package_line` per visit.
- Visits **without** lines and visits with legacy `shared_therapist_id/shared_pct` are reported with today's exact formulas (closed months reproduce to the rupee).
- Once a visit has `invoice_id`: lines, bill and discount are frozen (client and server); credits stay editable.
- Who may update a visit, its lines and its credits: admin, front desk, or the visit's own (primary) therapist. Delete a visit: admin or own therapist, not invoiced (unchanged). Assisting therapist: read-only.
- `clinics.enable_therapist_split` off: all credit to the primary, no share UI; assistant tags still allowed (time and patients-treated).
- Solo (`clinic.clinicType === 'individual'` or one active therapist): no "Assign assistant", no share UI.
- No time entry on the visit. Line minutes = snapshot of `service_catalog.duration_minutes`.
- Treatments stay visit-level (`visits.treatment_ids`, `treatment_notes`); no service→treatment link.
- Invoice shows the primary therapist only, one line per service.
- No per-patient "usual assistant".
- Screen copy: "Revenue share", "Your share", "Assign assistant", "assisting", "Billing therapist"; never "credits" on screen.
- Hard deletes don't sync through the outbox: both new tables use a `deleted boolean` soft delete, like `visits`.

## Review Focus

1. **Two devices edit the same visit offline** (one adds a service line, the other edits the share): both survive sync, because lines and credits are separate rows — Task 4 test `editing a line and a share on different rows never overwrite each other`.
2. **Rounding with several lines and a discount** (₹1,000 + ₹500 + ₹333, −₹200): line nets and auto credits sum exactly to the bill; a ₹1 bill split three ways doesn't produce a negative row — Task 3 tests `spreads a discount by largest remainder` and `tiny bills never go negative`.
3. **Changing the primary to the person tagged as assistant**: the tag on that line is cleared (assisting must differ from primary) and manual shares ask to recalculate — Task 4 test `changing the primary to the tagged assistant clears that tag`.
4. **A ₹0 visit (package continuation only) with an assistant tagged**: no division by zero; credits are a single ₹0 primary row; time still counts — Task 3 test `zero bill gives one zero primary row` and Task 6 test `assistant time counts on a zero-bill visit`.
5. **Editing lines on an invoiced visit offline**: the form blocks it before saving; if a stale device pushes anyway the server trigger rejects it and the sync reverts the local row — Task 2 SQL check `invoiced visit lines are frozen` and Task 10 test `invoiced visit shows services locked and share editable`.

---

### Task 1: Pay base — one function for each therapist's money (no visible change)

Implements the home-visits program's Plan 10 for today's data, so later tasks only add inputs. Plan 10's home/clinic buckets (by `visit.location`) are **not** part of this task; the home-pay plan (P12) adds them to the same function later. Plan 10's "patient default assistant" was dropped by the owner.

**Files:**
- Create: `src/domain/payBase.ts`, `src/domain/payBase.test.ts`
- Modify: `src/services/reportService.ts` (replace the inline split loop and `packageAttributionDeltas` with `payBase`), `src/services/attributionAuditService.ts` (build entries from the same movements), `src/services/reportService.test.ts`

**Interfaces:**
- Produces:
  - `type Movement = { mechanism: 'manual_split' | 'package_attribution' | 'line_share'; visitId: UUID; fromTherapistId: UUID; toTherapistId: UUID; grossPaise: Paise; clinicSharePaise: Paise; postTaxPaise: Paise }`
  - `interface PayBaseInput { visits: Visit[]; packageGroups: Map<UUID, Visit[]>; from: string; to: string }` (Task 5 adds `items` and `credits`)
  - `function attributionMovements(input: PayBaseInput): Movement[]`
  - `function payBaseByTherapist(input: PayBaseInput): Map<UUID, { grossPaise: Paise; clinicSharePaise: Paise; postTaxPaise: Paise }>` — the visit's billed amounts under its primary, plus every movement applied (equal and opposite, so totals are unchanged).
  - `TherapistMonthRow` gains `netClinicSharePaise: Paise` (clinic share after movements; for payroll). Existing fields keep their exact values.

- [ ] **Step 1: Write the golden tests** in `payBase.test.ts`: `single visit credits the primary only`; `legacy shared 30% moves gross and post-tax exactly as reportService did` (assert `roundToRupeeHalfUp(bill*pct/100)` and `roundToRupeeHalfUp(postTax*pct/100)`); `legacy shared also moves clinic share by the same pct`; `package session by another therapist moves floor(postTax/100/total)*100`; `shared and package on the same group together`; `totals are invariant` (Σ over therapists = Σ visit amounts for all three bases); `sessions outside [from,to] move nothing`.
- [ ] **Step 2: Run** `npx vitest run src/domain/payBase.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `attributionMovements` and `payBaseByTherapist` by lifting today's logic from `reportService.ts:58-128` and `:217-228` unchanged in behaviour; clinic-share movement uses the same pct / per-session ratio as post-tax.
- [ ] **Step 4: Run** the new tests — PASS.
- [ ] **Step 5: Switch `reportService.totalsForRange` and `attributionAuditService.monthly` to `attributionMovements`/`payBaseByTherapist`**; `reportService` still fetches package groups via `repos.visits.listByPackageGroup` and passes them in. Add `netClinicSharePaise` to rows and total.
- [ ] **Step 6: Run** `npx vitest run src/services` — every existing report and audit test PASSES unchanged (that is the proof nothing moved).
- [ ] **Step 7: Commit** `refactor(reports): one pay-base function for therapist money (shared + package attribution), no figures change`.

### Task 2: Database — service lines, revenue shares, durations, permissions

**Files:**
- Create: `supabase/migrations/20261023100000_visit_items_and_credits.sql`
- Modify: `src/domain/types.ts`, `src/lib/db.ts` (Dexie `version(26)`, `SyncedTable`, `ALL_SYNCED_TABLES`, `CLIENT_WRITABLE_TABLES`), `src/repositories/types.ts`, `src/repositories/local.ts`, `FEATURES_AND_SCHEMA.md` (schema, both copies)

**Interfaces:**
- Produces (types.ts):
  - `interface VisitItem { id; clinicId; visitId; position: number; serviceCatalogId; serviceName: string; catalogPricePaise: Paise; pricePaise: Paise; assistingTherapistId: UUID | null; durationMinutes: number | null; isPackageLine: boolean; deleted: boolean; createdBy?; updatedBy?; updatedAt }`
  - `interface VisitCredit { id; clinicId; visitId; therapistId: UUID; amountPaise: Paise; deleted: boolean; updatedBy?; updatedAt }`
  - `Visit.creditsMode?: 'auto' | 'manual'` (absent = auto); `CatalogItem.durationMinutes?: number | null`
- Produces (repos): `visitItems: { listByVisitIds(ids: UUID[]): Promise<VisitItem[]>; listByClinic(clinicId, range?: {from: string; to: string}): Promise<VisitItem[]>; bulkPut(rows: VisitItem[]): Promise<void> }` and `visitCredits` with the same three methods (`VisitCredit`). Reads exclude `deleted`.

- [ ] **Step 1: Write the migration.** Tables as in the spec plus `deleted boolean not null default false`, `created_by/updated_by uuid`, `updated_at timestamptz not null default now()` with the existing `set_updated_at` trigger; `visits.credits_mode text not null default 'auto' check (credits_mode in ('auto','manual'))`; `service_catalog.duration_minutes smallint check (duration_minutes between 1 and 480)`. Indexes `(visit_id)`, `(clinic_id, updated_at, id)`. Partial unique index: one `is_package_line` per visit where not deleted. Check `assisting_therapist_id` ≠ the visit's therapist via a trigger.
- [ ] **Step 2: RLS.** Both tables: select `is_clinic_member(clinic_id)`; insert `is_clinic_member(clinic_id)`; update `exists (visit v where v.id = visit_id and (is_clinic_admin(v.clinic_id) or is_front_desk(v.clinic_id) or is_own_therapist(v.clinic_id, v.therapist_id)))`. Replace `visits_update` with the same three-role rule. `visits_delete` unchanged.
- [ ] **Step 3: Triggers.** `protect_invoiced_visit_items`: reject insert/update/delete of a `visit_items` row whose visit has `invoice_id` (errcode `42501`, message "This visit is on an invoice; its services are frozen."). Attach the existing tombstone trigger (`record_sync_tombstone`) and the existing audit trigger function used by `visits_audit` to both tables.
- [ ] **Step 4: Apply live** with `apply_migration`; then verify with one rolled-back `do $$ … raise exception 'RESULT …' $$` block per role (set `request.jwt.claims` + `set local role authenticated`): front desk can update a visit and its lines; an assisting (non-primary) therapist cannot; nobody can change lines on an invoiced visit; two package lines on one visit fail.
- [ ] **Step 5: Client storage.** Dexie `version(26)`: `visit_items: 'id, clinicId, visitId, [clinicId+updatedAt]'`, `visit_credits: 'id, clinicId, visitId, therapistId'`. Add both to `SyncedTable`, `ALL_SYNCED_TABLES`, `CLIENT_WRITABLE_TABLES` (the `_exhaustiveCheck` must pass). Implement the two repos in `local.ts` (writes go through the same outbox helper visits use).
- [ ] **Step 6: Run** `npm run typecheck && npx vitest run src/sync src/repositories` — PASS.
- [ ] **Step 7: Commit** `feat(db): visit service lines and revenue-share rows, service duration, front desk can correct visits`.

### Task 3: Line math (pure)

**Files:**
- Create: `src/domain/visitLines.ts`, `src/domain/visitLines.test.ts`

**Interfaces:**
- Consumes: `VisitItem`, `VisitCredit` (Task 2).
- Produces:
  - `deliverer(item: Pick<VisitItem,'assistingTherapistId'>, primaryId: UUID): UUID`
  - `lineNets(items: VisitItem[], billPaise: Paise): Map<UUID /*itemId*/, Paise>` — spreads `bill − Σprice` across lines in proportion to `pricePaise`, largest remainder, rupee-rounded, sums exactly to `billPaise`; all-zero prices → everything on the first line.
  - `autoCredits(items, primaryId, billPaise, opts: { splitEnabled: boolean }): { therapistId: UUID; amountPaise: Paise }[]` — Σ nets per deliverer, the package line's net always to its deliverer, primary always present, split off → one primary row = bill.
  - `rebalanceCredits(current, edit: { therapistId: UUID; amountPaise?: Paise; pct?: number }, primaryId, billPaise, lockedPaise: Paise /*package money*/): { therapistId; amountPaise }[]` — sets one non-primary row, primary absorbs the difference, throws `'A share can't be more than the bill (less package money).'` if a row would go below ₹0.
  - `therapistMinutes(items, primaryId, therapistId, sittingMinutes: number): number` — spec rule: all of their lines have a duration → sum; otherwise `sittingMinutes` once; not on the visit → 0.
- [ ] **Step 1: Tests:** `spreads a discount by largest remainder` (1000/500, bill 1300 → 867/433); `three lines and a discount sum exactly` (1000/500/333, bill 1633); `tiny bills never go negative` (bill 100 paise, three lines); `zero bill gives one zero primary row`; `package money stays with the package line's deliverer`; `split off gives everything to the primary`; `rebalance keeps the total and moves the remainder to the primary`; `rebalance refuses a share above bill less package money`; `minutes: all durations sum`, `minutes: any missing duration counts the sitting once`, `minutes: two primary lines never exceed the sitting`.
- [ ] **Step 2: Run** `npx vitest run src/domain/visitLines.test.ts` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visits): line nets, auto revenue share and minutes rules`.

### Task 4: Saving visits with lines and shares

**Files:**
- Modify: `src/services/visitService.ts`, `src/services/visitService.test.ts`

**Interfaces:**
- Consumes: Task 2 repos, Task 3 functions.
- Produces:
  - `NewVisitInput.lines: { serviceCatalogId: UUID; assistingTherapistId?: UUID | null; packageContinuation?: { packageGroupId: UUID; sessionIndex: number; packageTotal: number } }[]` (replaces the single `serviceCatalogId` for new callers; the old single-service fields keep working and become one line).
  - `visitService.create(input)` writes visit + items + auto credits in **one Dexie transaction**, in that order. `visits.service_catalog_id` = first line; package fields from the package line.
  - `visitService.updateLines(visitId, lines, adjustment)` — refuses when `invoiceId` set; recomputes bill and split snapshot as `updateBilling` does; auto mode → rewrites credits; manual → leaves them and returns `{ sharesOutdated: true }`.
  - `visitService.setShares(visitId, rows: { therapistId; amountPaise }[])` — validates Σ = bill and package money untouched; sets `creditsMode = 'manual'`; allowed on invoiced visits. `recalculateShares(visitId)` → back to auto.
  - `visitService.updateBilling` primary change: untagged lines follow automatically; a line tagged with the new primary has its tag cleared; manual shares → `{ sharesOutdated: true }`.
  - Editing a legacy split (`setSplit`) on an old visit now writes credit rows (two rows, manual) and clears nothing else.
- [ ] **Step 1: Tests:** `creates one line per service and auto shares`; `continuation plus add-on keeps the package line at ₹0 and bills the add-on`; `rejects a second package line`; `rejects an assistant equal to the primary`; `changing the primary to the tagged assistant clears that tag`; `invoiced visit refuses line changes but accepts shares`; `manual shares survive a line change and report sharesOutdated`; `editing a line and a share on different rows never overwrite each other` (two sequential writes from separate copies; both rows present); `old single-service input still creates one line`.
- [ ] **Step 2: Run** `npx vitest run src/services/visitService.test.ts` — new tests FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(visits): save and edit visits with several services and revenue shares`.

### Task 5: Pay base reads lines, shares and package lines

**Files:**
- Modify: `src/domain/payBase.ts`, `src/domain/payBase.test.ts`, `src/services/reportService.ts`, `src/services/attributionAuditService.ts`

**Interfaces:**
- Consumes: Task 1 `PayBaseInput`, Task 3 `deliverer`, `lineNets`.
- Produces: `PayBaseInput` gains `items: Map<UUID /*visitId*/, VisitItem[]>` and `credits: Map<UUID, VisitCredit[]>` (empty maps = today's behaviour). Movement `line_share` for every non-primary credit (gross = amount; clinic share and post-tax proportional to the visit's, rounded so they sum). Package attribution: billing visit = the visit whose package line has `pricePaise > 0` (fallback: today's max-bill rule for visits without lines); base = that line's net share of post-tax; biller and session runner = package line deliverer. Credits of a visit that don't sum to its bill → recomputed with `autoCredits` and the movement flagged `repaired: true` (audit shows it).
- [ ] **Step 1: Tests:** `a visit with lines moves the assistant's share on all three bases`; `consultation billed with a package does not leak into session shares`; `an add-on on a continuation does not make it the billing visit`; `package biller is the package line's deliverer`; `credits that don't add up are repaired and flagged`; plus all Task 1 golden tests still pass with empty maps.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; `reportService`/`attributionAuditService` load items and credits for the period's visit ids and the package groups' visit ids. **Step 4: Run** `npx vitest run src/domain src/services` — PASS.
- [ ] **Step 5: Commit** `feat(reports): revenue share and package attribution from service lines`.

### Task 6: Counts, utilisation and revenue by service

**Files:**
- Modify: `src/services/reportService.ts` (`TherapistMonthRow` gains `patientsTreated`, `assistedVisitCount`), `src/domain/utilisation.ts`, `src/domain/utilisationReport.ts`, `src/components/useTherapistUtilisation.ts`, `src/domain/therapistRanking.ts`, `src/services/dashboardService.ts` (service mix by lines), their tests

**Interfaces:**
- Consumes: Task 3 `therapistMinutes`, `deliverer`; Task 2 repos.
- Produces: `UtilisationInput.visits` gains optional `items?: VisitItem[]` and `sittingMinutes?: number` per visit; visits with items use `therapistMinutes`, visits without keep `visitShare × slotMinutes`. Sitting length = linked appointment's `durationMinutes` (appointments with `visitId`) else clinic slot. `visitCount` (primary visits) stays; `patientsTreated` = visits where the therapist delivered ≥1 line (legacy: primary); `assistedVisitCount` = delivered a line but not primary. Ranking uses `patientsTreated`. Service mix counts and sums lines (net amounts).
- [ ] **Step 1: Tests:** `assistant time counts on a zero-bill visit`; `service durations replace the sitting when every line has one`; `legacy visits keep today's utilisation exactly`; `patients treated counts assisted visits once`; `clinic visit total does not change`; `service mix lists both services of one visit`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/domain src/services src/components` — PASS.
- [ ] **Step 5: Commit** `feat(reports): time, patients treated and service mix from service lines`.

### Task 7: Invoices — one line per service

**Files:**
- Modify: `src/domain/invoiceLine.ts`, `src/domain/invoiceLine.test.ts`, `src/services/invoiceService.ts`

**Interfaces:**
- Consumes: Task 3 `lineNets`; Task 2 `visitItems.listByVisitIds`.
- Produces: `groupVisitsForInvoicing` works on **billing units** `{ visit: Visit; item: VisitItem | null; netPaise: Paise }` (one per line; a visit without lines is one unit with `item: null`). Group key: package group, else `svc:{serviceCatalogId}:{catalogPricePaise}` of the line. Each line's `catalogPricePaise + adjustmentPaise = totalPaise` (`lineReconciles` stays true). Invoice therapist = the primary of the visits (`p_therapist_id`), never an assistant.
- [ ] **Step 1: Tests:** `a two-service visit prints two lines that add up to the bill`; `discount spread keeps every line reconciling`; `a visit without lines prints exactly as before` (snapshot an existing fixture); `package continuation plus add-on prints the package and the add-on`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/domain/invoiceLine.test.ts src/services` — PASS.
- [ ] **Step 5: Commit** `feat(invoices): one invoice line per service`.

### Task 8: Service duration in Settings

**Files:**
- Modify: the Services catalog editor in `src/features/settings/` (the form that edits `CatalogItem`), its test, `FEATURES_AND_SCHEMA.md`

- [ ] **Step 1: Test** `service form saves an optional duration and blank clears it` — field "Duration (minutes, optional)", hint "Per session for a package. Used for time reports; leave blank to count the whole session."
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(settings): optional service duration`.

### Task 9: New Visit form — service rows

**Files:**
- Create: `src/features/visits/ServiceRows.tsx`, `src/features/visits/ServiceRows.test.tsx`, `src/features/visits/RevenueShareSummary.tsx`
- Modify: `src/features/visits/NewVisitPage.tsx`, `FEATURES_AND_SCHEMA.md`, `README.md`

**Interfaces:**
- Consumes: Task 3 `autoCredits`, `lineNets`; Task 4 `NewVisitInput.lines`, `visitService.create`.
- Produces: `ServiceRows` props `{ rows: DraftLine[]; onChange(rows): void; catalog: CatalogItem[]; openPackages: OpenPackage[]; therapists: Therapist[]; primaryId: UUID; showAssistant: boolean; errors: Map<number, string> }` with `type DraftLine = { key: string; serviceCatalogId?: UUID; continuation?: OpenPackage; assistingTherapistId: UUID | null }`. `OpenPackage` is the shape `NewVisitPage` already builds for its open-packages list (`packageGroupId, serviceCatalogId, serviceName, logged, packageTotal, startedOn`) — export it from `NewVisitPage.tsx` (or move it beside `ServiceRows`) rather than redefining it. `RevenueShareSummary` props `{ items; primaryId; billPaise; therapistsById; onEdit(): void }`.
- Behaviour (spec "Screens" + "New Visit form: changes"): remove the New/Continuation toggle; picker lists open packages first ("Continue: {name} — session {n} of {total} (₹0)") then services by category; one open package → a continuation row is added once per patient; "+ Assign assistant" per row (hidden when solo); tag chip "{name} · assisting ✕"; second package row → row error "Only one package per visit."; guardrail note "{patient} has an open package (session {n} of {total}). It isn't used on this visit."; discount kept across row changes (cleared only if a ₹ discount exceeds the new subtotal, disabled at ₹0 subtotal); row errors shown on the row; Billing card lists services, subtotal, discount, total; share summary only when an assistant is tagged and split is on, with the ₹0 package note; after-save wording uses the service list and "Log a separate visit for {patient}".
- [ ] **Step 1: Tests** (`ServiceRows.test.tsx`): `one open package adds a continuation row that can be removed`; `picker lists open packages before services`; `second package row shows an error`; `assign assistant tags only that row`; `solo clinic shows no assign assistant`; `guardrail shows when the package row is removed`; plus a `NewVisitPage`-level test only if mocks stay under the existing page-test pattern — otherwise cover save wiring through `visitService.create` input in Task 4.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm run typecheck && npx vitest run src/features/visits` — PASS.
- [ ] **Step 5: Commit** `feat(visits): several services per visit with assisting therapist tags`.

### Task 10: Share editor, visit editor and front desk corrections

**Files:**
- Create: `src/components/RevenueShareEditor.tsx` (replaces `SplitModal` usage), its test
- Modify: `src/features/visits/EditVisitModal.tsx` (service rows from Task 9, frozen when invoiced), `src/features/visits/LedgerPage.tsx` and `src/features/workspace/WorkspacePage.tsx` (`canModify = isAdmin || role === 'front_desk' || v.therapistId === myTherapistId`; delete rule unchanged), remove `src/components/SplitModal.tsx` once unused

**Interfaces:**
- Consumes: Task 3 `rebalanceCredits`; Task 4 `setShares`, `recalculateShares`, `updateLines`.
- Produces: `RevenueShareEditor` props `{ visit: Visit; items: VisitItem[]; credits: VisitCredit[]; therapists: Therapist[]; onClose(): void }` — ₹ and % fields per non-primary therapist, primary row labelled "(remainder)", package money shown read-only, "Last edited by {name} · {when}", banner "Services changed. Update shares from services?" with "Recalculate from services".
- [ ] **Step 1: Tests:** `editing % updates ₹ and the remainder`; `refuses more than bill less package money`; `invoiced visit shows services locked and share editable` (EditVisitModal); `front desk sees Edit on a saved visit but not Delete`; `assisting therapist sees no Edit`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/components src/features` — PASS.
- [ ] **Step 5: Commit** `feat(visits): revenue share editor; front desk can correct saved visits`.

### Task 11: Assistant's view and the monthly statement

**Files:**
- Modify: Workspace "Today's visits" list, `src/features/visits/LedgerPage.tsx` (therapist filter), patient history visit rows, `src/components/MonthlyReportTable.tsx`, `src/features/reports/MonthlyStatementPage.tsx`, `src/features/reports/AttributionAuditPage.tsx`, tests beside each

**Interfaces:**
- Consumes: Task 5/6 report rows (`patientsTreated`, `assistedVisitCount`, `netClinicSharePaise`), Task 2 repos.
- Produces: a visit the viewer only assisted on appears under their name with their service, the patient, pill "Assisted", "with {primary}", "Your share ₹X" (split off: "revenue not shared"), "Not on your schedule. Logged on {primary}'s visit." — no Collect, no full bill, excluded from their Dues/Collected and from the Ledger's per-therapist totals. Monthly table adds "Assisted" next to Visits; Bill/Share/TDS/Post-Tax/Partner stay billed-under-name; Shared and Net come from `payBase`. Audit page lists `line_share` movements and flags repaired ones.
- [ ] **Step 1: Tests:** `assisted row shows only the assistant's share`; `assisted visit is not in the assistant's dues or ledger totals`; `split off shows revenue not shared`; `monthly table shows assisted count and unchanged billed columns`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/features src/components` — PASS.
- [ ] **Step 5: Commit** `feat(visits): assisted visits in the assistant's lists and the monthly statement`.

### Task 12: Docs and the real-app check

**Files:**
- Modify: `FEATURES_AND_SCHEMA.md` (feature sections: New Visit, revenue share, utilisation, reports, invoices, permissions; both schema copies), `README.md`

- [ ] **Step 1:** Update docs to describe what shipped, including the "pay base" pattern (one function for therapist money; reports, audit and payroll read it).
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm run test && npm run build` — all PASS.
- [ ] **Step 3:** Browser check at 360 px and desktop, logged in as front desk, admin, billing therapist and assisting therapist: solo clinic unchanged; consultation + assistant add-on; session + paid add-on; package row removed (guardrail); share edited by hand then a service added (recalculate prompt); invoiced visit (services locked, share editable); assistant's Today row. Note anything not verifiable.
- [ ] **Step 4: Commit** `docs: multi-service, multi-therapist visits`.

---

**Not in this plan (not agreed):** a per-clinic switch hiding the new entry screen during a pilot. Add it as a Task 9 sub-step if the owner wants it.
