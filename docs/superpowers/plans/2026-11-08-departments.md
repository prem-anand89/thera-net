# Departments: OP, Home care and IP kept apart

**Date:** 2026-11-08 · **Status:** planned, not started. Step 0 (Phase 2 review fixes) is built and tested, waiting on the
owner to apply `20261108130000_visit_stay_must_be_live.sql`.

## Why
A hospital or multi-disciplinary rehab practice never runs OP, Home care and IP through one combined ledger. Each
department has its own counter, its own collections, its own revenue and split, and the front desk's OP cash must
reconcile without inpatient stays mixed in. Until now the app treated the place of care as a filter over one ledger
(the Place toggle, the Daybook "by place" split, mixed "Clinic and Home" bills). This plan replaces that with
departments that are mutually exclusive everywhere.

## Owner decisions (2026-11-08)
1. Every department is separate, with its own ledger and revenue. There is no "all departments" view in the app.
2. IP has its own bill series (`BMIP/26-27/0001`); OP and Home care share today's series (`BM/26-27/0001`) for now.
3. One universal department switch for the whole app, not a toggle per page, and only one department's cards at a time.
4. A person assigned to one department sees only that department and gets no switch.
5. The patient file is shared: one file with every visit tagged by department. Money on the profile (bills, dues,
   advances) follows the department switch.
6. A combined total exists only in the accountant's month export (one "All departments" line), because the clinic files
   tax as one entity.
7. Departments are set per login (what a person sees) and on the therapist roster (who can be booked where).
8. Services say which departments offer them, built now (replaces the service's "Usually done at").

## The model
- **Department = care location.** No new vocabulary in the database: `clinic` / `home` / `ward` stay the stored keys
  (`clinics.care_locations`, `visits.location`, `appointments.location`). Screen labels: **OP**, **Home care**, **IP**
  (`DEPARTMENT_LABELS`). A clinic's departments are `clinicCareLocations(clinic)`.
- **The switch** (`useDepartment()`, a context published from `Shell.tsx`): in the header next to the clinic name
  (`OP | Home care | IP`, a compact "OP ▾" on phones), with a thin colour band per department so it is obvious which one
  is open. Remembered per person and clinic on the device (`meta` key). Shown only when the person has more than one
  department. Changing it rescopes every page, like changing clinic.
- **Who sees which departments:** `clinic_members.departments` (null = every department the clinic has; admins always
  see all). The roster's `therapists.care_locations` (null = all) decides who is offered in Book and New Visit pickers.
  Display-level only in v1: RLS still lets any clinic member read the data (worth knowing; tightening it is later).
- **Shared patient file:** the profile shows all visits with a department tag; its money panels (bills, dues, advances,
  Take payment) follow the switch. Links into another department's record (a bill, a visit) still open, with its tag.
  Only lists are scoped.

| | OP | Home care | IP |
|---|---|---|---|
| Workspace | Appointments (clinic only), today's visits, OP collected and dues | Home visits today (route: address, Copy, Call, Log visit), today's home visits, home collected and dues | Inpatients (ward rounds), today's sessions, running charges |
| Schedule | Clinic appointments, Book | Home appointments, Book | No booking (ward rounds are on the Inpatients card) |
| Ledger | OP visits, bills, daybook, dues | Home visits, bills, daybook (field collections per therapist, "to hand over"), dues | Sessions, discharge bills, deposits, daybook with **Hospital partner clearance** |
| New Visit | Clinic visit | Home visit | Only on an admitted patient (Log session) |
| Reports (admin) | OP only | Home only | IP only |

Settings stay clinic-wide; department-specific settings (bill series prefix, later split rates) sit inside them.

## Removed by this plan
The Workspace Place toggle (`WorkspacePlaceToggle`), the Ledger Place filter, the Daybook "Of this, by place" split, the
Reports "By place" card (`CareLocationSplitCard`), the booking sheet's Place row, the New Visit Clinic / Home toggle,
the Patients "Home" chip, the service form's "Usually done at", and mixed-department bills ("Clinic and Home"). The
department replaces each. `offersBookingChoice` / `offersLocationChoice` call sites go to the department context.

## Steps

### Step 0. Phase 2 review fixes (built, tested, uncommitted)
Waiting on the owner to apply `20261108130000_visit_stay_must_be_live.sql`; then record its history row, check live
(a visit on a deleted stay refused, a normal one accepted) and commit.

### Step 1. The switch and who sees what (migration)
- Migration: `clinic_members.departments text[] null` and `therapists.care_locations text[] null`, each a subset of
  `('clinic','home','ward')` and not empty when set. A member can read their own row (existing policy); admins set it
  (existing admin update path, or a small RPC if the policy does not allow it).
- `domain/departments.ts`: labels, `visibleDepartments(clinic, member, role)`, `departmentOf(visit | appointment)`.
- `useDepartment()` context + header switch (desktop segmented, phone compact), remembered per person and clinic.
- Settings → Team: "Departments" on each member and on roster-only therapists (shown only when the clinic has more than one).
- Tests: a one-department person gets no switch; an admin sees every clinic department; the remembered choice falls back
  when the person loses access to it.

### Step 2. Scope every screen to the department
- Workspace: render only the selected department's cards (table above). New **Home visits today** card.
  Appointments card = OP only. Tiles per department (IP shows "Running charges ₹X · N stays" instead of Dues).
- Ledger: Visits, Bills, Daybook, Dues filtered by department. IP Daybook lists partner-collected money as
  **Hospital partner clearance**; Home Daybook groups field collections by therapist.
- Schedule and Book: OP books clinic, Home books home, IP has no Book; pickers offer only therapists for that department.
- New Visit: the department sets the place; IP only through Log session.
- Patient profile: visit history tagged by department; money panels follow the switch.
- Reports: per department.
- Remove the controls listed above.
- Tests per screen: switching shows only that department's rows; counts and totals match the rows shown.

### Step 3. Separate the money (migration)
- **No bill mixes departments** (client: the bulk select and Bill this stay only offer one department; server:
  `issue_invoice` / `amend_invoice` raise when the visits span more than one department, OP and Home included).
- **IP bill series:** `invoice_counters` gains `series text not null default 'main'` (key becomes clinic, FY, series);
  the issue and amend functions derive the series from the visits (all `ward` = `ip`, else `main`); the number is
  `coalesce(clinics.ip_invoice_prefix, invoice_prefix || 'IP') || '/' || fy || '/' || seq` for IP (`BMIP/26-27/0001`),
  unchanged for main. An amendment keeps its original's series. Copy the CURRENT function definitions
  (`20261107120000_invoice_patient_check_by_id.sql` and later) when recreating them. Settings → Billing shows the IP
  prefix when IP is on.
- **Advances:** `patient_advances.department text not null default 'clinic'` (check clinic, home, ward); recording an
  advance takes the current department; applying one draws only against that department's visits.
- **Services per department:** `service_catalog.departments text[] null` (null = every department); the service form
  replaces "Usually done at" with department ticks; pickers filter by department. `default_location` is left in place,
  unused.
- **Combined total:** the accountant's month export gets one "All departments" line after the per-department sections.
- Tests: a bill spanning OP and IP (or OP and Home) refused by the server; IP numbers run `BMIP/26-27/0001, 0002` while
  main continues unaffected; an amended IP bill stays in the IP series; an IP deposit cannot pay an OP visit.

### Step 4. Later
Split %, TDS basis and who collects per department, and the partner statement per department (old Phase 4). Then
therapist pay per department (HR).

## Risks
- Scoping misses a list somewhere and shows another department's rows: one `departmentOf()` helper, a grep for every
  visits / appointments / payments list, and a test per screen.
- Bill series migration recreates money functions: copy the live definitions, test the old series continues gap-free.
- RLS does not enforce department access in v1 (display-level only), stated in the docs.

---

# Gemini briefs (steps 1 and 2 screens)

**Claude has built the foundation (Step 1):** migration `20261108140000_departments_access.sql` (owner applies it),
`src/domain/departments.ts`, `src/app/DepartmentContext.tsx` (`useDepartment()`, `DepartmentProvider`, wired in
`Shell.tsx`), `Therapist.careLocations`, `useClinicRole().departments`. Use them; do not re-derive.

## Standing rules (prepend to every task)
Start with `git status --short` and `git log --oneline -5`. Work on `main`, small commits, `git add <explicit paths>`
only (never `-A`, stash, reset --hard, push, --force, --no-verify). Never touch the live database (write the migration
`.sql` only, Claude applies it). Do not invent names: stop and report if a named file or function is missing. Tests
first. Every `<button>` has `type`. Update `FEATURES_AND_SCHEMA.md` (all duplicated copies) in the same change. No `₹`
typed by hand (`formatAmount`). Do not edit this plan file. Paste real command output; never claim "verified" without it.
Verification per task: `npm run check:fast`. Once at the end of the batch: `npm run typecheck`, `npm run lint`,
`npm run test` run once, and `npx vite build` when routing or shared components changed. Report: commits, files
changed, tails of the final run, deviations, open questions.

## The one rule every task follows
`const { department, departments, canSwitch } = useDepartment()` gives the department the app is showing. A screen
shows ONLY records whose `departmentOf(record) === department` (`inDepartment(department, record)`; a record with no
location is OP). Counts, totals, badges and empty states all come from the scoped list, never the full one. When
`canSwitch` is false there is no switch anywhere. Labels come from `DEPARTMENT_LABELS` (OP / Home care / IP). Never
write the words "Clinic" / "Home visit" / "Inpatient" as a place choice any more.

## G1. The header switch (Step 1)
- New `src/components/DepartmentSwitch.tsx`; render it in the `Shell.tsx` header beside the clinic pill, only when
  `canSwitch`. Desktop: a segmented control (`segTrack` / `segOption` from `@/components/ui`) with `DEPARTMENT_LABELS`.
  Phone (below `sm`): a compact `OP ▾` button that opens a small menu (reuse the clinic switcher's menu pattern).
- A thin colour band under the header per department (`--teal` OP, `--sky` Home care, `--plum` IP).
- Tests: renders nothing when `canSwitch` is false; clicking a department calls `setDepartment`; the active one is
  `aria-pressed`. 360px: nothing overflows.

## G2. Departments on Settings → Team (Step 1)
- In `src/features/settings/TeamSection.tsx`, on a member's edit form add "Departments" (ticks OP / Home care / IP from
  `clinicDepartments(clinic)`, none ticked = all), shown only when the clinic has more than one. Save it in the same
  `clinic_members.update(...)` as role and display name: `departments: ticked.length === 0 || ticked.length === all.length ? null : ticked`.
  For roster-only therapists (no login) and linked ones, the same ticks write `therapists.care_locations` (via
  `repos.therapists.put({...therapist, careLocations})`, same null rule), labelled "Works in".
- Tests: saves null when all or none ticked; saves the subset otherwise; hidden for a one-department clinic.

## Shared money helpers (Claude, built): `src/domain/departmentMoney.ts`
Use these instead of writing your own department filters for money. `inDepartmentList(department, records)`,
`paymentsForDepartment(department, payments, visitsById)` (a payment belongs to its visit's department; unknown visit =
OP), `advancesForDepartment(department, advances)` (until advances carry a department in Step 3, every advance is OP, so
IP and Home care show none), `runningCharges(visits)` (`{ paise, sessions, stays }`: unbilled live ward sessions, for the
IP tile; never counted as dues), `isPartnerClearance(method)`. If a screen needs a rule that is not here, ask Claude.

## G3. Workspace per department (Step 2)
`src/features/workspace/WorkspacePage.tsx`. Show only the selected department's cards:
- **OP:** the Appointments card (clinic appointments only: filter `appointmentsForList` by `inDepartment('clinic', a)`),
  Today's visits (OP visits), Follow up.
- **Home care:** new **Home visits today** card (`HomeVisitsCard.tsx`: today's home appointments in time order, each with
  address from the patient (Copy address, Call), Arrived / Log visit using the same actions as `TodayAppointments`),
  then Today's visits (home visits), Follow up.
- **IP:** the existing `InpatientsCard`, Today's visits (ward sessions only), Follow up. No Appointments card.
- Tiles: Collected and Dues are the selected department's (`today.visits` and payments filtered by department). IP shows
  "Running charges ₹X · N stays" (sum of unbilled ward sessions) in place of Dues, since unbilled inpatient sessions are
  not dues until discharge.
- Remove `WorkspacePlaceToggle` and its use. Keep All | Mine.
- Tests: switching department shows only that department's cards and rows; tile numbers equal the sum of the rows shown.

## G4. Ledger per department (Step 2)
`src/features/visits/LedgerPage.tsx`, `DaybookPage.tsx`, `src/features/invoices/InvoicesPage.tsx`.
- Visits, Invoices, Daybook, Dues and the Credits tab show only the selected department. An invoice's department is its
  visits' (`clinicalSnapshot.placeOfService`: clinic / home / ward; older bills with none are OP).
- Daybook: OP = drawer (cash, UPI, card). Home care = field collections grouped by therapist under "To hand over". IP =
  discharge settlements, deposits, and money the hospital collected on its own line **Hospital partner clearance**
  (`method === 'partner'`), not as cash.
- Remove the Place filter and the Daybook "Of this, by place" split.
- Tests: each tab's rows and totals for the three departments; partner money shows as clearance and never in a drawer.

## G5. Schedule and Book (Step 2)
`src/features/schedule/*`, `src/components/BookSlotSheet.tsx`. The calendar shows the selected department's
appointments (OP, Home care; IP has no booking and the Book buttons are hidden there). `BookSlotSheet` drops the Place
row: the booking's location IS the department. The therapist picker uses `therapistsInDepartment(department, therapists)`.
Tests: a Home care booking saves `location: 'home'`; the picker hides a therapist who works only in OP.

## G6. New Visit (Step 2)
`src/features/visits/NewVisitPage.tsx`. Remove the Clinic / Home toggle; the visit's location is the department (OP =
clinic, Home care = home). IP visits start only from "Log session" (already built; keep the fixed Inpatient tag).
The therapist picker uses `therapistsInDepartment`. Opening a visit link for a record of another department is allowed.
Tests: a Home care visit saves `location: 'home'`; the therapist list follows the department.

## G7. Patient profile (Step 2)
`src/features/patients/PatientProfilePage.tsx`. The visit history lists every department's visits with a small
`DEPARTMENT_LABELS` tag on each (shared file). The money panels (bills, dues, advances, Take payment, bulk bill) use only
the selected department's visits. "Admit to ward" shows for anyone who can open IP, even while in OP; after admitting,
call `setDepartment('ward')`.
Tests: history shows all departments tagged; the bulk-bill list is the selected department's only.

## G8. Reports (Step 2)
`src/features/reports/*`, `src/components/CareLocationSplitCard.tsx`. Reports show the selected department only (admin).
Delete `CareLocationSplitCard` and its `domain/careLocationSplit.ts` once nothing uses them.
Tests: totals equal the department's visits.

## G9. Remove the old Place controls (Step 2)
Delete: `WorkspacePlaceToggle` (+ test), the Patients "Home" chip, the New Visit toggle, the booking Place row, the
service form's "Usually done at" (Step 3 replaces it with department ticks). Delete `offersBookingChoice` /
`offersLocationChoice` call sites that only existed for these controls; keep `placeLabelFor` if a list still tags records.

## Order for Gemini
G1 and G2 first (they need only the foundation), then G3 to G8 one at a time (each is one commit), then G9. Claude
reviews after G2, after G4 and at the end.
