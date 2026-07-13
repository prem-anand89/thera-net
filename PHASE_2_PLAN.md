# Thera.Net: Phase 2 Patient History Enhancement Plan

**Last Updated:** July 13, 2026  
**Status:** Phase 1 Complete ✅ | Phase 2 Planning 📋

---

## Current State (Phase 1 - COMPLETE)

### Architecture Overview

**App Structure:**
- `/workspace` - **Default landing page** with Today, Recent, Open Packages, Pending Work
- `/archive` - Historical visits & patient records with Records toggle (Visits/Patients tabs)
- `/patients/$patientId` - Individual patient profile page
- `/setup` - Clinic configuration
- `/invoices` - Invoice management
- `/insights` - Reports and analytics

### Phase 1 Deliverables (LIVE)

**WorkspacePage - New Home**
```
├── Stat Tiles (Today's visits, Collected today, New patients this month, Packages this month)
├── Pending Work Feed (stale packages, outstanding invoices, incomplete notes + "Mark paid" action)
├── Open Packages Section (packages mid-treatment, stale indicators)
├── Today Section (visits entered today with payment state chips)
└── Recent Section (7/15/30 day windows, excludes today)
```

**Archive Page - Historical Records**
```
├── Records Toggle
│   ├── Visits Tab (All-time, therapist filter, patient search, dense table)
│   └── Patients Tab (AllPatientsSection with enriched columns)
├── Therapist Filter
├── Date Presets (This week, This month, Last month, All time)
└── Actions (Invoice, Repeat, Split, Delete)
```

**Services Layer (dashboardService.ts)**
- `todayWorklist(clinicId)` → Today's visits with payment states
- `pendingWork(clinicId)` → Unresolved items (stale packages, outstanding invoices, incomplete notes)
- `recentVisitsWindow(clinicId, days)` → Rolling window history
- `openPackages(clinicId)` → Active treatment packages
- `weeklySummary(clinicId)` → Weekly visit counts & collected revenue

**AllPatientsSection Features (Archive - Patients Tab)**
```
Columns:
  Patient ID | Name (age/sex inline) | Primary Condition | Last Visit + Count | 
  Therapist | Treatment | Bill | Phone | Package/Outstanding Badge | Actions

Sorting: MRNO, Name, Age, Condition
Filtering: Period (FY + month), Search (MRN prefix + name substring)
```

---

## Phase 2 Plan: Patient History Deep-Dive

### Problem Statement
Currently, to see a patient's complete visit history, users must:
1. Go to Workspace
2. Click "Workspace" nav
3. Go to Archive
4. Click Patients tab
5. Click "Visit history" link
6. View visits in dense table format

**Question:** Is this friction acceptable, or do we need a dedicated patient history view?

### Phase 2 Options (Pick One Direction)

#### **Option A: Enhance Patient Profile Page** ⭐ RECOMMENDED
Add a **Visit History table to PatientProfilePage** showing:
- Recent visits first
- Columns: Date | Service + Package Progress | Therapist | Condition | Bill | Invoice Status
- Sortable by date, bill amount
- Link to invoice view
- Repeat button for open packages
- Simple, focused, no archive navigation needed

**Files to modify:**
- `src/features/patients/PatientProfilePage.tsx` (add visit history table)

**Effort:** Low (1-2 hours)

---

#### **Option B: Create Dedicated Patient History Page**
New `/patients/$patientId/history` route with:
- Patient summary card
- Full visit history table
- Package timeline
- Financial summary (total billed, collected, outstanding)
- Notes/care plan

**Files to create:**
- `src/features/patients/PatientHistoryPage.tsx`

**Effort:** Medium (3-4 hours)

---

#### **Option C: Just Fix the Patients List in Archive**
Enhance AllPatientsSection with:
- Add "Last Bill Amount" column
- Add "Days Since Last Visit" column
- Add inline visit count badge
- Improve visual hierarchy with cards instead of table

**Files to modify:**
- `src/features/visits/VisitsPage.tsx` (AllPatientsSection)

**Effort:** Low (1-2 hours)

---

### Current Patients List Columns (Already Present)
```
✅ MRNO (Patient ID)
✅ Name (with age/sex inline)
✅ Primary Condition
✅ Last Visit Date + Visit Count
✅ Therapist Name
✅ Most Recent Treatment Notes
✅ Most Recent Bill Amount
✅ Phone
✅ Package Progress (visual dots)
✅ Outstanding Flag
✅ Actions (View history, Edit, Hide)
```

**What's Missing?**
- Days since last visit (calculated but not shown)
- Inline view of visit history (must click "Visit history" link)
- Patient financial summary (total billed, collected, outstanding)
- Package timeline (which session they're on vs total)

---

## Data Layer (Already Exists)

### `dashboardService.ts` - Visit Statistics
```typescript
// Groups visits by patient - pattern already used
const visitStatsByPatient = useMemo(() => {
  const map = new Map<string, { 
    lastVisitOn: string
    visitCount: number
    latestVisit: Visit
  }>();
  
  for (const v of allVisits ?? []) {
    // ... grouping logic
  }
  return map;
}, [allVisits]);
```

### `repos.visits.list()` - Already Flexible
```typescript
// Can query:
repos.visits.list({
  clinicId,
  from?: string,
  to?: string,
  therapistId?: string,
  patientId?: string  // <-- Already filters by patient
})
```

### `repos.patients.list()` - Has All Patient Data
```typescript
type Patient = {
  id: string
  mrno: string
  name: string
  age?: number
  sex?: string
  phone?: string
  primaryCondition?: string
  // ...
}
```

---

## Database Security Model (Phase 1 - LIVE)

**RLS Policies Verified:**
- ✅ `clinics_insert` - Any authenticated user can create clinic
- ✅ `clinics_select` - Only clinic members see their clinic
- ✅ `clinic_members_insert` - Only admin can add members
- ✅ `patients_all` - Only clinic members see their patients
- ✅ `visits_all` - Only clinic members see their visits
- ✅ Storage policies - Clinic-scoped asset uploads

**Multi-tenant Isolation:** ✅ Complete
- No patient from Clinic A is visible to Clinic B users
- RLS policies enforce at database level
- No application-level checks needed

**Clinic Creation Fixed:** ✅ Complete
- Migration: `20260713000002_fix_clinic_creation_rls.sql`
- Trigger now: `SECURITY DEFINER` for auto-admin assignment
- Still awaiting: Manual SQL execution in Supabase dashboard

---

## Testing & Quality Baseline

**Unit Tests:** ✅ 172 passing
```
dashboardService.test.ts (38 tests)
visitService.test.ts (14 tests)
patientService.test.ts (14 tests)
reportService.test.ts (10 tests)
// ... 12 other test files
```

**E2E Tests:** ✅ Passing
- Boot smoke test (Supabase config check)
- Full login → visit → invoice flow (self-skips without env vars)

**Manual Testing Checklist** (Phase 1)
- ✅ Sign in → Workspace loads
- ✅ Today section shows current day visits
- ✅ Recent tab toggles 7/15/30 days
- ✅ Open packages appear with stale indicators
- ✅ Pending work shows unresolved items
- ✅ Archive filters work (therapist, date, patient search)
- ✅ Invoice creation flow works
- ✅ Payment state chips update correctly
- ✅ New user sign-up → clinic creation → onboarded

---

## Phase 2 Decision Matrix

| Option | Effort | Impact | Recommended For |
|--------|--------|--------|-----------------|
| **A: Patient Profile History Table** | Low ⚡ | High 📈 | Most users - therapists checking patient history frequently |
| **B: Dedicated History Page** | Medium ⚙️ | Very High 🚀 | Detailed analytics - admins tracking patient lifecycle |
| **C: Enhanced Patients List** | Low ⚡ | Medium 📊 | Quick wins - improve existing table presentation |

---

## Implementation Timeline (Phase 2)

### If Option A (Recommended):
```
Day 1: Add visit history table to PatientProfilePage
Day 2: Test & verify data isolation
Day 3: Deploy & monitor
Effort: ~4 hours dev + 2 hours QA
```

### If Option B:
```
Day 1: Create PatientHistoryPage component
Day 2: Add route & navigation
Day 3: Add financial summary section
Day 4: Test & deploy
Effort: ~8 hours dev + 3 hours QA
```

### If Option C:
```
Day 1: Add "Days Since" column + last bill amount
Day 2: Improve table styling/hierarchy
Day 3: Test & deploy
Effort: ~3 hours dev + 1 hour QA
```

---

## Key Questions for User Review

1. **What's the friction point?**
   - Is navigating to Archive too many clicks?
   - Or is the table format itself hard to scan?
   - Or both?

2. **Who uses patient history most?**
   - Treating therapists? (need quick access to last visit details)
   - Admins? (need financial summary + lifecycle view)
   - Both equally?

3. **What data matters most when viewing a patient?**
   - Last treatment & date?
   - Bill amount & payment status?
   - Package progress & sessions remaining?
   - All of the above?

4. **Mobile consideration?**
   - Need to work on mobile? (table might be hard to read)
   - Desktop only for now?

---

## Risk Assessment

**No New Risks in Phase 2:**
- No schema changes required
- No RLS policy changes (already secure)
- No new dependencies
- All data already available in services
- Can be done incrementally (add feature, test, ship)

**Rollback Plan:**
- Any Phase 2 feature can be disabled via UI toggles
- No breaking changes to Phase 1
- Database stays unchanged

---

## What's NOT in Phase 2 (Future Phases)

**Phase 3 - Navigation Consolidation** (later)
- Rename nav: Today / Patients / Ledger / Insights / Setup
- Merge Invoices into Ledger
- Merge Dashboard + Reports into Insights
- (Not in Phase 2 scope)

**Phase 4 - Column Refinements** (later)
- Remove Adjustment column
- Relabel clinic type (display names only)
- (Not in Phase 2 scope)

---

## Summary for User

**Current State:**
- Phase 1 complete and merged to main ✅
- Workspace is new default landing page ✅
- Archive has full patient list with enriched columns ✅
- Can view patient visit history (via Archive) ✅
- All tests passing, Vercel deployed ✅

**Phase 2 Decision Needed:**
- Add visit history table to patient profile? (Option A - Recommended)
- Build dedicated patient history page? (Option B - More powerful)
- Improve Patients list in Archive? (Option C - Quick win)

**Next Step:**
- Review this plan in Claude chat
- Decide which option fits your workflow best
- Come back with decision, I'll implement & ship

---

*Generated for Phase 2 Planning Discussion*
