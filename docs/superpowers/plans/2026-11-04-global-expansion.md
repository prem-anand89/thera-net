# Global Expansion (India-first) Implementation Plan — v2

**Status (2026-11-08):** Reference. Superseded as the working plan by `2026-11-05-foundations-global-and-care.md`; its Task 1 (currency and tax columns) and the money rule are built there (G5, G1). The rest waits for a trigger to go global.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a clinic outside India run TheraNet natively (its own currency, phone country, payment methods, tax wording) while every existing Indian clinic sees **no change at all**.

**Architecture:** The database already stores integer minor units (100 per major unit). A clinic gets two new settings, `currency_code` (default `INR`) and `tax_regime` (default `GST_IN`), next to the existing `timezone` / `default_country_code`. Because money and phone helpers are called from plain domain/service code with no React context, the clinic's currency and country code are published once into a tiny module (`src/domain/clinicRuntime.ts`) by the clinic provider in `Shell.tsx` (and by `BookingFormPage.tsx` on public routes); helpers read it and fall back to India. The Settings picker ships **last**, only after every screen honours the setting.

**Tech Stack:** React, TypeScript, Vitest, Supabase migrations, Dexie. No new dependencies.

**Spec:** Review conversation 2026-11-04 (global-readiness review; v1 of this plan corrected after code audit and Cursor feedback integration).

## India-first principle (applies to every task)

- Every new setting defaults to India: `currency_code = 'INR'`, `tax_regime = 'GST_IN'`, country `+91`, zone `Asia/Kolkata`. A clinic that never opens the new controls must behave **byte-for-byte as today**.
- Each task that changes a helper adds a **regression test pinning the India output** (named `India unchanged: …`). If such a test has to be edited to pass, stop: the task is wrong.
- Code reads settings defensively (`clinic.currencyCode ?? 'INR'`) so the app works before the migration is applied (Rule 2).
- No new Indian-only assumption may be added anywhere; Indian-only surfaces (UPI, GSTIN, TDS) are gated by `taxRegime === 'GST_IN'`.

## Global Constraints

- No new npm dependencies (Rule 3). No `libphonenumber-js`.
- No sixth mobile tab. WhatsApp = `wa.me` deep links only; the Meta Cloud API stays hidden (`send-whatsapp-template` exists but is not exposed). No automated WhatsApp reminders, no `pg_cron` WhatsApp.
- CSS variables only; every `<button>` has an explicit `type`; errors inside dialogs via `<ErrorNote>`; "Patient ID", never "MRN".
- Money maths stays in `src/domain/visitLines.ts` / `payBase.ts`; this plan changes **display and gating only**.
- Migration number must be later than the newest file in `supabase/migrations/` (check with `ls supabase/migrations | tail -3`). Use `20261104150000_clinic_currency_tax_regime.sql`. **Write the file; do not apply it** (Rule 2, Claude applies).
- Update `FEATURES_AND_SCHEMA.md` (every copy) and `README.md` in the same change (Rule 1).
- Verify with `npm run check:fast` during work; pass worker flags on the command line, never edit `vite.config.ts`.

## Out of scope (decided in review — do not build)

Meta/`pg_cron` WhatsApp automation; HIPAA/GDPR `compliance_mode`; multi-currency FX; i18n; warfarin/regex clinical rules; `active_module_key` enum; library RLS; scheduling-step redesign; assessment/HEP work; staff-screen "today" in clinic zone (the docs say staff screens use the device clock by design; revisit only if a clinic's devices sit in another zone). `navigator.storage.persist()` is already done (`src/lib/persistStorage.ts`, called from `Shell.tsx`); Web Push is already built (`src/features/notifications/pushSubscription.ts`, `supabase/functions/send-push`).

## Review Focus

1. **India unchanged:** an INR/GST_IN/+91 clinic gets identical money strings, WhatsApp URLs, payment options and defaults, settings cards.
2. **Indian number starting "91":** a 10-digit Indian mobile like `9198765432` must still become `919198765432` (a "starts with the prefix" shortcut would break it).
3. **Partial rollout:** a clinic row with no `currencyCode`/`taxRegime` (migration not applied, or old Dexie row) renders as India.
4. **Historic data after a regime change:** UPI payments recorded earlier still show "UPI" in Daybook, invoices and the ledger after the clinic switches to a non-GST regime.
5. **Non-2-decimal currencies:** selecting a currency whose minor unit is not 1/100 must not be possible (closed list).
6. **Public booking runtime context:** `/book/:slug` bypasses `ClinicContext`; `BookingFormPage` must populate `clinicRuntime` so public booking uses the clinic's country/currency.
7. **Test isolation hygiene:** Any test that sets `setClinicRuntime()` must clear it in `afterEach(() => setClinicRuntime({}))` to prevent worker pollution.

---

### Task 1: Schema, types and defaults (no RPC change)

**Files:**
- Create: `supabase/migrations/20261104150000_clinic_currency_tax_regime.sql`
- Modify: `src/domain/types.ts` (the `Clinic` type, near `timezone` / `defaultCountryCode` ~L131-136)
- Modify: `src/domain/clinicRegion.ts`
- Test: `src/domain/clinicRegion.test.ts`

**Interfaces:**
- Produces: `type TaxRegime = 'GST_IN' | 'GENERIC_TAX' | 'NO_TAX'`; `Clinic.currencyCode?: string`; `Clinic.taxRegime?: TaxRegime`; `clinicCurrencyCode(clinic)`, `clinicTaxRegime(clinic)`, `isGstIndia(clinic)`; `SUPPORTED_CURRENCIES`.

> **Tax regime vs Partner billing:** `isGstIndia` gates UPI/GSTIN copy and Indian tax fields, NOT `hasPartner` / TDS / settlement reports. Non-India clinics with a partner hospital (`hasPartner: true`) function normally; `tax_regime` simply controls the tax wording and removes India-specific UPI.

> **Do NOT touch `get_booking_clinic_info`.** The newest version is in `20261101200000_clinic_operating_hours.sql` and returns `operatingHours`; replacing it without operating hours would drop them from the public booking page.

- [ ] **Step 1: Write the failing test**

```ts
import { clinicCurrencyCode, clinicTaxRegime, isGstIndia } from './clinicRegion';

describe('currency and tax regime defaults', () => {
  it('India unchanged: missing fields read as INR / GST_IN', () => {
    expect(clinicCurrencyCode(null)).toBe('INR');
    expect(clinicCurrencyCode({})).toBe('INR');
    expect(clinicTaxRegime(null)).toBe('GST_IN');
    expect(clinicTaxRegime({})).toBe('GST_IN');
    expect(isGstIndia({})).toBe(true);
  });
  it('explicit values win', () => {
    expect(clinicCurrencyCode({ currencyCode: 'GBP' })).toBe('GBP');
    expect(isGstIndia({ taxRegime: 'GENERIC_TAX' })).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/domain/clinicRegion.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement**

Migration:

```sql
-- Currency and tax regime per clinic. Defaults keep every existing clinic exactly as it is (India).
alter table public.clinics
  add column if not exists currency_code text not null default 'INR',
  add column if not exists tax_regime text not null default 'GST_IN';

alter table public.clinics drop constraint if exists clinics_currency_code_values;
alter table public.clinics add constraint clinics_currency_code_values
  check (currency_code in ('INR','USD','GBP','EUR','AED','AUD','CAD','SGD'));

alter table public.clinics drop constraint if exists clinics_tax_regime_values;
alter table public.clinics add constraint clinics_tax_regime_values
  check (tax_regime in ('GST_IN','GENERIC_TAX','NO_TAX'));
```

`types.ts`: add `export type TaxRegime = 'GST_IN' | 'GENERIC_TAX' | 'NO_TAX';` and, on `Clinic`, `currencyCode?: string; taxRegime?: TaxRegime;`.

`clinicRegion.ts` (import `TaxRegime` from `./types`):

```ts
export const DEFAULT_CURRENCY_CODE = 'INR';
/** Closed list: every one has 100 minor units per major unit, which the integer-minor-unit storage assumes. */
export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD', 'CAD', 'SGD'] as const;

export function clinicCurrencyCode(clinic: { currencyCode?: string | null } | null | undefined): string {
  return clinic?.currencyCode || DEFAULT_CURRENCY_CODE;
}
export function clinicTaxRegime(clinic: { taxRegime?: TaxRegime | null } | null | undefined): TaxRegime {
  return clinic?.taxRegime || 'GST_IN';
}
export const isGstIndia = (clinic: { taxRegime?: TaxRegime | null } | null | undefined) => clinicTaxRegime(clinic) === 'GST_IN';
```

- [ ] **Step 4:** Confirm sync needs no mapping change: `src/repositories/rowMapping.ts` converts keys generically and `src/sync/engine.ts` pulls with `select('*')`, so `currency_code` → `currencyCode` arrives on its own. Run `grep -n "select('\*')" src/sync/engine.ts` and note the result in the commit message. Run the test → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104150000_clinic_currency_tax_regime.sql src/domain/types.ts src/domain/clinicRegion.ts src/domain/clinicRegion.test.ts
git commit -m "feat(global): clinic currency_code and tax_regime (default INR / GST_IN)"
```

Report the migration path to Claude for review and live apply.

---

### Task 2: Runtime holder and money formatter

**Files:**
- Create: `src/domain/clinicRuntime.ts`, `src/domain/clinicRuntime.test.ts`
- Modify: `src/domain/money.ts` (L63-77)
- Test: `src/domain/money.test.ts`

**Interfaces:**
- Produces: `setClinicRuntime({ currencyCode?, countryCode? })`, `activeCurrency(): string` (default `'INR'`), `activeCountryCode(): string` (default `'+91'`); `formatMoney(minor, currency?, locale?)`; `formatAmount(minor)` (active currency); `currencySymbol(currency?)`; `formatINR` kept as strict INR.

> **Vitest hygiene:** Any test setting `setClinicRuntime({...})` must have `afterEach(() => setClinicRuntime({}))` to ensure test isolation.

- [ ] **Step 1: Write the failing tests**

`money.test.ts`:

```ts
import { formatMoney, formatAmount, formatINR, currencySymbol } from './money';
import { setClinicRuntime } from './clinicRuntime';

afterEach(() => setClinicRuntime({}));

describe('money formatting', () => {
  it('India unchanged: formatINR and formatAmount without a setting match the old output', () => {
    expect(formatINR(150000)).toBe('₹1,500');
    expect(formatINR(150050)).toBe('₹1,500.50');
    expect(formatAmount(150000)).toBe('₹1,500');
    expect(formatAmount(150050)).toBe('₹1,500.50');
    expect(formatAmount(0)).toBe('₹0');
    expect(formatAmount(-25000)).toBe(formatINR(-25000));
    expect(formatAmount(12345678)).toBe('₹1,23,456.78'); // Indian digit grouping preserved
  });
  it('formats other currencies, whole amounts without decimals', () => {
    expect(formatMoney(50000, 'USD')).toBe('$500');
    expect(formatMoney(50050, 'USD')).toBe('$500.50');
    expect(formatMoney(4575, 'GBP')).toBe('£45.75');
    expect(formatMoney(12000, 'AED')).toContain('120');
  });
  it('formatAmount follows the active clinic currency', () => {
    setClinicRuntime({ currencyCode: 'GBP' });
    expect(formatAmount(4500)).toBe('£45');
  });
  it('currencySymbol', () => {
    expect(currencySymbol()).toBe('₹');
    expect(currencySymbol('GBP')).toBe('£');
  });
});
```

`clinicRuntime.test.ts`: defaults are `INR`/`+91`; `setClinicRuntime({ currencyCode: 'USD', countryCode: '+1' })` is read back; `setClinicRuntime({})` resets to India; an empty-string value falls back to India.

- [ ] **Step 2:** Run both → FAIL.

- [ ] **Step 3: Implement**

`clinicRuntime.ts`:

```ts
/**
 * The signed-in clinic's currency and phone country, published once by the clinic provider so plain domain and
 * service code (no React context) can read them. Absent or blank = India, so nothing changes for Indian clinics.
 */
let currency = 'INR';
let country = '+91';

export function setClinicRuntime(next: { currencyCode?: string | null; countryCode?: string | null }): void {
  currency = next.currencyCode || 'INR';
  country = next.countryCode || '+91';
}
export const activeCurrency = () => currency;
export const activeCountryCode = () => country;
```

`money.ts` (keep every existing export; replace only the formatter block):

```ts
const LOCALES: Record<string, string> = {
  INR: 'en-IN', USD: 'en-US', GBP: 'en-GB', EUR: 'en-IE', AED: 'en-AE', AUD: 'en-AU', CAD: 'en-CA', SGD: 'en-SG',
};
const formatters = new Map<string, Intl.NumberFormat>();
function formatter(code: string, locale: string, fraction: 0 | 2): Intl.NumberFormat {
  const key = `${locale}|${code}|${fraction}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: fraction, maximumFractionDigits: fraction });
    formatters.set(key, f);
  }
  return f;
}

/** Minor units (1/100 of the major unit) as money; whole amounts show no decimals, as formatINR always did. */
export function formatMoney(minor: Paise, currencyCode = 'INR', locale?: string): string {
  const code = currencyCode.toUpperCase();
  return formatter(code, locale ?? LOCALES[code] ?? 'en-US', minor % 100 === 0 ? 0 : 2).format(minor / 100);
}
/** Strictly rupees (India-only surfaces such as UPI). Everything else uses formatAmount. */
export const formatINR = (paise: Paise): string => formatMoney(paise, 'INR', 'en-IN');
/** Money in the signed-in clinic's currency (INR until it is set). */
export const formatAmount = (minor: Paise): string => formatMoney(minor, activeCurrency());
export function currencySymbol(currencyCode: string = activeCurrency()): string {
  return new Intl.NumberFormat(LOCALES[currencyCode.toUpperCase()] ?? 'en-US', { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 })
    .formatToParts(0).find((p) => p.type === 'currency')?.value ?? currencyCode;
}
```

(import `activeCurrency` from `./clinicRuntime`.) Update the file's top comment: "integer paise" → "integer minor units (paise, cents, pence)"; keep the `rupeesToPaise` / `roundToRupeeHalfUp` names (renaming is out of scope).

- [ ] **Step 4:** Run `npx vitest run src/domain/money.test.ts src/domain/clinicRuntime.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(money): formatMoney, formatAmount and the clinic runtime holder`.

---

### Task 3: Publish the clinic's settings and switch every screen to `formatAmount`

**Files:**
- Modify: `src/app/Shell.tsx` (the two `ClinicContext.Provider` sites, ~L411 and ~L420)
- Modify: every non-test file that imports `formatINR` (about 53; list with `grep -rln "formatINR" src --include=*.ts --include=*.tsx | grep -v test`)
- Test: `src/app/Shell` has no unit test today; add `src/domain/clinicRuntime.test.ts` case below.

**Interfaces:**
- Consumes: `setClinicRuntime`, `formatAmount`, `clinicCurrencyCode`, `clinicCountryCode`.

- [ ] **Step 1: Publish from the provider.** Where `clinic` is resolved in `Shell.tsx`, before rendering the providers, call (synchronously in the component body, idempotent, so children never render with a stale value):

```ts
setClinicRuntime({ currencyCode: clinicCurrencyCode(clinic), countryCode: clinicCountryCode(clinic) });
```

On sign-out / no clinic, call `setClinicRuntime({})`.

- [ ] **Step 2: Targeted rename (codemod / file list).** In every non-test file, replace the import and calls `formatINR` → `formatAmount` (including functions passed as props, e.g. `formatRevenue={formatINR}` in `RevenueTrendPanel` and `TherapistComparisonCard`). Keep `formatINR` strictly in `money.ts` and `UpiQrModal.tsx` (UPI is rupee-only). Do not touch unit test files that intentionally verify `formatINR`.

```bash
grep -rl "formatINR" src --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -v "src/domain/money.ts" | grep -v UpiQrModal \
  | xargs sed -i 's/\bformatINR\b/formatAmount/g'
```

Existing tests that import `formatINR` keep passing because India output is identical; leave them.

- [ ] **Step 3: Test.** Add to `clinicRuntime.test.ts` a case that `formatAmount` switches when `setClinicRuntime({ currencyCode: 'USD' })` and returns to `₹` after `setClinicRuntime({})`.
- [ ] **Step 4:** `npm run typecheck && npm run lint && npx vitest run --maxWorkers=2` → all pass with **no edits to existing expectations** (this is the India-unchanged proof).
- [ ] **Step 5: Commit** `refactor(money): screens format in the clinic currency (INR by default)`.

---

### Task 4: Replace hard-coded `₹` text in the UI

**Files:** the non-comment `₹` literals in `src` (117 matches today, including `LetterheadPreview.tsx`, `PatientProfilePage.tsx`, `ServiceRows.tsx`, `BillAdjustmentFields.tsx`, `NewVisitPage.tsx`, `RevenueTrendMonthTable.tsx`, `reportService.ts`, `attributionAuditService.ts`, `visitService.ts`, `paymentState.ts`, `catalogDisplay.ts`, `ui.tsx`).

- [ ] **Step 1: Classify.** `grep -rn "₹" src --include=*.ts --include=*.tsx | grep -v "\.test\."`. Sort each hit as (a) comment/doc text → leave; (b) user-visible string or input prefix → replace; (c) India-only (UPI, GST wording) → leave.
- [ ] **Step 2: Replace (b)** with `currencySymbol()` (components) or `formatAmount()` (messages, e.g. error text in services, print pages). Example: `` `₹${n}` `` → `formatAmount(n * 100)`; an input adornment `₹` → `{currencySymbol()}`.
- [ ] **Step 3: Test.** For two representative screens (a bill-adjustment field and an invoice total), add a test that sets `setClinicRuntime({ currencyCode: 'GBP' })` and asserts `£` appears and `₹` does not; the default (India) test asserts `₹`. Ensure `afterEach(() => setClinicRuntime({}))` is present.
- [ ] **Step 4:** Re-run the grep: remaining `₹` are only comments, tests, `formatINR`/UPI. List them in the commit message.
- [ ] **Step 5: Commit** `feat(global): no hard-coded rupee symbol outside India-only surfaces`.

---

### Task 5: WhatsApp links use the clinic's country code

**Files:**
- Modify: `src/lib/pdfShare.ts` (`normalizePhoneForWaMe`, ~L121-132)
- Test: `src/lib/pdfShare.test.ts`

**Interfaces:** `normalizePhoneForWaMe(phone: string, defaultCountryCode: string = activeCountryCode()): string`. Callers (`bookingService`, `feedbackService`, `InvoicesPage`, `InvoicePrintPage`, `PatientProfilePage`, `VisitRowActions`, `whatsappSend`) **need no change**: they reach this through `openPatientWhatsAppChat` / `buildWhatsAppSendUrl`, and the default reads the published clinic country.

- [ ] **Step 1: Write the failing tests**

```ts
import { setClinicRuntime } from '@/domain/clinicRuntime';
afterEach(() => setClinicRuntime({}));

describe('normalizePhoneForWaMe country code', () => {
  it('India unchanged: bare 10 digits get 91, even when they start with 91', () => {
    expect(normalizePhoneForWaMe('9876543210')).toBe('919876543210');
    expect(normalizePhoneForWaMe('9198765432')).toBe('919198765432');
  });
  it('uses the clinic country for bare numbers', () => {
    setClinicRuntime({ countryCode: '+44' });
    expect(normalizePhoneForWaMe('7123456789')).toBe('447123456789');
    setClinicRuntime({ countryCode: '+1' });
    expect(normalizePhoneForWaMe('2125551234')).toBe('12125551234');
  });
  it('an explicit + number is never re-prefixed', () => {
    setClinicRuntime({ countryCode: '+44' });
    expect(normalizePhoneForWaMe('+91 98765 43210')).toBe('919876543210');
    expect(normalizePhoneForWaMe('+971 50 123 4567')).toBe('971501234567');
  });
});
```

(The existing tests at `pdfShare.test.ts` L12-50 and `publicBookingDays.test.ts` L259 must pass unchanged.)

- [ ] **Step 2:** Run → FAIL (UK case returns `917123456789`).
- [ ] **Step 3: Implement** — change only the prefix; keep the original rule:

```ts
export function normalizePhoneForWaMe(phone: string, defaultCountryCode: string = activeCountryCode()): string {
  const hadPlus = phone.trim().startsWith('+');
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (hadPlus) return digits;
  const prefix = defaultCountryCode.replace(/\D/g, '') || '91';
  return digits.length === 10 ? `${prefix}${digits}` : digits;
}
```

`+`-numbers are returned as typed, so stored `+CC …` values are never touched. Update the doc comment.

- [ ] **Step 4:** Run `npx vitest run src/lib/pdfShare.test.ts src/domain/publicBookingDays.test.ts` → PASS.
- [ ] **Step 5: Commit** `fix(whatsapp): bare numbers take the clinic's country code (91 by default)`.

---

### Task 5b: Public booking route sets clinic runtime

**Files:**
- Modify: `src/features/publicBooking/BookingFormPage.tsx`
- Test: `src/features/publicBooking/BookingFormPage.test.tsx`

**Motivation:**
Public booking (`/book/:slug`) and feedback (`/f/:token`) bypass `ClinicContext` in `Shell.tsx` (lines 332–338). Without this task, public booking would run with fallback India runtime (`INR` / `+91`).

- [ ] **Step 1: Write test for public booking runtime initialization**

In `BookingFormPage.test.tsx`:
Add test verifying that when `getBookingClinicInfo` returns clinic info with `timezone`, `defaultCountryCode`, or `currencyCode`, `activeCountryCode()` matches the clinic's setting while mounted and resets on unmount.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement runtime publish in BookingFormPage**

In `src/features/publicBooking/BookingFormPage.tsx`:
1. Import `setClinicRuntime` from `@/domain/clinicRuntime`.
2. When `bookingService.getBookingClinicInfo` succeeds:
   ```ts
   setClinicRuntime({
     countryCode: (info as any).defaultCountryCode || '+91',
     currencyCode: (info as any).currencyCode || 'INR',
   });
   ```
3. In `useEffect` cleanup (unmount):
   ```ts
   return () => {
     setClinicRuntime({});
   };
   ```
4. If `(info as any).defaultCountryCode` is present, initialize `countryCode` state from it if not already changed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/publicBooking/BookingFormPage.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/publicBooking/BookingFormPage.tsx src/features/publicBooking/BookingFormPage.test.tsx
git commit -m "feat(public-booking): sync clinicRuntime with booked clinic's settings"
```

---

### Task 6: Payment methods and UPI follow the tax regime

**Files:**
- Modify: `src/domain/paymentMethods.ts` (`paymentMethodOptions` L30-35, `defaultPaymentMethod` L52-62, `INVOICE_PAYMENT_MODES` L4)
- Modify: `src/features/visits/PaymentMethodChips.tsx` (L16 `PRIMARY_KEYS`), `src/features/visits/VisitSaveBar.tsx` (~L153), `src/components/IssueInvoiceDialog.tsx` (~L86), `src/components/TakePaymentDialog.tsx` (~L59), `src/features/visits/DaybookPage.tsx` (UPI column)
- Test: `src/domain/paymentMethods.test.ts`

**Interfaces:**
- `paymentMethodOptions(clinic: PartnerNames & { taxRegime?: TaxRegime })`, `defaultPaymentMethod(clinic, lastUsed)` (clinic now includes `taxRegime`), `invoicePaymentModes(clinic): PaymentMode[]`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('payment methods by tax regime', () => {
  it('India unchanged: options, order and default are the same as before', () => {
    expect(paymentMethodOptions({}).map((o) => o.value)).toEqual(['upi', 'cash', 'card', 'bank_transfer', 'cheque']);
    expect(defaultPaymentMethod({}, null)).toBe('upi');
    expect(invoicePaymentModes({})).toEqual(['UPI', 'Cash', 'Card', 'Insurance']);
  });
  it('outside GST_IN: no UPI, opens on cash', () => {
    const clinic = { taxRegime: 'GENERIC_TAX' as const };
    expect(paymentMethodOptions(clinic).map((o) => o.value)).toEqual(['cash', 'card', 'bank_transfer', 'cheque']);
    expect(defaultPaymentMethod(clinic, null)).toBe('cash');
    expect(defaultPaymentMethod(clinic, 'upi')).toBe('cash'); // a remembered UPI from before the switch is skipped
    expect(invoicePaymentModes(clinic)).toEqual(['Cash', 'Card', 'Insurance']);
  });
  it('historic UPI still has a label', () => {
    expect(paymentMethodLabel('upi', { taxRegime: 'GENERIC_TAX' })).toBe('UPI');
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Import `isGstIndia`. In `paymentMethodOptions` filter out `upi` when `!isGstIndia(clinic)`. In `defaultPaymentMethod`, treat `upi` as unusable when `!isGstIndia(clinic)` and end with `return isGstIndia(clinic) ? 'upi' : 'cash'`. Replace the constant with `invoicePaymentModes(clinic)` (keep `INVOICE_PAYMENT_MODES` exported for India and for tests; callers `IssueInvoiceDialog`, `AmendInvoiceDialog` switch to the function, and `IssueInvoiceDialog`'s initial state becomes `invoicePaymentModes(clinic)[0]`). `PaymentMethodChips`: build `PRIMARY_KEYS` from the clinic (`['upi','cash','card']` or `['cash','card']`). `VisitSaveBar`: hide the "UPI (Collect now)" entry when not GST_IN. `TakePaymentDialog`: the first split row defaults to `defaultPaymentMethod(...)` instead of the literal `'upi'`. `DaybookPage`: show the UPI column only when `isGstIndia(clinic)` **or** there is a non-zero UPI total in the range (historic data stays visible). `paymentMethodLabel` is unchanged.
- [ ] **Step 4:** Run `npx vitest run src/domain/paymentMethods.test.ts` plus the existing visit/payment component tests → PASS with no edits to their India expectations.
- [ ] **Step 5: Commit** `feat(payments): UPI only for GST_IN clinics; others open on cash`.

---

### Task 7: Visit-cap month uses the clinic's time zone (small)

**Files:**
- Modify: `src/domain/plans.ts` (`currentMonthRange`, L102-113), `src/app/useEntitlements.ts` (L161)
- Test: `src/domain/plans.test.ts`

Note: the server cap (`enforce_clinic_plan_on_visit_insert`) counts by `visit_date`, so it has no time zone issue; only the client's idea of "this month" depends on the device clock. This task keeps the two aligned; it is cosmetic for India.

- [ ] **Step 1: Write the failing test** (the three existing `currentMonthRange` tests at `plans.test.ts` L60-70 must still pass unchanged):

```ts
it('uses the given time zone for "now"', () => {
  const at = new Date('2026-03-31T22:30:00Z'); // 1 April in Kolkata, still 31 March in UTC
  expect(currentMonthRange(at, 'Asia/Kolkata')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  expect(currentMonthRange(at, 'UTC')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
});
it('an unknown zone falls back to the device clock', () => {
  expect(currentMonthRange(new Date('2026-02-15T12:00:00Z'), 'Nope/Zone')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Add an optional `timeZone?: string` parameter; when given, read year and month with `Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(now)` inside `try/catch` (fallback: `now.getFullYear()/getMonth()`); compute the last day with `new Date(year, month + 1, 0).getDate()`. In `useEntitlements.ts`: `currentMonthRange(new Date(), clinicTimezone(clinic))` (clinic read from `useClinic()` / the existing clinic source in that hook; if it has none, pass nothing).
- [ ] **Step 4:** Run `npx vitest run src/domain/plans.test.ts` → PASS.
- [ ] **Step 5: Commit** `fix(entitlements): visit-cap month in the clinic's time zone`.

---

### Task 8: Settings controls and tax-regime wording (ships last)

**Files:**
- Modify: `src/features/settings/ClinicSections.tsx` (`ClinicRegionSection` L292-430, `PaymentsSection` L680+), `src/features/settings/BillingSections.tsx` (L37-50), `src/domain/clinicRegion.ts` (`regionSummary` L44-47), `src/features/settings/sections.ts` (search keywords)
- Test: `src/features/settings/ClinicRegionSection.test.tsx`, `src/features/settings/PaymentsSection.test.tsx`

Prerequisite: Tasks 2-6 are merged, so choosing a currency or regime changes every screen. Do not ship the picker before that.

- [ ] **Step 1: Write the failing tests**
  - Region summary: for the default clinic the existing assertion in `ClinicRegionSection.test.tsx` L30 (`'India (+91) · India Standard Time (UTC+5:30) · Financial year from April'`) must still hold **unchanged**; the summary adds currency/regime text **only when they are not India's defaults**.
  - Opening **Change** shows combos named `Currency` and `Tax regime`; choosing `GBP` and `GENERIC_TAX` then Save calls `put` once with `{ currencyCode: 'GBP', taxRegime: 'GENERIC_TAX' }`. Add `currencyCode`/`taxRegime` to the form `Pick` (L292) and the initial values (`clinicCurrencyCode(c)`, `clinicTaxRegime(c)`).
  - Changing either asks first (same `ConfirmDialog` pattern as the time zone): "Amounts on every screen and invoice will show £ from now on. Existing amounts are not converted." (A currency change relabels, it does not convert; say so.)
  - Payments: with `taxRegime: 'GENERIC_TAX'` the "Show UPI QR at collection" switch is absent and a short note says UPI collection is for India; default clinic still shows it (existing `PaymentsSection.test.tsx` cases unchanged).
  - Billing: label is `GST / Tax ID (optional)` by default and `Tax ID / VAT number (optional)` when not GST_IN. The existing `settings-card-billing-invoicing` search keywords keep `gst`/`gstin` and add `vat`, `currency`, `tax`.
- [ ] **Step 2:** Run those test files → FAIL.
- [ ] **Step 3: Implement** with the existing `Field`, `inputCls`, `InfoTip`, and the existing confirm flow (`confirmingZone`) generalised to a `confirmingRegion` state; error text via `ErrorNote`; labels "Currency" and "Tax regime" with options `India (GST)`, `Other (VAT / sales tax)`, `No tax`; currency options from `SUPPORTED_CURRENCIES` labelled `INR (₹)`, `USD ($)`, etc.
- [ ] **Step 4:** Run the two test files → PASS; then `npm run check:fast`.
- [ ] **Step 5: Commit** `feat(settings): currency and tax regime in Region, gated UPI and tax-ID wording`.

---

### Task 9: Docs and final verification

**Files:** `FEATURES_AND_SCHEMA.md` (every copy; the Region paragraph near the "Clinic region and server times" text, and the clinics column list near the `timezone` column), `README.md`.

- [ ] **Step 1:** Document: `clinics.currency_code` (default `INR`, closed list) and `clinics.tax_regime` (default `GST_IN`) with the migration filename; `formatAmount` / `formatMoney` / `currencySymbol` and `clinicRuntime`; storage stays integer minor units; the `paise` names are historical; WhatsApp bare-number rule; UPI/GST gating; payments defaults; that a currency change relabels and never converts; the visit-cap month; and that staff "today" still uses the device clock.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm run test -- --maxWorkers=2 && npm run build`. All green with **no India expectation edited** (report if any was).
- [ ] **Step 3:** Manual India check on a dev clinic left at defaults: New visit opens on UPI; invoice shows ₹ with Indian grouping; Settings → Region reads exactly as before; a bare 10-digit number opens `wa.me/91…`.
- [ ] **Step 4:** Manual foreign check on a throwaway clinic set to GBP / GENERIC_TAX / +44 (after Claude applies the migration): £ everywhere, no UPI anywhere, bare number opens `wa.me/44…`.
- [ ] **Step 5: Commit** `docs: currency, tax regime and clinic runtime`.

---

## Appendix: Code Audit & Cursor Errata Note

During the review on 2026-11-04, an external tool (Cursor) reviewed this plan using a stale baseline snapshot (`20261015130000_restore_and_arrived_guards.sql` from mid-October). 
- **Rejected False Alarms (A1–A6):** Cursor claimed that `20261101200000_clinic_operating_hours.sql`, `clinicRegion.ts`, `visitLines.ts`, `payBase.ts`, `paymentMethods.ts`, `ClinicSections.tsx`, and `BillingSections.tsx` did not exist. Terminal inspection confirmed that every single one of these files exists on `main`. Following Cursor's A1–A6 would have rolled back 3 weeks of work.
- **Accepted Insights:**
  1. Cursor correctly noted that public booking (`/book/:slug`) renders outside `ClinicContext.Provider` (`Shell.tsx:332-338`). Added **Task 5b** to sync `clinicRuntime` inside `BookingFormPage.tsx`.
  2. Cursor correctly noted test hygiene: added mandatory `afterEach(() => setClinicRuntime({}))` to avoid Vitest worker state leakage.
  3. Cursor clarified that `tax_regime` is strictly for copy/UPI gating and does not disturb the optional `hasPartner` feature.
