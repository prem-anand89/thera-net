# Reports & Utilisation Redesign Specification

**Date:** 2026-10-11  
**Status:** Approved  
**Author:** Antigravity & User  

---

## 1. Overview & Objectives

This specification defines 5 targeted improvements to the Reports & Insights dashboard (`/insights`):

1. **Option A (Capacity & Booked Hours Companion Card):** Replace the redundant Revenue card in the Clinic Utilisation section with an operational **Capacity & Booked Hours** card that directly correlates with the Utilisation % metric.
2. **Revenue & Visits Split:** Convert the combined dual-axis `VisitsRevenueTrendChart` in the Revenue Trend section into **two separate, dedicated, side-by-side charts** (Monthly Revenue Trend + Monthly Patient Visits) with synchronized hover selection.
3. **Therapist Comparison Redesign:** Overhaul `TherapistComparisonCard` to use modern comparative ranking bars for Revenue Attribution and Visit Volume per therapist, replacing the squished dual-axis chart.
4. **Practitioner Profile Photo Fix:** Ensure therapist avatars in `PractitionerPerformanceTable` correctly resolve cloud storage paths using `publicTherapistPhotoUrl` and gracefully fall back to initials if an image fails or 404s.
5. **Crisp Typography (Fix Blurred / Stretched Text):** Eliminate `preserveAspectRatio="none"` distortion on SVG `<text>` by migrating guideline labels (`100% Capacity`, `Target 70%`) and month axis labels to native, crisp HTML typography layers.

---

## 2. Component Specifications

### 2.1 CapacityHoursCard (Option A)
- **Path:** `src/components/CapacityHoursCard.tsx`
- **Purpose:** Companion card alongside `UtilisationTrendCard` in `ClinicUtilisationCard`.
- **Metrics:**
  - Headline: Booked hours in the selected period (e.g., `4.5 hrs` or `4h 30m`).
  - Subtitle: Total available capacity (e.g., `of 72 hrs capacity · 67.5 hrs open/idle`).
  - Period-over-period delta: `+1.5 hrs vs prior` in compare mode.
- **Chart:**
  - Monthly capacity bars: Booked hours represented as filled bars (`var(--teal)`), with zero-booked months displaying subtle 2px baseline tick marks.
  - Interactive selection synchronized with the Utilisation Trend card.
- **Data Enrichment (`utilisationReport.ts`):**
  - Expose `clinicWorkedMinutes: number`, `clinicAvailableMinutes: number`, `priorClinicWorkedMinutes: number | null`, `priorClinicAvailableMinutes: number | null` on `BucketReport`.

### 2.2 Split Side-by-Side Revenue & Visits Charts
- **Files:** `src/components/RevenueTrendPanel.tsx`, `src/components/MonthlyRevenueChart.tsx`, `src/components/MonthlyVisitsChart.tsx`
- **Layout:** Responsive 2-column grid (`grid grid-cols-1 lg:grid-cols-2 gap-5`).
- **Card 1: Monthly Revenue Trend**
  - KPI Headline: Selected month revenue (`formatINR(revenue)`).
  - Delta badge: MoM revenue percentage change (`▲ +28% vs prior`).
  - Chart: Single-scale vertical revenue bars with current in-progress month indicator (dashed border) and hover tooltips.
- **Card 2: Monthly Visit Volume**
  - KPI Headline: Selected month visit count (`N visits`).
  - Delta badge: MoM volume percentage change.
  - Chart: Single-scale vertical visit bars (distinct series color token, e.g. `var(--teal-strong)` or warm palette) with in-progress indicator.
- **Interactivity:**
  - Hovering or clicking a month bar in either chart updates the active month index across both charts and the Month Detail table below.

### 2.3 Therapist Comparison Redesign
- **Path:** `src/components/TherapistComparisonCard.tsx`
- **Layout:**
  - Modern month-selector pill bar (`PerformanceFilterBar` style).
  - Two clean side-by-side comparative ranking panels:
    - **Revenue by Therapist:** Horizontal/vertical bars showing revenue per therapist, revenue share percentage, and avatar.
    - **Visits by Therapist:** Horizontal/vertical bars showing visit count per therapist, volume share percentage, and avatar.
  - Totals breakdown table underneath with cleaned status badges and sorting.

### 2.4 Practitioner Profile Photo & Avatar Fix
- **Path:** `src/components/PractitionerPerformanceTable.tsx`
- **Implementation:**
  - Import `publicTherapistPhotoUrl` from `@/lib/supabase`.
  - For rows with `photoPath`, render `<img src={publicTherapistPhotoUrl(row.photoPath) ?? ''} ... />` with `onError` state.
  - If `photoPath` is null/empty or `onError` triggers, render the fallback initials badge (`initialsFor(row.name)`).
  - Avatar sizing: `h-9 w-9 rounded-full object-cover ring-1 ring-[var(--border)]`.

### 2.5 Typography & SVG Non-Scaling Fix
- **Paths:** `src/components/UtilisationTrendCard.tsx`, `src/components/CapacityHoursCard.tsx`
- **Issue:** `preserveAspectRatio="none"` causes non-uniform horizontal scaling on SVG `<text>`, resulting in stretched, squashed, and blurred typography.
- **Fix:**
  - Guidelines (`100% Capacity`, `Target 70%`) and bottom month labels (`Nov`, `Dec`, ...) rendered as native HTML text elements positioned absolutely over the chart.
  - SVG retains vector geometry (`<line>`, `<path>`, `<rect>`) where `preserveAspectRatio="none"` works smoothly.
  - All text renders with native browser subpixel font antialiasing: crisp, razor-sharp, and un-distorted.

---

## 3. Testing & Verification Requirements
1. Unit tests for `clinicUtilisationReport` verifying `clinicWorkedMinutes` and `clinicAvailableMinutes`.
2. Component tests for `CapacityHoursCard`, verifying headline hours formatting, delta badges, and bucket selection.
3. Component tests for the split `MonthlyRevenueChart` and `MonthlyVisitsChart`.
4. Browser verification in Firefox/Chrome confirming:
   - Sharp, un-distorted labels for `100% Capacity` and `Target 70%`.
   - Therapist avatar images load properly and fall back to initials if broken.
   - Revenue and Visits render side-by-side with synchronized hover.
   - Capacity Hours card shows accurate booked hours vs open capacity.
