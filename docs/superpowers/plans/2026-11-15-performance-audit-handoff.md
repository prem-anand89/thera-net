# TheraNet Performance Audit & Optimization Handoff

**Scope:** `/home/theranet/TN Project/thera-net-1`  
**Date:** 2026-11-15  
**Purpose:** Evidence-backed performance review for Claude to verify, prioritize, and fold into an implementation plan. All findings below were verified directly against source files, migrations, and the production `dist/` bundle.

---

## Executive Summary

TheraNet's UI lags primarily because **hot screens independently re-pull full-history tables from IndexedDB on mount and on every Dexie change**, perform **$O(N^2)$ / linear scans in render**, trigger **~30 concurrent Supabase HTTP requests per sync cycle**, and ship a **`671 KB` main JS bundle** (plus a broken empty `vendor-react` split and **`3.5 MB` PWA precache**).

The fixes break cleanly into **Tier 1 (Zero-schema quick wins)**, **Tier 2 (Sync & Bundle)**, and **Tier 3 (Dexie / Postgres indexes & tab isolation)**.

---

## 1. Full-History Multi-Scans & Redundant `useLiveQuery` Hooks

### 1.1 Workspace duplicates full-table scans (`WorkspacePage.tsx`, `usePatientFlagContext.ts`, `useFollowUpData.ts`)
- **What happens today:**
  - `src/features/workspace/WorkspacePage.tsx` mounts ~17 separate `useLiveQuery` hooks (`todayWorklist`, `monthlyNewCounts`, `openPackages`, `monthReport`, `receivedToday`, `duesSummary`, `workspaceAppointments`, `consultationNotes`, `feedbackRequests`, `feedbackResponses`, `appointmentRequests`, `allPatients`, etc.).
  - `usePatientFlagContext` (`src/components/schedule/usePatientFlagContext.ts:16-28`) runs its own `useLiveQuery` calling:
    1. `repos.visits.list({ clinicId })` (unbounded full visit history)
    2. `repos.patients.list(clinicId)` (all patients)
    3. `dashboardService.openPackages(clinicId, department)` (`src/services/dashboardService.ts:389-435`) — which **re-loads all visits and all patients** a second time
    4. `dashboardService.patientIdsWithDues(clinicId, department)` (`dueVisits`, `src/services/dashboardService.ts:345-374`) — which **re-loads all visits, `invoicePayments`, and all `payments`** a third time
    5. `repos.appointmentRequests.listByClinic(clinicId)`
  - Notice `WorkspacePage.tsx:399` also passes `workspaceAppointments` (all historical clinic appointments) into `usePatientFlagContext`, when Workspace only renders `todayAppointments`.
  - `useFollowUpData` (`src/features/followUp/useFollowUpData.ts:40-61`) reads `patients.list(clinicId)`, `appointments.listByClinic(clinicId)`, and `visits.list` back to the oldest open `followUpOn` date, then calls `followUpDepartmentForPatient(p, visits)` (`lines 15-32`) inside `patients.filter(...)` — scanning the full `visits` array per patient ($O(P \times V)$).

### 1.2 Other screens loading unbounded / off-tab clinic tables
- **`LedgerPage.tsx` (`src/features/visits/LedgerPage.tsx:410-579`):** Unconditionally subscribes to `patients.list`, `consultationNotes.listByClinic`, `feedbackRequests.listByClinic`, `feedbackResponses.listByClinic`, `invoicePayments.list`, all-time `payments.list`, all-time `invoices.list`, `dashboardService.openPackages`, and `dashboardService.outstandingInvoices`, regardless of which tab (`visits` | `patients` | `invoices` | `daybook` | `credits`) is active or what date filter is selected.
- **`PatientsPage.tsx` (`src/features/patients/PatientsPage.tsx:127-152, 241-262`):** Loads both date-bounded `periodVisits` AND unbounded `allVisits` (`repos.visits.list({ clinicId })`), plus all `appointments`, `invoicePayments`, and `payments`. In addition, `active` filtering, `hidden` filtering, and `applySort(...)` (`lines 241-262`) run directly in render on every keystroke/re-render with no `useMemo` (including regex phone normalization per patient).
- **`InvoicesPage.tsx` (`src/features/invoices/InvoicesPage.tsx:41-62`):** Loads all clinic `invoices`, `visits`, `payments`, and `patients` regardless of active date filter.
- **`PatientProfilePage.tsx` (`src/features/patients/PatientProfilePage.tsx:128-154, 246-249`):** Loads clinic-wide `openPackages`, `invoicePayments.list`, `payments.list`, `invoices.list`, and `appointments.listByClinic` while viewing a single patient.
- **`NewVisitPage.tsx` (`src/features/visits/NewVisitPage.tsx:419-522, 651, 705-713`):**
  - `fromAppointment` loads all clinic `appointments` then `.find()`s instead of `get(id)`.
  - `patientPaid` (`705-713`) reads all clinic `payments` instead of querying by patient's visits.
  - When search is empty (`line 520`), calls `dashboardService.recentVisits(clinic.id, 20)` (`src/services/dashboardService.ts:966-991`), which loads **all** clinic visits, patients, invoicePayments, and payments just to `.slice(0, 20)`.
- **`useTherapistUtilisation.ts` (`src/components/useTherapistUtilisation.ts:25-36, 69`):** Calls `repos.visits.list({ clinicId })` (no `from`/`to` bounds) and filters `visitDate` in JS (unlike `ClinicUtilisationCard.tsx:37-41`, which passes `from`/`to`). Also includes the `therapists` array reference in `useLiveQuery` deps (`line 69`).
- **`ReportsOverviewPage.tsx` (`src/features/reports/ReportsOverviewPage.tsx:173-206`):** Initializes `trendPeriodMode` as `'6m'`, triggers `dashboardService.revenueTrend` (6 full `monthly` reports), and immediately `navigate`s in a `useEffect` to `period: 'ytd'`, causing an immediate double calculation on `/insights` mount.

---

## 2. Quadratic $O(N^2)$ Loops, Sequential N+1s & Unpaginated Dual DOM

### 2.1 $O(N \times M)$ and $O(N^2)$ JS work
- **`noteForVisit` (`src/domain/noteLinks.ts:15-31`):** Performs up to two linear `.find()` scans across `notes` per visit. Called for every row inside `WorkspacePage.tsx`, `LedgerPage.tsx` (**across all visits in the range before `Pager` slices the page!**), and `PatientProfilePage.tsx`. Fix: build `Map<visitId, note>` and `Map<patientId, draftNote>` once in `useMemo`, and enrich only the paginated slice (`pager.slice`) in `LedgerPage`.
- **Array-spread copying inside grouping loops ($O(N^2)$):**
  - `buildVisitDetails` (`src/features/visits/visitDetails.ts:38, 43`): `map.set(visitId, [...(map.get(visitId) ?? []), item])`
  - `assistedVisitsFor` (`src/features/visits/assistedVisits.ts:40`): same spread copy per row
  - `ScheduleBookingsView.tsx` (`src/features/schedule/ScheduleBookingsView.tsx:382, 411`): `monthByDate` and `byDate` spread-copy bucket arrays over all-time appointments
  - `invoiceService.buildLineItems` (`src/services/invoiceService.ts:144`): same spread copy per row
  - Fix: mutate the bucket array directly (`const list = map.get(k); if (list) list.push(row); else map.set(k, [row]);`).
- **`PatientsPage.tsx` (`lines 62-69, 602`):** `patientReferralLine` runs `referringSources.find(...)` per patient row instead of `Map` lookup.
- **`dashboardService.repeatVisits` (`lines 740-747`):** Filters and `.sort()`s per-patient visit arrays inside the `for (const v of inMonth)` loop.

### 2.2 Sequential N+1 Dexie / Service Calls
- **`invoiceService.voidInvoice` (`src/services/invoiceService.ts:392-394`):** Loads **all** clinic visits (`repos.visits.list({ clinicId })`) and filters `v.invoiceId === invoiceId` instead of calling existing `repos.visits.listByInvoiceId(invoiceId)`.
- **`paymentService.collectedInRange` (`src/services/paymentService.ts:232-236`):** Loads all clinic payments (`repos.payments.list(clinicId)`) and filters `receivedDate` in JS instead of querying `[clinicId+receivedDate]` via `.between([clinicId, from], [clinicId, to], true, true)`.
- **`loadPackageGroups` (`src/services/reportService.ts:97-104`):** `Promise.all(ids.map((id) => repos.visits.listByPackageGroup(id)))` — N+1 query per package group, amplified 6–12× by `dashboardService.revenueTrend` (`src/services/dashboardService.ts:380-387`).
- **`invoicedSiblingGroupIds` (`WorkspacePage.tsx:725-734`, `LedgerPage.tsx:603-612`):** Queries `repos.visits.listByPackageGroup(groupId)` per ₹0 package row (can use `db.visits.where('packageGroupId').anyOf(ids).toArray()` in one query).
- **`paymentService.invoiceBalance` (`lines 54-60`) & `advanceService.openAdvancesWithBalance` (`lines 65-68`):** Sequential `for ... await` loops querying `payments` per visit / advance.
- **`visits.markUninvoiced` / `markInvoiced` (`src/repositories/local.ts:284-303`):** Sequential `for (const id of ids)` `get` + `put` instead of `bulkGet` + `bulkPut`.
- **`importVisitsService.ts` (`lines 105-108, 229-286`):** Sequential `getByMrno` in `preview` and sequential `create` calls in `commit`.

### 2.3 Unpaginated Dual Mobile+Desktop DOM & Eager PDF Capture
- **`DaybookPage.tsx` (`lines 449, 479`), `LedgerPage.tsx` outstanding section (`lines 1032, 1089`), `SchedulePage.tsx` feedback tab (`lines 367, 428`):** Render every item **twice** in the DOM (desktop `<table>` + mobile card stack) without `Pager` pagination or virtualization.
- **`PatientProfilePage.tsx` (`lines 998-1019`):** Renders all of a patient's historical visits without pagination.
- **`useBillShare.ts` (`src/features/invoices/useBillShare.ts:54-62`):** Automatically triggers `renderElementToPdf` (`html2canvas` + `jsPDF`) ~1.5s after mount on share-capable devices, blocking the main thread even when the user never shares.

---

## 3. Missing Client (Dexie) & Server (Postgres) Indexes

### 3.1 Client Dexie (`src/lib/db.ts` & `src/repositories/local.ts`)
- **`visits.countByService` (`local.ts:230-236`):** Runs `db.visit_items.filter((i) => i.serviceCatalogId === serviceCatalogId && !i.deleted).count()` — unindexed full scan of `visit_items` (called per catalog item). Adding `serviceCatalogId` to `visit_items` in a new Dexie `version(28)` turns this into an instant indexed count.
- **`DaybookPage.tsx` (`lines 80-86`):** Uses `db.payments.where('clinicId').equals(clinic.id).filter(p => p.receivedDate ...)` instead of the existing `[clinicId+receivedDate]` index (`db.ts:321`), and scans `patient_advances` with `.filter(...)`.
- **`outbox` unindexed `.filter()` scans:**
  - `SyncBadge.tsx:34, 67`: `db.outbox.filter((e) => !!e.error).toArray()`
  - `WorkspacePage.tsx:424` & `LedgerPage.tsx:792`: `db.outbox.filter((e) => e.table === 'visits').count()` instead of `db.outbox.where('table').equals('visits').count()` (`table` is already indexed at `db.ts:218`).
- **`patients.search` (`local.ts:156-176`):** Loads every clinic patient row via `where('clinicId').equals(clinicId).toArray()`, runs `.replace(/\D/g, '')` on all phone numbers, sorts all matches, and takes top 15 on every keystroke.
- **Additional high-value Dexie compound indexes (additive, non-breaking):**
  - `visits`: add `[clinicId+patientId]` and `[clinicId+therapistId]`
  - `visit_items`: add `serviceCatalogId`
  - `patient_advances`: add `[clinicId+receivedDate]`, `[clinicId+patientId]`
  - `appointments`: add `[clinicId+scheduledAt]`
  - `consultation_notes`: add `[clinicId+patientId]`

### 3.2 Server Postgres (`supabase/migrations/`)
`SyncEngine.pullPages` (`src/sync/engine.ts:635-639`) queries `.order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(1000)` on all 28 tables:
- Core high-volume tables (`visits`, `patients`, `invoices`, `payments`, `consultation_notes`, `patient_module_enrollments`, `invoice_payments`, `settlements`, `settlement_payments`) only index `(clinic_id, updated_at)` — unlike newer tables (`admissions_pull_idx`, `visit_items_pull_idx`, `visit_credits_pull_idx`) that properly index `(clinic_id, updated_at, id)`.
- Synced tables with **no `updated_at` index at all**: `patient_advances` (has zero secondary indexes), `appointments`, `appointment_requests`, `feedback_requests`, `feedback_responses`, `therapist_shift_assignments`, `user_seen_markers`, `user_push_preferences`.

*(Remember `THERA_NET.md` Rule 2: if adding Postgres index migrations, commit the SQL file in `supabase/migrations/` and coordinate live apply separately.)*

---

## 4. Sync Engine Network Burst (~30 Requests per Cycle)

- **Observed in `src/sync/engine.ts` (`lines 46, 214-254, 609-653`):**
  - `SyncEngine.start()` attaches Realtime listeners on all 28 `ALL_SYNCED_TABLES`. Any realtime change on 1 table, any local write (`onLocalWrite`), `visibilitychange`, or the 5-minute interval runs `sync()`.
  - `sync()` executes `reconcileClinicMembership` + `pull()`, which concurrently queries `supabase.from(table).select('*')` across **all 28 tables + `sync_tombstones` (~30 HTTP requests per sync cycle)**, even when nothing changed on 27 of those tables.
  - **Optimization opportunity:** When a Postgres Realtime event triggers a pull for a specific `table`, pull only that table (`pullTable(table)`) rather than running all 29 queries (leaving full 28-table `pull()` for startup, reconnect/online, and the 5-minute fallback).
  - **`pullTombstones` (`lines 655-673`):** Reads `db.outbox.toArray()` per 1,000-row page and executes up to 1,000 sequential `db.table(t.table).get(t.rowId)` + `.delete(rowId)` calls instead of batching per table with `bulkGet` / `bulkDelete`.

---

## 5. Bundle Weight & PWA Precache (`dist/assets` + `vite.config.ts` + `sw.ts`)

Verified against the current `dist/` output:
1. **`dist/assets/index-CMnY7PQh.js` is `671 KB` while `vendor-react-l0sNRNKZ.js` is `1 byte` (`'\n'`):**
   - `vite.config.ts:64-69` specifies `manualChunks: { 'vendor-react': ['react', 'react-dom'], ... }`, yet Rollup emitted `vendor-react` as an empty 1-byte file and bundled `react`/`react-dom` into `index` and `vendor-router` (`228 KB`). Returning users therefore re-download React on every deploy inside the `671 KB` app chunk.
   - `WorkspacePage.tsx` is eagerly imported in `src/app/router.tsx:4` alongside all of its modal/sheet dialogs (`StartVisitSheet`, `BookSlotSheet`, `EditVisitModal`, `TakePaymentDialog`, `IssueInvoiceDialog`, `EditPatientModal`, `AddPatientDetailsModal`, `ReviewsPanel`), inflating initial parse/compile cost on mobile even before opening a dialog (or on login/deep links).
2. **`3.5 MB` PWA Precache (`src/sw.ts:27`):**
   - `dist/sw.js` precaches all **60 assets** (`3.5 MB` total), including `jspdf` (`376 KB`), `body-chart.png` (`365 KB`), `html2canvas` (`198 KB`), `SettingsPage` (`173 KB`), and `SchedulePage` (`125 KB`), forcing every first install and app update to download rarely used print/admin assets in the background.

---

## Recommended Implementation Order for Claude

1. **Wave 1 — Zero-Risk JS & Query Fixes (highest immediate speedup):**
   - Replace `noteForVisit` linear scans with `Map` lookups; in `LedgerPage`, transform/enrich only the visible `pager.slice` rather than all filtered rows.
   - Fix `$O(N^2)$` array-spread grouping loops in `buildVisitDetails`, `assistedVisitsFor`, `ScheduleBookingsView`, and `buildLineItems`.
   - Memoize `PatientsPage` filtering/sorting and `referringSources` lookup; stop rendering dual mobile+desktop unpaginated lists in `DaybookPage` / `LedgerPage` outstanding / `SchedulePage` feedback.
   - Fix `voidInvoice` (`listByInvoiceId`), `collectedInRange` (`[clinicId+receivedDate]` via Dexie `.between()`), `DaybookPage` (`payments` date index), `outbox.where('table').equals('visits')`, `useTherapistUtilisation` (`from`/`to`), `NewVisitPage.recentVisits` (date-bounded window instead of all history), and `ReportsOverviewPage` double-load (`'6m'` -> `'ytd'`).
2. **Wave 2 — Deduplicate Workspace Queries & Lazy-Load Off-Screen Tabs/Dialogs:**
   - Consolidate redundant `openPackages` / `dues` / `visits` / `patients` reads shared between `WorkspacePage`, `usePatientFlagContext`, and `useFollowUpData`; pass only relevant appointments (`todayAppointments` + recent no-shows) instead of all historical appointments.
   - Gate `LedgerPage` queries (`invoices`, `payments`, `outstandingInvoices`) on the active tab.
   - Lazy-load Workspace/Ledger sheets/modals (`BookSlotSheet`, `EditVisitModal`, `TakePaymentDialog`, `IssueInvoiceDialog`, `EditPatientModal`) and only run `useBillShare` PDF capture on user click (or keep lazy).
3. **Wave 3 — Bundle, Precache & Sync Engine:**
   - Fix `vite.config.ts` `manualChunks` function so `react` / `react-dom` genuinely land in a stable `vendor-react` chunk; configure `VitePWA` `workbox.globIgnores` so heavy on-demand chunks (`jspdf`, `html2canvas`, `body-chart-*`) are runtime-cached on demand instead of upfront precached.
   - Route Postgres Realtime events by changed table (`pullTable(table)`) instead of triggering all 28 table pulls per event; batch `pullTombstones` with `bulkGet` / `bulkDelete`.
4. **Wave 4 — Dexie & Postgres Index Additions (with Migration):**
   - Bump `ClinicDB` to `version(28)` with `visit_items` `serviceCatalogId`, `visits` `[clinicId+patientId]`, `patient_advances` `[clinicId+receivedDate]`, and `appointments` `[clinicId+scheduledAt]`.
   - Commit a Supabase migration adding `(clinic_id, updated_at, id)` / `updated_at` pull indexes to the remaining high-volume synced tables.
