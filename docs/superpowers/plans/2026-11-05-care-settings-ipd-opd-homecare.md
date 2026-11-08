# Care Settings (OPD, IPD, Home Care) Segregation & Therapist Access — Plan

> **For Claude / Agentic Review:** This plan designs the segregation of Outpatient (OPD), Inpatient (IPD), and Home Care services, departmental revenue splits, and role/area scoping per therapist.
> **Status (updated 2026-11-08):** Reference only; the working plan is `2026-11-05-foundations-global-and-care.md`. Home care (the OPD / home part) is built (H1 to H4, behind a per-clinic switch). The inpatient (IPD) and per-therapist area parts are not built.

---

## 1. Goal & Product Vision

Enable TheraNet to cleanly serve:
1. **Multi-department Clinics & Hospital Practices:** Physio & rehab departments operating inside small hospitals with outpatient walk-ins, inpatient ward rounds, and home care visits.
2. **Inpatient Rehab Centers:** Dedicated neuro/stroke/ortho rehab facilities needing daily bed rounds, multidisciplinary service logging (PT, OT, Speech), and consolidated billing.
3. **Domiciliary / Home Care Networks:** Visiting therapists traveling to patients' homes with travel surcharge tracking and restricted access to hospital/clinic internal queues.

### Guiding Principles & Constraints
- **Zero regression for pure outpatient clinics:** Every existing clinic defaults to 100% OPD with byte-for-byte identical UI and behavior.
- **No Enterprise HIS Trap:** We do NOT build bed occupancy management, nursing notes, or pharmacy inventory. TheraNet remains the specialized **rehab delivery ledger, clinical documentation engine, and revenue reconciliation book**.
- **Therapist Area Scoping:** Admins can assign therapists to specific care settings (e.g. Home Care only, IPD only, OPD only, or any combination). Therapists only see and log visits in their assigned areas.
- **Offline-First & Exact Money Math:** All revenue math stays in `src/domain/split.ts` and `src/domain/payBase.ts`. All writes sync via Dexie outbox. No new npm dependencies.

---

## 2. Core Architectural Decisions

### A. Care Setting Model
Replace the partial `location?: 'clinic' | 'home'` on `visits` with a formal `care_setting`:
```ts
export type CareSetting = 'opd' | 'ipd' | 'home';
```
- **OPD (Outpatient):** Standard clinic consultation & therapy sessions. Patient pays directly or via hospital OPD desk.
- **IPD (Inpatient):** Bedside sessions in hospital wards or ICU. Carries optional `wardBed` (e.g. "Ward 3 / Bed 12"), `ipdNo` (hospital admission number), and `admittingDoctor`. Payment defaults to `'hospital_ipd'` (settled on discharge via the hospital's central billing tab).
- **Home Care (Domiciliary):** Therapist visits patient's home. Carries optional `travelSurchargePaise`.

### B. Therapist Area Assignment & Access Scoping
- **Admin Configuration (Settings → Team → [Member]):**
  Admins assign one or more care settings per therapist:
  ```ts
  assignedCareSettings: CareSetting[]; // e.g. ['home'] or ['opd', 'ipd']
  ```
- **Therapist View Scoping:**
  - **Visit Logging (`NewVisitPage`):** The Care Setting selector (`[ OPD | IPD | Home ]`) shows only the settings assigned to the logged-in therapist. If a therapist is assigned to only one setting (e.g. Home Care only), the toggle is locked/hidden and preselected to Home Care.
  - **Schedule & Workspace:**
    - A Home-Care-only therapist sees their scheduled home visits, with patient address and phone deep links. They do not see OPD clinic queues or hospital bed rosters.
    - An IPD-only therapist sees the hospital **Ward Rounds** list.
  - **Dispatch & Pickers:** When scheduling or assigning a Home Care visit, only therapists assigned to `'home'` appear in the practitioner picker.
- **Admin & Front Desk:** Always retain full visibility across all enabled care settings.

### C. Revenue Math & Departmental Splits
Hospitals and clinics typically operate under different commercial splits across departments:
1. **Department Split Rates:**
   In `clinics`, clinics can optionally configure department-specific hospital partner splits:
   - `clinicSplitPct` (default OPD split, e.g. 75% clinic / 25% hospital)
   - `ipdSplitPct` (optional, e.g. 60% clinic / 40% hospital)
   - `homeSplitPct` (optional, e.g. 90% clinic / 10% hospital)
   *Visits snapshot the respective split percentage based on `careSetting` at logging time.*
2. **Home Care Travel Surcharge Exclusion:**
   - Any `travelSurchargePaise` added to a Home Care visit is excluded from the hospital partner split and credited 100% to the clinic / attending therapist.
   $$\text{Splittable Bill} = \text{Actual Bill} - \text{Travel Surcharge}$$
3. **Monthly Reporting:**
   Monthly settlement statement and ledger breakdown by care setting:
   $$\text{Gross Revenue} = \text{Gross}_{\text{OPD}} + \text{Gross}_{\text{IPD}} + \text{Gross}_{\text{Home}}$$

---

## 3. Implementation Tasks

### Task 1: Schema & Domain Types
- [ ] **Migration (`supabase/migrations/YYYYMMDDNNNNNN_care_settings.sql`):**
  - Add `care_setting` enum/text check to `visits`: `care_setting text not null default 'opd' check (care_setting in ('opd', 'ipd', 'home'))`. Backfill from `location`: `'home'` -> `'home'`, `'clinic'` / null -> `'opd'`.
  - Add nullable context columns to `visits`:
    - `ward_bed text null`
    - `ipd_no text null`
    - `referred_by_doctor text null`
    - `travel_surcharge_paise integer not null default 0`
  - Add to `clinics`:
    - `enabled_care_settings text[] not null default '{opd}'`
    - `ipd_split_pct numeric(5,2) null`
    - `home_split_pct numeric(5,2) null`
  - Add to `therapist_profiles`:
    - `assigned_care_settings text[] not null default '{opd}'`
- [ ] **Domain Types (`src/domain/types.ts`):**
  - Update `Visit`, `Clinic`, and `TherapistProfile` interfaces with defensive fallbacks (`?? ['opd']`).

### Task 2: Settings Configuration (Clinic & Team)
- [ ] **Settings → Partner & Billing:**
  - If clinic has `hasPartner`: Show optional "Department split overrides" for IPD and Home Care.
- [ ] **Settings → Team Member Card (`TeamMemberCard.tsx`):**
  - For each therapist, render an "Areas of Practice" chip group:
    `[✓] Outpatient (OPD)  [✓] Inpatient (IPD)  [✓] Home Care`.
  - Admin can toggle any combination. At least one must remain selected.

### Task 3: Visit Logging & Area Scoping (`NewVisitPage.tsx`)
- [ ] **Dynamic Care Setting Selector:**
  - Replace current binary `clinic | home` toggle with 3-way toggle: `[ OPD | IPD | Home Care ]`.
  - Filter options based on `assignedCareSettings` of the current therapist (Admins/Front Desk see all clinic-enabled settings).
  - If therapist has only 1 assigned setting, auto-lock and hide toggle.
- [ ] **Context-Aware Fields:**
  - When **IPD** is selected:
    - Reveal `Ward / Bed` (e.g. "Ward 4 / Bed 15") and `IPD No.` inputs.
    - Default payment method to `'hospital_ipd'` ("Billed to Hospital IP Tab").
  - When **Home Care** is selected:
    - Display patient home address snapshot.
    - Reveal optional `Travel surcharge (₹)` field.

### Task 4: Revenue & Split Engine (`split.ts` & `payBase.ts`)
- [ ] **Rate Resolution:**
  - In `src/domain/split.ts`, add helper `resolveCareSettingSplit(clinic, careSetting)`:
    - Returns `ipdSplitPct` for `'ipd'`, `homeSplitPct` for `'home'`, or `clinicSplitPct` for `'opd'`.
- [ ] **Travel Surcharge Isolation:**
  - Ensure `computeVisitSplit` applies the hospital partner split only to `billPaise - travelSurchargePaise`.
  - Unit tests in `src/domain/split.test.ts` verifying exact rupee rounding and partner shares.

### Task 5: Ledger, Reports & Hospital Billing Slip
- [ ] **Ledger Filter (`LedgerPage.tsx`):**
  - Add Care Setting filter chip row: `All | OPD | IPD | Home Care`.
- [ ] **Reports Overview (`ReportsOverviewPage.tsx`):**
  - Add Departmental Breakdown card showing volume and revenue split across OPD, IPD, and Home Care.
- [ ] **Hospital IP Billing Slip Export:**
  - A clean, printable/exportable table for the hospital central billing counter:
    *Date | IPD No. | Patient Name | Ward / Bed | Service | Attending Therapist | Charge*.

### Task 6: Inpatient Rehab Operations ("Ward Rounds" View)
- [ ] **Workspace Inpatient Card:**
  - For therapists assigned to `'ipd'`, provide a fast "Ward Rounds" batch-logging view:
    - Shows list of currently admitted IPD patients grouped by Ward.
    - One-tap `[Log Round]` button pre-filling the therapist's standard IP session charge.

---

## 4. Verification & Testing Plan
- **Regression Testing:** Pure OPD clinics must show zero UI difference and maintain identical split math.
- **Therapist Scoping Tests:**
  - A Home-Care-only therapist cannot select OPD or IPD on `NewVisitPage`.
  - An OPD therapist cannot be selected for a Home Care appointment.
- **Financial Audit:**
  - Verify that travel surcharges are never taxed or split with the hospital partner.
  - Verify IPD split overrides reconcile exactly to the penny against clinic and partner shares.
