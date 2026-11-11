# Inpatients Card Redesign, IP/Rehab Billing Workflow & Header Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Inpatient & Rehab workflow (`InpatientsCard`, structured `Ward / unit` + `Bed / room` with hospital & rehab presets, and IP billing rules that suppress per-session collection and distinguish hospital-billed IP from clinic/rehab stay-billed IP), refine Place terminology (`OP` · `Home` · `IP`), and un-cramp the app header by integrating `ClinicSwitcher` and `Settings` into `AccountMenu`.

**Architecture:**
1. **Place Terminology (`src/domain/departments.ts`):** Shorten `DEPARTMENT_LABELS.home` from `'Home care'` to `'Home'` (`OP` · `Home` · `IP`) and standardize user-facing umbrella labels to **"Place"** / **"Places"** (keeping **"Place of service"** on invoices).
2. **Inpatient & Rehab Billing Rules (`src/domain/departmentMoney.ts`):**
   - Inpatient sessions (`departmentOf(v) === 'ward'`) are **never collected or invoiced per individual session**.
   - Two IP billing modes are supported via `isIpBilledByPartner(clinic)` (`clinic.ipBilledByPartner ?? Boolean(clinic.hasPartner && clinic.partnerCollects)`):
     - **Hospital / partner bills inpatients (`isIpBilledByPartner(clinic) === true`):** Therapists only document sessions and rates. All invoice and payment-collection UI is hidden in IP (`VisitLoggedCard`, `VisitCard`, `PaymentStatusDisplay`, `RowActionsMenu`, `PatientAdmissionBar`, `PatientProfilePage`, `WorkspacePage`, `LedgerPage`).
     - **Clinic / rehab centre bills inpatients (`isIpBilledByPartner(clinic) === false`):** Sessions accumulate as **Running charges** (`On stay bill` pill) and are billed together via **Bill this stay** or at **Discharge** (`PatientAdmissionBar`, `InpatientsCard`). Per-session `Collect ₹X` and `Give bill` are suppressed on visit rows and `VisitLoggedCard`, while stay-level invoicing, IP advances, and `Unpaid invoices` remain active.
3. **Structured Ward / Unit + Bed / Room & Preset Wards (`src/domain/admissions.ts`, `AdmissionSheet.tsx`, `CareLocationsSection`):**
   - Add `clinics.wards text[]` and `clinics.ip_billed_by_partner boolean` in migration `supabase/migrations/20261110010000_inpatient_wards_and_billing.sql`.
   - Provide hospital & rehab presets (`General`, `Ortho`, `Neuro`, `ICU`, `Private`, `Rehab Wing`, `Suite / Room`, `Step-down`) configurable in Settings → Places you see patients, and split `Ward / bed` in `AdmissionSheet` into a **Ward / unit** selector + **Bed / room** input while preserving storage in `admissions.ward_bed` via `splitWardBed` / `joinWardBed`.
4. **Inpatients Card Redesign (`src/features/workspace/InpatientsCard.tsx`):**
   - Add Ward filter chips, respect Workspace `All | Mine` scope, display **`Next round HH:MM`** from today's upcoming ward appointments (completing Step 5 of `2026-11-08-departments.md`), de-duplicate the row subtitle into scannable **Bed/Room**, **Day N**, **Doctor/IPD**, and **unbilled sessions/running charges**, and add 1-tap **`Edit stay`** and **`Bill stay`** actions.
5. **Header Navigation & Unified `AccountMenu` (`Shell.tsx`, `AccountMenu.tsx`, `DepartmentSwitch.tsx`):**
   - Remove `Settings` from primary desktop `NAV` (leaving `Workspace`, `Schedule`, `Ledger`, `Reports` with room for upcoming HEP and HR tabs).
   - Move clinic identity, clinic switching, `+ Add another clinic`, and `Clinic settings` (`/settings`) into `AccountMenu.tsx`, removing the crushed standalone `<ClinicSwitcher />` pill from `Shell.tsx`.
   - Use the compact `Place ▾` dropdown up to `desktop:` (`1000px`) so tablet and 120%-zoomed desktop headers never clip.

**Tech Stack:** React 19, TypeScript, Tailwind CSS (CSS custom properties only), TanStack Router, Dexie.js (IndexedDB), Supabase (Postgres), Vitest + React Testing Library.

---

## Global Constraints (Must Follow on Every Task)

- **Follow `.agents/rules/THERA_NET.md` strictly:**
  - Every `<button>` must have an explicit `type="button"` (or `submit`/`reset`).
  - Use CSS variables only (`var(--teal)`, `var(--ink)`, `var(--muted)`, `var(--surface)`, `var(--paper)`, `var(--border)`, `var(--plum)`, `var(--rust)`, `var(--amber)`). Never hardcode hex values.
  - Never use "MRN" or "MRNO" in user-facing text (use `Patient ID` or `{patient.mrno}`).
  - **Never apply SQL migrations directly to live Supabase.** Commit the migration file under `supabase/migrations/` and report its path.
  - Update `FEATURES_AND_SCHEMA.md` in the same commit/task when adding columns or changing rules.
  - **Never edit `vite.config.ts`.** Run targeted tests with `npx vitest run <path> --maxWorkers=2` and typecheck/lint with `npm run check:fast`.

## Review Focus (For Code Reviewers & Subagents)

1. **Zero per-session collection in IP:** Verify that logging an inpatient visit or viewing an inpatient visit on Workspace (`Today's visits`), Ledger (`Visits`), or Patient Profile never renders a `Collect ₹X` button, `Give bill` row menu item, `Send WhatsApp reminder`, or red `Due ₹X` total.
2. **Hospital-billed vs. Clinic/Rehab-billed IP separation:** Verify that when `isIpBilledByPartner(clinic)` is `true`, `Bill this stay`, `Unpaid invoices`, `Invoices` tab, and `Daybook` tab are hidden in IP (`ward`), whereas when `isIpBilledByPartner(clinic)` is `false`, `Bill this stay` and `Unpaid invoices` (for issued stay bills) remain available.
3. **Backwards compatibility of `ward_bed`:** Verify `splitWardBed` and `joinWardBed` round-trip existing free-text `ward_bed` strings (e.g., `"Ortho, Bed 12"`, `"Neuro"`, `"ICU - Bed 3"`, `"Room 204"`) without data loss.
4. **Header responsiveness:** Verify `Shell.tsx` no longer renders `<ClinicSwitcher />` in the top bar or `Settings` in `NAV`, and `AccountMenu.tsx` provides `Clinic settings`, clinic switching, and `+ Add another clinic`.

---

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `supabase/migrations/20261110010000_inpatient_wards_and_billing.sql` | Create | Adds `wards text[] null` and `ip_billed_by_partner boolean null` to `public.clinics`. |
| `src/domain/types.ts` | Modify | Adds `wards?: string[] \| null` and `ipBilledByPartner?: boolean \| null` to `Clinic`. |
| `src/domain/departments.ts` | Modify | Changes `DEPARTMENT_LABELS.home` from `'Home care'` to `'Home'`. |
| `src/domain/departments.test.ts` | Modify | Updates label assertions for `'Home'`. |
| `src/components/DepartmentSwitch.tsx` | Modify | Uses `"Place"` aria-labels and switches breakpoint from `sm:` to `desktop:` (`1000px`). |
| `src/components/DepartmentSwitch.test.tsx` | Modify | Updates tests for `"Place"` aria-labels and `'Home'` label. |
| `src/features/settings/ServiceFormSheet.tsx` | Modify | Changes `"Departments"` field label to `"Places"`. |
| `src/features/settings/TeamSection.tsx` | Modify | Changes `"Departments"` label to `"Places"`. |
| `src/features/settings/DepartmentHoursSection.tsx` | Modify | Updates copy from `"department"` to `"place"`. |
| `src/features/invoices/AdvanceReceiptPrintPage.tsx` | Modify | Changes `"Department"` receipt meta label to `"Place"`. |
| `src/domain/departmentMoney.ts` | Modify | Adds `isInpatientVisit`, `isIpBilledByPartner`, and `canBillInpatientStay` helpers. |
| `src/domain/departmentMoney.test.ts` | Modify | Tests IP billing mode helpers. |
| `src/components/visit/types.ts` | Modify | Adds `inpatientBilling?: 'stay_bill' \| 'partner_billed' \| null` to `VisitCardData`. |
| `src/components/visit/VisitPaymentDisplay.tsx` | Modify | Renders `On stay bill` or `Logged` pill for IP visits instead of per-session `Collect ₹X`. |
| `src/components/VisitCard.tsx` | Modify | Matches `PaymentStatusDisplay` IP pill logic on mobile `SharedVisitCard`. |
| `src/components/visit/VisitRowActions.tsx` | Modify | Hides per-session `Give bill` and `Send WhatsApp reminder` when `data.inpatientBilling` is set. |
| `src/features/visits/VisitLoggedCard.tsx` | Modify | Renders `Added to stay bill` or `Logged` pill for IP sessions and suppresses per-session `Take payment` / `Give bill`. |
| `src/features/visits/NewVisitPage.tsx` | Modify | Passes `inpatientStay`, `paymentDue={0}`, and `canBill={false}` to `VisitLoggedCard` for IP sessions. |
| `src/features/patients/PatientAdmissionBar.tsx` | Modify | Gates `Bill this stay` and discharge bill prompt on `canBillInpatientStay(clinic)`. |
| `src/features/patients/PatientProfilePage.tsx` | Modify | Sets `inpatientBilling` on `VisitCardData` and hides IP invoicing/advances when `!canBillInpatientStay(clinic)`. |
| `src/features/workspace/TodayVisitsExtras.tsx` | Modify | Suppresses `Paid` / red `Due` in `TodayVisitsTotals` when in IP (`ward`). |
| `src/features/workspace/WorkspacePage.tsx` | Modify | Sets `inpatientBilling` on `todayRows`, hides `Collected` tile in IP when partner bills, and passes IP props to `TodayVisitsTotals` and `InpatientsCard`. |
| `src/features/visits/LedgerPage.tsx` | Modify | Sets `inpatientBilling` on `cardRows`, hides per-session collection filters & red `DueToggle` in IP, and hides `Invoices`/`Daybook`/`Unpaid invoices` in IP when partner bills. |
| `src/domain/admissions.ts` | Modify | Adds `DEFAULT_PRESET_WARDS`, `clinicWards`, `splitWardBed`, `joinWardBed`. |
| `src/domain/admissions.test.ts` | Modify | Unit tests for `splitWardBed`, `joinWardBed`, `clinicWards`, and `wardOf`. |
| `src/features/settings/ClinicSections.tsx` | Modify | Adds preset Ward / Rehab unit chip editor and IP billing mode switch (`ipBilledByPartner`) in `CareLocationsSection`. |
| `src/features/patients/AdmissionSheet.tsx` | Modify | Splits `Ward / bed` into `Ward / unit` select + custom option and `Bed / room` text input. |
| `src/features/workspace/InpatientsCard.tsx` | Modify | Complete redesign: ward filter chips, `All \| Mine` support, `Next round HH:MM`, de-duplicated bed/day/doctor/charges layout, inline `Edit stay` & `Bill stay`. |
| `src/features/workspace/InpatientsCard.test.tsx` | Create | Tests ward filtering, `Next round`, de-duplicated subtitle, `Edit stay`, and `Bill stay` visibility. |
| `src/app/Shell.tsx` | Modify | Removes `Settings` from `NAV` and removes standalone `<ClinicSwitcher />` from header; passes clinic props to `AccountMenu`. |
| `src/app/AccountMenu.tsx` | Modify | Integrates clinic header, `Clinic settings` link, clinic switcher list, and `+ Add another clinic`. |
| `FEATURES_AND_SCHEMA.md` | Modify | Documents `clinics.wards`, `clinics.ip_billed_by_partner`, IP/Rehab billing rules, `InpatientsCard`, and unified `AccountMenu`. |

---

### Task 1: Place Terminology (`OP` · `Home` · `IP`) & Compact `DepartmentSwitch`

**Files:**
- Modify: `src/domain/departments.ts`
- Modify: `src/domain/departments.test.ts`
- Modify: `src/components/DepartmentSwitch.tsx`
- Modify: `src/components/DepartmentSwitch.test.tsx`
- Modify: `src/features/settings/ServiceFormSheet.tsx`
- Modify: `src/features/settings/TeamSection.tsx`
- Modify: `src/features/settings/DepartmentHoursSection.tsx`
- Modify: `src/features/invoices/AdvanceReceiptPrintPage.tsx`

- [ ] **Step 1: Update `DEPARTMENT_LABELS.home` in `src/domain/departments.ts` and test in `src/domain/departments.test.ts`**

In `src/domain/departments.ts`, change line 10:
```ts
export const DEPARTMENT_LABELS: Record<Department, string> = { clinic: 'OP', home: 'Home', ward: 'IP' };
```
(Keep `DEPARTMENT_NAMES` on line 13 as `{ clinic: 'Outpatient (OP)', home: 'Home care', ward: 'Inpatient (IP)' }` for longer descriptions.)

In `src/domain/departments.test.ts`, update any assertion expecting `DEPARTMENT_LABELS.home` to be `'Home'`.

- [ ] **Step 2: Update `src/components/DepartmentSwitch.tsx` and `src/components/DepartmentSwitch.test.tsx`**

Update `src/components/DepartmentSwitch.tsx` so:
1. The segmented bar is `hidden desktop:inline-flex` (only on wide `1000px+` screens) and `aria-label="Place switch"`.
2. The compact dropdown trigger is `relative desktop:hidden` (used on phone, tablet, and 120%-zoomed desktop) with `aria-label={`Place: ${DEPARTMENT_LABELS[department]}. Switch place`}` and menu `aria-label="Switch place"`.

Full replacement for `src/components/DepartmentSwitch.tsx`:
```tsx
import { useRef, useState } from 'react';
import { useDepartment } from '@/app/DepartmentContext';
import { DEPARTMENT_LABELS, type Department } from '@/domain/departments';
import { segOption, segTrack } from '@/components/ui';

const BAND_COLORS: Record<Department, string> = {
  clinic: 'bg-[var(--teal)]',
  home: 'bg-[var(--sky)]',
  ward: 'bg-[var(--plum)]',
};

/**
 * Universal place switch (OP · Home · IP). Rendered in the Shell header
 * when the user has more than one place to choose from.
 * Wide desktop (desktop:): segmented control.
 * Below desktop: compact trigger button with dropdown menu.
 */
export function DepartmentSwitch() {
  const { department, departments, canSwitch, setDepartment } = useDepartment();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!canSwitch) return null;

  function toggleMenu() {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const winWidth = typeof window !== 'undefined' ? window.innerWidth : 360;
        const width = Math.min(160, winWidth - 24);
        const left = Math.max(12, Math.min(rect.left, winWidth - width - 12));
        setMenuPos({ top: (rect.bottom || 0) + 8, left, width });
      } else {
        setMenuPos({ top: 48, left: 12, width: 140 });
      }
    }
    setOpen(!open);
  }

  return (
    <div className="flex shrink-0 items-center">
      {/* Wide desktop segmented switch (desktop and up) */}
      <div className="hidden desktop:inline-flex" role="group" aria-label="Place switch">
        <div className={segTrack}>
          {departments.map((dept) => {
            const active = dept === department;
            return (
              <button
                key={dept}
                type="button"
                aria-pressed={active}
                onClick={() => setDepartment(dept)}
                className={segOption(active)}
              >
                {DEPARTMENT_LABELS[dept]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phone / tablet / zoomed-desktop compact dropdown trigger (below desktop) */}
      <div className="relative desktop:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Place: ${DEPARTMENT_LABELS[department]}. Switch place`}
          onClick={toggleMenu}
          className="flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface)]"
        >
          <span>{DEPARTMENT_LABELS[department]}</span>
          <svg aria-hidden className="h-3 w-3 shrink-0 text-[var(--muted)]" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && menuPos && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <div
              role="menu"
              aria-label="Switch place"
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              className="fixed z-50 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-lg"
            >
              {departments.map((dept) => {
                const active = dept === department;
                return (
                  <button
                    key={dept}
                    type="button"
                    role="menuitem"
                    aria-pressed={active}
                    onClick={() => {
                      setDepartment(dept);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                      active
                        ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                        : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                    }`}
                  >
                    <span>{DEPARTMENT_LABELS[dept]}</span>
                    {active && <span aria-hidden className="text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A thin colour band rendered under the header per place:
 * --teal for OP, --sky for Home, --plum for IP.
 * Only shown when the user has more than one place to choose from.
 */
export function DepartmentBand() {
  const { department, canSwitch } = useDepartment();
  if (!canSwitch) return null;
  return <div className={`h-0.5 w-full ${BAND_COLORS[department]}`} role="presentation" />;
}
```

Update `src/components/DepartmentSwitch.test.tsx` to match `"Place switch"`, `"Place: OP. Switch place"`, `"Switch place"`, and `"Home"`.

- [ ] **Step 3: Update user-facing "Department(s)" labels to "Place(s)" in Settings & Advance Receipt**

1. `src/features/settings/ServiceFormSheet.tsx` (lines 171–179):
   - Change `label="Departments"` → `label="Places"`
   - Change `hint="Leave all ticked if offered in every department."` → `hint="Leave all ticked if offered in every place."`
   - Change `aria-label="Service departments"` → `aria-label="Service places"`
2. `src/features/settings/TeamSection.tsx` (lines 287–291):
   - Change `Departments <span className="font-normal">(optional — leave all unticked for every department)</span>` → `Places <span className="font-normal">(optional — leave all unticked for every place)</span>`
3. `src/features/settings/DepartmentHoursSection.tsx` (lines 38–39):
   - Change `"Each department follows your main clinic hours unless you set its own hours and slot length here."` → `"Each place follows your main clinic hours unless you set its own hours and slot length here."`
4. `src/features/invoices/AdvanceReceiptPrintPage.tsx` (line 97):
   - Change `<dt>Department</dt>` → `<dt>Place</dt>`

- [ ] **Step 4: Run tests for Task 1 and commit**

Run:
```bash
npx vitest run src/domain/departments.test.ts src/components/DepartmentSwitch.test.tsx src/features/patients/PatientProfilePage.test.tsx --maxWorkers=2
```
 update any test in `PatientProfilePage.test.tsx` or `ServiceFormSheet.test.tsx` that matched `'Home care'` or `'Departments'` to match `'Home'` / `'Places'`.
Commit:
```bash
git add src/domain/departments.ts src/domain/departments.test.ts src/components/DepartmentSwitch.tsx src/components/DepartmentSwitch.test.tsx src/features/settings/ServiceFormSheet.tsx src/features/settings/TeamSection.tsx src/features/settings/DepartmentHoursSection.tsx src/features/invoices/AdvanceReceiptPrintPage.tsx
git commit -m "feat(departments): refine terminology to Place/Places and compact Home label"
```

---

### Task 2: Database Migration & Inpatient / Rehab Billing Rules

**Files:**
- Create: `supabase/migrations/20261110010000_inpatient_wards_and_billing.sql`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/departmentMoney.ts`
- Modify: `src/domain/departmentMoney.test.ts`
- Modify: `src/components/visit/types.ts`
- Modify: `src/components/visit/VisitPaymentDisplay.tsx`
- Modify: `src/components/visit/VisitPaymentDisplay.test.tsx`
- Modify: `src/components/VisitCard.tsx`
- Modify: `src/components/visit/VisitRowActions.tsx`
- Modify: `src/features/visits/VisitLoggedCard.tsx`
- Modify: `src/features/visits/VisitLoggedCard.test.tsx`
- Modify: `src/features/visits/NewVisitPage.tsx`
- Modify: `src/features/patients/PatientAdmissionBar.tsx`
- Modify: `src/features/patients/PatientProfilePage.tsx`
- Modify: `src/features/workspace/TodayVisitsExtras.tsx`
- Modify: `src/features/workspace/WorkspacePage.tsx`
- Modify: `src/features/visits/LedgerPage.tsx`

- [ ] **Step 1: Write migration `supabase/migrations/20261110010000_inpatient_wards_and_billing.sql` and update `Clinic` type**

Create `supabase/migrations/20261110010000_inpatient_wards_and_billing.sql`:
```sql
-- Preset wards / rehab units and inpatient billing mode (whether the hospital/partner bills IP patients
-- or the clinic/rehab centre bills IP stays at discharge).
alter table public.clinics
  add column if not exists wards text[] null,
  add column if not exists ip_billed_by_partner boolean null;
```

In `src/domain/types.ts`, add to `export interface Clinic`:
```ts
  /** Preset ward or rehab unit names for Inpatient admissions (`clinics.wards`). null / absent = default presets. */
  wards?: string[] | null;
  /**
   * True when the hospital / partner bills inpatients and therapists only document sessions and rates (`clinics.ip_billed_by_partner`).
   * False when the clinic / rehab centre bills inpatient stays itself (at discharge or interim stay bill).
   * Null / absent falls back to `Boolean(hasPartner && partnerCollects)`.
   */
  ipBilledByPartner?: boolean | null;
```

- [ ] **Step 2: Add IP billing domain helpers in `src/domain/departmentMoney.ts` + tests in `src/domain/departmentMoney.test.ts`**

Add to `src/domain/departmentMoney.ts`:
```ts
/** True when a visit is an inpatient stay / ward session (never collected or invoiced per individual session). */
export function isInpatientVisit(
  visit: { location?: string | null; admissionId?: string | null } | null | undefined
): boolean {
  return departmentOf(visit) === 'ward';
}

/**
 * True when the hospital / partner bills inpatients and therapists only document service names and amounts.
 * Explicit `clinic.ipBilledByPartner` wins when set; otherwise defaults to `Boolean(clinic.hasPartner && clinic.partnerCollects)`.
 */
export function isIpBilledByPartner(
  clinic: { ipBilledByPartner?: boolean | null; hasPartner?: boolean; partnerCollects?: boolean } | null | undefined
): boolean {
  if (!clinic) return false;
  if (typeof clinic.ipBilledByPartner === 'boolean') return clinic.ipBilledByPartner;
  return Boolean(clinic.hasPartner && clinic.partnerCollects);
}

/**
 * True when the clinic / rehab centre issues its own inpatient stay / discharge bills.
 * False when the hospital / partner bills inpatients directly.
 */
export function canBillInpatientStay(
  clinic: { ipBilledByPartner?: boolean | null; hasPartner?: boolean; partnerCollects?: boolean } | null | undefined
): boolean {
  return !isIpBilledByPartner(clinic);
}

/** How an inpatient visit's billing status should be displayed on visit cards/tables, or null for OP/Home visits. */
export function inpatientVisitBillingMode(
  visit: { location?: string | null; admissionId?: string | null } | null | undefined,
  clinic: { ipBilledByPartner?: boolean | null; hasPartner?: boolean; partnerCollects?: boolean } | null | undefined
): 'stay_bill' | 'partner_billed' | null {
  if (!isInpatientVisit(visit)) return null;
  return isIpBilledByPartner(clinic) ? 'partner_billed' : 'stay_bill';
}
```

Add unit tests in `src/domain/departmentMoney.test.ts`:
```ts
import {
  isInpatientVisit,
  isIpBilledByPartner,
  canBillInpatientStay,
  inpatientVisitBillingMode,
} from './departmentMoney';

describe('inpatient billing rules', () => {
  it('identifies inpatient visits by ward location or admissionId', () => {
    expect(isInpatientVisit({ location: 'ward' })).toBe(true);
    expect(isInpatientVisit({ location: 'clinic', admissionId: 'adm-1' })).toBe(true);
    expect(isInpatientVisit({ location: 'clinic' })).toBe(false);
    expect(isInpatientVisit({ location: 'home' })).toBe(false);
  });

  it('resolves whether hospital partner bills inpatients vs clinic stay billing', () => {
    expect(isIpBilledByPartner({ hasPartner: false, partnerCollects: false })).toBe(false);
    expect(isIpBilledByPartner({ hasPartner: true, partnerCollects: true })).toBe(true);
    expect(isIpBilledByPartner({ hasPartner: false, partnerCollects: false, ipBilledByPartner: true })).toBe(true);
    expect(isIpBilledByPartner({ hasPartner: true, partnerCollects: true, ipBilledByPartner: false })).toBe(false);
    expect(canBillInpatientStay({ ipBilledByPartner: false })).toBe(true);
    expect(canBillInpatientStay({ ipBilledByPartner: true })).toBe(false);
  });

  it('returns stay_bill or partner_billed for ward visits and null for OP/Home', () => {
    expect(inpatientVisitBillingMode({ location: 'clinic' }, { ipBilledByPartner: false })).toBeNull();
    expect(inpatientVisitBillingMode({ location: 'ward' }, { ipBilledByPartner: false })).toBe('stay_bill');
    expect(inpatientVisitBillingMode({ location: 'ward' }, { ipBilledByPartner: true })).toBe('partner_billed');
  });
});
```

- [ ] **Step 3: Suppress per-session collection/invoicing on `VisitCardData`, `PaymentStatusDisplay`, `SharedVisitCard`, and `RowActionsMenu`**

1. In `src/components/visit/types.ts`, add to `VisitCardData`:
```ts
  /**
   * Set on inpatient (`ward`) visits, which are never collected or invoiced per individual session:
   * - `'stay_bill'`: clinic/rehab centre bills the stay in a batch (at discharge or interim stay bill).
   * - `'partner_billed'`: hospital/partner bills the patient; therapists only log sessions and rates.
   */
  inpatientBilling?: 'stay_bill' | 'partner_billed' | null;
```

2. In `src/components/visit/VisitPaymentDisplay.tsx`:
   - When `data.inpatientBilling` is set, `effectiveCanCollect` must be `false` (no per-session `Collect ₹X` button and no `Ask billing` secondary pill).
   - When `data.inpatientBilling === 'partner_billed'`, render `<Pill tone="slate"><span className="whitespace-nowrap" title="Logged for hospital / partner billing">Logged</span></Pill>`.
   - When `data.inpatientBilling === 'stay_bill'` and `!data.invoiceId`, render `<Pill tone="slate"><span className="whitespace-nowrap" title="Included on the inpatient stay / discharge bill">On stay bill</span></Pill>`.
   - When `data.inpatientBilling === 'stay_bill'` and `data.invoiceId` is present, render the normal invoice status pill (`Invoiced` / `Paid` + `🔒` + `<VisitBillLink data={data} />`).
   - Also hide the `!canCollect && paymentActions(data.paymentState).length > 0` (`Ask billing`) pill whenever `Boolean(data.inpatientBilling)`.

3. In `src/components/VisitCard.tsx` (`SharedVisitCard`):
   - Mirror the exact same `data.inpatientBilling` display as `PaymentStatusDisplay.tsx` so mobile cards and desktop tables match 100%.

4. In `src/components/visit/VisitRowActions.tsx` (`RowActionsMenu`):
   - Update `canIssueInvoice` and `showReminder` so both are `false` when `Boolean(data.inpatientBilling)`:
```ts
  const isInpatient = Boolean(data.inpatientBilling);
  const canIssueInvoice =
    !isInpatient &&
    Boolean(canInvoice) &&
    Boolean(onInvoice) &&
    paymentActions(data.paymentState).includes('issue_invoice') &&
    !isFullyPartnerCollected(data.billPaise, data.partnerCollectedPaise);
  const showReminder = !isInpatient && Boolean(canCollect) && paymentActions(data.paymentState).includes('take_payment');
```

5. Add tests in `src/components/visit/VisitPaymentDisplay.test.tsx` verifying that `inpatientBilling: 'stay_bill'` renders `"On stay bill"` (without `Collect ₹X` or `Ask billing`) and `inpatientBilling: 'partner_billed'` renders `"Logged"`.

- [ ] **Step 4: Suppress per-session payment/bill CTAs on `VisitLoggedCard.tsx` and `NewVisitPage.tsx`**

1. In `src/features/visits/VisitLoggedCard.tsx`:
   - Add `inpatientBilling?: 'stay_bill' | 'partner_billed' | null;` to `SavedVisitInfo`.
   - In the status pill block (lines 230–271), check `justSaved.inpatientBilling` before `paymentDue > 0`:
```tsx
          {justSaved.inpatientBilling === 'partner_billed' ? (
            <span
              className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--slate-light)] px-2.5 py-1 text-xs font-medium text-[var(--ink)]"
              data-testid="inpatient-logged-line"
            >
              ✓ Session logged · {formatAmount(justSaved.billPaise)}
            </span>
          ) : justSaved.inpatientBilling === 'stay_bill' ? (
            <span
              className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--teal-light)] px-2.5 py-1 text-xs font-medium text-[var(--teal-strong)]"
              data-testid="inpatient-stay-bill-line"
            >
              ✓ Added to stay bill · {formatAmount(justSaved.billPaise)}
            </span>
          ) : paymentDue > 0 ? (
```
2. In `src/features/visits/NewVisitPage.tsx`:
   - Import `inpatientVisitBillingMode` from `@/domain/departmentMoney`.
   - When constructing `setJustSaved({...})` (around line 1177), pass:
     `inpatientBilling: inpatientVisitBillingMode({ location: effectiveLocation, admissionId: activeAdmission?.id ?? null }, clinic),`
   - In the `if (justSaved)` block (lines 1224–1255):
     - If `justSaved.inpatientBilling` is set, set `paymentDue = 0` and `showBill = false` so `VisitLoggedCard` never promotes `Take payment` or `Give bill` on an inpatient round.
   - Also when clicking `Another visit` (`onNewVisitSamePatient`, line 1285), preserve `admissionId: search.admissionId` in `navigate({ to: '/visits/new', search: ... })` so logging a second session for the same admitted patient stays linked to the stay.

3. Add tests in `src/features/visits/VisitLoggedCard.test.tsx` verifying both `inpatientBilling: 'stay_bill'` and `inpatientBilling: 'partner_billed'`.

- [ ] **Step 5: Wire IP billing rules into `PatientAdmissionBar`, `PatientProfilePage`, `WorkspacePage`, `TodayVisitsExtras`, and `LedgerPage`**

1. **`src/features/patients/PatientAdmissionBar.tsx`:**
   - Import `canBillInpatientStay` from `@/domain/departmentMoney`.
   - Define `const canBillStay = canBill && canBillInpatientStay(clinic);`.
   - Replace `canBill` with `canBillStay` on lines 63, 106, and 128 so `Bill this stay` and the discharge bill prompt (`offerDischargeBill`) only appear when the clinic/rehab bills stays (`!isIpBilledByPartner(clinic)`).

2. **`src/features/patients/PatientProfilePage.tsx`:**
   - Import `canBillInpatientStay, inpatientVisitBillingMode, isInpatientVisit` from `@/domain/departmentMoney`.
   - Define `const ipCanBill = department !== 'ward' || canBillInpatientStay(clinic);`.
   - Gate `showInvoicesTab` on `ipCanBill`: `const showInvoicesTab = invoicingOnPlan && invoiceRoleOk && ipCanBill;`.
   - Gate the `Record advance` button and `PatientAdvancesStrip` in `ward` mode on `ipCanBill`.
   - In `visitCardRows` (around line 390):
     - Add `inpatientBilling: inpatientVisitBillingMode(v, clinic),`
     - Set `canCollect: canCollectPayment && inDepartment(department, v) && !isInpatientVisit(v),`
   - In `canSelectVisits` (bulk visit selection for invoicing): disable selection in `ward` when `!ipCanBill`.

3. **`src/features/workspace/TodayVisitsExtras.tsx` & `src/features/workspace/WorkspacePage.tsx`:**
   - In `TodayVisitsExtras.tsx`, add optional prop `inpatientBillingMode?: 'stay_bill' | 'partner_billed' | null` to `TodayVisitsTotals`:
     - When `inpatientBillingMode === 'partner_billed'`, render `Visits {totals.visits}` and (if `showMoney`) `Logged {formatAmount(totals.billedPaise)}` (no `Paid` or red `Due`).
     - When `inpatientBillingMode === 'stay_bill'`, render `Visits {totals.visits}` and (if `showMoney`) `On stay bill {formatAmount(totals.billedPaise)}` (no per-session `Paid` or red `Due`).
   - In `WorkspacePage.tsx`:
     - Import `canBillInpatientStay, inpatientVisitBillingMode` from `@/domain/departmentMoney`.
     - Pass `inpatientBilling: inpatientVisitBillingMode({ location: row.location }, clinic)` and `canCollect: row.location === 'ward' ? false : undefined` inside `todayRowToCardData` (passing `inpatientBilling` as a parameter to `todayRowToCardData`).
     - For `statCells` when `department === 'ward'` (around line 805):
       - If `!canBillInpatientStay(clinic)` (hospital bills IP), show `[runningChargesCell]` (with label `Logged on stays · N stays` or `Logged on stays`) when `showDues` is true, and `[]` otherwise — do not show `₹0 Collected`.
       - If `canBillInpatientStay(clinic)` (clinic/rehab bills IP stays), keep `[collectedCell, runningChargesCell]`.
     - Pass `inpatientBillingMode={department === 'ward' ? (canBillInpatientStay(clinic) ? 'stay_bill' : 'partner_billed') : null}` to `<TodayVisitsTotals />`.

4. **`src/features/visits/LedgerPage.tsx`:**
   - Import `canBillInpatientStay, inpatientVisitBillingMode` from `@/domain/departmentMoney`.
   - In `filterLedgerTabs`, accept `hideBillingTabs?: boolean`; when `department === 'ward' && !canBillInpatientStay(clinic)`, hide the `'invoices'` and `'daybook'` tabs.
   - In `visitToCardData`, set:
     - `inpatientBilling: inpatientVisitBillingMode(v, clinic),`
     - `canCollect: departmentOf(v) === 'ward' ? false : undefined,`
   - When `department === 'ward'`:
     - Hide the `Collected, no invoice` and `Not collected` filter checkboxes in the Filters drawer (lines 998–1015).
     - Gate the `Unpaid invoices` section card (line 1038) on `canBillInpatientStay(clinic)`.
     - In the sticky bottom summary bar (lines 1246–1328): when `department === 'ward'`, instead of rendering `DueToggle` (`Due ₹3,000 (3)`), render:
       - If `canBillInpatientStay(clinic)`: `On stay bill {formatAmount(totals.outstanding)}` (calm text, not a red `Due` toggle).
       - If `!canBillInpatientStay(clinic)`: `Logged {formatAmount(totals.bill)}`.

- [ ] **Step 6: Run tests and typecheck for Task 2 and commit**

Run:
```bash
npx vitest run src/domain/departmentMoney.test.ts src/components/visit/VisitPaymentDisplay.test.tsx src/features/visits/VisitLoggedCard.test.tsx --maxWorkers=2
npm run check:fast
```
Commit:
```bash
git add supabase/migrations/20261110010000_inpatient_wards_and_billing.sql src/domain/types.ts src/domain/departmentMoney.ts src/domain/departmentMoney.test.ts src/components/visit/types.ts src/components/visit/VisitPaymentDisplay.tsx src/components/visit/VisitPaymentDisplay.test.tsx src/components/VisitCard.tsx src/components/visit/VisitRowActions.tsx src/features/visits/VisitLoggedCard.tsx src/features/visits/VisitLoggedCard.test.tsx src/features/visits/NewVisitPage.tsx src/features/patients/PatientAdmissionBar.tsx src/features/patients/PatientProfilePage.tsx src/features/workspace/TodayVisitsExtras.tsx src/features/workspace/WorkspacePage.tsx src/features/visits/LedgerPage.tsx
git commit -m "feat(inpatient): suppress per-session collection in IP and support hospital vs stay billing"
```

---

### Task 3: Structured Ward / Unit + Bed / Room Split & Preset Wards in Settings (Hospital & Rehab Setups)

**Files:**
- Modify: `src/domain/admissions.ts`
- Modify: `src/domain/admissions.test.ts`
- Modify: `src/features/settings/ClinicSections.tsx`
- Modify: `src/features/patients/AdmissionSheet.tsx`

- [ ] **Step 1: Add `DEFAULT_PRESET_WARDS`, `clinicWards`, `splitWardBed`, and `joinWardBed` to `src/domain/admissions.ts` + unit tests**

In `src/domain/admissions.ts`, add:
```ts
/** Default ward & rehab unit presets covering both hospital wards and rehabilitation centres. */
export const DEFAULT_PRESET_WARDS: readonly string[] = [
  'General',
  'Ortho',
  'Neuro',
  'ICU',
  'Private',
  'Rehab Wing',
];

/**
 * The clinic's configured ward / unit presets (or `DEFAULT_PRESET_WARDS` when unset),
 * merged case-insensitively with any wards already used on open stays so existing custom wards always appear.
 */
export function clinicWards(
  clinic: { wards?: readonly string[] | null } | null | undefined,
  stays: readonly { wardBed?: string | null }[] = []
): string[] {
  const base = clinic?.wards && clinic.wards.length > 0 ? clinic.wards : DEFAULT_PRESET_WARDS;
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };
  for (const w of base) add(w);
  for (const s of stays) {
    const { ward } = splitWardBed(s.wardBed);
    if (ward) add(ward);
  }
  return out;
}

/**
 * Splits a stored `ward_bed` string into structured `{ ward, bed }` parts:
 * - `"Ortho, Bed 12"` -> `{ ward: "Ortho", bed: "Bed 12" }`
 * - `"Neuro - Room 204"` -> `{ ward: "Neuro", bed: "Room 204" }`
 * - `"ICU Bed 3"` -> `{ ward: "ICU", bed: "Bed 3" }`
 * - `"Bed 12"` or `"Room 101"` -> `{ ward: "", bed: "Bed 12" }` / `{ ward: "", bed: "Room 101" }`
 * - `"Ortho"` -> `{ ward: "Ortho", bed: "" }`
 */
export function splitWardBed(wardBed: string | null | undefined): { ward: string; bed: string } {
  const text = (wardBed ?? '').trim();
  if (!text) return { ward: '', bed: '' };
  if (text.includes(',')) {
    const [first, ...rest] = text.split(',');
    return { ward: first.trim(), bed: rest.join(',').trim() };
  }
  if (/^(bed|room|suite|cabin)\b/i.test(text)) {
    return { ward: '', bed: text };
  }
  const trailingMatch = text.match(/^(.*?)\s*[-–·]?\s*((?:bed|room|suite|cabin)\s*\S+.*)$/i);
  if (trailingMatch && trailingMatch[1].trim()) {
    return { ward: trailingMatch[1].trim(), bed: trailingMatch[2].trim() };
  }
  return { ward: text, bed: '' };
}

/** Joins structured `ward` and `bed` inputs back into the single `ward_bed` string stored in Postgres. */
export function joinWardBed(ward: string | null | undefined, bed: string | null | undefined): string {
  const w = (ward ?? '').trim();
  const b = (bed ?? '').trim();
  if (w && b) return `${w}, ${b}`;
  return w || b;
}
```
Also update `wardOf(wardBed)` in `src/domain/admissions.ts` to use `splitWardBed(wardBed)`:
```ts
export function wardOf(wardBed: string | null | undefined): { key: string; label: string } {
  const { ward } = splitWardBed(wardBed);
  if (!ward) return { key: '', label: 'No ward set' };
  return { key: ward.toLowerCase(), label: ward };
}
```

Add comprehensive tests in `src/domain/admissions.test.ts` for `splitWardBed`, `joinWardBed`, `clinicWards`, and `wardOf`.

- [ ] **Step 2: Add Ward / Unit Preset Editor & IP Billing Switch in `CareLocationsSection` (`src/features/settings/ClinicSections.tsx`)**

In `src/features/settings/ClinicSections.tsx`, update `CareLocationsSection`:
- Expand `CareLocationFields` to `Pick<Clinic, 'careLocations' | 'wards' | 'ipBilledByPartner'>`.
- When `on.includes('ward')` is true, render an indented configuration box under the Inpatient toggle with:
  1. **Who bills inpatients (`ipBilledByPartner`):**
     - Radio/select or `SwitchRow`:
       - **We bill inpatients (stay / discharge bill)** (`ipBilledByPartner: false`) — *"Sessions accumulate on the stay and are billed together at discharge or interim."*
       - **Hospital / partner bills inpatients** (`ipBilledByPartner: true`) — *"Therapists only log sessions and rates; invoice and payment collection options are hidden in IP."*
  2. **Wards / rehab units (`wards`):**
     - Displays current ward/unit chips (`clinicWards(form)`) with an `×` button to remove a ward, a small text input + `Add` button to add a custom ward/unit (e.g. `Neuro Rehab`, `Deluxe Suite`, `Step-down`), and quick-add buttons for any default hospital/rehab presets not yet in the list.
     - Only include `wards` and `ipBilledByPartner` in the form payload when edited or already present on `clinic` (defensive against unapplied migration).

- [ ] **Step 3: Split `Ward / unit` and `Bed / room` in `src/features/patients/AdmissionSheet.tsx`**

In `src/features/patients/AdmissionSheet.tsx`:
- Read `clinic` via `useClinic()` and open stays via `useLiveQuery(() => repos.admissions.listOpen(clinic.id), [clinic.id])`.
- Compute `const wardOptions = clinicWards(clinic, openStays ?? []);`.
- Initialize `const initialSplit = splitWardBed(stay?.wardBed);` and track `wardChoice` (selected preset or `'__custom__'` if typing a new ward) + `customWard` + `bedRoom`.
- Whenever `wardChoice`, `customWard`, or `bedRoom` changes, update `form.wardBed = joinWardBed(wardChoice === '__custom__' ? customWard : wardChoice, bedRoom)`.
- Render:
  - **Ward / unit (optional)** `<select id="admission-ward">` with `<option value="">Not set</option>`, each `w` in `wardOptions`, and `<option value="__custom__">+ Custom ward / unit…</option>`. When `'__custom__'` is chosen, show a text input right below (`placeholder="e.g. Neuro Rehab, 3rd Floor"`).
  - **Bed / room (optional)** `<input id="admission-bed" placeholder="e.g. Bed 12, Room 204" />`.
  - **IPD / Stay no (optional)** `<input id="admission-ipd" />`.

- [ ] **Step 4: Run tests for Task 3 and commit**

Run:
```bash
npx vitest run src/domain/admissions.test.ts --maxWorkers=2
npm run check:fast
```
Commit:
```bash
git add src/domain/admissions.ts src/domain/admissions.test.ts src/features/settings/ClinicSections.tsx src/features/patients/AdmissionSheet.tsx
git commit -m "feat(inpatient): split ward/unit and bed/room with configurable hospital and rehab presets"
```

---

### Task 4: Complete Redesign of `InpatientsCard` on Workspace

**Files:**
- Modify: `src/features/workspace/InpatientsCard.tsx`
- Create: `src/features/workspace/InpatientsCard.test.tsx`
- Modify: `src/features/workspace/WorkspacePage.tsx`

- [ ] **Step 1: Redesign `src/features/workspace/InpatientsCard.tsx`**

Update `InpatientsCard` to accept optional `{ viewTherapistId?: string }` from `WorkspacePage` and include:
1. **Live Query:** Fetch `stays` (`repos.admissions.listOpen(clinic.id)`), `patients` (`repos.patients.list(clinic.id)`), `therapists` (`repos.therapists.list(clinic.id, true)`), `appointments` (`repos.appointments.listByClinic(clinic.id)`), and `visits` for the admitted patients.
2. **Per-stay computed row:**
   - `ward`: `wardOf(stay.wardBed)` (`{ key, label }`)
   - `bed`: `splitWardBed(stay.wardBed).bed` (de-duplicated so the ward name is never repeated under the patient's name!)
   - `day`: `dayOfStay(stay.admittedOn, today)`
   - `todaySessions`: sessions with `visitDate === today`
   - `seenByNames`: unique therapist first names who saw the patient today
   - `unbilledSessions`: sessions with `!v.invoiceId`
   - `unbilledPaise`: sum of `actualBillPaise` across `unbilledSessions`
   - `nextRoundTime`: earliest today `'ward'` appointment for `stay.patientId` with `status === 'confirmed' || status === 'rescheduled'` (formatted as `HH:MM`, e.g. `Next round 08:30`, completing Step 5 of `2026-11-08-departments.md`).
   - `matchesMine`: when `viewTherapistId` is passed (`Mine` filter active on Workspace), keep stays where the patient has any session or today's appointment with `viewTherapistId`, OR stays with `0` sessions so newly admitted patients are never hidden before their first round!
3. **Ward Filter Bar:**
   - When `groups.length > 1`, render a horizontal filter chip strip at the top of the card:
     `All ({filteredRows.length})` + `{g.label} ({g.rows.length})` using `filterChip(active)` and `ChipCount`.
4. **Rich, Scannable Row Layout:**
   - **Line 1:**
     - Patient name link (`/patients/$patientId`)
     - If `bed` is present: `<Pill tone="slate">{bed}</Pill>` (e.g. `Bed 12` or `Room 204`)
     - `<Pill tone="slate">Day {day}</Pill>`
     - Status badge:
       - If `seenToday > 0`: `<Pill tone="green">Seen today{seenByNames.length > 0 ? ` · ${seenByNames.join(', ')}` : ''}{seenToday > 1 ? ` (${seenToday})` : ''}</Pill>`
       - Else if `nextRoundTime`: `<Pill tone="teal">Next round {nextRoundTime}</Pill>`
       - Else: `<Pill tone="amber">Pending round</Pill>`
   - **Line 2 (compact metadata):**
     - Joins non-empty items with ` · `:
       - `stay.ipdNo && \`IPD ${stay.ipdNo}\``
       - `stay.admittingDoctor && \`Dr. ${stay.admittingDoctor.replace(/^Dr\.?\s*/i, '')}\``
       - `patient.primaryCondition || lastSession?.condition`
       - `unbilledSessions.length > 0 && \`${unbilledSessions.length} session${unbilledSessions.length === 1 ? '' : 's'} · ${formatAmount(unbilledPaise)}\``
   - **Right-side Actions:**
     - Quiet **`Edit stay`** button (`pillNeutral`) that opens `<AdmissionSheet open stay={stay} patient={patient} />` directly on Workspace (1-tap bed/ward assignment or transfer).
     - When `canBill && canBillInpatientStay(clinic) && unbilledSessions.length > 0 && unbilledPaise > 0`: quiet **`Bill stay`** button (`pillNeutral`) that opens `<IssueInvoiceDialog />` for the stay's unbilled sessions.
     - Primary CTA: `<Link to="/visits/new" search={{ patientId: patient.id, admissionId: stay.id, from: '/workspace', ...(lastVisitId ? { repeatVisitId: lastVisitId } : {}) }} className={seenToday > 0 ? pillNeutral : pillAccent}>{seenToday > 0 ? '+ Log another' : '+ Log session'}</Link>`.

- [ ] **Step 2: Pass `viewTherapistId={viewTherapistId}` to `<InpatientsCard />` in `src/features/workspace/WorkspacePage.tsx`**

In `src/features/workspace/WorkspacePage.tsx` (line 1257):
```tsx
{department === 'ward' && <InpatientsCard viewTherapistId={viewTherapistId} />}
```

- [ ] **Step 3: Create `src/features/workspace/InpatientsCard.test.tsx` and run tests**

Write unit/component tests in `src/features/workspace/InpatientsCard.test.tsx` covering:
1. Grouping by ward, rendering de-duplicated `Bed 12` and `Day 2` pills (without repeating `"Ortho"` under the patient name), and filtering by ward chip.
2. Displaying `Next round 08:30` when an upcoming ward appointment exists today and `Seen today · Prem` once a session is logged today.
3. Opening `Edit stay` (`AdmissionSheet`) inline from a row, and showing `Bill stay` when `canBillInpatientStay(clinic)` is true vs hiding `Bill stay` when `ipBilledByPartner` is true.

Run:
```bash
npx vitest run src/features/workspace/InpatientsCard.test.tsx --maxWorkers=2
npm run check:fast
```
Commit:
```bash
git add src/features/workspace/InpatientsCard.tsx src/features/workspace/InpatientsCard.test.tsx src/features/workspace/WorkspacePage.tsx
git commit -m "feat(workspace): redesign InpatientsCard with ward chips, bed pills, next round, and inline actions"
```

---

### Task 5: Un-Cramp Header Navigation & Unify `AccountMenu` + `ClinicSwitcher`

**Files:**
- Modify: `src/app/Shell.tsx`
- Modify: `src/app/AccountMenu.tsx`
- Modify: `src/app/Shell.test.tsx` (or related nav tests)
- Modify: `FEATURES_AND_SCHEMA.md`

- [ ] **Step 1: Remove `Settings` from desktop `NAV` and remove standalone `<ClinicSwitcher />` from `src/app/Shell.tsx`**

1. In `src/app/Shell.tsx`:
   - Update `NAV` (lines 63–69) to remove `{ to: '/settings', label: 'Settings', Icon: IconSettings }`:
```ts
export const NAV = [
  { to: '/workspace', label: 'Workspace', Icon: IconWorkspace },
  { to: '/schedule', label: 'Schedule', Icon: IconCalendar },
  { to: '/ledger', label: 'Ledger', Icon: IconLedger },
  { to: '/insights', label: 'Reports', Icon: IconReports },
] as const;
```
   - Simplify `filterNavItems(role: string)`:
```ts
export function filterNavItems(role: string) {
  return NAV.filter(
    (item) =>
      (item.to !== '/schedule' || role !== 'unknown') &&
      (item.to !== '/insights' || role === 'admin' || role === 'front_desk')
  );
}
```
   - In the `<header>` right-side cluster (lines 483–518), remove `<div className="flex min-w-0 justify-end"><ClinicSwitcher ... /></div>` and pass `clinics={clinics ?? []}`, `logoUrl={logoUrl}`, and `active={pathname.startsWith('/settings') || pathname.startsWith('/setup')}` to `<AccountMenu />`.

- [ ] **Step 2: Integrate Clinic Identity, `Clinic settings`, and Clinic Switching into `src/app/AccountMenu.tsx`**

In `src/app/AccountMenu.tsx`:
1. Accept new optional props:
   - `clinics?: Clinic[];`
   - `logoUrl?: string | null;`
2. Update the trigger button in the header to show the user's avatar + (on `desktop:`) their name and clinic name subtitle (or a subtle chevron) so the header stays compact on all screen widths (`360px` phone, `768px` iPad, `120%` zoomed desktop).
3. Inside the `AccountMenu` dropdown/sheet:
   - **Top Identity Card (`bg-[var(--paper)]`):**
     - User avatar, `name`, and `roleLabel` (`Admin`, `Front desk`, `Therapist`).
     - Active clinic badge row showing clinic logo/initial + `clinic.name`.
     - `SetupProgressBar` (for admin).
   - **Clinic Administration & Switching Section (for `role === 'admin'` or `(clinics?.length ?? 0) > 1`):**
     - When `role === 'admin'`: a **`Clinic settings`** menu item (`Link to="/settings"`) with `IconSettings` and subtitle `"Profile, places, team, billing"`.
     - When `(clinics?.length ?? 0) > 1`: list the user's clinics (`role="menuitemradio"`) to switch clinics with 1 tap (`setActiveClinic(c.id)` + `navigate({ to: '/workspace' })`).
     - When `role === 'admin'`: a **`+ Add another clinic`** menu item that opens `<AddClinicDialog />`.
   - Keep all existing personal items (`My account`, `My working hours`, `Notifications`, `InstallPrompt`, `Help & feedback`, `Sign out`, `Refresh app`).

- [ ] **Step 3: Update `FEATURES_AND_SCHEMA.md` and run full verification**

1. Update `FEATURES_AND_SCHEMA.md` to document:
   - Short place labels (`OP` · `Home` · `IP`) and `Place` / `Places` UI wording.
   - `clinics.wards` (`text[]`) and `clinics.ip_billed_by_partner` (`boolean`) columns.
   - Inpatient & Rehab billing rules (no per-session collection; hospital-billed IP vs. clinic stay-billed IP).
   - Structured `Ward / unit` + `Bed / room` in `AdmissionSheet` and the redesigned `InpatientsCard`.
   - Header navigation (`Workspace`, `Schedule`, `Ledger`, `Reports`) and unified `AccountMenu` (with `Clinic settings` and clinic switching).
2. Run verification suite:
```bash
npm run check:fast
npx vitest run src/app/ src/components/ src/domain/ src/features/workspace/ src/features/visits/ --maxWorkers=2
```
3. Commit:
```bash
git add src/app/Shell.tsx src/app/AccountMenu.tsx FEATURES_AND_SCHEMA.md
git commit -m "feat(nav): move ClinicSwitcher and Settings into AccountMenu and update docs"
```

