# Foundations: Global Readiness and Care Settings

**Date:** 2026-11-05 (refreshed 2026-11-06) · **Status (updated 2026-11-08):** Part 1 is done: G1 (`fb6404b`, pushed), G2, G4 and G5 (`18aa8f3`). Part 2 Phase 1, home care (H1 to H4), is built and committed, waiting on the owner's check on devices. **Still open:** Phase 2 inpatient rehab, Phase 3 therapist areas, Phase 3b colour palette, Phase 4 split rates by location. The refresh below is history up to 2026-11-06.
**Replaces as the working plan:** `2026-11-04-global-expansion.md` and `2026-11-05-care-settings-ipd-opd-homecare.md`. Those two stay as reference for later; their detail is still useful once a trigger below fires.

**Owner decisions (2026-11-05):** add the currency and tax columns now (G5). Build home care and inpatient rehab now, so the app serves home-care therapists, rehab centres and hospitals (Part 2). This file stays local.

**Live data (2026-11-05):** 16 clinics, all India time and +91; 2 patients with a foreign number; 229 visits, **0 home visits**; 1 clinic with a partner; no IPD clinic.

---

## Status refresh (2026-11-06: re-checked against the code and the live database)

**Done and live:** G2 (WhatsApp country code), the partner statement fix, Settings Step 16 (16a, 16c, 16d), and the whole Awaiting plan (switch split, Awaiting list). Those items below are history; ignore their detail.

**Still to do:** G1, G4, G5, then Part 2 (Phases 1 to 4). Nothing in Part 2 or G5 has been started: no `care_locations`, `admissions`, `currency_code` or `tax_regime` exists anywhere.

**Corrections to the text below (found today):**
| What the plan says | What is true now |
|---|---|
| H1: "widen the `visits.location` check" | **No check existed.** `visits.location` was plain nullable text; the limit was only in TypeScript. H1 adds `visits_location_check` (clinic, home, ward, null allowed). `Visit.location` in TypeScript stays clinic or home until I4 widens it with `placeOfService`. |
| Live data: 0 of 229 visits home | **236 visits, 0 home** (196 have a null location, 40 say clinic). Null must keep reading as clinic everywhere (Reports, filters, the invoice). |
| G1: 53 files, 268 uses of `formatINR`; `₹` in 41 files, 123 uses | **54 files, 274 uses** of `formatINR`; `₹` typed by hand in **41 files, 52 uses** outside tests (the 123 counted tests and comments). Smaller than thought, still worth the lint rule. |
| H1: three RPCs take `p_location` (`confirm_booking_slot`, `confirm_booking_series`, `start_walk_in`) | **Correct as written.** The app never calls `confirm_appointment_request`, so it is left alone (an earlier note here said otherwise). `confirm_booking_slot` now carries `p_request_id` and `p_duration_minutes`, so the drop-and-recreate copies the **current** definitions. |
| "Awaiting plan first" | Done. H3 (location on `BookSlotSheet`, Home badge) now builds on the finished Awaiting list: its rows already show "Asked for", and the sheet already takes `requestAsked`. |

**Owner decisions since the plan was written (2026-11-06)**
- **Home care and Inpatient both stay behind switches, off by default** (Settings → General → Where you see patients). That includes today's Home toggle on New Visit: it goes behind the home-care switch, so a clinic that wants it turns it on. Nothing changes for a clinic that does nothing.
- **"N staff" stays** on the Weekly shifts "On shift" row (Gemini's `6940b49`); it replaces the earlier "N people".
- **G1 is built and pushed** (`fb6404b`): `formatAmount` and `currencySymbol()`, enforced by lint. The patient profile now shows amounts with thousands separators.
- **Platform admin and subscriptions** is a separate Gemini plan (`2026-11-06-platform-admin-subscriptions.md`): migration `20261106100000` (unapplied), the realtime plan path, docs. It does not touch the foundation work; both add migrations, numbered in order.
- **Phase 3b (team member colour palette, below) is planned, not built.**
- **No Google Maps link (2026-11-06).** A home appointment shows the address with **Copy address** and **Call**. Nothing map-related is built. (Replaces "Open in Maps" in H3.)
- **Therapist pay is a separate later feature, after the current app's issues are fixed.** Pay rules belong to the person (salary plus a % or flat amount per location), a monthly draft the admin adjusts and locks, admin-only and online-only. The older HR plans are the starting point. Phase 4 (partner rates by location) is only for partner contracts and does not pay therapists.
- **H4 adds a Clinic / Home split to Reports** (visits and billed per therapist and location, money untouched) when more than one location is on.

**Conflicts to watch while building**
- **Public online booking stays clinic-only**, and `online_booking_enabled` (new) is what the public RPCs check; H1 must not touch those five functions.
- **`doNotMessage`** and the WhatsApp rules now apply to Awaiting entries; a home visit's "Call / Open in Maps" row (H3) must follow the same rule.
- **Appointment `location` and the freed-time strip:** the "a time opened" match ignores location today. A home slot freed by a cancellation should not suggest a clinic-only person; decide when H3 lands.
- **Loading rule (PR #107):** every new list (Inpatients card, ward groups) shows `LoadingRows`, never "no inpatients", until its data has loaded.

---

## Part 1: Global foundation (about a day; not going global yet, so nothing changes for Indian clinics)

**Rule:** do only what gets more expensive every week it waits. Anything that one migration or one file can add later waits.

### G1. One way to show money (Sonnet)
- Today: `formatINR` in 53 files (268 uses), and `₹` typed by hand in 41 files (123 uses). That count grows with each feature, which is the real cost.
- Add `formatAmount` and `currencySymbol()` in `domain/money.ts`. Both return rupees for now, with no setting behind them. Move every screen to them with the mechanical rename; `formatINR` stays for India-only surfaces (UPI).
- Replace visible `₹` text with those two. Leave comments, tests, UPI.
- **Lint rule (error, not warning):** no custom rule needed. In `eslint.config.js`, ESLint's built-in `no-restricted-syntax` (`Literal` and `JSXText` containing `₹`) and `no-restricted-imports` (`formatINR`), with an override for `domain/money.ts`, `components/UpiQrModal.tsx`, the other UPI files and tests. This is the actual foundation: it stops the number growing back.
- **Test:** no existing expectation changes. Output for India is byte-for-byte the same.
- Touches 50+ files: run when no other work is in the tree.

### G2. WhatsApp uses the clinic's country code (Sonnet; do early, live bug)
- **A live bug:** `normalizePhoneForWaMe` strips to digits and adds 91 to any 10-digit result, so a stored `+65 91234567` (10 digits with its code) opens `916591234567`. Settings → Region also lets a clinic pick a country, which it ignores. Two live patients have foreign numbers; check them after the fix.
- **Fix:** add `domain/clinicRuntime.ts` (country code only), published from `Shell.tsx`, and rebuild the function on `splitPhone` from `domain/countryCodes.ts`, which already understands stored numbers. Keep stripping a `00` prefix. Nothing that sends a WhatsApp link changes (they all go through `lib/pdfShare.ts`).
- **Tests:** `9198765432` becomes `919198765432`; `+65 91234567` becomes `6591234567`; `+971 501234567` stays itself; a bare `501234567` with a +971 clinic gets 971; a trunk `0` is dropped; existing tests pass unchanged.

### G4. Write the map down (Sonnet)
- **`CLAUDE.md` rule:** no new India-only assumption. Money through `formatAmount`, phone through the clinic's code, zone through `clinicTimezone`.
- **`FEATURES_AND_SCHEMA.md` section "India-only surfaces":** the list a future global project starts from:
  - UPI (30 files); GST and TDS wording (`TDS` in 17 files); `amountInWords` (rupees, lakh, crore); "Bill cum receipt" and invoice labels.
  - `lastTenDigits` matches patients by the last 10 digits, which fails for shorter numbers abroad.
  - `*_paise` columns and the `Paise` type mean "1/100 of the currency". **Never rename them.** Currencies without 100 minor units (Japanese yen, Kuwaiti dinar) are out of scope by design.
  - One Supabase project in Mumbai, and plan prices in rupees.

### G5. Currency and tax columns (Sonnet, one migration; owner decision)
- `clinics.currency_code text not null default 'INR'` and `clinics.tax_regime text not null default 'GST_IN'`, with the check lists from the global plan's Task 1 (INR, USD, GBP, EUR, AED, AUD, CAD, SGD; GST_IN, GENERIC_TAX, NO_TAX). Types and `clinicCurrencyCode` / `clinicTaxRegime` / `isGstIndia` in `clinicRegion.ts`, with India fallbacks.
- **Stored only.** No picker and no screen reads them until every screen honours them, or a clinic could set GBP and still see ₹. `get_booking_clinic_info` is untouched.
- Do not change it per clinic by hand. Document that in the schema docs.

### Not now, on purpose
| Item | Why it can wait |
|---|---|
| Currency and tax pickers, and screens reading those columns | Only safe once G1 is done and a clinic outside India is signed |
| Hiding UPI by regime, tax-ID wording | A few files once a regime exists |
| Translation (i18n) | Large, and English covers the UK, UAE, Singapore and Australia |
| Patient privacy compliance (GDPR, HIPAA), data regions | Needs legal advice, and is likely a separate Supabase project per region, not a code change. The app reading its project URL from environment settings (confirmed) keeps that door open |

**Trigger for the rest:** a signed clinic outside India. (`restore_cancelled_appointment` already uses the clinic's zone since `20261021100000`; `Asia/Kolkata` there is only the fallback.) Then use `2026-11-04-global-expansion.md` Tasks 2, 4 to 8 on top of this (Task 1 is G5). G1 removes most of its work.

---

## Part 2: Home care and inpatient rehab (build)

**Goal:** a home-care therapist, an inpatient rehab centre and a hospital rehab department can each run their day in the app. A clinic that turns none of this on sees no change.

**Still not a hospital system:** no bed occupancy, nursing notes, pharmacy or lab.

### Design rulings (corrections to the draft)
| Topic | Ruling |
|---|---|
| Where a visit happens | **Extend `visits.location`** with `ward`, not a new `care_setting` column: no backfill, and invoices' `placeOfService` already follows it. Screen words: **Clinic, Home visit, Inpatient**. |
| Which clinics see it | `clinics.care_locations text[] not null default '{clinic}'`. Settings → General → **Where you see patients**. One location means no toggle anywhere. The Home toggle on New Visit, shown to everyone today with 0 of 229 visits using it, goes behind this. |
| Admissions | A small `admissions` table, because the ward list needs to know who is admitted. |
| Payment | Reuse `partner` ("Collected by {partner}"); no `hospital_ipd` method. |
| Therapist areas | `therapists.care_locations`, default all. **Shapes pickers and defaults only**: any clinic member can read these rows. |
| Travel charge | **A normal service line** ("Home visit charge") in v1. Keeping it out of the partner split waits for an accountant's answer; the draft's "never taxed" claim is dropped. |
| Travel time between visits | Later (older program's 9b), once a home therapist's day shows the need. |

### Partner statement fix (Opus; first, on its own)
A live error, independent of this feature, and the discharge bill depends on it. `MonthlyStatementPage` picks one direction from `clinic.partnerCollects`, yet any visit can be settled the other way:
- A clinic that collects tells itself to pay the partner's full share, including visits where the hospital took 100% of the money.
- A partner-collecting clinic that takes a payment at its own desk has the mirror error.

**Fix:** work out the balance from who actually held each visit's money (`method = 'partner'` or not), show the two directions and one net figure, and put the sum in a pure tested function next to `payBase`. **Tests:** all-clinic and all-partner match today's figures exactly; mixed months net correctly in both directions; exact rounding. Only 1 clinic has a partner, so check its current month by hand after.

### Phase 1: Home care
**H1. Schema (Opus; migration).** Widen the `visits.location` check; `clinics.care_locations`; `patients.address text`; `appointments.location` and `service_catalog.default_location`, both defaulting to `clinic`; optional `p_location text default 'clinic'` on `confirm_booking_slot`, `confirm_booking_series` and `start_walk_in`, the three the app calls (confirming a request goes through `confirm_booking_slot`). Drop the old signatures first so no ambiguous overload remains, then re-grant; check the unused `create_appointment_staff` wrapper still resolves. Public online booking stays clinic-only. Migration goes live before the client.
**H2. Settings and patient (Sonnet).** The Where you see patients card. An optional address on the patient form, shown only with Home on.
**H3. Booking and the day (Sonnet).** Location on `BookSlotSheet` (from the service's default); a Home badge on Schedule and Workspace rows; for a home appointment, the address with **Copy address** and Call (no map link). A clinic that only does home care defaults everything to Home.
**H4. Visit and bill (Sonnet).** One helper, `defaultVisitLocation(clinic, myLocations)`, feeds the starting state, `startFreshVisitForm`, and the `isNewVisitDirty` baseline, or a home-only clinic gets a false "Discard changes?" on opening New Visit. Precedence: the appointment's location, then repeat visit, then a location the user tapped (a touched flag), then the service default, then the helper. Choosing a service never overwrites a tapped location. Ledger filter and a Reports breakdown when more than one location is on. The invoice's place of service prints as now.
**Tests:** a clinic-only setup shows no toggle or address box and books as today; a home-only clinic opens New Visit and "Another visit" with no discard prompt; a tapped location survives choosing a service; `start_walk_in` keeps the location; a home booking carries through to the visit and bill; RPC defaults (SQL).

### Phase 2: Inpatient rehab
**I1. Schema (Opus; migration).** `admissions`: `id, clinic_id, patient_id, ipd_no, ward_bed, admitting_doctor, admitted_on, discharged_on, notes`, `deleted`, plus the standard sync columns and clinic-member RLS (same pattern as `patients`). Partial unique index: one row per `(clinic_id, patient_id)` where `discharged_on is null and not deleted`. `visits.admission_id uuid null`. A Dexie version, sync registration and backup coverage: offline-first like visits.
**I2. Admit and discharge (Sonnet).** On the patient profile: Admit (IPD no, ward/bed, doctor, all optional but the date), Change ward/bed, Discharge. At most one open admission per patient: `admissionService` refuses a second before writing, as `catalogService` does for names. **Offline conflict:** two devices can still admit the same patient, and the index would then reject one and stick it in the sync queue. Handle that rejection by keeping the first and telling staff, not retrying forever. **A mistaken admission** can be deleted while it has no visits (quiet red action at the foot of the sheet).
**I3. Ward rounds (Opus reviews, Sonnet builds).** A Workspace card, **Inpatients (N)**, grouped by ward: patient, bed, day of stay, and whether seen today. **Log session** opens New Visit filled from the patient's last session here (the existing repeat-visit path), with the admission and Inpatient set. A multi-disciplinary team uses "Done by" as today.
**I4. Billing (Opus).** Sessions are saved unpaid (`paymentChoice: 'pending'`) against the admission. **Discharge bill:** one invoice over the admission's visits (invoices already cover several visits), plus a printable **Hospital billing slip**: date, IPD no, patient, ward/bed, service, therapist, charge. Settled at discharge: `partner` when the hospital counter collects (`partner` only exists with `hasPartner`), or normal methods and advances for a standalone rehab centre. Invoice snapshot gains IPD no and ward/bed. `placeOfService` becomes `'clinic' | 'home' | 'ward'` in `types.ts`, `InvoiceClinicalFields` (its select), `IssueInvoiceDialog` and the print page, or an inpatient bill prints "Clinic".
**Tests:** one open admission only; the seen-today marker; a discharge bill totals exactly the admission's visits and a visit can't be billed twice; slip matches the bill; old invoices print unchanged; a second open admission is refused, and the offline conflict doesn't stick; a mistaken admission deletes only with no visits; an inpatient bill prints Inpatient.

### Phase 3: Therapist areas (Sonnet)
`therapists.care_locations` (migration, default all), set on the team member form when the clinic has more than one location. Book and New Visit pickers offer only people for that location, and a therapist with one location gets it preselected.
**Tests:** a home-only therapist starts on Home and isn't offered for a clinic booking; admins see everything.

### Phase 3b: Team Member Color Palette Refinement (Sonnet; owner request 2026-11-06)
- **The problem:** `TherapistColorPicker` offers only 8 swatches (`SERIES_COLORS`). When a clinic has 6–10+ therapists, swatches fill up and force staff into the raw OS `<input type="color">`. The native OS picker is clunky on touch devices, and picking a pastel or light shade triggers a jarring error (*"That color is too light to see on the schedule. Pick a darker one."*).
- **Refinement:**
  1. **Compact 16-shade aesthetic palette (4 × 4):** Strictly 16 curated, calming, non-intense clinical tones (Sky Blue, Cobalt, Cerulean, Soft Teal, Emerald, Sage, Forest, Muted Olive, Amber Gold, Terracotta, Rust, Clay, Rosewood, Iris, Indigo, Deep Slate). No garish neons, no hex typing, and guaranteed to pass contrast checks. The entire 4×4 grid takes only ~130px height, fitting comfortably on any phone screen.
  2. **Offset floating badges on swatches:** Swatches remain pure solid color (no text inside the circle). Swatches already in use display a small, elegant offset initial badge anchored at the bottom-right corner with a crisp white border (e.g. `KB` for Kiran Balla). Selecting a taken color gives a gentle inline notice rather than a block (*"Also used by Dr Kiran Balla. You can share it, or pick an unclaimed shade."*).
  3. **"Auto-pick" button:** A one-tap shortcut at the top of the picker to auto-select the best available unused color.
  4. **Live calendar preview:** Compact 2-state card preview showing both the upcoming white card (solid left border) and arrived waiting-room appointment (`color-mix` 16% soft background tint).
- **Tests:** all 16 swatches pass `isReadableColor`; initials render for taken colors; choosing a taken color does not crash or block saving; preview reflects selection and tint.

### Phase 4: Split rates by location (Opus; migration)
Only when a partner contract differs by department. `clinics.home_split_pct`, `ward_split_pct` (null means the normal rate). Rate chosen when the visit is logged and stored on it as now. **`uninvoicedSplitRates` and `visitNeedsSplitUpdate` must take the location too**, or "Update visits not yet invoiced" would overwrite these rates (the draft missed this). Partner statement broken down by location.
**Tests:** exact rounding per location; totals unchanged for a clinic with no overrides; invoiced visits never move.

### Merges
The older home-visits program (9a, 12 in `~/.claude/plans/calm-nibbling-stroustrup.md`) is covered by Phase 1 and later HR pay. `2026-11-05-care-settings-ipd-opd-homecare.md` stays as the first draft.

### Owner decisions (2026-11-05)
1. **Plans:** Home care on every plan. Inpatient on Clinic and Clinic+ only: a new `inpatient` plan feature in `TIER_FEATURES`, checked in the Where you see patients card and at the server on `admissions` writes (a locked option names the plan, like the other locked cards).
2. **Address:** one optional free-text address on the patient. This overrides the older program's "no patient address".
3. **Order:** as below.

---

## Order against the other open work

1. **G2** (WhatsApp) and the **partner statement fix**: small live bugs, ahead of everything.
2. Settings plan Step 16: 16a, 16d, 16c (16c's migration can carry G5).
3. Awaiting plan: Task 1 (switch split), then 2 to 4. It shares the Appointments card and `BookSlotSheet` with H3, so do it first.
4. **G1 and G4** when no other work is in the tree, so Part 2's new money screens start right.
5. **Part 2:** Phase 1, Phase 2, then 3 and 4.

**Models:** G1, G2, G4, G5 **Sonnet**, with one **Opus** review of G1. Part 2: the statement fix, H1, I1, I4 and Phase 4 **Opus**; the rest **Sonnet**; **Opus** reviews each phase.
