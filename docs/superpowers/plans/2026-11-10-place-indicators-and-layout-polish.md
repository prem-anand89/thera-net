# Place Indicators, Ledger Toolbar & Desktop Row Polish Implementation Plan

> **For agentic workers (Gemini Flash):** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous 2px header border line (`<DepartmentBand />`) with explicit, unmistakable **Place Pills (`OP`, `Home`, `IP`)** across `NewVisitPage`, `BookSlotSheet`, and `LedgerPage`; eliminate the wasted full-width `Columns ▾` row on `LedgerPage`; remove the redundant `Visit type (sets the length)` dropdown in `BookSlotSheet`; and compact the desktop `TodayAppointments` row layout so there is no dead middle whitespace.

**Architecture:**
1. **`DepartmentPill` component (`src/components/DepartmentSwitch.tsx`):** Replace `DepartmentBand` with a semantic, color-coded `<DepartmentPill department={...} />` (`OP · Outpatient` in teal, `Home · Home Care` in sky, `IP · Inpatient` in plum) that can render in compact (`OP`, `Home`, `IP`) or full (`OP · Outpatient`, `Home · Home Care`, `IP · Inpatient`) mode.
2. **Contextual Place Indicators (`NewVisitPage.tsx`, `BookSlotSheet.tsx`, `LedgerPage.tsx`):**
   - `NewVisitPage`: Show `<DepartmentPill department={visitDept} full />` in the page title row AND inside the `This visit` card header (when `!activeAdmission`), plus contextualize the primary submit button (`Save OP visit` / `Save home visit` / `Save IP visit`).
   - `BookSlotSheet`: Show `<DepartmentPill department={department} full />` right next to the modal header (`New booking` / `Reschedule appointment`).
   - `LedgerPage`: Show `<DepartmentPill department={department} full />` in the top tab bar row.
3. **Ledger `Columns ▾` Toolbar Consolidation (`LedgerPage.tsx`):** Move `<VisitColumnPicker />` inline into the Ledger filter bar row (right next to the `Filters` button on `tab:` screens) and pass `showColumnPicker={false}` to `<ResponsiveVisitList />`.
4. **Desktop Appointments Row Compaction (`TodayAppointments.tsx`):** Replace the stretched `flex-1` empty middle space and oversized `sm:w-44` right box with a balanced desktop layout where clinical context (condition/reason + flags) and therapist/duration sit cleanly without dead space.
5. **Booking Form Simplification (`BookSlotSheet.tsx`):** Remove the redundant `Visit type (sets the length)` `<select>` dropdown above the duration chips (`15m | 30m | 45m | 60m | 90m`).

---

## Task 1: Replace `DepartmentBand` with `DepartmentPill` (`src/components/DepartmentSwitch.tsx` & `src/app/Shell.tsx`)

**Files:**
- Modify: `src/components/DepartmentSwitch.tsx`
- Modify: `src/app/Shell.tsx`

- [ ] **Step 1: Replace `DepartmentBand` with `DepartmentPill` in `src/components/DepartmentSwitch.tsx`**
  In `src/components/DepartmentSwitch.tsx`, replace `BAND_COLORS` (lines 6–10) and `DepartmentBand` (lines 119–128) with `DepartmentPill`:
  ```tsx
  import { DEPARTMENT_LABELS, DEPARTMENT_NAMES, type Department } from '@/domain/departments';
  import { Pill, segOption, segTrack } from '@/components/ui';

  const PILL_TONES: Record<Department, 'teal' | 'sky' | 'plum'> = {
    clinic: 'teal',
    home: 'sky',
    ward: 'plum',
  };

  /**
   * Explicit visual badge indicating the active place of service (OP, Home, IP).
   * Shown inside page headers, forms, and modals so staff never miss which place they are working in.
   */
  export function DepartmentPill({
    department: explicitDept,
    full = false,
  }: {
    department?: Department;
    full?: boolean;
  }) {
    const { department: contextDept } = useDepartment();
    const dept = explicitDept ?? contextDept;
    return (
      <Pill tone={PILL_TONES[dept]}>
        {full ? DEPARTMENT_NAMES[dept] : DEPARTMENT_LABELS[dept]}
      </Pill>
    );
  }
  ```

- [ ] **Step 2: Remove `<DepartmentBand />` from `src/app/Shell.tsx`**
  - In `src/app/Shell.tsx`, remove `DepartmentBand` from the `@/components/DepartmentSwitch` import (line 27) and remove `<DepartmentBand />` under `<header>` (line 516).

---

## Task 2: Place Indicators on `NewVisitPage`, `BookSlotSheet`, and `LedgerPage`

**Files:**
- Modify: `src/features/visits/NewVisitPage.tsx`
- Modify: `src/components/BookSlotSheet.tsx`
- Modify: `src/features/visits/LedgerPage.tsx`

- [ ] **Step 1: Add `DepartmentPill` to `NewVisitPage.tsx` header & `This visit` card**
  - Import `DepartmentPill` from `@/components/DepartmentSwitch` in `src/features/visits/NewVisitPage.tsx`.
  - In the `This visit` header (`src/features/visits/NewVisitPage.tsx:1747-1755`), show the admission pill when `activeAdmission` is set, or `<DepartmentPill department={visitDept} full />` otherwise:
    ```tsx
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-display text-base font-semibold text-[var(--ink)] whitespace-nowrap shrink-0">This visit</h2>
      {activeAdmission ? (
        <Pill tone="plum">
          {['Inpatient', activeAdmission.wardBed].filter(Boolean).join(' · ')}
        </Pill>
      ) : (
        <DepartmentPill department={visitDept} full />
      )}
    </div>
    ```
  - In the page header (`src/features/visits/NewVisitPage.tsx:2235-2245`), render `<DepartmentPill department={visitDept} full />` right next to `<h1 className={pageTitle}>New visit</h1>`:
    ```tsx
    <div className="flex flex-wrap items-center gap-2.5">
      <h1 className={pageTitle}>New visit</h1>
      <DepartmentPill department={visitDept} full />
    </div>
    ```

- [ ] **Step 2: Add `DepartmentPill` to `BookSlotSheet.tsx` modal header & remove `Visit type (sets the length)` dropdown**
  - Import `DepartmentPill` from `@/components/DepartmentSwitch` in `src/components/BookSlotSheet.tsx`.
  - In the modal header (`src/components/BookSlotSheet.tsx:693-702`), display `<DepartmentPill department={department} full />` next to `<h2 id="book-slot-title">`:
    ```tsx
    <div className="flex flex-wrap items-center gap-2">
      <h2 id="book-slot-title" className="font-display text-lg font-semibold text-[var(--ink)]">{title}</h2>
      <DepartmentPill department={department} full />
    </div>
    ```
  - Remove the redundant `Visit type (sets the length)` `<select>` block (`src/components/BookSlotSheet.tsx:850-873`) and unused `visitTypes` / `visitTypeId` state (`lines 194-201`), leaving the clean `15m | 30m | 45m | 60m | 90m` duration chips.
  - Update any test in `src/components/BookSlotSheet.test.tsx` that queries `Visit type (sets the length)` if present.

- [ ] **Step 3: Add `DepartmentPill` and inline `VisitColumnPicker` on `LedgerPage.tsx`**
  - Import `DepartmentPill` from `@/components/DepartmentSwitch` and `VisitColumnPicker`, `useVisitColumnPrefs` from `@/components/visit/VisitColumnPicker` in `src/features/visits/LedgerPage.tsx`.
  - Call `const [columnPrefs, setColumnPrefs] = useVisitColumnPrefs();` inside `LedgerPage`.
  - In the top tab row (`src/features/visits/LedgerPage.tsx:823`), place `<DepartmentPill department={department} full />` alongside the tab strip so it is immediately clear which place of service the Ledger is showing.
  - In the `recordsView === 'visits'` filter bar (`src/features/visits/LedgerPage.tsx:987`, right before `<KebabMenu>`), add the desktop column picker inline:
    ```tsx
    <div className="hidden tab:block">
      <VisitColumnPicker prefs={columnPrefs} onChange={setColumnPrefs} />
    </div>
    ```
  - On `<ResponsiveVisitList>` (`src/features/visits/LedgerPage.tsx:1183`), pass `showColumnPicker={false}` so it no longer renders a wasted full-width row above the visits table.

---

## Task 3: Compact Desktop Appointment Rows (`src/components/schedule/TodayAppointments.tsx`)

**Files:**
- Modify: `src/components/schedule/TodayAppointments.tsx`

- [ ] **Step 1: Eliminate dead middle whitespace on desktop appointment rows**
  In `src/components/schedule/TodayAppointments.tsx` (`lines 140-192`):
  - Change the row `<button>` layout on `sm:` so that instead of pushing therapist/duration to the far right across 600px of empty space and reserving `sm:w-44` for the action button:
    - Give the patient identity column `sm:w-56 sm:shrink-0` (or `sm:max-w-xs sm:flex-1`),
    - Place clinical context (`wideDetail` + `<PatientFlagPills />`) in its own middle column (`hidden min-w-0 flex-1 items-center gap-1.5 text-xs text-[var(--muted)] sm:flex`) on desktop so condition (`Back Pain`), package progress (`Package 4/7`), and flags sit cleanly in the middle column,
    - Keep therapist + length compact (`hidden shrink-0 items-center gap-3 text-xs text-[var(--muted)] sm:flex`),
    - Change the `end` wrapper (`line 187`) from `sm:w-44 sm:justify-end` to `shrink-0 self-center sm:flex sm:justify-end` so the `Arrived` / `Log visit` button hugs the right edge without reserving 176px of blank space.

---

## Task 4: Verification & Documentation

- [ ] **Step 1: Update `FEATURES_AND_SCHEMA.md`**
  - Note the `DepartmentPill` contextual indicator on `NewVisitPage`, `BookSlotSheet`, and `LedgerPage`, and the inline `Columns ▾` picker in the Ledger filter toolbar.
- [ ] **Step 2: Run TypeScript & Vitest checks**
  - Run `npx tsc --noEmit`
  - Run `npx vitest run src/app/AccountMenu.test.tsx src/components/BookSlotSheet.test.tsx src/features/visits/NewVisitDepartmentScoping.test.tsx src/features/visits/LedgerDepartmentScoping.test.tsx --maxWorkers=2`
- [ ] **Step 3: Commit changes**
  - Commit with a descriptive message summarizing the UI/UX refinements.

