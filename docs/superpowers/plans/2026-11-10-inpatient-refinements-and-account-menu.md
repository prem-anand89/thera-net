# Inpatient Refinements and Account Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 4 targeted UX and terminology refinements: rename "On stay bill" to "IP Bill" and eliminate duplicate billed amounts in the Ledger footer, hide the Unpaid Invoices card on the Ledger Visits tab in ward mode, hide the Follow up (Reviews & Packages) card on the Workspace in ward mode, and collapse the clinic switcher inside `AccountMenu` into a sleek collapsible dropdown under the profile header.

**Architecture:** Client-only UI refinements in React/TypeScript following existing design patterns: standard CSS variables, defensive fallbacks, and clean separation between Outpatient/Home and Inpatient modes.

**Tech Stack:** React 18, TanStack Router, Vitest, Tailwind CSS with CSS custom properties.

**Spec:** User feedback from screenshots on 2026-11-10 (`media_1794259693651_7987c0fa.png`, `media_1794259770793_acdd3a1f.png`, `media_1794259862979_ef4db446.png`).

## Global Constraints

- CSS colors must use existing CSS custom properties (e.g. `var(--teal)`, `var(--ink)`, `var(--border)`, `var(--surface)`, `var(--paper)`, `var(--muted)`). Never hardcode hex values.
- Every `<button>` must have an explicit `type` attribute.
- No new npm dependencies.
- Defensive coding: no breaking changes to outpatient or home care flows.
- Maintain documentation in `FEATURES_AND_SCHEMA.md`.

## Review Focus

1. **Terminology consistency:** Every user-facing instance of "On stay bill" changed to "IP Bill" (or "Added to IP bill" in success card).
2. **Ledger IP totals bar:** In ward mode with clinic billing, footer must show `IP Bill ₹X` without redundant `Billed ₹X · IP Bill ₹X` duplicate text.
3. **Ledger Visits tab in Ward mode:** The "Unpaid invoices" card must not appear on the Visits tab in ward mode (stay invoices live on the Invoices tab).
4. **Workspace Follow up card:** Outpatient review schedule and package tracking must be hidden in ward mode.
5. **AccountMenu collapsible dropdown:** Clinics list is collapsed by default; clicking the active clinic toggle expands/collapses smoothly, preserving "Clinic settings" and other actions.

---

### Task 1: Rename "On stay bill" to "IP Bill" and De-duplicate Ledger IP Totals

**Files:**
- Modify: `src/components/VisitCard.tsx:255-265`
- Modify: `src/components/visit/VisitPaymentDisplay.tsx:115-125`
- Modify: `src/features/visits/VisitLoggedCard.tsx:240-250`
- Modify: `src/features/workspace/TodayVisitsExtras.tsx:65-72`
- Modify: `src/features/visits/LedgerPage.tsx:1265-1355`
- Test: `src/features/visits/VisitPaymentDisplay.test.tsx`
- Test: `src/features/visits/VisitLoggedCard.test.tsx`

**Interfaces:**
- Consumes: `totals`, `canBillInpatientStay(clinic)`, `department` from `src/features/visits/LedgerPage.tsx`.
- Produces: Clean user-facing text "IP Bill" instead of "On stay bill", de-duplicated totals string.

- [ ] **Step 1: Update `VisitCard.tsx` and `VisitPaymentDisplay.tsx`**

In `src/components/VisitCard.tsx`:
Change:
```tsx
            <span className="rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-xs font-medium text-[var(--teal-strong)]">
              On stay bill
            </span>
```
To:
```tsx
            <span className="rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-xs font-medium text-[var(--teal-strong)]">
              IP Bill
            </span>
```

In `src/components/visit/VisitPaymentDisplay.tsx`:
Change:
```tsx
            <span className="rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-xs font-medium text-[var(--teal-strong)]">
              On stay bill
            </span>
```
To:
```tsx
            <span className="rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-xs font-medium text-[var(--teal-strong)]">
              IP Bill
            </span>
```

- [ ] **Step 2: Update `VisitLoggedCard.tsx` and `TodayVisitsExtras.tsx`**

In `src/features/visits/VisitLoggedCard.tsx`:
Change:
```tsx
              ✓ Added to stay bill · {formatAmount(justSaved.billPaise)}
```
To:
```tsx
              ✓ Added to IP bill · {formatAmount(justSaved.billPaise)}
```

In `src/features/workspace/TodayVisitsExtras.tsx`:
Change:
```tsx
            cell('On stay bill', formatAmount(totals.billedPaise), 'text-[var(--teal)]')
```
To:
```tsx
            cell('IP Bill', formatAmount(totals.billedPaise), 'text-[var(--teal)]')
```

- [ ] **Step 3: Update `LedgerPage.tsx` totals bar and status labels**

In `src/features/visits/LedgerPage.tsx`:
In phone layout (<sm):
Change:
```tsx
                    {department === 'ward' ? (
                      <>
                        <span className="text-[var(--muted)]">·</span>
                        <span>
                          Billed <strong className="font-num text-[var(--ink)]">{formatAmount(totals.bill)}</strong>
                        </span>
                      </>
                    ) : (
```
To:
```tsx
                    {department === 'ward' ? null : (
```
And on line 1309:
Change:
```tsx
                        On stay bill <span className="font-num">{formatAmount(totals.outstanding)}</span>
```
To:
```tsx
                        IP Bill <span className="font-num">{formatAmount(totals.outstanding)}</span>
```

In desktop layout (sm+):
Change lines 1335-1351 from:
```tsx
                    {department === 'ward' ? (
                      canBillInpatientStay(clinic) ? (
                        <>
                          <span>
                            Billed <strong className="font-num text-[var(--ink)]">{formatAmount(totals.bill)}</strong>
                          </span>
                          <span className="text-[var(--muted)]">·</span>
                          <span className="font-medium text-[var(--teal-strong)]">
                            On stay bill <span className="font-num">{formatAmount(totals.outstanding)}</span>
                          </span>
                        </>
                      ) : (
                        <span>
                          Logged <strong className="font-num text-[var(--ink)]">{formatAmount(totals.bill)}</strong>
                        </span>
                      )
                    ) : (
```
To:
```tsx
                    {department === 'ward' ? (
                      canBillInpatientStay(clinic) ? (
                        <span className="font-medium text-[var(--teal-strong)]">
                          IP Bill <span className="font-num">{formatAmount(totals.outstanding)}</span>
                        </span>
                      ) : (
                        <span>
                          Logged <strong className="font-num text-[var(--ink)]">{formatAmount(totals.bill)}</strong>
                        </span>
                      )
                    ) : (
```

- [ ] **Step 4: Update test assertions for "On stay bill"**

Search any existing tests asserting `"On stay bill"` and update to `"IP Bill"`. Run vitest on affected files:
`npx vitest run src/components/visit/VisitPaymentDisplay.test.tsx src/features/visits/VisitLoggedCard.test.tsx`
Verify: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/components/VisitCard.tsx src/components/visit/VisitPaymentDisplay.tsx src/features/visits/VisitLoggedCard.tsx src/features/workspace/TodayVisitsExtras.tsx src/features/visits/LedgerPage.tsx
git commit -m "refactor(visits): rename On stay bill to IP Bill and de-duplicate IP ledger totals"
```

---

### Task 2: Hide Unpaid Invoices Card on Ledger Visits Tab in Ward Mode

**Files:**
- Modify: `src/features/visits/LedgerPage.tsx:1052-1058`

**Interfaces:**
- Consumes: `recordsView`, `department`, `outstanding` in `LedgerPage.tsx`.

- [ ] **Step 1: Update condition in `LedgerPage.tsx`**

In `src/features/visits/LedgerPage.tsx`, change:
```tsx
      {recordsView === 'visits' &&
        (department !== 'ward' || canBillInpatientStay(clinic)) &&
        outstanding &&
        outstanding.rows.length > 0 && (
          <SectionCard title="Unpaid invoices">
```
To:
```tsx
      {recordsView === 'visits' &&
        department !== 'ward' &&
        outstanding &&
        outstanding.rows.length > 0 && (
          <SectionCard title="Unpaid invoices">
```

- [ ] **Step 2: Run test verification**

Run: `npx vitest run src/features/visits/LedgerDepartmentScoping.test.tsx`
Verify: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/visits/LedgerPage.tsx
git commit -m "fix(ledger): hide unpaid invoices card on visits tab in ward mode"
```

---

### Task 3: Hide Follow-up & Packages Section on Workspace in Ward Mode

**Files:**
- Modify: `src/features/workspace/WorkspacePage.tsx:1400-1680`

**Interfaces:**
- Consumes: `department` in `WorkspacePage.tsx`.

- [ ] **Step 1: Wrap `<SectionCard title="Follow up" ...>` in `department !== 'ward'`**

In `src/features/workspace/WorkspacePage.tsx`:
Change line 1402:
```tsx
      {department !== 'ward' && (
        <SectionCard
          title="Follow up"
          badge={followUpBadge}
          action={
            <button
...
        </SectionCard>
      )}
```

- [ ] **Step 2: Run Workspace tests**

Run: `npx vitest run src/features/workspace/WorkspaceDepartmentScoping.test.tsx`
Verify: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/workspace/WorkspacePage.tsx
git commit -m "fix(workspace): hide follow up and packages card in ward mode"
```

---

### Task 4: Collapsible Clinic Dropdown & Reorganized Account Menu

**Files:**
- Modify: `src/app/AccountMenu.tsx`
- Test: `src/app/AccountMenu.test.tsx`

**Interfaces:**
- Consumes: `clinics`, `clinic`, `role`, `switchToClinic`, `closeMenu` in `AccountMenu.tsx`.

- [ ] **Step 1: Add `clinicsExpanded` state and convert active clinic badge to collapsible toggle**

In `src/app/AccountMenu.tsx`:
Add state:
```tsx
  const [clinicsExpanded, setClinicsExpanded] = useState(false);
```
Reset `clinicsExpanded` to `false` when menu closes:
```tsx
  function closeMenu() {
    setOpen(false);
    setClinicsExpanded(false);
  }
```

In the menu header (lines 199-204):
Replace the static active clinic badge with:
```tsx
              {/* Active clinic toggle */}
              <button
                type="button"
                aria-expanded={clinicsExpanded}
                onClick={() => setClinicsExpanded((v) => !v)}
                className="mt-2.5 flex w-full items-center justify-between gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <ClinicAvatar name={clinic.name} logoUrl={logoUrl} />
                  <span className="truncate font-medium">{clinic.name}</span>
                </div>
                {(clinics.length > 1 || role === 'admin') && (
                  <span className="text-[10px] text-[var(--muted)]" aria-hidden="true">
                    {clinicsExpanded ? '▴' : '▾'}
                  </span>
                )}
              </button>

              {/* Collapsible clinic switcher list */}
              {clinicsExpanded && (
                <div className="mt-2 space-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
                  {clinics.length > 1 && (
                    <>
                      <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        Switch clinic
                      </p>
                      {sortedClinics.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={c.id === clinic.id}
                          onClick={() => void switchToClinic(c.id)}
                          className={`flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${
                            c.id === clinic.id
                              ? 'bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                              : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                          }`}
                        >
                          <span className="w-3.5 shrink-0 text-xs" aria-hidden>
                            {c.id === clinic.id ? '✓' : ''}
                          </span>
                          <span className="truncate">{c.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {role === 'admin' && (
                    <button
                      type="button"
                      role="menuitem"
                      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                      onClick={() => {
                        closeMenu();
                        setAddingClinic(true);
                      }}
                    >
                      <span className="w-3.5 shrink-0 text-center font-bold text-[var(--teal)]" aria-hidden>
                        +
                      </span>
                      <span className="min-w-0 flex-1 truncate">Add another clinic</span>
                    </button>
                  )}
                </div>
              )}
```

- [ ] **Step 2: Reorganize sections cleanly**

Under the Profile & Clinic header:
1. **Clinic Management (Admin only):**
```tsx
            {role === 'admin' && (
              <div className="border-t border-[var(--border)] px-2 py-2">
                <Link
                  to="/settings"
                  role="menuitem"
                  className={rowCls}
                  onClick={closeMenu}
                >
                  <IconSettings className={rowIcon} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block font-medium leading-tight">Clinic settings</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      Profile, places, team, billing
                    </span>
                  </span>
                </Link>
                <div className="mt-1 px-1">
                  <SetupProgressBar clinicId={clinicId} />
                </div>
              </div>
            )}
```
2. **Personal:**
```tsx
            <div className="border-t border-[var(--border)] px-2 py-2">
              <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setAccountOpen)}>
                <IconUser className={rowIcon} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block leading-tight">My account</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">Profile, password</span>
                </span>
              </button>
              {myTherapist && (
                <button type="button" role="menuitem" className={rowCls} onClick={openHoursSheet}>
                  <IconCalendar className={rowIcon} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-1.5 leading-tight">
                      <span>My working hours</span>
                      {hasUpdatedDot && (
                        <span
                          data-testid="hours-updated-dot"
                          className="h-2 w-2 rounded-full bg-[var(--teal)] shrink-0"
                          title="Updated"
                          aria-label="Updated"
                        />
                      )}
                    </span>
                    {hoursSubtitle && (
                      <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                        {hoursSubtitle}
                      </span>
                    )}
                  </span>
                </button>
              )}
              <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setNotificationsOpen)}>
                <IconBell className={rowIcon} />
                Notifications
              </button>
            </div>
```
3. **App & Feedback:**
```tsx
            <div className="border-t border-[var(--border)] px-2 py-2">
              {showInstall && (
                <div className="px-2.5 py-1.5">
                  <InstallPrompt />
                </div>
              )}
              <button type="button" role="menuitem" className={rowCls} onClick={() => openSheet(setHelpOpen)}>
                Help &amp; feedback
              </button>
            </div>
```
4. **Footer:**
```tsx
            <div className="border-t border-[var(--border)] bg-[var(--paper)] px-2 py-2">
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-medium text-[var(--rust)] hover:bg-[var(--rust-light)]"
                onClick={() => void signOutSafely()}
              >
                Sign out
              </button>
            </div>
            <div className="flex items-center justify-center gap-2 border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
              <BrandMark size={14} decorative />
              <span>Thera.Net v{__APP_VERSION__} · {__APP_BUILD__}</span>
              <span aria-hidden>·</span>
              <button type="button" className="font-medium text-[var(--teal)] hover:underline" onClick={() => void refreshApp()}>
                Refresh app
              </button>
            </div>
```

- [ ] **Step 3: Update and run `AccountMenu.test.tsx`**

Run: `npx vitest run src/app/AccountMenu.test.tsx`
Verify all tests pass (updating tests if they expect switch clinic to be uncollapsed without clicking).

- [ ] **Step 4: Commit**

```bash
git add src/app/AccountMenu.tsx src/app/AccountMenu.test.tsx
git commit -m "feat(nav): collapse clinic switcher into interactive dropdown in account menu"
```

---

### Task 5: Documentation Update and Full Validation

**Files:**
- Modify: `FEATURES_AND_SCHEMA.md`

- [ ] **Step 1: Update `FEATURES_AND_SCHEMA.md`**

Update the Inpatient billing section to reflect `IP Bill` terminology, hiding of unpaid invoices card in ward visits log, and hiding of outpatient follow-ups/packages on ward workspace.

- [ ] **Step 2: Run full check**

Run: `npm run check:fast`
Verify all typechecks, lint checks, and test suites pass.

- [ ] **Step 3: Commit**

```bash
git add FEATURES_AND_SCHEMA.md
git commit -m "docs: update FEATURES_AND_SCHEMA.md with IP Bill terminology and department scoping"
```

