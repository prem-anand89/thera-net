# Plans, Onboarding, Split-Shift Hours & Therapist Shifts: Implementation Plan

**Date:** 2026-11-01 (rewrite after review)
**Status:** Reviewed by Claude 2026-11-01; corrections below were confirmed by the owner (§7, items 6–10). Owner decisions in §0 are LOCKED.
**Process:** Work on `main`, one commit per step, never push. Start with `git status --short` and `git log --oneline -5`. Run `npm run typecheck && npm run lint && npm run test` before each commit (pass `--maxWorkers=2` flags on the command line, never edit `vite.config.ts`). Per `THERA_NET.md`: no new npm dependencies, CSS variables only, every `<button>` has a `type`, errors render inside dialogs with `<ErrorNote>`, never write "MRN" in user-facing text. **Never apply migrations to live Supabase.** Write the file and report its path; Claude applies it. Update `FEATURES_AND_SCHEMA.md` (and `README.md` where relevant) in the same commit as each change. That file duplicates some sections (for example the tier text near lines ~2700 and ~4660), so `grep` and edit every copy.

---

## 0. Decisions (LOCKED, ask before changing)

### Plans
1. **Lite:** 1 login seat, **50 visits/month**, **1 no-login roster therapist** (max 2 active practitioners total: owner + 1 assistant/visiting colleague). No invoicing ("Give bill"), no note printing.
2. **Solo** (an extension of Lite): 1 login seat, **200 visits/month**, **1 no-login roster therapist** (max 2 active practitioners total). Adds invoicing ("Give bill") and note printing/PDF.
3. **Strict tier enforcement (No grandfathering loophole):** If a Lite or Solo clinic already has more active therapists or seats than allowed, they are not grandfathered; the server and client strictly block creating or reactivating roster therapists until they deactivate excess staff or upgrade. **Nothing is deactivated automatically**, and **visits are never blocked** for being over the staff limit (clinical work must not stop); an over-limit clinic sees a banner asking the admin to choose who stays active.
4. **Clinic & Clinic+ tiers:**
   - **Clinic (Growing Team):** 5 login seats, **unlimited visits/month**, 3 no-login roster therapists (max 8 active practitioners total). Includes team roster & shift scheduling, multi-therapist calendar, standard invoicing & notes, **Hospital / Partner Revenue Split (`revenueSplit`)**, and **Attribution Audit & Payouts breakdown**.
   - **Clinic+ (Advanced Practice / Enterprise):** 10 login seats, **unlimited visits/month**, 10 no-login roster therapists (max 20 active practitioners total). Everything in Clinic, plus **Advanced Assessment Modules (`advancedModules`)** and the upcoming **HR Module (`hrModule`)**.
5. **Lite must not show "Give bill" or "Print note" anywhere.** Not a disabled "· Solo+" teaser, simply absent. Direct URLs to the print/invoice routes keep their `LockedSectionNotice`.
6. Seat count is the signal for "solo-style" UX (checklist, copy). `clinic_type` is not used for that.

### Hours and shifts
7. **`WorkingHours` interval format is unchanged** (`Partial<Record<'0'..'6', [number, number][]>>`). Therapist intervals and breaks already render in `DayColumn.tsx` and are honoured by `schedule.ts`.
8. **Clinic hours get a second layer.** `booking_start_hour` / `booking_end_hour` stay as the *outer envelope* for the grid. A new `operating_hours` JSONB (same interval shape) holds the real open intervals (e.g. 9–1 and 4–8). The envelope is **derived from** `operating_hours` on save (min start, max end) so the two never drift.
9. **A clinic closure hard-blocks the public booking form only.** Staff booking keeps its existing "book outside hours" flexibility (`bookableWindow`) and gets a **warning**, not a block.
10. **Therapists work 8–9 h either continuously or split** (morning + evening). The shift editor expresses both naturally. Shift templates are stored in the existing `ShiftTemplate` fields.
11. **Precedence for a therapist's day:** approved shift-template assignment, then custom `workingHours`, then clinic hours (the order `shiftUtils` already uses). The UI says which one is in effect.

### Onboarding
12. The creator goes from the **"You're set up"** screen straight to Workspace. No second form intercept.

---

## 1. Replace the "team" flag with one tier-limits table

The original draft said nothing reads `team`. That is wrong: `PlanSection.tsx` uses it for the "Multiple team logins" line in "What's included", and `TeamSection.tsx` uses `minimumTierFor('team')` for the "more logins in Clinic and above" message. Deleting it breaks the build.

It is still the wrong shape: a yes/no flag for something that is really a number (how many logins), duplicated by `clinic_plans.max_members`. **Replace it with numbers, kept in one place:**

- `src/domain/plans.ts` gets `TIER_LIMITS: Record<PlanTier, { seats: number; visitsPerMonth: number | null; rosterWithoutLogin: number }>` (`null` = unlimited):
  `lite {1, 50, 1}`, `solo {1, 200, 1}`, `clinic {5, null, 3}`, `clinic_plus {10, null, 10}`.
- `PlanFeature` keeps only true on/off features (`invoicing`, `revenueSplit`, `advancedModules`, `notePrinting`); `team` is removed.
- Helpers replace the flag's two uses:
  - `nextTierWithMore(tier, 'seats')` → the lowest tier with more seats than the current one, for upgrade copy ("Clinic includes 5 logins").
  - "What's included" in Settings → Your plan prints the numbers ("1 login · 50 visits a month · 1 team member without a login") instead of a yes/no "Multiple team logins" line.
- **The SQL side reads the same numbers:** a `plan_tier_defaults(tier)` SQL function (see A.1) returns the same three values, and a **parity test** (like `followUpAgendaParity.test.ts`) checks that the migration's numbers equal `TIER_LIMITS`, so app copy and server limits cannot drift.
- These are **defaults for a tier**. A clinic's own row in `clinic_plans` can still differ (one live Clinic+ clinic has 100 seats), and enforcement always reads the clinic's row, never the defaults.

## Phase A: Plans (Lite / Solo)

### A.1 Migration: explicit limits + roster cap
`supabase/migrations/<number later than the newest file>_plan_limits_roster_cap.sql`:
- `ALTER TABLE clinic_plans ADD COLUMN IF NOT EXISTS max_roster_therapists int NULL;` (`NULL` = unlimited, tunable per clinic like `max_members`).
- `plan_tier_defaults(p_tier text)` SQL function returning `(max_members, visit_cap_per_month, max_roster_therapists)` per tier: `lite (1, 50, 1)`, `solo (1, 200, 1)`, `clinic (5, null, 3)`, `clinic_plus (10, null, 10)`. Same numbers as `TIER_LIMITS` (parity test, §1).
- **Backfill only the new column**, and only where it is null: `UPDATE clinic_plans SET max_roster_therapists = (plan_tier_defaults(plan_tier)).max_roster_therapists WHERE max_roster_therapists IS NULL`. **Never rewrite existing `max_members` or `visit_cap_per_month`**: they are per-clinic and some are tuned (one live Clinic+ clinic has 100 seats).
- `seed_default_clinic_plan()` seeds new clinics from `plan_tier_defaults('lite')`. Manual upgrades use the same function (document a one-line SQL snippet for the owner).
- **No auto-deactivation.** A live check on 2026-11-01 found no clinic over the new roster limit; enforcement happens on add / reactivate only.
- **Server guard** on `therapists`: fires only when a row **becomes** active with no login (insert of a new active unlinked row, or an update that sets `active` true or clears `user_id`). The count **leaves the row itself out** (`id <> new.id`): the sync saves with an upsert, so a BEFORE INSERT trigger also fires on plain edits of an existing therapist, and counting the row twice would refuse renaming the only roster therapist (the same bug fixed for packages in `20261028210000_fix_upsert_race_guards.sql`). Raise with a clear message.
- **Sync risk:** a therapist refused by the server stays in the outbox, and every visit or appointment for that therapist then fails on its foreign key. The client guard (A.3) must stop it first; the server guard is a backstop. Add a SQL test matrix: edit at cap (allowed), add at cap (refused), reactivate at cap (refused), link a login (allowed), feature switch off (allowed).

### A.2 Types and entitlements
- `ClinicPlan` gains `maxRosterTherapists: number | null`; `useEntitlements` exposes it. **When the column is missing or null the app does not block** (`null` = no client limit); the server is the authority. (A fail-closed default of 1 would lock out the four live Clinic+ clinics until the migration is applied.)
- Replace the `team` flag with `TIER_LIMITS` and its helpers (§1), updating `PlanSection.tsx` and `TeamSection.tsx`.
- **Gating alignment:** Update `TIER_FEATURES.clinic.advancedModules = false`, keeping it `true` only for `clinic_plus`. Update unit tests in `plans.test.ts` asserting on `minimumTierFor('advancedModules')`.
- `PlanSection`: add a "Team without login  n / cap" tile beside Seats and Visits.

### A.3 Client roster guard (before the server has to refuse)
- In `TeamSection.tsx`'s Add team member form: when the roster cap is reached, disable the no-login path with a plain explanation ("Your plan allows 1 team member without a login. Upgrade to add more.") and an upgrade link.
- Same check when re-activating an inactive therapist.
- **Over-limit banner** (Settings → Team, and a one-line note on Workspace for admins) when active no-login therapists exceed the clinic's limit: "Your plan allows 1 team member without a login; 2 are active. Choose who stays active, or upgrade." Visits and existing staff keep working.
- Keep the existing `loginsLocked` behaviour for logins.

### A.4 "Give bill" and "Print note" are absent on Lite
- `canBill` already hides the post-save "Give bill" tile (`VisitLoggedCard`). **Verify** the other entry points are fed by `canBill`/`canIssueInvoice` and hidden on Lite: `VisitRowActions` (menu "Give bill"), Ledger Invoices tab, Workspace/patient profile bill buttons.
- Replace the disabled teaser labels with nothing on Lite:
  - `NoteEditorPage.tsx` (~L891): `Print · Solo+`
  - `PatientProfilePage.tsx` (~L771): `Session log & insurer packet · Solo+`
- Keep `LockedSectionNotice` on `NotePrintPage`, `SessionLogPrintPage`, `InsurerPacketPage`, and `InvoicePrintPage` for typed URLs.
- The "What's included" list in Settings → Your plan is the one place that names Solo-only features.
- Tests: Lite renders no Give bill / Print entry (post-save card, row menu, note editor, patient profile); Solo renders them.

### A.5 Visit-cap honesty
- Solo's 200 flows through `visitCapPerMonth` from the plan row, with no code change beyond the migration.
- The client blocks at the cap and the server only at cap + 20 (a grace buffer). Say so in `FEATURES_AND_SCHEMA.md` and keep the "nothing you entered is lost" copy.

### A.6 Upgrade request
- Out of scope to build a payment flow. Improve the existing `mailto:` (`upgradeMailto`) to include clinic ID, tier and current usage in the body. Confirm `VITE_SUPPORT_EMAIL` is set in deployed env.

### A.7 Docs
- Add a single tier table (seats, visits, roster-without-login, invoicing, printing, split, modules) to `FEATURES_AND_SCHEMA.md` and keep it in sync with `plans.ts`.

---

## Phase B: Onboarding friction

### B.1 No post-onboarding profile intercept & combined Step 2 fields
* **Evidence:** `Shell.tsx` redirects an unconfirmed therapist to `/onboarding/profile` (~L300-305); `profileConfirmedAt` is only set in `TherapistProfileOnboardingPage.tsx`; `OnboardingTeamStep.tsx` never sets it.
* **Fix in `OnboardingTeamStep.tsx`:**
  - When the creator links themselves in Step 2 ("I treat patients here"), capture **Name on invoices** (pre-filled from roster name), optional **Registration / council no.** (TPAs check it on invoices), and **Phone** directly in Step 2.
  - Stamp `profileConfirmedAt: new Date().toISOString()` when saving Step 2.
  - Acceptance: finishing step 4 lands directly on `/workspace` without being intercepted by `/onboarding/profile`.

### B.2 Address optional at clinic creation
- `CreateClinicForm.tsx` drops the hard address requirement. Helper text: "Printed on bills and receipts. Add it now or later in Settings."
- **Coupling that must change with it:** `useSetupProgress.ts` sets `clinicProfileSet` from `clinic.address`. The checklist item must stay a nudge and not block "setup complete". Address is required at **invoice issue time** (Solo+ only), where a missing address shows an inline prompt instead of a failure.

### B.3 Fix Step 2 email invite error on new signups & plan-aware checklist
* **Critical Bug Fix in `OnboardingTeamStep.tsx`:** New clinics seed on `lite` (1 seat). Calling `invite-therapist` currently throws a 403 error because the creator already consumes seat 1 of 1.
  - When `maxMembers <= 1` (Lite/Solo), hide the email-invite form. Replace it with an optional **"Add a colleague without a login (1 included in your plan)"** name input (`userId = null`). Display a quiet hint that team member logins require upgrading to the Clinic plan.
* **Checklist follows the plan, not the clinic type:**
  - `buildSetupSteps(seatLimited, …)` fix: When `seatLimited` (`enforcementEnabled && maxMembers <= 1`):
    - `invite-team` becomes `group: 'optional'` (excluded from total by `summarizeSetup`).
    - `therapistsLinked` ignores no-login roster rows and requires only that the creator's own row is linked.
  - Update `setupGuide.test.ts` (step ids stay the same for stored ticks; totals change for seat-limited clinics).

### B.4 Dropped
- ~~Prominent Google OAuth on signup~~: removed. It's a login-layout change with no link to a bug found.

---

## Phase C: Settings information architecture

### C.1 Move Hours / Slot Duration / Weekly Off Days to Schedule & Booking
- **Evidence:** `sections.ts` / `ClinicSections.tsx` currently put Hours & Closures and Payments under General.
- Move **Clinic hours, appointment duration, weekly off days, holidays** into the Booking tab (rename "Schedule & Booking").
- **Payment Settings Routing:** Lite clinics collect visit payments (UPI/Cash/Card) even though invoicing is disabled. Do not hide `defaultPaymentMethod` inside the plan-locked `BillingSection`.
  - Keep **Default payment method** accessible to all tiers (remain in General under Clinic Preferences, or placed in Billing *outside* the `canSeeBilling` gate).
  - Move the partner collection toggle (`partnerCollects`) into `PartnerSection` (which is already gated by `hasPartner` and `revenueSplit`).
- **Before editing:** `grep` `sections.ts`, `sections.test.ts`, deep links and setup-guide links (`{ kind: 'settings', tab: 'general' }`), and keep anchors working.

### C.2 Correct the "Linked login" wording
- **Evidence:** `WorkspacePage.tsx` (~L943) says "Settings → Team → Linked login". No such control exists. The edit modal's "Email address (Link to login)" field renders only for an **unlinked therapist with no clinic member** (`!member && therapist`, `TeamSection.tsx` ~L555), and saving it **sends a new invite** through the `invite-therapist` function; it does not link an existing login.
- **Fix now:** change the copy to match reality ("Settings → Team → open the therapist → add their email to invite them").
- **Defer / separate feature:** "link an existing member to an existing roster row" has no UI and likely needs an RPC that sets `therapists.user_id`. Not needed on Lite/Solo (1 seat); plan it only for Clinic tiers.

### C.3 Document branding: deferred
- Patient ID prefix (General), invoice prefix (Billing) and signature stay where they are. Revisit after C.1.

---

## Phase D: Clinic hours with split shifts

### D.1 Migration
`supabase/migrations/<later number>_clinic_operating_hours.sql`:
- `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS operating_hours jsonb NULL;` Same shape as `WorkingHours`; `NULL` = old behaviour (one block from `booking_start_hour` to `booking_end_hour`).
- Validate intervals server-side (ordered, non-overlapping, 0..1440, ≤ 4 per day, mirroring `workingHoursProblem`).
- **Expose it to the public form:** update `get_booking_clinic_info` (anon RPC) to return `operating_hours`. Without this the public form cannot see a lunch closure.
- ~~Server enforcement in `submit_appointment_request`~~: **dropped** (owner, 2026-11-01). A request is not a booking; staff review every one before confirming, and parsing a time label in SQL is fragile. The public form simply does not offer closed times.

### D.2 App plumbing
- `Clinic.operatingHours?: WorkingHours | null`; add to the repository/row mapper, Dexie type and sync mapping; always read as `operatingHours ?? null`.
- **`workingIntervals()` / `defaultWorkingHours()` / `clipToWorking()`** in `schedule.ts` / `WorkingHoursSheet.tsx` currently fall back to a single `{startHour, endHour}` block when a therapist has no hours. Extend them to accept the clinic's per-day intervals so "same as clinic hours" inherits splits. Note in the UI: a therapist who has saved custom hours **stops following** later clinic changes.
- Derive `booking_start_hour` / `booking_end_hour` from the intervals on save.

### D.3 Settings UI (Schedule & Booking → Clinic hours)
- One pattern by default (Shift 1 + optional Shift 2 per open day) with **"Copy to all open days"** and **"Customise per day"**. A visible "Closed 1:00 PM – 4:00 PM" summary line.
- Weekly closed days and holidays stay as they are.

### D.4 Public booking and Schedule behaviour
- `isPublicSlotTaken` and slot generation in `BookingFormPage.tsx` skip slots outside clinic operating intervals.
- The Schedule grid shades clinic closures like therapist breaks (reuse the `data-break` styling in `DayColumn.tsx`). Staff booking into a closure sees a confirm ("Clinic is closed 1–4 PM. Book anyway?"), per decision 9.

### D.5 Tests
- `schedule.test.ts`: `workingIntervals` and `clipToWorking` with a clinic lunch gap; a therapist on custom hours across the gap; a 2 PM public slot is unavailable; a slot at 12:30 for a 60-minute session that would cross into the gap is unavailable.
- Mapper/sync test for `operating_hours` null and populated.

---

## Phase E: Therapist shifts (continuous vs split)

### E.1 Dual-mode shift editor (`ShiftTemplatesSection.tsx`)
- Segmented toggle **Continuous | Split**.
  - **Continuous:** start, end, optional lunch (duration + start). Live badge "8h working".
  - **Split:** Session 1 start–end, Session 2 start–end. Live badge "8h 30m working · 3h 30m gap".
- Mapping to `ShiftTemplate`: `startMinute = S1.start`, `endMinute = S2.end`, `defaultBreakStartMinute = S1.end`, `breakDurationMinutes = S2.start − S1.end`.
- **Known limits & consistency rules:**
  - A template supports exactly one break; three sessions are out of scope.
  - In `shiftUtils.ts`, `formatShiftSummary` labels a shift "split" when `breakDurationMinutes >= 120`. In the Split tab of the editor, enforce that the gap between Session 1 and Session 2 is $\ge 120$ minutes (2 hours), with an inline validation note: *"For breaks under 2 hours, use Continuous shift with a break"*. This guarantees 100% round-trip fidelity between editor mode and display summary with zero database schema changes.
  - `validateShiftTemplate` rules (break within shift, positive length) still apply.

### E.2 Starter shifts
- **Nothing seeds shift templates today** (no `createShiftTemplate` call in onboarding). Decide the mechanism: an "Add suggested shifts" button in Settings → Shifts (Morning 8:00–4:30 with 30 min lunch, Evening 12:30–9:00, Split 8:30–1:00 & 4:30–8:30), rather than silently creating rows for every clinic. Skip entirely for one-seat plans, where shift assignments are not useful.

### E.3 Roster assignment and "same as clinic"
- Assignment stays in the existing shift-assignment flow. The Team card shows which source is in effect (shift / custom hours / clinic hours), per decision 11.

### E.4 Tests
- `ShiftTemplatesSection.test.tsx`: create in both modes; mapping round-trips; badge totals.
- `shiftUtils.test.ts`: 90-min vs 3-hour gap labelling.

---

## 2. Suggested order and commits

1. **A** (plans: migration, entitlements, guards, Lite hiding) → highest value, fixes real gaps.
2. **B** (onboarding) → small, independent.
3. **C.2** (copy fix) now; **C.1** after B.
4. **D** (clinic hours), then **E** (shift editor): larger, riskiest, separate commits each.

## 3. Verification

- [ ] `npm run typecheck`, `npm run lint`, `npm run test` pass for each commit; `npm run build` after A and D.
- [ ] Lite: no Give bill / Print entry anywhere; Solo: both present; Solo shows 200 visits cap.
- [ ] A Lite clinic cannot add or reactivate a 2nd no-login therapist (client message first, server trigger as backstop); editing the existing one still syncs; an over-limit clinic sees the banner and can still log visits.
- [ ] `TIER_LIMITS` parity test passes against `plan_tier_defaults`; no existing `clinic_plans` row's seats or visit cap changed.
- [ ] One-seat checklist can reach 100% with no teammate invited and one roster colleague added.
- [ ] Onboarding finish lands on `/workspace`.
- [ ] Public form offers no slot in a clinic lunch closure.
- [ ] Docs updated everywhere they are duplicated.

## 4. Out of scope

Payment/checkout, auto-email on booking confirm, "link existing login to roster row" RPC, Google OAuth layout, document-branding reorganisation, three-session shifts.

## 5. Risks

- **Server rejection vs offline sync (A.1):** a therapist created offline and refused on sync can wedge the queue. The client guard and a clear sync-error path are required.
- **Roster cap enforcement (A.1):** clinics exceeding their tier cap will be blocked from adding/reactivating staff until they deactivate excess entries or upgrade. Client must show a clear banner/dialog guiding them to manage their team or upgrade. Visits are never blocked by this.
- **Upsert triggers (A.1):** any new BEFORE INSERT guard on a synced table must leave the row itself out of its count; see `20261028210000_fix_upsert_race_guards.sql`.
- **Clinic-hours inheritance (D.2):** changes shared helpers used by Schedule, public form and the working-hours sheet. `grep` all usages first; prefer a new optional parameter over changing existing signatures.

## 6. Documentation to update

`FEATURES_AND_SCHEMA.md` (tier table, `clinic_plans.max_roster_therapists`, `clinics.operating_hours`, Settings sections, onboarding flow, shift editor), `README.md` if the tier or setup summary appears there.

## 7. Decisions Resolved by Owner

1. **Roster cap meaning:** Confirmed. "1 team member with no login" means 1 colleague in addition to the owner (maximum 2 active practitioners total on Lite/Solo).
2. **Grandfathering:** Confirmed **No**. Strict enforcement applies; clinics above their quota must deactivate extra staff or upgrade before adding or reactivating staff. (Visits are not blocked; see item 9.)
3. **Staff booking in clinic closure:** Confirmed **Warn and allow**. Staff booking inside a lunch closure sees a confirmation warning, but is not hard-blocked.
4. **Clinic vs Clinic+ gating:** Confirmed:
   - **Visits:** Unlimited for both Clinic and Clinic+.
   - **Revenue Split & Attribution:** Kept on **Clinic** (and Clinic+).
   - **Clinic limits:** 5 login seats, 3 roster therapists without login (max 8 active practitioners).
   - **Clinic+ limits:** 10 login seats, 10 roster therapists without login (max 20 active practitioners). Exclusively includes **Advanced Assessment Modules (`advancedModules`)** and the upcoming **HR Module (`hrModule`)**.
5. **Solo "Give bill" & Note Printing:** Confirmed. Solo includes invoicing and note printing; Lite hides both completely.
6. **`team` flag:** replaced by a `TIER_LIMITS` table of numbers (seats, visits, team without login) in `plans.ts`, mirrored by a `plan_tier_defaults()` SQL function with a parity test (§1).
7. **Migration scope:** adds `max_roster_therapists` only (filled where null); existing seats and visit caps are never rewritten.
8. **No auto-deactivation:** enforcement on add / reactivate, plus an over-limit banner to choose who stays active.
9. **Visits are never blocked** for being over the staff limit.
10. **No server-side rejection** of public requests inside a clinic closure.
