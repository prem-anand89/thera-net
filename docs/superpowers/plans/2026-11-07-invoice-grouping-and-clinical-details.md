# Invoice grouping, clinical details and the multi-visit workflow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Tasks run in order; Task 1 needs the live database and is done by Claude (Opus), not by an agent.

**Goal:** Make a bill that groups several visits (home care, packages, several services) correct on the server and in print, with clinical details taken from all the visits billed, and make grouping easy for the people who do it.

**Architecture:** The server refuses an invoice whose total, patient or visits do not add up. A pure function builds the clinical snapshot from every selected visit. Bill lines group by location as well as service. Patient Profile gets bulk-select shortcuts and a fuller review step.

**Tech Stack:** PostgreSQL (Supabase), React 19, TypeScript, Vitest, Dexie.

**Spec:** "Decisions" below (owner, 2026-11-07), from the review of `invoiceService.ts`, `invoiceLine.ts`, `IssueInvoiceDialog.tsx`, `issue_invoice` / `amend_invoice` and `get_invoice_referral`.

## Decisions

1. **Home and clinic visits of the same service print as separate bill rows.** Location is part of the grouping key. Package lines still group by package.
2. **A bill edited after it was issued does not say so.** Edits are usually corrections, and the printed bill should not draw attention to them. The database's before-and-after audit log (`invoices_audit`) and the internal `editedByBiller` flag stay as they are; nothing about this is printed.
3. **The financial-year number follows the issue date.** A bill issued in April for March visits takes the new year's number. No change.
4. **No ₹0 bills.** The server refuses an invoice with a total of zero.

## Global Constraints

- Issued invoices stay immutable. Only `clinical_snapshot` may change after issue (existing rule); this plan adds no new editable field.
- Migrations are files only for agents; Claude reviews and applies them live. Number each after the newest in `supabase/migrations/` (check with `ls supabase/migrations | tail -3`; at the time of writing the newest is `20261106130000`).
- Money and attribution maths stay in `src/domain` (`invoiceLine.ts`); no totals computed in components.
- Money text uses `formatAmount` / `currencySymbol()`; phones through the clinic's country code. India-only wording (UPI, GST, "Rupees … Only") stays on the list in `FEATURES_AND_SCHEMA.md` section 0e.
- Explicit `type` on every button; errors inside dialogs with `ErrorNote`; no new npm dependencies.
- The working tree may hold other sessions' edits: stage by explicit path, update `FEATURES_AND_SCHEMA.md` with a patch of only your own hunks, never `git add -A`. Do not push.

## Review Focus

1. **Server refusals:** a total that differs from the visits' bills, visits of two patients, a patient snapshot that does not match, a ₹0 total, and an amendment that re-points visits all fail with a plain message, and every existing valid issue/amend still succeeds.
2. **Mixed bills:** one bill with a clinic visit and a home visit of the same service prints two rows and the place of service reads "Clinic and Home".
3. **Old invoices** (snapshot with `'clinic'` or `'home'` only, no `locations`) still print exactly as before.
4. **Front desk privacy:** the new referral function returns only the referral block (diagnosis, ICD code, physician, registration number), never other note content.
5. **Package follow-ups:** sessions logged after a package was billed cannot be issued as a ₹0 bill.

---

### Task 1: Server checks on issue and amend (Claude does this task)

**Files:**
- Create: `supabase/migrations/<next>_invoice_integrity_checks.sql`
- Create: `supabase/tests/invoice_integrity_checks.sql`
- Modify: `src/services/invoiceService.ts` (friendly messages only)

- [ ] **Step 1: Read the live definitions first**

`select pg_get_functiondef('public.issue_invoice(uuid,text,jsonb,jsonb,bigint,text,uuid,uuid[],jsonb)'::regprocedure);` and the same for `amend_invoice`. The migration replaces both, based on the live text, not on the old files.

- [ ] **Step 2: Write the migration**

Add one private helper and call it from both functions, after the visits are stamped (so the existing "missing, deleted or already invoiced" check still reports first):

```sql
create function public.check_invoice_matches_visits(
  p_clinic_id uuid, p_visit_ids uuid[], p_total_paise bigint, p_line_items jsonb, p_patient_snapshot jsonb
) returns void language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_visits int; v_patients int; v_bills bigint; v_lines bigint; v_mrno text;
begin
  select count(*), count(distinct patient_id), coalesce(sum(actual_bill_paise), 0)
    into v_visits, v_patients, v_bills
    from visits where id = any (p_visit_ids) and clinic_id = p_clinic_id and not deleted;
  if v_patients <> 1 then raise exception 'All visits on one invoice must belong to the same patient'; end if;
  select mrno into v_mrno from patients
   where id = (select patient_id from visits where id = p_visit_ids[1]);
  if p_patient_snapshot ->> 'mrno' is distinct from v_mrno then
    raise exception 'The patient on this invoice does not match its visits';
  end if;
  if p_total_paise <= 0 then raise exception 'Nothing to bill: these visits have no charge'; end if;
  if p_total_paise <> v_bills then raise exception 'The invoice total does not match the visits'' bills'; end if;
  select coalesce(sum((l ->> 'totalPaise')::bigint), 0) into v_lines from jsonb_array_elements(p_line_items) l;
  if v_lines <> p_total_paise then raise exception 'The invoice lines do not add up to its total'; end if;
end $$;
revoke all on function public.check_invoice_matches_visits(uuid, uuid[], bigint, jsonb, jsonb) from public, anon, authenticated;
```
Call it as `perform public.check_invoice_matches_visits(p_clinic_id, p_visit_ids, p_total_paise, p_line_items, p_patient_snapshot);` in both functions. Keep every other line of both functions exactly as live. Verify the column names (`patients.mrno`, `visits.patient_id`, `visits.actual_bill_paise`) against the live schema before applying.

- [ ] **Step 3: Write `supabase/tests/invoice_integrity_checks.sql`**

A `begin; ... rollback;` script, acting as a clinic member, that builds two patients with visits and asserts:
1. A valid one-visit invoice, a package invoice and a two-service visit invoice still issue.
2. A total ₹1 higher or lower than the visits' bills raises.
3. Visits of two patients raise.
4. A patient snapshot with another patient's `mrno` raises.
5. Only ₹0 visits (a package continuation) raise "Nothing to bill".
6. Line items whose totals do not sum to the total raise.
7. `amend_invoice` re-pointing the original's visits plus one new visit succeeds; with a visit of another patient it raises.

- [ ] **Step 4: Friendly messages**

In `invoiceService.issueForVisits` / `amendInvoice`, the RPC error text is already shown via `toFriendlyMessage`; add the four new messages to the friendly-message map if it has one, so the biller reads a sentence and not a database error. Test: each message maps to itself without the "Could not issue invoice:" prefix doubled.

- [ ] **Step 5: Run the checks script (it rolls back), apply the migration live, re-run the valid cases against the live clinic read-only, commit**

```bash
git add supabase/migrations/<next>_invoice_integrity_checks.sql supabase/tests/invoice_integrity_checks.sql src/services/invoiceService.ts
git commit -m "feat(db): an invoice must match its visits, one patient, and a non-zero total"
```

---

### Task 2: One clinical snapshot from all the visits billed

**Files:**
- Create: `src/domain/invoiceClinical.ts`, `src/domain/invoiceClinical.test.ts`
- Create: `supabase/migrations/<next+1>_invoice_referral_for_visits.sql`, `supabase/tests/invoice_referral_checks.sql` (Claude reviews and applies)
- Modify: `src/domain/types.ts` (`InvoiceClinicalSnapshot`)
- Modify: `src/components/IssueInvoiceDialog.tsx`, `src/components/InvoiceClinicalFields.tsx`, `src/components/EditInvoiceDetailsDialog.tsx`
- Modify: `src/services/invoiceService.ts` (`referralForVisits`)

**Interfaces:**
- Produces, in `invoiceClinical.ts`:
  - `placeOfServiceFor(visits: Pick<Visit, 'location'>[]): { place: CareLocation | 'mixed'; locations: CareLocation[] }`
  - `treatmentsFor(visits: Pick<Visit, 'treatmentIds' | 'treatmentNotes' | 'visitDate'>[], catalog: { id: string; name: string }[]): string`
  - `pickReferralNote(notes: ConsultationNote[], visits: Pick<Visit, 'id' | 'visitDate'>[]): ConsultationNote | undefined`
- `InvoiceClinicalSnapshot.placeOfService` becomes `'clinic' | 'home' | 'ward' | 'mixed' | null`, plus `locations?: CareLocation[]` (all optional additions; old rows stay valid).
- The server function `get_invoice_referral_for_visits(p_visit_ids uuid[]) returns jsonb` replaces `get_invoice_referral` for the dialog and also returns `diagnosisIcdCode`.

- [ ] **Step 1: Write failing tests (`invoiceClinical.test.ts`)**

- `placeOfServiceFor`: all clinic → `clinic`; all home → `home`; clinic + home → `mixed` with `['clinic','home']` in that order; a visit with no location counts as clinic (`locationOf`).
- `treatmentsFor`: distinct treatment names across visits in order of first appearance (visits sorted by date), each visit's free-text notes added once, comma separated, trimmed to 200 characters with an ellipsis; no visits with treatments → `''`.
- `pickReferralNote`: prefers a note linked to one of the visits (latest visit first); else the latest completed initial/followup note updated on or before the last visit's date; else the latest completed note overall; a session-mode note is never returned.

- [ ] **Step 2: Run, expect failure:** `npx vitest run src/domain/invoiceClinical.test.ts`

- [ ] **Step 3: Implement the three functions and widen the type.**

- [ ] **Step 4: Dialog**

`IssueInvoiceDialog`: build the pre-fill from all `target.visitIds ?? [target.visitId]` (load each visit with `useLiveQuery`), using the three functions. `diagnosisIcdCode` is kept only when the diagnosis text equals the pre-filled text, else `null`:
`diagnosisIcdCode: fields.diagnosis === prefill.diagnosis ? referral?.diagnosisIcdCode ?? null : null`.
`ClinicalFields.placeOfService` becomes the wider union; `InvoiceClinicalFieldsForm` offers Clinic / Home / Ward (Ward only when the clinic has it in `careLocations`) and shows "Clinic and Home" read-only text when the pre-fill was mixed, still overridable. `EditInvoiceDetailsDialog` accepts the wider union.

- [ ] **Step 5: Front desk referral**

Migration: `get_invoice_referral_for_visits(p_visit_ids uuid[])`. For members of the visits' clinic only; returns `diagnosis`, `diagnosisIcdCode`, `referringPhysician`, `physicianRegistrationNo` from the note linked to the latest visit that has a heavy note, else the latest completed heavy note on or before the last visit's date, else the latest overall (same three steps as `pickReferralNote`). Returns null when none. Never returns other note content. `invoiceService.referralForVisits(visitIds)` calls it; the dialog uses it when `!canViewClinicalNotes`. Test script asserts: another clinic's visits return null; a session-mode note is never returned; the ICD code is present.

- [ ] **Step 6: Run `npx vitest run src/domain src/components`, typecheck, lint, commit** (migration reported to Claude, not applied)

```bash
git add src/domain/invoiceClinical.ts src/domain/invoiceClinical.test.ts src/domain/types.ts src/components/IssueInvoiceDialog.tsx src/components/InvoiceClinicalFields.tsx src/components/EditInvoiceDetailsDialog.tsx src/services/invoiceService.ts supabase/migrations/<next+1>_invoice_referral_for_visits.sql supabase/tests/invoice_referral_checks.sql
git commit -m "feat(invoices): clinical details come from every visit billed, with the right ICD code"
```

---

### Task 3: Grouping and print

**Files:**
- Modify: `src/domain/invoiceLine.ts`, `src/domain/invoiceLine.test.ts`
- Modify: `src/features/invoices/InvoicePrintPage.tsx`, `src/features/invoices/printChrome.tsx` if the clinical block is shared
- Test: `src/features/invoices/InvoicePrintPage` tests (create `invoiceClinicalBlock.test.tsx` if none exists)

- [ ] **Step 1: Write failing tests**

- `unitGroupKey`: two non-package lines with the same service and price but locations `clinic` and `home` get different keys; same location → same key; a package line keeps its `packageGroupId` whatever its location; a visit with no `location` groups with `clinic`.
- `buildLineItems`: a clinic visit and a home visit of the same service produce two line items; totals unchanged.
- Print helpers: `placeOfServiceLabel(snapshot)`: `clinic` → "Clinic", `home` → "Home (domiciliary)", `ward` → "Ward", `mixed` with `['clinic','home']` → "Clinic and Home", missing/old → as today.
- The clinical block shows "Treatment period" only for an invoice with more than one visit date (`invoicePeriod` with `from < to`), formatted `dd/mm/yy – dd/mm/yy`.
- A line in range mode (more than 8 dates) adds one muted line under the table: "Full session dates are in the session log." An invoice whose lines all list their dates does not.
- No text anywhere on the printed bill says the clinical details were edited (a snapshot with `editedByBiller: true` prints the same as one without).

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

`unitGroupKey` for a non-package unit becomes `svc:${serviceId}:${catalogPrice}:${locationOf(visit)}`; for a unit with no `item`, `invoiceLineGroupKey` gets the same suffix. Import `locationOf` from `@/domain/careLocations`. In `InvoicePrintPage`'s Clinical details section add the treatment period row and the wider place-of-service label; add the session-log note under the table. Do not touch invoices already issued: grouping only runs at issue/amend time.

- [ ] **Step 4: Run tests, typecheck, lint, build; commit**

```bash
git add src/domain/invoiceLine.ts src/domain/invoiceLine.test.ts src/features/invoices/InvoicePrintPage.tsx
git commit -m "feat(invoices): home and clinic visits stay on separate rows; place and treatment period print"
```

---

### Task 4: Workflow on Patient Profile

**Files:**
- Modify: `src/features/patients/PatientProfilePage.tsx`, `src/components/IssueInvoiceDialog.tsx`
- Create: `src/features/patients/billingSelection.ts`, `src/features/patients/billingSelection.test.ts`

**Interfaces:**
- Produces: `selectableForBilling(rows: VisitCardData[], opts: { canBill: boolean; canCollect: boolean }): VisitCardData[]` (today's `isSelectableRow`, extracted) and `unbilledInRange(rows, range: 'all' | 'this_month' | 'last_month', today: string): string[]` (visit ids).

- [ ] **Step 1: Write failing tests**

- `selectableForBilling`: with billing rights an uninvoiced, not-fully-partner-collected visit is selectable; an invoiced one is not; a ₹0 visit that belongs to a package already invoiced is **not** selectable (it can only be billed with its package); without billing rights, only visits with an amount still due, and only when `canCollect`.
- `unbilledInRange`: `all` returns every selectable id; `this_month` / `last_month` filter by `visitDate` in the clinic's local month (`today` is passed in, as `YYYY-MM-DD`); results are in date order.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

- Extract the two functions; `PatientProfilePage` uses them.
- In the bulk bar add "Select all unbilled", "This month" and "Last month" shortcuts beside the existing checkboxes; they replace the selection. Show the count and total (`formatAmount`).
- A ₹0-only selection disables "Issue invoice" with the reason "These visits have no charge to bill" (the server's Task 1 check stays the real guard).
- `IssueInvoiceDialog` review step also shows: the clinical details that will print, the treatment period, and what "Collected now" will record (method and amount, or "Nothing yet").

- [ ] **Step 4: Run tests, typecheck, lint, build; commit**

```bash
git add src/features/patients/billingSelection.ts src/features/patients/billingSelection.test.ts src/features/patients/PatientProfilePage.tsx src/components/IssueInvoiceDialog.tsx
git commit -m "feat(patients): select all unbilled visits, by month, with a fuller review"
```

---

### Task 5: Docs and manual check

- [ ] **Step 1: Update `FEATURES_AND_SCHEMA.md`** (every copy of each section: `grep -n` the headings): the server checks and their messages; the snapshot widening (`ward`, `mixed`, `locations`) and where it comes from; the grouping rule (location in the key); the two new RPCs; the print additions; the "no edited marker" decision; the Patient Profile shortcuts. Add the new RPCs and the new place values to the schema notes. Use a hunk-only patch for the shared docs file.

- [ ] **Step 2: Full gate, run each on its own and read its exit status:** `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.

- [ ] **Step 3: Manual check (owner)**

1. Home care: log three home visits for a patient plus one clinic visit of the same service; select all unbilled; the review shows two rows (home and clinic) and the place "Clinic and Home"; issue it; print shows the treatment period.
2. A package billed with 3 sessions; log a fourth; it cannot be issued as a ₹0 bill.
3. Edit the diagnosis on a bill after issuing; the printed bill shows no mark of the edit.
4. As front desk, issue a bill and confirm the ICD code and referring physician pre-fill.
5. Delete this plan file once everything is built and verified.
