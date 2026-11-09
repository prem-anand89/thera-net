# Step 3: Separate the Money Across Departments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Step 3 of `docs/superpowers/plans/2026-11-08-departments.md` so that bills never mix departments, IP bills use their own gap-free invoice series (`BMIP/26-27/0001`), patient advances are recorded and drawn down per department, catalog services can be scoped to specific departments, and the accountant's monthly statement CSV export includes per-department sections followed by one `"All departments"` combined total line.

**Architecture:**
- **Database Migration (`supabase/migrations/20261109120000_separate_department_money.sql`):** Already authored in the repo (never apply directly to live Supabase; report its path for review/application). Adds `clinics.ip_invoice_prefix`, adds `series` to `invoice_counters` primary key `(clinic_id, fy_label, series)`, drops `invoices_clinic_id_fy_label_seq_key` (since `unique (clinic_id, invoice_no)` enforces uniqueness across series), updates `check_invoice_matches_visits`, `issue_invoice`, and `amend_invoice`, adds `patient_advances.department` + updates `enforce_advance_balance()`, and adds `service_catalog.departments`.
- **Client Defensive Defaults:** All client code must tolerate older local/server rows where new columns (`ipInvoicePrefix`, `advance.department`, `service.departments`) are `undefined` or `null`.

**Tech Stack:** TypeScript, React 19, Dexie (IndexedDB), Vitest, Testing Library, Tailwind CSS (`var(--...)` custom properties only).

---

## Testing & Verification Rules (CRITICAL)

- **Never edit `vite.config.ts`.**
- Run targeted Vitest files with `--maxWorkers=2` during each task:
  `npx vitest run <test-file> --maxWorkers=2`
- Run typecheck and lint on touched files after each task:
  `npx tsc --noEmit && npx eslint <touched-files>`
- Always stage explicit file paths (`git add <file1> <file2>`); **never** run `git add -A` or `git add .` (leave untracked plan files untouched).

---

### Task 1: No Bill Mixes Departments

**Files:**
- Modify: `src/services/invoiceService.ts`
- Modify: `src/components/AmendInvoiceDialog.tsx`
- Modify: `src/features/patients/PatientAdmissionBar.tsx`
- Test: `src/services/invoiceService.test.ts`
- Test: `src/components/AmendInvoiceDialog.test.tsx`

- [ ] **Step 1: Write failing tests in `src/services/invoiceService.test.ts` and `src/components/AmendInvoiceDialog.test.tsx`**

In `src/services/invoiceService.test.ts`, add a test verifying that `issueForVisits` (and `previewLineItems` / `visitsOnInvoice`) rejects visits from different departments (`'clinic'` and `'home'`, or `'clinic'` and `'ward'`) with `/Cannot combine visits from different departments on one invoice/i`, and that package expansion (`collectVisits`) only pulls in uninvoiced package siblings from the same department.

In `src/components/AmendInvoiceDialog.test.tsx` (create or extend existing test), verify that when amending an OP invoice, uninvoiced Home care or IP visits for the same patient are not listed under `"Add uninvoiced visits for this patient"`.

- [ ] **Step 2: Run the targeted tests to confirm they fail**

Run:
`npx vitest run src/services/invoiceService.test.ts src/components/AmendInvoiceDialog.test.tsx --maxWorkers=2`

- [ ] **Step 3: Implement department checks in `invoiceService.ts`, `AmendInvoiceDialog.tsx`, and `PatientAdmissionBar.tsx`**

1. In `src/services/invoiceService.ts`:
   - Import `departmentOf` from `@/domain/departments`.
   - In `collectVisits(visit: Visit, allowInvoiceId?: UUID)`:
     ```ts
     async function collectVisits(visit: Visit, allowInvoiceId?: UUID): Promise<Visit[]> {
       if (!visit.packageGroupId) return [visit];
       const dept = departmentOf(visit);
       const group = await repos.visits.listByPackageGroup(visit.packageGroupId);
       return group.filter((v) => isAvailable(v, allowInvoiceId) && departmentOf(v) === dept);
     }
     ```
   - In `resolveVisits(visitIds: UUID[], allowInvoiceId?: UUID)`:
     After deduplicating into `uniqueVisits`:
     ```ts
     const depts = new Set(uniqueVisits.map((v) => departmentOf(v)));
     if (depts.size > 1) {
       throw new Error('Cannot combine visits from different departments on one invoice');
     }
     ```
   - In `amendInvoice`:
     Also check that the resolved visits match the original invoice's department (`const origVisits = await repos.visits.listByInvoiceId(originalInvoiceId);` — if `origVisits.length > 0` and `departmentOf(origVisits[0]) !== departmentOf(allVisits[0])`, throw `new Error('Cannot combine visits from different departments on one invoice')`).

2. In `src/components/AmendInvoiceDialog.tsx`:
   - Import `departmentOf, invoiceDepartment` from `@/domain/departments`.
   - Compute:
     ```ts
     const originalVisits = (allVisits ?? []).filter((v) => v.invoiceId === invoice.id);
     const patientId = originalVisits[0]?.patientId;
     const invoiceDept = originalVisits[0] ? departmentOf(originalVisits[0]) : invoiceDepartment(invoice);
     const addableVisits = (allVisits ?? []).filter(
       (v) => v.patientId === patientId && !v.invoiceId && !v.deleted && departmentOf(v) === invoiceDept
     );
     ```

3. In `src/features/patients/PatientAdmissionBar.tsx`:
   - Import `departmentOf` from `@/domain/departments`.
   - Update `unbilledOf`:
     ```ts
     const unbilledOf = (stay: Admission) =>
       (visits ?? []).filter(
         (v) => !v.deleted && v.admissionId === stay.id && !v.invoiceId && departmentOf(v) === 'ward'
       );
     ```

- [ ] **Step 4: Run tests, typecheck, and commit**

Run:
`npx vitest run src/services/invoiceService.test.ts src/components/AmendInvoiceDialog.test.tsx src/features/patients/PatientAdmissionBar.test.tsx --maxWorkers=2`
`npx tsc --noEmit && npx eslint src/services/invoiceService.ts src/components/AmendInvoiceDialog.tsx src/features/patients/PatientAdmissionBar.tsx`

---

### Task 2: IP Bill Series (`BMIP/26-27/0001`) & Billing Settings UI

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/departments.ts`
- Modify: `src/features/settings/BillingSections.tsx`
- Test: `src/domain/departments.test.ts`
- Test: `src/features/settings/BillingSections.test.tsx`

- [ ] **Step 1: Write failing tests for `effectiveIpInvoicePrefix` and the IP prefix field in `BillingSections`**

1. In `src/domain/departments.test.ts`:
   - Test `effectiveIpInvoicePrefix({ invoicePrefix: 'BM', ipInvoicePrefix: null })` returns `'BMIP'`.
   - Test `effectiveIpInvoicePrefix({ invoicePrefix: 'BM', ipInvoicePrefix: '  BMWARD ' })` returns `'BMWARD'`.
2. In `src/features/settings/BillingSections.test.tsx`:
   - Test that `InvoiceIdentityCard` does NOT render the `"IP invoice prefix"` field when `clinic.careLocations` is `['clinic', 'home']` (no `'ward'`).
   - Test that `InvoiceIdentityCard` DOES render `"IP invoice prefix"` when `clinic.careLocations` includes `'ward'`, shows sample number `BMIP/26-27/0001` when blank, refuses saving a prefix equal to `invoicePrefix` (`BM`), and saves `ipInvoicePrefix` on `repos.clinics.put` when valid (e.g. `BMIP2`, or `null` when cleared).

- [ ] **Step 2: Run the targeted tests to confirm they fail**

Run:
`npx vitest run src/domain/departments.test.ts src/features/settings/BillingSections.test.tsx --maxWorkers=2`

- [ ] **Step 3: Implement `Clinic.ipInvoicePrefix`, `effectiveIpInvoicePrefix`, and `InvoiceIdentityCard` IP prefix input**

1. In `src/domain/types.ts`:
   - Add to `Clinic`:
     ```ts
     /** Optional prefix for inpatient (IP) bills (e.g. 'BMIP'). Null/blank defaults to `${invoicePrefix}IP`. */
     ipInvoicePrefix?: string | null;
     ```
2. In `src/domain/departments.ts`:
   - Export helper:
     ```ts
     /** Prefix printed on IP bills: the clinic's custom IP prefix when set, else `${invoicePrefix}IP`. */
     export function effectiveIpInvoicePrefix(clinic: { invoicePrefix: string; ipInvoicePrefix?: string | null }): string {
       const custom = clinic.ipInvoicePrefix?.trim();
       return custom ? custom : `${clinic.invoicePrefix}IP`;
     }
     ```
3. In `src/features/settings/BillingSections.tsx`:
   - Import `clinicDepartments, effectiveIpInvoicePrefix` from `@/domain/departments`.
   - Inside `InvoiceIdentityCard`:
     - Check `const hasIp = clinicDepartments(clinic).includes('ward');`
     - Add state `const [ipPrefix, setIpPrefix] = useState(clinic.ipInvoicePrefix ?? '');` and `const [ipPrefixError, setIpPrefixError] = useState<string | null>(null);` (sync in `useEffect` on `clinic.id`).
     - Validate when `hasIp && ipPrefix.trim() !== ''`:
       - Must match `/^[A-Z0-9]{2,10}$/` (`'Use 2–10 letters or digits (no spaces or slashes)'`).
       - Must not equal `prefix.trim().toUpperCase()` (`'IP invoice prefix must differ from the main invoice prefix'`).
     - When `hasIp`, render `<Field label="IP invoice prefix (optional)" hint={\`Sample IP invoice number: \${effectiveIpInvoicePrefix({ invoicePrefix: prefix, ipInvoicePrefix: ipPrefix })}/\${currentFy.label}/0001. Leave blank to use \${prefix}IP.\`} error={ipPrefixError}>` with uppercase alphanumeric input (maxLength 10, placeholder `${prefix}IP`), saving `ipInvoicePrefix: ipPrefix.trim() ? ipPrefix.trim().toUpperCase() : null` on `repos.clinics.put`.

- [ ] **Step 4: Run tests, typecheck, and commit**

Run:
`npx vitest run src/domain/departments.test.ts src/features/settings/BillingSections.test.tsx --maxWorkers=2`
`npx tsc --noEmit && npx eslint src/domain/types.ts src/domain/departments.ts src/features/settings/BillingSections.tsx`

---

### Task 3: Advances Per Department

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/departmentMoney.ts`
- Modify: `src/services/advanceService.ts`
- Modify: `src/components/RecordAdvanceDialog.tsx`
- Modify: `src/components/TakePaymentDialog.tsx`
- Modify: `src/features/invoices/AdvanceReceiptPrintPage.tsx`
- Test: `src/domain/departmentMoney.test.ts`
- Test: `src/services/advanceService.test.ts`
- Test: `src/components/TakePaymentDialog.test.tsx`

- [ ] **Step 1: Write failing tests in `departmentMoney.test.ts`, `advanceService.test.ts`, and `TakePaymentDialog.test.tsx`**

1. In `src/domain/departmentMoney.test.ts`:
   - Test `advancesForDepartment` filters both plain `PatientAdvance` objects (`{ department: 'ward' }`) and wrapped balance rows (`{ advance: { department: 'home' }, remainingPaise: 50000 }`) to the requested department, treating missing/null `department` as `'clinic'` (OP).
2. In `src/services/advanceService.test.ts`:
   - Test `recordAdvance` stamps `department` (defaulting to `'clinic'` when omitted, and `'ward'` / `'home'` when passed).
   - Test `applyAdvance` throws `/different department/i` if an advance for `'ward'` is applied to an OP (`'clinic'`) visit.
3. In `src/components/TakePaymentDialog.test.tsx`:
   - Test that when taking payment for a `'ward'` visit, an open `'clinic'` advance is not offered, whereas an open `'ward'` advance is offered and can be applied.

- [ ] **Step 2: Run the targeted tests to confirm they fail**

Run:
`npx vitest run src/domain/departmentMoney.test.ts src/services/advanceService.test.ts src/components/TakePaymentDialog.test.tsx --maxWorkers=2`

- [ ] **Step 3: Implement per-department advances**

1. In `src/domain/types.ts`:
   - Add `department?: CareLocation;` to `PatientAdvance`.
2. In `src/domain/departmentMoney.ts`:
   ```ts
   type AdvanceItem = {
     department?: string | null;
     advance?: { department?: string | null } | null;
   };

   /**
    * Advances (deposits) by department. An advance belongs to the department it was recorded in;
    * older rows with no department belong to OP ('clinic'). Works on both raw `PatientAdvance`
    * rows and `{ advance, remainingPaise }` balance entries.
    */
   export function advancesForDepartment<A extends AdvanceItem>(department: Department, advances: readonly A[]): A[] {
     return advances.filter((item) => {
       const raw = item.department ?? item.advance?.department;
       const advDept: Department = raw === 'home' || raw === 'ward' ? raw : 'clinic';
       return advDept === department;
     });
   }
   ```
3. In `src/services/advanceService.ts`:
   - Import `departmentOf, type Department` from `@/domain/departments` and `advancesForDepartment` from `@/domain/departmentMoney`.
   - In `recordAdvance`: add parameter `department: Department = 'clinic'` and set `department` on the created `PatientAdvance`.
   - In `openAdvancesWithBalance(clinicId: UUID, patientId: UUID, department?: Department)`: if `department` is provided, filter with `advancesForDepartment(department, ...)`.
   - In `applyAdvance`:
     ```ts
     const advDept: Department =
       advance.department === 'home' || advance.department === 'ward' ? advance.department : 'clinic';
     if (visits.some((v) => departmentOf(v) !== advDept)) {
       throw new Error('Advance belongs to a different department than this visit.');
     }
     ```
4. In `src/components/RecordAdvanceDialog.tsx`:
   - Import `useDepartment` from `@/app/DepartmentContext`.
   - Read `const { department } = useDepartment();` and pass `department` as the 7th argument to `advanceService.recordAdvance(clinicId, patientId, parsedAmountPaise, method, receivedDate, notes.trim() || null, department)`.
5. In `src/components/TakePaymentDialog.tsx`:
   - Import `departmentOf, invoiceDepartment` from `@/domain/departments` and `advancesForDepartment` from `@/domain/departmentMoney`.
   - Query `const visit = useLiveQuery(() => repos.visits.get(visitId), [visitId]);`
   - Determine `const targetDept = invoice ? invoiceDepartment(invoice) : departmentOf(visit);`
   - Filter `const deptAdvances = advancesForDepartment(targetDept, openAdvances ?? []);`
   - Compute `const advanceBalancePaise = deptAdvances.reduce((sum, a) => sum + a.remainingPaise, 0);` and iterate `deptAdvances` in `applyAdvance()`.
6. In `src/features/invoices/AdvanceReceiptPrintPage.tsx`:
   - Import `advancesForDepartment` from `@/domain/departmentMoney`.
   - Filter `openAdvances` by the printed advance's department (`const advDept = advance?.department === 'home' || advance?.department === 'ward' ? advance.department : 'clinic'; const deptAdvances = advancesForDepartment(advDept, openAdvances ?? []);`) before summing `advanceBalancePaise`.

- [ ] **Step 4: Run tests, typecheck, and commit**

Run:
`npx vitest run src/domain/departmentMoney.test.ts src/services/advanceService.test.ts src/components/TakePaymentDialog.test.tsx src/features/patients/PatientProfileDepartmentScoping.test.tsx --maxWorkers=2`
`npx tsc --noEmit && npx eslint src/domain/types.ts src/domain/departmentMoney.ts src/services/advanceService.ts src/components/RecordAdvanceDialog.tsx src/components/TakePaymentDialog.tsx src/features/invoices/AdvanceReceiptPrintPage.tsx`

---

### Task 4: Services Per Department

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/departments.ts`
- Modify: `src/features/settings/ServiceFormSheet.tsx`
- Modify: `src/features/settings/ServicesView.tsx`
- Modify: `src/features/visits/NewVisitPage.tsx`
- Modify: `src/features/visits/EditVisitModal.tsx`
- Modify: `src/components/BookSlotSheet.tsx`
- Test: `src/domain/departments.test.ts`
- Test: `src/features/settings/ServicesView.test.tsx`
- Test: `src/features/visits/NewVisitDepartmentScoping.test.tsx`

- [ ] **Step 1: Write failing tests for service department filtering and `ServiceFormSheet` checkboxes**

1. In `src/domain/departments.test.ts`:
   - Test `servicesInDepartment('ward', services)` includes services with `departments: null` or `undefined` or `['ward']`, and excludes services with `departments: ['clinic']`.
   - Test `normalizeServiceDepartments` returns `null` when none or all of the clinic's departments are ticked, and returns the ordered subset (e.g. `['ward']`) when a subset is ticked.
2. In `src/features/settings/ServicesView.test.tsx`:
   - Test that when the clinic has multiple departments (`['clinic', 'home', 'ward']`), `ServiceFormSheet` shows department checkboxes (`OP`, `Home care`, `IP`), saves `departments: ['ward']` when only `IP` is ticked, and saves `departments: null` when all or none are ticked.
   - Test that when the clinic has only `['clinic']`, no department checkboxes are shown.
3. In `src/features/visits/NewVisitDepartmentScoping.test.tsx`:
   - Test that in OP (`'clinic'`), a service restricted to `departments: ['ward']` does not appear in the service picker, whereas a service with `departments: null` or `departments: ['clinic']` does.

- [ ] **Step 2: Run the targeted tests to confirm they fail**

Run:
`npx vitest run src/domain/departments.test.ts src/features/settings/ServicesView.test.tsx src/features/visits/NewVisitDepartmentScoping.test.tsx --maxWorkers=2`

- [ ] **Step 3: Implement `CatalogItem.departments`, `servicesInDepartment`, `ServiceFormSheet`, and picker filtering**

1. In `src/domain/types.ts`:
   - Add to `CatalogItem`:
     ```ts
     /** Departments where this service is offered (`null` or absent = every department). */
     departments?: CareLocation[] | null;
     ```
2. In `src/domain/departments.ts`:
   - Add helpers:
     ```ts
     /** The catalog services offered in a department: everyone with no restriction, else those that include it. */
     export function servicesInDepartment<S extends { departments?: readonly string[] | null }>(
       department: Department,
       services: readonly S[]
     ): S[] {
       return services.filter(
         (s) => !s.departments || s.departments.length === 0 || s.departments.includes(department)
       );
     }

     /** Normalizes ticked service departments against the clinic's departments: none or all ticked -> null (all). */
     export function normalizeServiceDepartments(
       selected: readonly string[],
       clinicDepts: readonly Department[]
     ): Department[] | null {
       const kept = clinicDepts.filter((d) => selected.includes(d));
       if (kept.length === 0 || kept.length >= clinicDepts.length) return null;
       return kept;
     }
     ```
3. In `src/features/settings/ServiceFormSheet.tsx`:
   - Import ` useClinic ` from `@/app/clinicContext` and `clinicDepartments, DEPARTMENT_LABELS, normalizeServiceDepartments, type Department` from `@/domain/departments`.
   - Compute `const clinicDepts = clinicDepartments(clinic);`
   - Add state `const [departments, setDepartments] = useState<Department[]>(editing?.departments ?? []);` (and reset in `useEffect` when `open`/`editing` changes: `setDepartments(editing?.departments ?? [])`).
   - Include `departments.slice().sort().join(',')` vs `(editing?.departments ?? []).slice().sort().join(',')` in `dirty`.
   - When `clinicDepts.length > 1`, render a `<Field label="Departments" hint={departments.length === 0 || departments.length === clinicDepts.length ? 'All departments (leave unticked or tick all)' : undefined}>` with checkboxes for each `d` in `clinicDepts` labelled `DEPARTMENT_LABELS[d]`.
   - In `save()`, pass `departments: normalizeServiceDepartments(departments, clinicDepts)` onto the `CatalogItem` written to `repos.catalog.put`.
4. In `src/features/settings/ServicesView.tsx`:
   - When `clinicDepartments(clinic).length > 1` and `item.departments && item.departments.length > 0`, show `item.departments.map((d) => DEPARTMENT_LABELS[d]).join(', ')` in the row meta caption so admins can see at a glance which services are department-specific.
5. In `src/features/visits/NewVisitPage.tsx`:
   - Import `servicesInDepartment` from `@/domain/departments`.
   - Filter `catalog`:
     ```ts
     const rawCatalog = useLiveQuery(() => repos.catalog.list(clinic.id), [clinic.id]);
     const catalog = useMemo(
       () => (rawCatalog ? servicesInDepartment(department, rawCatalog) : undefined),
       [rawCatalog, department]
     );
     ```
6. In `src/features/visits/EditVisitModal.tsx`:
   - Import `departmentOf, servicesInDepartment` from `@/domain/departments`.
   - Filter `catalog`:
     ```ts
     const visitDept = departmentOf(visit);
     const catalog = useMemo(
       () =>
         (catalogAll ?? EMPTY_CATALOG).filter(
           (c) =>
             (c.active && servicesInDepartment(visitDept, [c]).length > 0) ||
             items.some((i) => i.serviceCatalogId === c.id)
         ),
       [catalogAll, items, visitDept]
     );
     ```
7. In `src/components/BookSlotSheet.tsx`:
   - Import `servicesInDepartment` from `@/domain/departments`.
   - Filter `visitTypes`:
     ```ts
     const visitTypes = useMemo(
       () =>
         servicesInDepartment(department, services ?? [])
           .filter((service) => service.active && service.durationMinutes)
           .sort((a, b) => a.name.localeCompare(b.name)),
       [services, department]
     );
     ```

- [ ] **Step 4: Run tests, typecheck, and commit**

Run:
`npx vitest run src/domain/departments.test.ts src/features/settings/ServicesView.test.tsx src/features/visits/NewVisitDepartmentScoping.test.tsx src/components/BookSlotSheet.test.tsx --maxWorkers=2`
`npx tsc --noEmit && npx eslint src/domain/types.ts src/domain/departments.ts src/features/settings/ServiceFormSheet.tsx src/features/settings/ServicesView.tsx src/features/visits/NewVisitPage.tsx src/features/visits/EditVisitModal.tsx src/components/BookSlotSheet.tsx`

---

### Task 5: Combined `"All departments"` Line in Accountant's Month Export & Docs Update

**Files:**
- Modify: `src/services/reportService.ts`
- Modify: `src/features/reports/MonthlyStatementPage.tsx`
- Modify: `FEATURES_AND_SCHEMA.md`
- Test: `src/services/reportService.test.ts`
- Test: `src/features/reports/ReportsDepartmentScoping.test.tsx`

- [ ] **Step 1: Write failing tests in `src/services/reportService.test.ts`**

Add tests in `src/services/reportService.test.ts`:
- When `toCsv` is called with `departmentSections: [{ label: 'OP', report: opReport }, { label: 'Home care', report: homeReport }, { label: 'IP', report: ipReport }]` and `allDepartmentsTotal: combinedReport.total`:
  - It outputs each department's section (department label row, therapist rows, department total row) in order.
  - After the per-department sections, it outputs one combined total line whose first cell is `"All departments"` and whose amounts equal `combinedReport.total`.
- When `toCsv` is called without `departmentSections` (single-department clinic or existing callers), output is unchanged.

- [ ] **Step 2: Run the targeted test to confirm it fails**

Run:
`npx vitest run src/services/reportService.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement multi-department CSV sections + `"All departments"` line in `reportService.ts` and `MonthlyStatementPage.tsx`**

1. In `src/services/reportService.ts`:
   - Extend `toCsv` options:
     ```ts
     departmentSections?: { label: string; report: MonthlyReport }[];
     allDepartmentsTotal?: TherapistMonthRow;
     ```
   - When `opts.departmentSections && opts.departmentSections.length > 1 && opts.allDepartmentsTotal`:
     - Build rows starting with `header`.
     - For each `{ label, report: sectionReport }` in `opts.departmentSections`:
       - Push `[label, ...Array(header.length - 1).fill('')]` (or `[label]`).
       - Push `...sectionReport.rows.map(line)`.
       - Push `line({ ...sectionReport.total, therapistName: `${label} Total` })`.
     - After the loop, push `line({ ...opts.allDepartmentsTotal, therapistName: 'All departments' })`.
2. In `src/features/reports/MonthlyStatementPage.tsx`:
   - Import `clinicDepartments, DEPARTMENT_LABELS` from `@/domain/departments`.
   - Compute `const clinicDepts = useMemo(() => clinicDepartments(clinic), [clinic]);`
   - In `downloadCsv()` (make `async function downloadCsv()`):
     - If `clinicDepts.length > 1`:
       Fetch the per-department reports `await Promise.all(clinicDepts.map(async (d) => ({ label: DEPARTMENT_LABELS[d], report: await reportService.monthly(clinic.id, selected, d) })))` and the combined report `const combined = await reportService.monthly(clinic.id, selected);`
       Pass `departmentSections` and `allDepartmentsTotal: combined.total` to `reportService.toCsv(...)`.
     - Else: call `reportService.toCsv(report, { labels, partnerSplit, showPostTax, therapistSplit })` as before.
3. Update `FEATURES_AND_SCHEMA.md`:
   - Document Step 3 schema and rules (`clinics.ip_invoice_prefix`, `invoice_counters.series`, `check_invoice_matches_visits` single-department enforcement, `patient_advances.department` and `enforce_advance_balance`, `service_catalog.departments`, and the `"All departments"` combined total line in the Monthly Statement CSV export).

- [ ] **Step 4: Run tests, typecheck, lint, and commit**

Run:
`npx vitest run src/services/reportService.test.ts src/features/reports/ReportsDepartmentScoping.test.tsx --maxWorkers=2`
`npx tsc --noEmit && npx eslint src/services/reportService.ts src/features/reports/MonthlyStatementPage.tsx`

