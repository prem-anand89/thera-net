# Multi-Therapist Week View — Implementation Plan

Date: 2026-10-11
Status: Approved

## Goal
Implement "Option 3": A multi-therapist week view using a horizontally scrolling matrix. 
Currently, the "Week" toggle is hidden unless the user filters down to exactly one therapist. We will unhide the Week toggle for multi-therapist selections and render a horizontal grid where days are top-level headers, and selected therapists are sub-columns beneath each day.

**Crucial Constraints:**
- **Strict Scope: Booked Appointments Only:** This view is strictly for providing an overview of *booked patient appointment slots* across therapists. It does not manage, edit, or display staff shift configurations.
- **Zero Conflict with Shift-Based Scheduling:** This UI change purely consumes the existing `Appointment`, `Therapist`, and `working_hours` data shapes. It does not write to the database and will not conflict with the ongoing Shift Templates implementation plan.
- **Performance & Column Geometry:** Rendering 4 therapists across 7 days generates 28 sub-columns. Sub-columns are locked to `min-w-[70px]` (`65px`–`80px`), yielding a compact $\sim 1,960\text{px}$ scrollable table that renders quickly without crashing.

## Architecture & UX
1. **Unhide the Week Toggle:** In `ScheduleBookingsView.tsx`, remove `const weekAvailable = singleTherapist !== null;` and allow `mode === 'week'` at all times.
2. **Left-Rail Filtering:** We rely on the existing `ScheduleRail.tsx` checkboxes. The user checks which therapists they want to see. The week view only renders sub-columns for the currently selected/visible therapists.
3. **Sticky Headers & Axis:** 
   - The left axis (Time slots) must be `position: sticky; left: 0; z-index: 20; background: var(--surface)`.
   - The top axis (Days) and sub-axis (Therapist Names) must be `position: sticky; top: 0; z-index: 10; background: var(--surface)`.
4. **Interaction Safety (Disable Drag for Phase 1):** In a 28-column horizontally scrolling matrix, pointer-down drag-and-drop introduces severe risk of accidental reassignments while scrolling. Drag-and-drop is disabled in `MultiResourceWeekGrid` for Phase 1. Clicking an appointment block opens its details modal.
5. **Unified Closed Days:** When `isClosedDay(date)` is true, merge the day into a single column with a diagonal hatch and *"Closed"* label, rather than rendering empty sub-columns for all therapists.
6. **Quick-Booking on Empty Slot:** Clicking an empty slot in a therapist's sub-column passes `{ date, time, therapistId }` to open `BookSlotSheet` pre-filled.
7. **Smart Initial Auto-Scroll:** On initial mount, automatically scroll vertically to `clinic.bookingStartHour` (or `now - 60min`), and horizontally to center `today`.
8. **The Component:** Create `MultiResourceWeekGrid.tsx` alongside `ResourceDayGrid.tsx` and `WeekTimeGrid.tsx`.

---

## Task 1: Create `MultiResourceWeekGrid.tsx`

**File:** `src/components/schedule/MultiResourceWeekGrid.tsx` (New)

**Requirements:**
- Receives: `days` (array of dates for the week), `therapists` (array of selected therapists), `appointments` (filtered for the week), `hours` (start/end grid hours), `slotMinutes`, `closedFor` (function), `workingFor` (function), `onSelect` (appointment details callback), `onBook` (quick-booking callback).
- Renders a scrollable container (`overflow-x-auto`).
- **Header Row 1:** Sticky top. First cell is empty (above time axis). Then, mapping over `days`:
  - If closed day: single header column (width $\approx 100\text{px}$).
  - If open day: header cell spanning `therapists.length` columns (`col-span-[N]`, e.g., "Monday, Oct 23").
- **Header Row 2:** Sticky top (below Row 1). 
  - For open days, map over `therapists` to render a sub-header cell for each therapist (`min-w-[70px] max-w-[85px]`, e.g., "Dr. Priya", "Dr. John").
- **Grid Body:** 
  - Leftmost column is the sticky Time axis.
  - For closed days: render a single merged closed column.
  - For open days: map over `therapists`, rendering a `DayColumn` component for each Day+Therapist combination with `min-w-[70px]`.
  - Pass `minimalBlocks={true}` to `DayColumn`: appointment blocks render textless (solid color rectangle). The vertical position clearly indicates time; sub-column placement indicates the therapist.
  - Hovering over any colored block displays a native tooltip containing: Patient name, time range, and therapist.
  - Clicking an empty slot triggers `onBook(date, time, therapist.id)`.

## Task 2: Integrate into `ScheduleBookingsView.tsx`

**File:** `src/features/schedule/ScheduleBookingsView.tsx`

**Modifications:**
1. **Remove the block:** Remove `const weekAvailable = singleTherapist !== null;` and make the Day/Week toggle always visible.
2. **Routing Logic:** Update the render tree in the desktop view block:
```tsx
{mode === 'week' ? (
  singleTherapist ? (
    <WeekTimeGrid {...props} /> // Existing single-therapist week view
  ) : (
    <MultiResourceWeekGrid 
      days={weekDays(date)}
      therapists={gridTherapists} // Derived from selected checkboxes
      appointments={weekAppointments} // Filtered for the week
      hours={hours}
      slotMinutes={slotMinutes}
      closedFor={closedFor}
      workingFor={workingFor}
      onSelect={handleSelectAppointment}
      onBook={(d, t, therapistId) => handleQuickBook(d, t, therapistId)}
    />
  )
) : (
  <ResourceDayGrid {...props} /> // Existing multi-therapist day view
)}
```
3. **Data Fetching:** Ensure the `appointments` live query retrieves the entire week's data when `mode === 'week'`.
4. **Auto-Scroll Ref:** Attach a ref to scroll the container to `today` horizontally and `bookingStartHour` vertically on mount.

## Task 3: Optimization & Limits

**File:** `src/features/schedule/ScheduleBookingsView.tsx`

**Modifications:**
- If the user selects "All Therapists" and clicks "Week", default to showing a maximum of 4 or 5 therapists at once to prevent DOM overload on initial render.
- Render a small alert/banner at the top: *"Showing 4 therapists. Use the left sidebar to select specific team members."*

---
## Verification
- Does not modify any RPCs, database tables, or the `working_hours` JSON structure.
- Verify horizontal scrolling is smooth and sticky headers stay in place.
- Verify that clicking an appointment opens details.
- Verify that clicking an empty slot opens the booking modal with date, time, and therapist pre-filled.
- Verify that closed days render as a clean unified column.
