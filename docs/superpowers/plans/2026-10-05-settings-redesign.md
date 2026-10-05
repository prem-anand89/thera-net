# Settings: Live Letterhead Preview + Safe Modularisation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use `- [ ]`.
> **Read first:** this plan was REWRITTEN after auditing the code. The earlier version assumed a 4-tab / path-routed layout that does not exist. Do not "improve" it by reintroducing `/settings/general`-style routes.

**Goal:** (A) Let admins see a live preview of their invoice letterhead while editing Clinic profile, any time (not just onboarding). (B) Split the 3,280-line `SettingsPage.tsx` into files **without changing behaviour or URLs**.

## Ground truth (verified in code — do not contradict)

- Tabs are **6**: `general, team, services, booking, billing, account` (`SETTINGS_TABS` in `src/features/settings/sections.ts`). There is **no** "Advanced" tab.
- URL state is `/settings?tab=…&catalogView=…&fromSetup=true`, validated by `parseSettingsSearch` (with `LEGACY_TABS` redirects). Route is a single `settingsRoute` in `src/app/router.tsx` (~L400).
- Callers that depend on `?tab=`: `SetupPage.tsx` (L25), `ClosedDaysSheet.tsx` (L111, `tab:'booking'`), `e2e/settings-mobile-nav.spec.ts`, `e2e/nav-active.spec.ts` (`/settings?tab=team`), `sections.test.ts`, `navActive.ts/.test.ts`.
- `SettingsPage` owns: active tab, dirty-form tracking (`FormKey` = profile|billing|partner|patientComms → `FORM_TAB`), the `useBlocker` leave-guard (it skips blocking when `next.pathname === '/settings'`), the discard `ConfirmDialog`, card search/anchor scrolling, default-landing logic (Team if unlinked therapists, Services if catalog empty).
- Section components inside the file: `ClinicProfileSection`(L807) `BillingSection`(L1007) `PartnerSection`(L1307) `PatientCommsSection`(L1536, + `WhatsAppBusinessSubsection`) `Therapists`(L2335, + `RosterCard`, `MemberCard`, `RolePill`, `OnboardingBadge`) `PlanSection`(L703) `HistoricalData` `DataBackup` `DangerZone`; `CatalogSection` is already its own file.
- Shared helpers every section uses: `useClinicSectionForm` (L551), `SectionSaveBar`(L629), `LockedSectionNotice`(L682), `SetOnceEditButton`(L799), `BoolToggle`(L1913), `toggleSet`, `Accent`/`ACCENT_VARS`.
- Existing letterhead: `PrintLetterhead({clinic, logoUrl, partnerLogoUrl})` in `src/features/invoices/printChrome.tsx`, used by `InvoicePrintPage` and `AdvanceReceiptPrintPage`. Logo URL = `publicLogoUrl(path)` from `@/lib/supabase`. `ClinicProfileSection` already computes `logoPreviewUrl` from the **draft** `form.logoPath` (L826).
- Note/ledger/session-log print pages have their own inline letterheads (NOT shared). Out of scope.

## Global constraints (hard rules)

1. **No URL/route changes.** `?tab=` stays the contract. Do not touch `router.tsx` or `sections.ts` tab lists. `sections.test.ts` and e2e specs must pass unmodified.
2. **No behaviour changes in Phase B.** Moves are cut-and-paste + imports only. **Never duplicate** a helper — move it once to a shared file and import it.
3. **Reuse `PrintLetterhead`; do not write a second letterhead.** The preview must be the same component invoices use so they cannot drift.
4. Preview is **read-only and additive**; it must not alter the save/dirty logic of `ClinicProfileSection`.
5. Follow existing UI (`SectionCard`, `Field`, `inputCls`, `btnPrimary`, CSS vars like `var(--border)`), Tailwind as already used. `desktop:` breakpoint is the existing wide-layout switch.
6. Don't touch Supabase schema, sync, or services. UI only.
7. After **every** task: `npm run typecheck && npm run lint && npm run test` must pass, then commit. The pre-push hook runs typecheck+lint; do not bypass it.

---

## Phase A — Live Letterhead Preview (do this first; small, additive)

### Task A1: Extract a reusable preview component

**Files:** Create `src/features/settings/LetterheadPreview.tsx`

- [ ] Props: `{ draft: Pick<Clinic,'name'|'address'|'phone'|'email'|'gstNo'|'partnerHospitalName'>; logoUrl: string|null; partnerLogoUrl: string|null }`.
- [ ] Render `PrintLetterhead` inside a white "paper" card (`bg-white`, border, shadow, small fixed aspect, `pointer-events-none`, `aria-hidden` not needed but label with a caption "Invoice preview"). Build a full `Clinic`-shaped object by spreading the real clinic and overriding the draft fields (do not invent defaults — if name is empty show the existing placeholder text "Your clinic name" via the caller, not by editing `PrintLetterhead`).
- [ ] Below the header, add a faint skeleton (grey bars) for patient/line items so it reads as an invoice. Static, no data.
- [ ] Unit test (`LetterheadPreview.test.tsx`, vitest + testing-library as used by `BookSlotSheet.test.tsx`): renders clinic name/address from draft; shows logo `<img>` only when `logoUrl` given.

### Task A2: Wire into General tab

**Files:** Modify `SettingsPage.tsx` (`ClinicProfileSection` only)

- [ ] Read `ClinicProfileSection` fully first. Pass `form.name/address/phone/email/gstNo` + `logoPreviewUrl` (already there) + `partnerLogoPreviewUrl` from `clinic` (partner lives in Billing; use saved value only).
- [ ] Layout: on `desktop:` show preview as a sticky right column (`desktop:sticky desktop:top-20`), on smaller widths show it **collapsed under the form** as a `<details>` "Preview invoice header". Do not make the form narrower on tablet portrait (the file notes iPad portrait already has width problems).
- [ ] Preview must update on each keystroke from the **unsaved draft** (`form`), so admins see changes before Save.
- [ ] Do NOT add new dirty state; do not read from `repos` inside the preview.

### Task A3: Verify (evidence required)

- [ ] `npm run dev`; open `/settings?tab=general`. Type in name/address → preview updates live. Upload a logo → appears. Refresh → shows saved values.
- [ ] Compare against `/invoices/...` print page for the same clinic: header must look identical (same component).
- [ ] Check 390px, 768px, 1280px widths: no horizontal scroll (see `e2e/settings-mobile-nav.spec.ts` "no sideways scroll").
- [ ] Run `npx playwright test e2e/settings-mobile-nav.spec.ts` if the env allows.
- [ ] Commit: `feat(settings): live letterhead preview on General tab`.

---

## Phase B — Mechanical split of `SettingsPage.tsx` (only after Phase A is merged and green)

Order matters: shared first, then leaves. One commit per task. After each, confirm the file still compiles and behaviour is unchanged.

### Task B1: Move shared helpers

**Files:** Create `src/features/settings/settingsShared.tsx`

- [ ] Move (export) `useClinicSectionForm`, `SectionSaveBar`, `LockedSectionNotice`, `SetOnceEditButton`, `BoolToggle`, `toggleSet`, `Accent`, `ACCENT_VARS`, `FormKey`. Update imports in `SettingsPage.tsx`. No logic edits.

### Task B2–B6: Extract sections (one task each)

Create in `src/features/settings/sections/` (avoid clashing with `sections.ts`; name the folder `panels/` instead): 
- `panels/GeneralPanel.tsx` ← `ClinicProfileSection` (+ `LetterheadPreview` usage)
- `panels/TeamPanel.tsx` ← `Therapists`, `RosterCard`, `MemberCard`, `RolePill`, `OnboardingBadge`
- `panels/BookingPanel.tsx` ← `PatientCommsSection`, `WhatsAppBusinessSubsection`, `BOOKING_SLUG_PATTERN`
- `panels/BillingPanel.tsx` ← `BillingSection`, `PartnerSection`
- `panels/AccountPanel.tsx` ← `PlanSection`, `HistoricalData`, `DataBackup`, `DangerZone`

Rules: keep each component's props identical (`onDirtyChange` etc.); `SettingsPage` keeps tab state, dirty tracking, blocker, discard dialog, search, anchors. Use `React.lazy` per panel **only if** it doesn't change the tab-switch transition behaviour (`startTransition` already wraps tab swaps); otherwise plain imports. Do not move `CatalogSection`.

### Task B7: Final verification

- [ ] `SettingsPage.tsx` is now a thin shell. `grep -n "function .*Section" SettingsPage.tsx` shows none of the moved ones.
- [ ] Manually test every tab, `?tab=partner`/`patientComms` legacy links, `fromSetup=true` "Back to setup" link, unsaved-changes prompts (edit General, click Team → discard dialog; edit then navigate away → leave confirm), card search jump + highlight, locked Billing on a lower plan.
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build`, plus the two settings/nav e2e specs.
- [ ] Update `FEATURES_AND_SCHEMA.md` Settings section (file layout + letterhead preview). Commit.

## Out of scope (do not do)

Path-based routes, new tabs ("Advanced"), changing `sections.ts`, services-card redesign, moving logo upload, onboarding wizard preview (can reuse `LetterheadPreview` later), print pages other than invoice/receipt letterhead.

---

## Phase C — Enterprise Invoice Upgrade (InvoicePrintPage)

### Task C1: Strict 2-Column Metadata Grid
- **File:** `src/features/invoices/InvoicePrintPage.tsx`
- **Action:** Replace the flexbox header (patient/invoice metadata) with a strict `grid grid-cols-2`. Add print-specific typography (`text-[11px]`, label/value rows).
- **Left Column:** `Patient Name`, `Patient ID`, `Age / Gender` (mapped from `invoice.patientSnapshot`).
- **Right Column:** `Bill No` (from `invoice.invoiceNo`), `Billing Date` (from `invoice.issuedAt`), `Consultant` (joined names from the locally computed `footerTherapists` which maps `invoice.therapistId` or `lineItems.therapistIds`), `Status`.
- **Action:** Add the centered `BILL CUM RECEIPT` title above the grid.

### Task C2: Formal Payment Details Ledger
- **Files:** `src/repositories/types.ts`, `src/repositories/local.ts`, `src/features/invoices/InvoicePrintPage.tsx`
- **Action:**
  1. Add `listByInvoiceId(invoiceId: UUID): Promise<Visit[]>` to `VisitRepo` (using Dexie's `where('invoiceId')` index) to avoid fetching all clinic visits.
  2. Create a pure helper `buildInvoicePaymentLedger(invoice, visits, payments, invoicePayment)` in `src/domain/` to cleanly resolve the ledger rows and balance logic.
  3. Replace the single `Payment mode:` line with a formal table (`Date | Mode | Amount`). If no payment rows exist but the invoice is paid at issue, gracefully fallback to one row using `invoice.paymentMode`.
  4. Under the ledger, print a clear **Balance Details** block (`Gross amount`, `Amount Paid`, `Balance To Pay`).

### Task C3: Amount in Words & Footer Elements
- **File:** `src/features/invoices/InvoicePrintPage.tsx`
- **Action:** 
  1. Ensure `(Received with thanks a sum of Rupees {amountInWords(invoice.totalPaise)} only)` is rendered correctly using the existing `src/domain/amountInWords.ts`. [COMPLETED]
  2. Implement an optional "Terms & Conditions" static UI block above the signature. [COMPLETED]
  3. Implement a formal page footer. Use a flexible `min-h-[calc(100vh-...)]` column with `mt-auto` rather than absolute positioning, to ensure it gracefully handles multi-page prints without overlapping the line items. [COMPLETED]
