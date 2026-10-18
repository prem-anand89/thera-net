# Design Spec: Mobile Schedule Proportional Time Grid (v3)

- **Date**: 2026-10-19
- **Status**: Proposed
- **Author**: Antigravity & User

---

## 1. Executive Summary & Objectives

The desktop schedule grid was previously adapted to mobile by constraining columns into narrow viewports. While functional, it lacked mobile-native schedule density: appointments were either truncated in tight columns or presented as disconnected lists.

This redesign introduces a **True-to-Time Mobile Proportional Schedule Grid**:
1. **15-Minute Subdivisions & Proportional Slot Heights**: Exact height-to-time mapping (e.g. 80px per hour; a 45-minute booking takes 3/4 height / 60px, leaving the bottom 15m / 20px visibly open).
2. **Floating "Now" Indicator**: Real-time indicator bar floating across the canvas directly on top of the slots and appointments at the exact current minute.
3. **Adaptive Density Rules for Concurrent Overlaps**:
   - 1 Provider active: 100% full width rich card.
   - 2 Providers active: 50% width side-by-side cards.
   - 3 Providers active: 33% width compact cards.
   - >3 Providers active: **Micro-Pill Mode** displaying Patient Name only with the provider's color accent.
4. **Role-Based Scoping & Colleague Comparison**:
   - **Admin / Front Desk**: Defaults to all active providers in the clinic with full side-by-side parallel density.
   - **Individual Therapist**: Defaults to their own schedule (100% width), with a 1-tap `+ Compare Colleague` chip to overlay another therapist's schedule alongside theirs.
5. **3-Day View Architecture**: 3 date columns sharing the same 15-minute proportional slot heights, floating "Now" bar on today's column, therapist micro-pills, and 1-tap header zoom into Day view.

---

## 2. Layout & Interaction Architecture

### 2.1 View Options & Device Scoping
- **Mobile View Options**: `Day` and `3-Day` (with `List` preserved as an option).
- **Default on Phones**: `Day` grid.
- **Persistence**: Preserved per device in `localStorage['theranet:schedule-phone-view']` (default `'day'`).
- **Responsive Breakpoint**: Matches Tailwind `tab:` exactly via `(max-width: 46.49rem)`.

### 2.2 Time Grid Canvas & Subdivisions
- **Base Grid Sizing**:
  - CSS Variable: `--schedule-hour-height: 80px`.
  - Hourly slots: 80px height.
  - Subdivisions: 4 equal 15-minute intervals (20px each), rendered with subtle dashed divider lines (`border-b border-dashed border-[var(--border)]/40`).
- **Proportional Placement**:
  - `top = ((startMinutes - clinicStartMinutes) / 60) * hourHeight`.
  - `height = (durationMinutes / 60) * hourHeight`.
  - A 45-minute appointment starting at 09:00 AM in a 09:00–10:00 AM block occupies `top: 0px`, `height: 60px`. The remaining `20px` (09:45–10:00 AM) is physically open and actionable.
  - Tapping empty 15-minute space initiates a quick-booking bottom sheet for that exact start time.

### 2.3 Floating Real-Time "Now" Indicator
- Replicates desktop/iPad behavior:
  - Red indicator line (`bg-[var(--rust)]` / `#ef4444`) spanning across the active day canvas.
  - Position: `top = ((currentMinutes - clinicStartMinutes) / 60) * hourHeight`.
  - Left circular dot (10px) + time badge (`09:35 AM`).
  - Pointer events set to `none` so underlying slots remain tappable.
  - Only visible when the displayed date includes today. In 3-Day view, spans across Today's column only.

### 2.4 Adaptive Parallel Density Rules (Concurrent Appointments)
When multiple therapists have bookings during overlapping time intervals:

| Concurrent Bookings | Slot Width | Layout Behavior | Cell Content |
|---|---|---|---|
| **1 Provider** | ~100% | Single column | **Full Rich Card**: Patient name, therapist pill, exact time range, room, condition/visit reason, status badge. |
| **2 Providers** | ~50% each | Side-by-side | **Medium Card**: Patient name, therapist name, duration, room. |
| **3 Providers** | ~33% each | Side-by-side | **Compact Card**: Patient name, therapist tag, duration. |
| **>3 Providers (4+)** | Micro split (~24% each) | Parallel micro-pills | **Micro-Pill Mode**: Patient name only (`Rahul K.`), colored therapist border/indicator dot. Tapping opens full appointment card in bottom sheet. |

### 2.5 Role Defaults & Therapist Colleague Comparison
- **Admin / Front Desk (`canManageAll === true`)**:
  - Defaults to viewing all active therapists across the clinic.
  - All parallel sessions render side-by-side across the Day grid.
  - Therapist filter chip bar allows toggling specific therapists on/off.
- **Individual Therapist (`isTherapist === true` / provider scope)**:
  - Defaults strictly to their own schedule (`myTherapistId`).
  - Their schedule automatically takes 100% width with full details.
  - **`+ Compare Colleague` Chip**:
    - Placed in the provider strip: `[Dr. Sarah (Me)]` + `[+ Compare Colleague]`.
    - Tapping opens a quick provider selector sheet/menu.
    - When a colleague (e.g. Dr. Anand) is selected, both providers share the day grid side-by-side (50% width each).
    - Tapping `✕` on the colleague chip immediately removes the overlay and restores the therapist's 100% full-width view.

### 2.6 3-Day View Architecture
- **Structure**: 3 equal date columns side-by-side (e.g. Mon 19 | Tue 20 | Wed 21) next to the time gutter (44px).
- **Proportional Slot Heights**: Uses the same 15-minute slot heights as Day view.
- **Appointment Cells**: Rendered as micro-pills:
  - Patient Name + Time Range (`Rahul K. · 09:00-09:45`).
  - Left border colored with provider color (`border-l-4`).
- **Floating "Now" Line**: Spans across Today's column when within the 3-day window.
- **1-Tap Zoom to Day**: Tapping any of the 3 date header cells immediately switches phone view to `Day` and sets the active date to that clicked day.

---

## 3. Technical Implementation Plan

### 3.1 Pure Helpers & Geometry (`src/features/schedule/scheduleMobileLayout.ts`)
- `calculateParallelSlots(appointments: Appointment[]): LayoutSlot[]`
  - Groups overlapping appointments using interval intersection algorithm.
  - Assigns each appointment a `column` index (0 to N-1) and total `columns` count for that overlap group.
  - Calculates `leftPercent` and `widthPercent`.
  - Determines `density`: `'full' | 'medium' | 'compact' | 'micro'`.
- `calculateSlotGeometry(appointment: Appointment, clinicStartHour: number, hourHeight: number)`:
  - Calculates `topPx` and `heightPx` based on exact scheduled minutes.

### 3.2 Components
1. **`MobileDayGrid.tsx`**:
   - The dedicated mobile time-grid canvas.
   - Renders the vertical time gutter, 15-minute dashed lines, floating "Now" line, and parallel appointment blocks.
   - Implements touch handling (tap for appointment sheet, tap empty slot to book).
2. **`Mobile3DayGrid.tsx`**:
   - 3-day column layout reusing the same geometry and micro-pill components.
   - Header with tap-to-zoom into Day view.
3. **`TherapistCompareBar.tsx`**:
   - Role-aware provider strip: shows clinic filter chips for admins, or `[Me] + [+ Compare Colleague]` for individual therapists.
4. **Integration in `ScheduleBookingsView.tsx`**:
   - Renders `MobileDayGrid` when `isPhone && phoneView === 'day'`.
   - Renders `Mobile3DayGrid` when `isPhone && phoneView === '3day'`.
   - Renders `AgendaList` when `isPhone && phoneView === 'list'`.
   - Retains tablet/desktop rendering untouched under `tab:block`.

---

## 4. Design Standards & Safety Constraints
- **Touch Targets**: All interactive elements (appointment blocks, empty slot buttons, chips, date headers) meet or exceed 44px min tap target or provide comfortable padding.
- **CSS Variables**: Strict use of CSS variables (`var(--teal)`, `var(--moss)`, `var(--ink)`, `var(--border)`, etc.) matching TheraNet design tokens.
- **No Route Regressions**: Does not touch `router.tsx` or `schedule.ts`. URL contract remains intact.
- **Safe State Handling**: All localStorage accesses wrapped in try/catch. matchMedia checked on initial mount without flash.

---

## 5. Verification & Testing Strategy
1. **Unit Tests**:
   - Interval intersection and parallel column assignment in `scheduleMobileLayout.test.ts`.
   - Correct 15-minute height calculation (e.g. 45m = 60px, 30m = 40px, 60m = 80px).
   - Density assignment: 1 col -> full, 2 cols -> medium, 3 cols -> compact, 4+ cols -> micro.
   - Role scoping & colleague compare state.
2. **Visual & Responsive Verification**:
   - 360px (compact Android phone), 390px (iPhone 14/15), 1280px (desktop unaffected).
3. **Automated Verification**:
   - `npm run check:fast` per commit.
   - `npm run gemini:report -- --build` with 100% pass on typecheck, lint, vitest, and build.
