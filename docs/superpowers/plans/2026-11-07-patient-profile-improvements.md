# Patient Profile Improvements and Invoices Integration

**Date:** 2026-11-08 · **Status:** Built (7971fdc, cbcdcb7, 5818994, f569e7b), awaiting the owner check, then delete this file · **No schema change, no migration.**

**Goal:** On a patient's profile, show where care happens (home address, place on the next appointment and on past visits)
and list the patient's bills with the actions staff need, so nobody has to go through Ledger → Invoices to find them.

**Read first:** `CLAUDE.md` (money via `formatAmount`, clinic timezone, every `<button>` has a `type`, update
`FEATURES_AND_SCHEMA.md` in the same commit, run `npm run typecheck && npm run lint && npm run test` before each commit,
`npm run build` after Task 4). Work on `main`, one commit per task, stage files by explicit path, do not push.

## Global rules for every task
- Place wording comes from `CARE_LOCATION_LABELS` in `src/domain/careLocations.ts` (`Home visit`, `Inpatient`). A place
  is only shown when `offersLocationChoice(clinic)` is true and `locationOf(record) !== 'clinic'`. A clinic that only sees
  patients in the clinic must look exactly as it does today (no pill, no address, no extra space).
- Dates and times use the clinic zone (`clinicTimezone(clinic)` from `@/domain/clinicRegion`) and `formatDateDM` /
  `formatDateDMY` from `@/domain/fiscalYear`. No `'en-IN'` in new code.
- Use the `Pill` component from `@/components/ui` for badges. No emoji icons.
- Permissions come from `usePermissions()`: `invoiceRoleOk`, `invoicingOnPlan`, `canCollectPayment`.

---

## Task 1: Shared invoice status label (no visible change)

**Files:** `src/domain/invoiceStatus.ts`, `src/domain/invoiceStatus.test.ts` (new or extend), `src/features/invoices/InvoicesPage.tsx`

Add to `invoiceStatus.ts`:

```ts
export type InvoiceDisplay = { label: 'Superseded' | 'Void' | 'Paid' | 'Partially paid' | 'Outstanding'; tone: 'slate' | 'green' | 'amber'; isPartial: boolean };
export function invoiceDisplayStatus(args: { isSuperseded: boolean; status: PaymentStatus; paidPaise: number }): InvoiceDisplay;
```

Rules (identical to what `InvoicesPage` prints today): superseded wins over everything → `Superseded`/slate; else `paid` →
`Paid`/green; `void` → `Void`/slate; else `outstanding` with `paidPaise > 0` → `Partially paid`/amber (`isPartial: true`);
else `Outstanding`/amber. Replace the two inline Pill tone/label ternaries in `InvoicesPage.tsx` (the phone cards and the
table rows; search for `'Superseded'`) with a call to it.

**Tests:** one case per label; superseded + paid → `Superseded`; outstanding with 0 paid → `Outstanding`, with 1 paid →
`Partially paid`. `InvoicesPage.pastInvoices.test.tsx` passes unchanged.

**Commit:** `refactor(invoices): one place decides an invoice's status label`

## Task 2: Address on the profile header

**Files:** `src/components/CopyAddressButton.tsx` (new, + test), `src/components/schedule/AppointmentDetailsPanel.tsx`,
`src/features/patients/PatientProfilePage.tsx`

1. `CopyAddressButton({ address }: { address: string })`: a `type="button"` styled like the existing one in
   `AppointmentDetailsPanel` (lines ~219-226), label `Copy address`, then `Address copied ✓`. It calls
   `navigator.clipboard?.writeText(address)`; a rejected or missing clipboard leaves the label unchanged (no throw).
2. `AppointmentDetailsPanel` uses it in place of its inline button and its `addressCopied` state. Its existing test
   (`AppointmentDetailsPanel.home.test.tsx`) must pass unchanged.
3. In the identity header of `PatientProfilePage`, under the Patient ID / phone line, when `homeCareOn(clinic)` and
   `patient.address` is non-empty: the address as text clamped to 2 lines (`line-clamp-2`, `whitespace-pre-line`) and the
   `CopyAddressButton`. No map link (owner decision 2026-11-06).

**Tests:** copy writes the address and shows the copied label; no throw when `navigator.clipboard` is undefined. Profile
test (or render test of the header block): address shown for a home-care clinic with an address; hidden when home care is
off; hidden when the address is empty.

**Commit:** `feat(patients): the home address and a Copy address button on the profile`

## Task 3: Place on the next appointment and on past visits

**Files:** `src/features/patients/PatientProfilePage.tsx`, `src/components/VisitCard.tsx`

1. Next appointment strip (`upcomingAppointments[0]`): replace the two `toLocaleDateString('en-IN')` /
   `toLocaleTimeString('en-IN')` calls with clinic-zone formatting (weekday short, day, month short; time 12-hour) using
   `Intl.DateTimeFormat(undefined, { timeZone: clinicTimezone(clinic), … })`. Add a `Pill tone="slate"` with the place
   label after the time under the Global rule.
2. `VisitCardData` gains `location?: CareLocation`. `visitCardRows` in the profile sets `location: locationOf(v)`. `VisitCard`
   shows the same pill next to the service name, in both the card and the compact forms, under the Global rule. `VisitCard`
   needs to know whether to show places: pass a boolean prop `showPlace` (default `false`) set from
   `offersLocationChoice(clinic)` by the profile; other callers of `VisitCard` are unchanged.

**Tests:** `VisitCard` with `showPlace` false and a home visit → no pill; `showPlace` true with home → `Home visit`; with
clinic → none; with ward → `Inpatient`. Profile: next appointment at home shows `Home visit` for a home-care clinic and
nothing for a clinic-only clinic.

**Commit:** `feat(patients): the place of care on the next appointment and on past visits`

## Task 4: Invoices on the profile

**Files:** `src/features/patients/PatientInvoicesList.tsx` (new, + test), `src/domain/patientInvoices.ts` (new, + test),
`src/features/patients/PatientProfilePage.tsx`, `src/app/router.tsx`, `src/features/invoices/InvoicePrintPage.tsx`

**Which invoices belong to the patient** (`src/domain/patientInvoices.ts`):

```ts
export function invoicesForPatient(
  patientId: string,
  invoices: Invoice[],
  visits: Pick<Visit, 'invoiceId' | 'patientId' | 'deleted'>[]
): Invoice[]; // newest issuedAt first, no duplicates
```

An invoice is the patient's when `invoice.patientSnapshot.patientId === patientId`, or any non-deleted visit with
`visit.invoiceId === invoice.id` has `visit.patientId === patientId` (older bills have no snapshot id). Tests: matched by
snapshot id; matched only through a visit (older bill); another patient's bill excluded; a bill matched both ways appears
once; ordering.

**Profile changes:**
- Show the toggle only when `invoicingOnPlan && invoiceRoleOk`. Otherwise the page is unchanged.
- Route search: `patientProfileRoute` accepts `view?: 'invoices'` (anything else is dropped). The toggle sets/clears it
  with `navigate({ search: prev => … , replace: true })`, so Back from a bill lands on the same tab.
- Toggle: `role="tablist"` with two `role="tab"` buttons (`aria-selected`), `Visits (N)` and `Invoices (M)`. M counts the
  patient's invoices that are not superseded. Left/Right arrow keys move between the tabs.
- When `view === 'invoices'` render `PatientInvoicesList` in place of the visit history; the visit-selection bar and the
  grouped/ungrouped controls belong to Visits only.
- Side column `PaymentsSummarySection`: add a small link `N bills · View` (same visibility rule, N as above) that switches
  to the Invoices tab.

**`PatientInvoicesList` props:** `{ invoices: Invoice[]; statusByInvoiceId: Map<string, PaymentStatus>; paidByInvoiceId:
Map<string, number>; supersededInvoiceIds: Set<string>; sampleVisitIdByInvoiceId: Map<string, string>; patientId: string;
patientName: string; mrno: string; onTakePayment: (inv: Invoice) => void; canCollect: boolean; backSearch: … }`. Compute the
maps in the profile the way `InvoicesPage` does (status via `invoiceRowStatus`, paid = sum of direct payments over the
invoice's visits, superseded set as on `InvoicesPage`); the profile already loads `invoicePayments` and visits.
- One row per invoice, newest first; superseded ones are dimmed.
  Row: bill number (`inv.invoiceNo`), `formatDateDM(inv.issuedAt)`, `formatAmount(inv.totalPaise)`, a `Pill` from
  `invoiceDisplayStatus`, and `X collected · Y due` for a partial bill.
- Actions: **Print** (`Link` to `/invoices/$invoiceId/print` with `search={{ from: '/patients', patient: patientId }}`);
  **Take payment** when not superseded, status `outstanding`, a visit exists for it, and `canCollect` (opens the profile's
  existing `TakePaymentDialog` through `onTakePayment`, same props the Ledger passes); **Send WhatsApp reminder** only for
  outstanding bills and only with `canCollect`, reusing `remindToPay`'s logic: move it out of `InvoicesPage` into
  `src/features/invoices/remindToPay.ts` (a function taking `{ clinic, invoice, remainingPaise, phone }`) and call it from
  both places.
- Layout: boxed cards below the `tab` breakpoint, a table from `tab` up (same classes `InvoicesPage` uses).
- Empty state: "No bills for this patient yet."

**Print page Back:** `invoicePrintRoute` search also accepts `patient?: string` (a non-empty string; otherwise dropped).
In `InvoicePrintPage`, when `from === '/patients'` and `patient` is set, "← Back" links to
`/patients/$patientId` with `search={{ view: 'invoices' }}`; every other case stays as today. Pass `patient` through the
places that already forward `from`/`tab` (lines ~456, ~470, ~485 in `InvoicePrintPage.tsx`).

**Tests:** `PatientInvoicesList` renders one row per invoice with the right pill; a partial bill shows collected/due;
Take payment absent without `canCollect` and for a superseded or paid bill; reminder absent for a paid bill. Profile: tab
hidden when `invoiceRoleOk` is false and when `invoicingOnPlan` is false; count excludes superseded. Route: `view=invoices`
opens the Invoices tab.

**Docs (same commit):** update the patient-profile part of `FEATURES_AND_SCHEMA.md` (address, place pills, Invoices tab and
its visibility rule, `invoicesForPatient`, `invoiceDisplayStatus`, `remindToPay`).

**Commit:** `feat(patients): a patient's bills on the profile, with print, take payment and reminder`

## Task 5: Visit card links to its bill

**Files:** `src/components/VisitCard.tsx`, `src/features/patients/PatientProfilePage.tsx`

On an invoiced visit, the bill number shown on the card (use `data.invoiceNo`; add it to `VisitCardData` as
`invoiceNo?: string | null` and fill it from the invoices already loaded) becomes a `Link` to
`/invoices/$invoiceId/print` with `search={{ from: '/patients', patient: <patientId> }}`. The rest of the card (Collect
button, lock, status pill) is unchanged. Shown only when `data.invoiceId` is set and the user passes the same visibility
rule as Task 4 (pass `canOpenInvoice` as a prop, default `false`, so other callers keep today's output).

**Tests:** link present with `invoiceId` and `canOpenInvoice`; plain text or nothing otherwise.

**Commit:** `feat(patients): a visit's bill number opens the bill`

---

## Verification (after Task 5)
- `npm run typecheck && npm run lint && npm run test && npm run build`.
- A clinic with only Clinic OPD (home care off): no address, no pills, Visits tab as before.
- Owner check at 375px and 1280px: Invoices tab, Take payment from the profile, Print then Back returns to the Invoices tab.

## Not in this plan
Admit/Discharge banner (inpatient Phase 2), map links, editing or voiding bills from the profile.
