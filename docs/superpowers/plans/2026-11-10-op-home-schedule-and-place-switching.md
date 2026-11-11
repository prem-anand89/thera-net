# OP / Home Care Workflow Polish: In-Form Place Switching, Unified Schedule & Location Badges Implementation Plan

## Overview
Polish the operational workflow for clinics and therapists delivering both Outpatient (in-clinic) and Home care (as well as Inpatient), ensuring clinicians and front desk staff have clear visibility, zero accidental cross-place errors, and seamless transitions without abandoning in-progress forms.

## Core Deliverables

1. **In-Form Place Switching in `NewVisitPage` (`Clinic` ↔ `Home`)**:
   - Inside `NewVisitPage` under the `This visit` card, when the clinic operates multiple care locations (`careLocations.includes('home')`), show an interactive segmented toggle: `[ Clinic | Home ]`.
   - Switching updates `location` state, shifting `visitDept` cleanly between `'clinic'` and `'home'`.
   - Catalogs, package applicability, therapist rosters, and pricing automatically adjust without discarding entered clinical details.
   - If the patient has an active inpatient stay (`activeAdmission`), the place remains locked to Inpatient with its stay pill.

2. **Unified Schedule Timeline (OP + Home)**:
   - In `ScheduleBookingsView.tsx` / `SchedulePage.tsx`, when in OP or Home mode (or personal therapist schedule view), show both in-clinic slots and home visits on the therapist's day timeline.
   - Visually distinguish them with clear color coding:
     - In-clinic OP: Teal tone / standard border.
     - Home Care: Sky blue tone (`border-[var(--sky)] bg-[var(--sky-light)]/40`) with Home badge and address preview.
   - Ensure overlap guards and slot availability calculations honor therapist availability across both locations.

3. **Care Location Badges on Patient Records & Visit Cards**:
   - In `VisitCard.tsx` (`SharedVisitCard` & `VisitCardDetails`), render color-coded department/place badges:
     - `OP`: Neutral/Teal (`Pill tone="teal"` or `"slate"`)
     - `Home`: Sky blue (`Pill tone="sky"`)
     - `IP`: Plum (`Pill tone="plum"`)
   - In `PatientProfilePage.tsx` and `PatientsPage.tsx`, show the care location tag on recent visits and history entries so clinicians instantly know whether past sessions occurred in the ward, at home, or in the clinic.

---

## Detailed Task Breakdown

### Task 1: In-Form Place Switching in `NewVisitPage`
- **Files**:
  - `src/features/visits/NewVisitPage.tsx`
  - `src/features/visits/NewVisitDepartmentScoping.test.tsx`
- **Changes**:
  1. Add a responsive `[ Clinic | Home ]` place selector in `NewVisitPage` when `clinic.careLocations` has both `clinic` and `home` and `!activeAdmission`.
  2. Clicking "Home" sets `location = 'home'` and `locationDecidedRef.current = true`.
  3. Clicking "Clinic" sets `location = 'clinic'` and `locationDecidedRef.current = true`.
  4. Ensure `visitDept` updates dynamically, re-evaluating `therapistList` and `catalog`.
- **Verification**: Run `npx vitest run src/features/visits/NewVisitDepartmentScoping.test.tsx`.

### Task 2: Unified Schedule Timeline for OP & Home Care
- **Files**:
  - `src/features/schedule/ScheduleBookingsView.tsx`
  - `src/features/schedule/ScheduleDepartmentScoping.test.tsx`
- **Changes**:
  1. In `ScheduleBookingsView.tsx`, allow `scopedAppointments` when `department === 'clinic' || department === 'home'` to include both `clinic` and `home` appointments for a therapist's day view, while keeping `ward` (IP) rounds separated.
  2. Add distinct Sky blue badge / styling for Home appointments on the calendar grid and list view.
  3. On click, open `AppointmentDetailsPanel` showing patient address with "Copy address" / map link for Home appointments.
- **Verification**: Run `npx vitest run src/features/schedule/ScheduleDepartmentScoping.test.tsx`.

### Task 3: Color-Coded Location Indicators Across Patient Profile & Cards
- **Files**:
  - `src/components/VisitCard.tsx`
  - `src/features/patients/PatientProfilePage.tsx`
  - `src/features/patients/PatientsPage.tsx`
  - `src/features/patients/PatientProfileDepartmentScoping.test.tsx`
- **Changes**:
  1. In `VisitCard.tsx`, update `placeLabel` rendering to use semantic tones:
     - `departmentOf(v) === 'home'`: `Pill tone="sky"`
     - `departmentOf(v) === 'ward'`: `Pill tone="plum"`
     - `departmentOf(v) === 'clinic'`: `Pill tone="teal"`
  2. In `PatientsPage.tsx`, on each patient card's last visit line, append the place badge if the clinic operates multiple locations.
  3. Ensure `PatientProfileDepartmentScoping.test.tsx` passes with the enhanced badges.
- **Verification**: Run `npx vitest run src/features/patients/PatientProfileDepartmentScoping.test.tsx`.

### Task 4: Fast Pre-Commit Checks & Documentation
- **Commands**:
  - `npm run check:fast`
  - Update `FEATURES_AND_SCHEMA.md` documenting in-form place switching and unified OP/Home schedule.

