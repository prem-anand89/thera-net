# Reports & Utilisation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Reports & Insights dashboard with crisp non-distorted typography, valid practitioner avatar URLs, an operational Capacity & Booked Hours companion card (Option A), dedicated side-by-side Revenue and Visits charts, and a modern Therapist Comparison ranking interface.

**Architecture:**
1. Enrich `utilisationReport` with aggregate worked and available minutes to drive capacity metrics.
2. Fix photo loading via `publicTherapistPhotoUrl` in `PractitionerPerformanceTable` and eliminate SVG text stretching in `UtilisationTrendCard` via HTML overlays.
3. Build `CapacityHoursCard` (Option A) and wire it into `ClinicUtilisationCard` to replace redundant revenue bars.
4. Replace squished dual-axis `VisitsRevenueTrendChart` in `RevenueTrendPanel` with two dedicated side-by-side single-axis charts: `MonthlyRevenueChart` and `MonthlyVisitsChart`.
5. Modernize `TherapistComparisonCard` with comparative ranking bars for revenue and visits per practitioner.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, SVG + HTML typography overlays, Vitest + Testing Library, Dexie.

**Spec:** `docs/superpowers/specs/2026-10-11-reports-and-utilisation-redesign.md`

## Global Constraints
- **Zero Schema Changes**: Reuses existing `visits`, `therapists`, and `clinicClosedDates` tables.
- **Color Tokens**: Must use `var(--teal)`, `var(--teal-light)`, `var(--teal-strong)`, `var(--ink)`, `var(--muted)`, `var(--border)`, `var(--surface)`, `var(--paper)`, `var(--rust)`.
- **Razor-Sharp Typography**: Never render critical text inside non-uniform `preserveAspectRatio="none"` SVGs; use layered HTML text.
- **Mobile Responsive**: Side-by-side charts stack into single columns on mobile (<1024px).
- **Graceful Image Fallback**: Missing or failed photo paths must never break table layout or overflow alt text.

## Review Focus
1. `BucketReport` worked and available minutes remain accurate when practitioners are filtered or have 0 hours.
2. `publicTherapistPhotoUrl` returns correct paths without console 404s, falling back to initials on error.
3. Chart labels (`100% Capacity`, `Target 70%`, months) render without horizontal stretch or blur on wide viewports.
4. Hovering or selecting months in the split Revenue/Visits charts synchronizes state between both cards.
5. All existing test suites continue to pass with 100% success rate.

---

### Task 1: Domain & Avatar Fixes

**Files:**
- Modify: `src/domain/utilisationReport.ts`
- Modify: `src/domain/utilisationReport.test.ts`
- Modify: `src/components/PractitionerPerformanceTable.tsx`
- Modify: `src/components/PractitionerPerformanceTable.test.tsx`

**Interfaces:**
- Consumes: `ReportTherapist`, `UtilisationBucket`, `Visit`
- Produces: `BucketReport.clinicWorkedMinutes`, `BucketReport.clinicAvailableMinutes`, `BucketReport.priorClinicWorkedMinutes`, `BucketReport.priorClinicAvailableMinutes`
- Avatar: `publicTherapistPhotoUrl(row.photoPath)` with `onError` handling in `PractitionerPerformanceTable`

- [ ] **Step 1: Write failing tests for worked & available minutes in `src/domain/utilisationReport.test.ts`**
- [ ] **Step 2: Update `src/domain/utilisationReport.ts` to calculate and return worked & available minutes**
- [ ] **Step 3: Run `npx vitest run src/domain/utilisationReport.test.ts` and verify PASS**
- [ ] **Step 4: Update `src/components/PractitionerPerformanceTable.tsx` to resolve `photoPath` with `publicTherapistPhotoUrl` and fallback state**
- [ ] **Step 5: Run `npx vitest run src/components/PractitionerPerformanceTable.test.tsx` and verify PASS**
- [ ] **Step 6: Commit changes**

```bash
git add src/domain/utilisationReport.ts src/domain/utilisationReport.test.ts src/components/PractitionerPerformanceTable.tsx src/components/PractitionerPerformanceTable.test.tsx
git commit -m "fix(reports): add worked/available minutes to report and fix therapist avatar image resolving"
```

---

### Task 2: Fix Stretched/Blurred Typography in Utilisation Card

**Files:**
- Modify: `src/components/UtilisationTrendCard.tsx`
- Modify: `src/components/PerformanceCards.test.tsx`

**Interfaces:**
- Consumes: `reports: BucketReport[]`, `activeIndex: number`, `targetRatio?: number`
- Produces: Razor-sharp HTML text overlays for `100% Capacity`, `Target 70%`, and month labels, removing SVG `<text>` distortion.

- [ ] **Step 1: Update `src/components/UtilisationTrendCard.tsx` to position guideline badges and month labels using HTML absolute layers**
- [ ] **Step 2: Run `npx vitest run src/components/PerformanceCards.test.tsx` and verify PASS**
- [ ] **Step 3: Commit changes**

```bash
git add src/components/UtilisationTrendCard.tsx src/components/PerformanceCards.test.tsx
git commit -m "fix(ui): use crisp HTML typography overlays in UtilisationTrendCard to eliminate SVG font stretching"
```

---

### Task 3: Option A - Capacity & Booked Hours Card

**Files:**
- Create: `src/components/CapacityHoursCard.tsx`
- Create: `src/components/CapacityHoursCard.test.tsx`
- Modify: `src/components/ClinicUtilisationCard.tsx`
- Modify: `src/components/ClinicUtilisationCard.test.tsx`

**Interfaces:**
- Consumes: `reports: BucketReport[]`, `activeIndex: number`, `onSelectBucket: (index: number) => void`, `compareMode?: boolean`
- Produces: `<CapacityHoursCard />` rendering booked hours vs available capacity with monthly volume bars and crisp HTML labels.

- [ ] **Step 1: Write failing tests in `src/components/CapacityHoursCard.test.tsx`**
- [ ] **Step 2: Implement `src/components/CapacityHoursCard.tsx`**
- [ ] **Step 3: Run `npx vitest run src/components/CapacityHoursCard.test.tsx` and verify PASS**
- [ ] **Step 4: Update `src/components/ClinicUtilisationCard.tsx` to replace `RevenueVolumeCard` with `CapacityHoursCard`**
- [ ] **Step 5: Update `src/components/ClinicUtilisationCard.test.tsx` and verify PASS**
- [ ] **Step 6: Commit changes**

```bash
git add src/components/CapacityHoursCard.tsx src/components/CapacityHoursCard.test.tsx src/components/ClinicUtilisationCard.tsx src/components/ClinicUtilisationCard.test.tsx
git commit -m "feat(insights): implement CapacityHoursCard (Option A) to show booked hours vs capacity"
```

---

### Task 4: Split Dedicated Side-by-Side Revenue & Visits Charts

**Files:**
- Create: `src/components/MonthlyRevenueChart.tsx`
- Create: `src/components/MonthlyVisitsChart.tsx`
- Create: `src/components/MonthlyCharts.test.tsx`
- Modify: `src/components/RevenueTrendPanel.tsx`

**Interfaces:**
- Consumes: `categories: string[]`, `revenuePaise: number[]`, `visitCounts: number[]`, `currentMonthIndices: number[]`
- Produces: Clean 2-column grid of dedicated single-axis charts with synchronized hover/selection.

- [ ] **Step 1: Implement `MonthlyRevenueChart.tsx` (single scale, crisp bars, headline metric, MoM badge)**
- [ ] **Step 2: Implement `MonthlyVisitsChart.tsx` (single scale, crisp bars, headline metric, MoM badge)**
- [ ] **Step 3: Write tests in `src/components/MonthlyCharts.test.tsx` and verify PASS**
- [ ] **Step 4: Update `src/components/RevenueTrendPanel.tsx` to replace the dual-axis chart with the 2-column side-by-side charts**
- [ ] **Step 5: Run `npx vitest run src/components/RevenueTrendPanel.test.tsx` (or full suite) and verify PASS**
- [ ] **Step 6: Commit changes**

```bash
git add src/components/MonthlyRevenueChart.tsx src/components/MonthlyVisitsChart.tsx src/components/MonthlyCharts.test.tsx src/components/RevenueTrendPanel.tsx
git commit -m "feat(reports): split revenue and visits into dedicated side-by-side single-axis charts"
```

---

### Task 5: Redesign Therapist Comparison Card

**Files:**
- Modify: `src/components/TherapistComparisonCard.tsx`
- Modify: `src/components/TherapistComparisonCard.test.tsx` (if present)

**Interfaces:**
- Consumes: `trendData`, `controlledTrend`, `chartMonthIndex`, `onChartMonthIndexChange`
- Produces: Comparative ranking bars for revenue attribution and visit volume per therapist.

- [ ] **Step 1: Redesign `TherapistComparisonCard.tsx` layout with modern month pills and clean ranking bars**
- [ ] **Step 2: Run `npx vitest run src/components/TherapistComparisonCard.test.tsx` and verify PASS**
- [ ] **Step 3: Commit changes**

```bash
git add src/components/TherapistComparisonCard.tsx
git commit -m "feat(reports): redesign therapist comparison with comparative ranking bars"
```

---

### Task 6: Visual Audit & Final Verification

- [ ] **Step 1: Run full test suite across the entire project (`npx vitest run`)**
- [ ] **Step 2: Open browser via `browser_subagent` and capture screenshots of `/insights`**
- [ ] **Step 3: Verify razor-sharp typography, avatar rendering, side-by-side charts, and capacity cards**
