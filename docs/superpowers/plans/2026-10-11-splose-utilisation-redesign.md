# Splose-Inspired Performance Overview & Utilisation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Clinic Utilisation & Performance Overview to match the modern Splose reference design, providing a unified top filter bar with Compare mode, twin-hero KPI cards (Utilisation Trend Line + Revenue Volume Bars), and an enriched Practitioner Performance Table with therapist avatars, sortable columns, and inline horizontal progress bars.

**Architecture:** 
1. Enrich `clinicUtilisationReport` to calculate both utilisation ratios and revenue (`revenuePaise`) per bucket and per therapist, with previous-period comparison data.
2. Build modular presentational components: `PerformanceFilterBar` (pill controls), `UtilisationTrendCard` (SVG line chart with target & compare overlays), `RevenueVolumeCard` (SVG bar chart), and `PractitionerPerformanceTable` (avatars + inline progress bars + sorting).
3. Compose them into `ClinicUtilisationCard` (or `ClinicPerformanceOverview`) rendering a 2-column hero grid at tablet/desktop and full-width leaderboard table underneath, fully responsive down to 390px mobile screens.

**Tech Stack:** React 18, TypeScript, Tailwind CSS with Theranet CSS variables (`var(--teal)`, `var(--ink)`, `var(--muted)`, `var(--border)`, `var(--surface)`), Dexie React hooks, Vitest + Testing Library.

**Spec:** Review discussion and layout cues from Splose reference screenshot (`splose.com` Performance Overview).

## Global Constraints
- **Zero Schema Changes**: Utilizes existing `visits`, `therapists`, and `clinicClosedDates` tables.
- **Strict Color Tokens**: Use `var(--teal)`, `var(--teal-light)`, `var(--teal-strong)`, `var(--rust)`, `var(--paper)`, `var(--surface)`, `var(--ink)`, `var(--muted)`. Never hardcode raw hex values outside validated chart palettes.
- **Mobile Responsive**: Cards stack vertically on phone viewports (<640px); progress bars remain visible without horizontal scrollbar on 390px screens.
- **Accessible & Tested**: All interactive elements have descriptive `aria-label`s and `type="button"`. 100% test pass rate across new and existing test suites.

## Review Focus
1. **Empty / Zero Data State**: Renders clean empty state when no visits exist in the selected period.
2. **Missing Working Hours**: Therapists without working hours display clinic booking hours with an explanatory indicator (`*`) without crashing or dividing by zero.
3. **Compare Mode Edge Cases**: When comparing periods, prior period missing or zero values do not produce `NaN` or broken SVG paths.
4. **Mobile Layout (390px)**: Dual cards stack cleanly; leaderboard rows keep avatar, name, inline progress bar, and revenue without overflowing.
5. **Sorting Invariants**: Sorting by Name, Utilisation Rate, Revenue, or Visits toggles asc/desc reliably and handles null/zero values gracefully.

---

### Task 1: Domain Enrichment - Add Revenue & Comparison to Utilisation Report

**Files:**
- Modify: `src/domain/utilisationReport.ts`
- Test: `src/domain/utilisationReport.test.ts`

**Interfaces:**
- Consumes: `Visit` (`actualBillPaise`), `UtilisationBucket`, `ReportTherapist`
- Produces: 
  - `TherapistBucketRow`: adds `revenuePaise: number`, `photoPath?: string | null`
  - `BucketReport`: adds `clinicRevenuePaise: number`, `priorClinicRatio: number | null`, `priorClinicRevenuePaise: number | null`

- [ ] **Step 1: Write the failing tests in `src/domain/utilisationReport.test.ts`**

Add tests verifying that `clinicUtilisationReport` sums `revenuePaise` per therapist and for the clinic, captures `photoPath`, and computes prior bucket deltas when multiple buckets exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/domain/utilisationReport.test.ts`
Expected: FAIL with missing properties on `BucketReport` / `TherapistBucketRow`.

- [ ] **Step 3: Update `src/domain/utilisationReport.ts` implementation**

Add `revenuePaise` to `TherapistBucketRow`, add `clinicRevenuePaise` to `BucketReport`, pass `photoPath` from `ReportTherapist`, and compute `priorClinicRatio` / `priorClinicRevenuePaise` from adjacent buckets.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/domain/utilisationReport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/domain/utilisationReport.ts src/domain/utilisationReport.test.ts
git commit -m "feat(domain): enrich utilisation report with revenue and prior period comparison"
```

---

### Task 2: Top Global Filter Bar Component (`PerformanceFilterBar`)

**Files:**
- Create: `src/components/PerformanceFilterBar.tsx`
- Create: `src/components/PerformanceFilterBar.test.tsx`

**Interfaces:**
- Consumes: Granularity state (`month`, `quarter`, `year`), compare mode boolean, therapist list, selected therapist filter
- Produces: `<PerformanceFilterBar />` with date pill, period selector pills, therapist filter dropdown, and Compare switch toggle.

- [ ] **Step 1: Write failing tests in `src/components/PerformanceFilterBar.test.tsx`**

Test rendering of granularity options, clicking a granularity pill, toggling Compare mode switch, and selecting a practitioner filter.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/components/PerformanceFilterBar.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement `PerformanceFilterBar.tsx`**

Implement modern pill-style filter controls:
- Active period label pill (`01 Oct 26 → 31 Oct 26`)
- Granularity segmented pills (`Monthly`, `Quarterly`, `Annual`)
- Practitioner selector dropdown (`All practitioners` or individual therapist)
- Compare switch (`Compare` with accessible checkbox/toggle)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/PerformanceFilterBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/components/PerformanceFilterBar.tsx src/components/PerformanceFilterBar.test.tsx
git commit -m "feat(ui): add PerformanceFilterBar with granularity and compare switch"
```

---

### Task 3: Dual Hero Cards - Utilisation Trend & Revenue Volume

**Files:**
- Create: `src/components/UtilisationTrendCard.tsx`
- Create: `src/components/RevenueVolumeCard.tsx`
- Create: `src/components/PerformanceCards.test.tsx`

**Interfaces:**
- Consumes: `BucketReport[]`, active bucket index, compare mode boolean, target percentage (70%)
- Produces:
  - `<UtilisationTrendCard />`: Headline % (e.g. `68.4%`), date sub-badge, SVG Line Trend Chart with target dashed line and optional comparison dashed line.
  - `<RevenueVolumeCard />`: Headline ₹ (e.g. `₹ 4,20,000`), date sub-badge, SVG Bar Volume Chart with hover highlights.

- [ ] **Step 1: Write failing tests in `src/components/PerformanceCards.test.tsx`**

Test that `UtilisationTrendCard` displays headline percentage and line trend, and `RevenueVolumeCard` formats Indian Rupees and renders bar series.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/components/PerformanceCards.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `UtilisationTrendCard.tsx` and `RevenueVolumeCard.tsx`**

Implement SVG-based rendering:
- `UtilisationTrendCard`: Headline percentage, subtitle, date pill, SVG line path connecting bucket ratios, dashed target line at 70%, and optional prior period overlay curve.
- `RevenueVolumeCard`: Headline currency formatted via `formatINR`, subtitle, date pill, SVG rounded column bars with hover highlights and zero-baseline.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/PerformanceCards.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/components/UtilisationTrendCard.tsx src/components/RevenueVolumeCard.tsx src/components/PerformanceCards.test.tsx
git commit -m "feat(ui): add UtilisationTrendCard and RevenueVolumeCard dual hero components"
```

---

### Task 4: Practitioner Performance Leaderboard Table

**Files:**
- Create: `src/components/PractitionerPerformanceTable.tsx`
- Create: `src/components/PractitionerPerformanceTable.test.tsx`

**Interfaces:**
- Consumes: `TherapistBucketRow[]` (with `revenuePaise`, `utilisation`, `visitCount`, `photoPath`, `name`), status verdicts
- Produces: `<PractitionerPerformanceTable />` with avatars, inline horizontal bullet/progress bars, revenue column, and sortable headers.

- [ ] **Step 1: Write failing tests in `src/components/PractitionerPerformanceTable.test.tsx`**

Test rendering of practitioner avatars, inline progress bars matching utilisation percentages, currency formatting, and sorting by column clicks.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/components/PractitionerPerformanceTable.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `PractitionerPerformanceTable.tsx`**

Implement:
- Avatar with initials (`initialsFor`) or photo.
- Utilisation Rate column: Progress bar (`div` with rounded ends, colored by performance: Teal >= 70%, Gold >= 50%, Rust < 50%) followed by tabular percentage text.
- Formatted Revenue column (`formatINR`).
- Visits column.
- Sortable column headers with `▲/▼` indicators.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/PractitionerPerformanceTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/components/PractitionerPerformanceTable.tsx src/components/PractitionerPerformanceTable.test.tsx
git commit -m "feat(ui): add PractitionerPerformanceTable with avatars and inline progress bars"
```

---

### Task 5: Assemble Full Performance Overview & Wire into Reports

**Files:**
- Modify: `src/components/ClinicUtilisationCard.tsx`
- Modify: `src/components/ClinicUtilisationCard.test.tsx`
- Modify: `src/features/reports/ReportsOverviewPage.tsx`

**Interfaces:**
- Consumes: Clinic context, live visits query, therapists, closed dates
- Produces: The complete, unified Performance Overview layout matching Splose.

- [ ] **Step 1: Update `ClinicUtilisationCard.test.tsx` for the new composite structure**

Update integration test to check that the top filter bar, dual KPI cards (Utilisation + Revenue), and the practitioner table render together cohesively.

- [ ] **Step 2: Update `ClinicUtilisationCard.tsx`**

Assemble the components:
- Render `PerformanceFilterBar` at top.
- Render 2-column grid (`grid grid-cols-1 md:grid-cols-2 gap-4`) for `UtilisationTrendCard` and `RevenueVolumeCard`.
- Render `PractitionerPerformanceTable` underneath.
- Handle active bucket selection, compare toggle, and therapist filtering.

- [ ] **Step 3: Run full component tests**

Run: `npm test -- src/components/ClinicUtilisationCard.test.tsx`
Expected: PASS.

- [ ] **Step 4: Run full verification suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: All type checks, linter checks, and tests pass.

- [ ] **Step 5: Commit changes**

```bash
git add src/components/ClinicUtilisationCard.tsx src/components/ClinicUtilisationCard.test.tsx src/features/reports/ReportsOverviewPage.tsx
git commit -m "feat(reports): assemble modern Splose-inspired clinic performance overview"
```

---

## Verification & Polish
- Run `npm test` across all suites to ensure no regressions.
- Verify desktop width layout and mobile 390px responsive collapsing.
