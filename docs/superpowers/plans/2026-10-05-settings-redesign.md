# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the monolithic Settings page into a modular, router-based layout with a left sidebar navigation to match the premium mockup, grouping settings into General, Team, Billing & Plans, and Advanced.

**Architecture:** We will convert `SettingsPage.tsx` into a layout component (`SettingsLayout.tsx`) holding the left sidebar. The individual setting sections will be extracted into separate files (`GeneralSettings.tsx`, `TeamSettings.tsx`, `BillingSettings.tsx`, `AdvancedSettings.tsx`) and wired as child routes in `@tanstack/react-router`. Legacy query parameter tabs will be replaced with clean URL paths (`/settings/general`, `/settings/team`, etc.), with a redirect from `/settings` to `/settings/general`.

**Tech Stack:** React, `@tanstack/react-router`, TailwindCSS

**Spec:** The design mockup dictates a vertical sidebar ("General", "Team", "Billing & Plans", "Advanced") alongside content cards on a slightly off-white background.

## Global Constraints

- Retain existing form submission and validation logic from `SettingsPage.tsx`.
- Follow existing codebase UI component patterns (`SectionCard`, `Field`, `Input`, `btnPrimary`).
- Use existing Tailwind styling patterns.

## Review Focus

- The deep link to `/settings?tab=team` from elsewhere in the app (like `WorkspacePage.tsx` fallback) must correctly resolve or redirect to `/settings/team`.
- The 'unsaved changes' dirty state guards (`SectionSaveBar`) must work properly within each child route independently.
- The permissions logic (e.g. `isClinicWideView`, `canEditSettings`) must appropriately guard the routes or redirect to `/workspace`.

---

### Task 1: Setup Settings Layout and Routing

**Files:**
- Create: `src/features/settings/SettingsLayout.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Produces: `SettingsLayout` component holding the sidebar and `<Outlet />`.
- Produces: Base routes `/settings/general`, `/settings/team`, `/settings/billing`, `/settings/advanced`.

- [ ] **Step 1: Create `SettingsLayout.tsx` with sidebar**
```tsx
// Implement the sidebar layout matching the mockup
// Use <Link> from @tanstack/react-router for navigation
// Render <Outlet /> for child content
```

- [ ] **Step 2: Update `router.tsx` to define nested routes**
Modify `settingsRoute` to act as a parent using `SettingsLayout`. Add placeholder child routes for General, Team, Billing, and Advanced.
```tsx
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsLayout,
});
// Add settingsGeneralRoute, settingsTeamRoute, etc.
```

- [ ] **Step 3: Handle legacy tab redirects in `router.tsx`**
Ensure that the root `/settings` redirects to `/settings/general`, and that passing `?tab=team` redirects to `/settings/team` to preserve backward compatibility.

- [ ] **Step 4: Commit**
```bash
git add src/features/settings/SettingsLayout.tsx src/app/router.tsx
git commit -m "feat: setup settings layout and nested routing"
```

### Task 2: Extract General Settings

**Files:**
- Create: `src/features/settings/GeneralSettings.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: `ClinicProfileSection`, `PatientCommsSection` logic from legacy `SettingsPage.tsx`.

- [ ] **Step 1: Move Clinic Profile and Comms logic**
Create `GeneralSettings.tsx`. Copy the `ClinicProfileSection` and `PatientCommsSection` functions and their dependencies from `SettingsPage.tsx`.

- [ ] **Step 2: Combine into a single page view**
Export a default `GeneralSettings` component that renders both sections vertically with nice spacing.

- [ ] **Step 3: Wire up in `router.tsx`**
Import `GeneralSettings` and attach it to `settingsGeneralRoute`.

- [ ] **Step 4: Commit**
```bash
git add src/features/settings/GeneralSettings.tsx src/app/router.tsx
git commit -m "feat: extract General Settings page"
```

### Task 3: Extract Team Settings

**Files:**
- Create: `src/features/settings/TeamSettings.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: `TeamSection` logic from legacy `SettingsPage.tsx`.

- [ ] **Step 1: Move Team logic**
Create `TeamSettings.tsx`. Copy the `TeamSection` function and its dependencies.

- [ ] **Step 2: Wire up in `router.tsx`**
Import `TeamSettings` and attach it to `settingsTeamRoute`.

- [ ] **Step 3: Commit**
```bash
git add src/features/settings/TeamSettings.tsx src/app/router.tsx
git commit -m "feat: extract Team Settings page"
```

### Task 4: Extract Billing & Plans Settings

**Files:**
- Create: `src/features/settings/BillingSettings.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: `BillingSection`, `PartnerSection`, and `PlanSection` logic from legacy `SettingsPage.tsx`.

- [ ] **Step 1: Move Billing logic**
Create `BillingSettings.tsx`. Copy the `BillingSection`, `PartnerSection`, and `PlanSection` functions and their dependencies.

- [ ] **Step 2: Combine into a single page view**
Export a default `BillingSettings` component that renders these sections.

- [ ] **Step 3: Wire up in `router.tsx`**
Import `BillingSettings` and attach it to `settingsBillingRoute`.

- [ ] **Step 4: Commit**
```bash
git add src/features/settings/BillingSettings.tsx src/app/router.tsx
git commit -m "feat: extract Billing Settings page"
```

### Task 5: Extract Advanced Settings & Cleanup

**Files:**
- Create: `src/features/settings/AdvancedSettings.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/features/settings/SettingsPage.tsx` (Delete it)

**Interfaces:**
- Consumes: `CatalogSection`, `DataSection` logic from legacy `SettingsPage.tsx`.

- [ ] **Step 1: Move Advanced logic**
Create `AdvancedSettings.tsx`. Copy the `CatalogSection` and `DataSection` functions and their dependencies.

- [ ] **Step 2: Wire up in `router.tsx`**
Import `AdvancedSettings` and attach it to `settingsAdvancedRoute`.

- [ ] **Step 3: Delete legacy monolith**
Delete `src/features/settings/SettingsPage.tsx` as all its sections have now been successfully extracted. Update any dangling imports in the app that referenced `SettingsPage.tsx`.

- [ ] **Step 4: Verify navigation**
Run the dev server and verify that clicking through the sidebar correctly loads all the sub-pages without errors.

- [ ] **Step 5: Commit**
```bash
git rm src/features/settings/SettingsPage.tsx
git add src/features/settings/AdvancedSettings.tsx src/app/router.tsx
git commit -m "feat: extract Advanced Settings and remove legacy monolith"
```
