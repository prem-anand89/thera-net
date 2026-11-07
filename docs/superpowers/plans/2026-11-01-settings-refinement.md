# Settings Refinement — Plan (v5)

**Date:** 2026-11-03 · **Status:** Steps 1–14 and the phone layout pass are built and pushed. **Open: Step 15 (Lite tier & Settings refinements; 15a and 15b are both BUILT, commits 4816c04, 8a49974 and f3c4ae4, and wait for the owner's check), Step 16 (Faster visit logging & package expiry), and the 360px phone check.** When all are done, delete this file and update the docs, per the housekeeping rule.
**Process:** Work on `main`, one commit per step, never push without asking. Before each commit that touches `src/`: `npm run typecheck && npm run lint && npm run test`, plus `npm run build` when shared components, routing or Tailwind config change. Per `CLAUDE.md`: no new npm dependencies, CSS variables only, every `<button>` has an explicit `type`, errors inside dialogs via `<ErrorNote>`, update `FEATURES_AND_SCHEMA.md` (every copy) in the same commit. (There is no `THERA_NET.md`; `CLAUDE.md` is the rule file.) **Migrations:** none through Step 13. **14a needs one** (the `assign_shift` RPC) and **16c needs one** (package expiry columns): apply it live and commit the matching `supabase/migrations/` file in the same change, per `CLAUDE.md`.
**Models:** only Opus and Sonnet. Each step names who builds it and who reviews it. Opus builds and reviews anything that touches money or the shared form state every card uses.

---

## The goal in one paragraph

Settings should feel like a normal form: click a field, type, press Save. Each setting lives in exactly one place, search finds it, and a new therapist can understand the words. Steps 1–11 did this for Settings; Steps 12–15 carry the same rules to first-run setup, the schedule's shifts and the Lite plan.

## Done (all pushed to `origin/main`, 2026-11-02 and 2026-11-03)

| Step | What was built | Commit | Differs from the old plan |
|---|---|---|---|
| 1 | "Single / Multiple Therapists" removed; Share follows the number of active therapists | 7e9257b | Share also respects `enableTherapistSplit`, so a clinic with the split off keeps its service tagging |
| 2 | Every partner setting in Billing → Partner & split; switch disabled below the plan; "Turn off partner mode" for downgrades | 90be3bb | |
| 3 | UPI collection reachable on every plan | 7ff7765 | Later moved with Payments (3b) |
| 4 | No Edit buttons; untouched cards follow saved values; Save bar only on changes | 6cdff79 | |
| 3b | Payments in the Billing tab, "Payments & billing" | fe2c767 | |
| 3c | "Bills after a visit" removed | 77b61fb | |
| 3d | Region in one line; partner labels and TDS basis under "More options" | 3445689 | |
| 3e | "After a visit" card; default payment method removed | 394b30b | |
| 3f | One "Clinic code" for Patient IDs and invoices | af53fe5, fix 6d25953 | Shows format examples ("BM26-0001"), not the live next number, because the server allocates it; no separate invoice-prefix note, since the field moved |
| 5 | Three confirmations (partner split with a count, booking link, time zone) | 7a90732 | Also a retry button when the visit update fails after a save; `saveFieldNow` now throws if the clinic row is missing |
| 6 | Search finds Region and agenda, Shifts & coverage; keywords follow moved settings | c537527 | |
| 7 | Team tab in two views with a pending badge; `?teamView=` | 25e555f | No "default by role": only admins open Settings |
| 8 | "Bookable" → "Sees patients" | 930ef91 | Also the filter chip and the add-form error |
| 9 | Therapist comparison by one rule (admin, revenue-split plan, 2+ active therapists) | b80ea20 | Front desk and therapists no longer see it; 1 clinic gains it, 2 lose an empty card |
| 10 | One on/off control (`SwitchRow`) | 0e548af | Redrawn as a track-and-thumb switch in the phone pass |
| — | Phone layout pass: sticky Save bar with a status line, invoice preview folded on phones, several layout bugs, shorter text, Health Valley references removed | f0e458e | The "sticky mobile save bar already exists" note in the old plan was wrong; it was built here |
| 11a | "Services & treatments" tab; referral sources to General; wording; two-group starter list | feade7e | The General card later kept the name **"Referral sources"** (6c00be9) |
| 11c | Name checks for services, treatments and referral sources, in `catalogService` and every form | 0635895 | |
| 11b | New Services list, desktop table, one add/edit sheet, group sheet, Show usage; visit picker on the same order | e1e9ac5, f80281d, d43c6b3; fixes f371ba6 | |
| 11d / 11e | Treatments as chips; Referral sources as a list | 5b1ff78, 2f7df6d | |
| — | Service form pass and email/address boxes | 7d76354 | "More" removed; Save off until a change |
| — | Save bar: slimmed (f29a855), then made a **static card footer** (36b18b6) at the owner's request | 36b18b6 | The sticky bar is gone |
| — | Visible "Settings" title on phones only | 84e2c8d | |

### Decisions from Steps 1–11 to keep (so later steps don't undo them)

- **Names (owner):** the tab is **Services & treatments** with `Services | Treatments`; referral sources are a General card called **Referral sources** (first line "How patients found you"); the word "technique" is never used; the visit screen's "Services" and "Treatments" cards use the same words.
- **Prices:** per-session prices are whole rupees with no qualifier ("₹1,667 each", never "≈" or paise); `effectivePricePerSession` stays exact for maths. Display goes through `catalogDisplay.ts` (`serviceSubline`, `perSessionLabel`, `groupServices`).
- **Names are unique:** the database has `unique (clinic_id, name)` on services, treatments and referral sources, and the app saves on the device first, so every add or rename goes through `catalogService`, which refuses a taken name (capitals ignored) before writing. Use `nameCheck` for any new list of named things.
- **Shared pieces:** `SheetDialog` (bottom sheet on phones, pinned buttons), `HiddenItemsFooter`, `SwitchRow`, `Segmented`, `useShowUsage` (a per-device view switch, on by default since 16d, never a clinic setting), `SectionSaveBar`.
- **Save bar:** a plain static row at the foot of the card. A floating bar was tried and dropped (it felt broken and cost phone/iPad height); the tab dot and the leave prompt are the safety net on long cards.
- **Group rules:** groups are optional; named groups first, ungrouped under "Other", one flat list when no groups; the visit picker follows the same rule.
- **Mockup (reference):** https://claude.ai/artifact/NFxXHxizzsRZUs9xQbaST4

## Order of work (what is left)

| Step | What | Builds | Reviews |
|---|---|---|---|
| 12 | Onboarding & first-week setup polish (12a–12d) | Sonnet / Opus | Opus |
| 13 | Schedule mini-calendar dots fix (decouple `implicitSelection` from month `dayState`) — **built** | Sonnet | Opus |
| 14 | Shifts refinement v2 (14a bugs + one `assign_shift` migration, 14b one person sheet, 14c Weekly shifts + phone cards, 14d Shift types + tokens, 14e one-therapist clinics) | Sonnet / Opus | Opus |
| 15 | Lite tier & Settings refinements (past invoices stay printable with a note, Team seat cap on unlinked therapists, banner wording) | Sonnet | Opus |
| 16 | Faster visit logging & optional package expiry (16a add a service from the visit, 16c optional package expiry, 16d usage for the admin; 16b dropped, already built) | Sonnet / Opus (16c) | Opus |
| — | Phone check at 360px (the owner), then the final review | owner / Opus | Opus |

---

### Step 12 — Onboarding & first-week setup

Steps 1–11 changed Settings' words and layout (`Sees patients`, `One visit`, `₹700 each`, `Services & treatments`, `Referral sources`, `Payments & billing`, `Schedule & Booking`, one list card per list, the shared sheet). First-run setup (`/onboarding`, `/onboarding/profile`, `CreateClinicForm`) and the first-week checklist (`/setup`) still carry the old layout and words, plus a few phone/tablet layout bugs. **Reviewed against the code 2026-11-03:** the claims below were checked; corrections are marked *(corrected)*.
*(Note: Built steps 12a, 12b, 12c are committed locally on main; unpushed, awaiting final branch verification before push).*

| Sub-step | Scope | Build | Review |
|---|---|---|---|
| **12a** | Hide the dead nav during onboarding (`Shell.tsx`); Step 1 single card, code preview, address line breaks (`CreateClinicForm.tsx`) — **built** | Sonnet | Opus |
| **12b** | Step 2 width, "I see patients", solo hint, full-width button (`OnboardingPage.tsx`, `OnboardingTeamStep.tsx`) — **built** | Sonnet | Opus |
| **12c** | Step 3 starter editor in the Step 11 look; Step 4 button order (`ServiceCatalogTemplateEditor.tsx`, `OnboardingPage.tsx`) — **built** | Opus | Opus |
| **12d** | Invited therapist page; `/setup` checklist words and links (`TherapistProfileOnboardingPage.tsx`, `setupGuide.ts`, `sections.ts`) — **built** | Sonnet | Opus |

#### 12a — Onboarding shell & Step 1 Clinic form (Sonnet)
- **Hide the dead nav on `/onboarding*` (`Shell.tsx`):** while onboarding, the app redirects every other route back (`Shell.tsx` ~273–305), yet the desktop nav links and the phone bottom bar still show. Make `shouldShowPhoneBottomNav(pathname)` return `false` for `pathname.startsWith('/onboarding')`, and hide the desktop nav links there too, keeping the brand and the account menu (so Sign out stays reachable).
- **One card on the sign-up page (`CreateClinicForm.tsx`):** in the `page` variant the form has its own bordered `p-6` box inside the page's bordered `p-6` card (two boxes, ~128px of padding on a 360px phone). Give the `<form>` plain `space-y-4` in the page variant; keep the box for the `dialog` variant (Add clinic), which has no outer card.
- **Code preview in the "Invoice header preview" panel:** add one line, e.g. "Invoices BM/26-27/0001 · Patient IDs BM26-0001", from `clinicCode(form.name)` with `formatInvoiceNo` / `formatWalkInMrno` (the same helpers as the Clinic code field). *(corrected)* There is no "CL" fallback: `clinicCode` returns `''` for a name with no letters and sign-up then uses "INV", so show the line only once the name gives a code.
- **Address line breaks in the preview:** the address box is now multi-line (7d76354), but the preview prints it in one `<p>` that collapses the line breaks. Add `whitespace-pre-line` so the preview shows the rows as the bill will.
- *(dropped)* Folding the preview on phones: on a phone the preview sits **below** the Continue and Sign out buttons, so it pushes nothing down; leave it.
- **Built 12a (2026-11-03, `be41753`):** `shouldShowPhoneBottomNav` & `shouldShowDesktopNav` hide nav on `/onboarding*`; `CreateClinicForm` uses `className="space-y-4"` with single outer page card; address in preview preserves line breaks via `whitespace-pre-line`; live invoice and patient ID code preview from `clinicCode(form.name)`.
- **Tests:** `shouldShowPhoneBottomNav('/onboarding')` and `('/onboarding/profile')` are `false`; the page variant has one bordered box; the preview line follows the name and hides with no code; a two-line address shows as two lines.

#### 12b — Step 2 Team (Sonnet)
- **Built 12b (2026-11-03):** `OnboardingPage` widens step 2 to `tab:max-w-3xl` and drops the outer border/padding around the two cards; "I see patients at this clinic" replaces "I treat patients"; solo hint under colleague and invite card headers; Continue is `w-full sm:w-auto`.
- **Tests:** `OnboardingTeamStep.test.tsx` (9 tests: checkbox name, blank invite continuation, solo hint on 1-seat and multi-seat plans); `OnboardingPage.test.tsx` (3 tests: step 2 layout without outer border and with `tab:max-w-3xl`, step 3 and done with bordered card `max-w-xl`).

#### 12c — Step 3 starter editor & Step 4 Done (Opus)
- **Built 12c (2026-11-03):** `ServiceCatalogTemplateEditor` updated to Step 11 look (single list card, uppercase headings, editable `inputCls` name fields, no "Single visit" text, package subline "N sessions · ₹700 each" from `perSessionLabel`, per-row live duplicate check, dashed "+ Add a service" row with One visit | Package selector, guidance note); Step 3 button updated to "Finish setup" (`w-full sm:w-auto`, disabled on duplicate names); Step 4 Done screen reorders "Go to Workspace" as primary (`btnPrimary`) and "First-week checklist" as secondary (`btnSecondary`).
- **Tests:** `ServiceCatalogTemplateEditor.test.tsx` (5 tests: headings, ₹700 each, editable inputs, live duplicate flag, add service row & note); `OnboardingPage.test.tsx` (5 tests: step 2 layout, step 3 container, Step 3 "Finish setup" button text & width, duplicate blocking, Step 4 Done CTA order).

#### 12d — Invited therapist page & `/setup` checklist (Sonnet)
- **Invited therapist (`TherapistProfileOnboardingPage.tsx`):** greet with the clinic name ("Welcome to {clinic.name}"). When `!hasPasswordIdentity(session.user.identities)`, offer an optional "Set a password" step reusing `OnboardingPasswordStep` (the admin flow already does this in `OnboardingPage.tsx`). *(corrected)* They are not stranded today (the account menu has "Set a password"), but nobody finds it; offering it here is the improvement.
- **Checklist words and links (`src/domain/setupGuide.ts`)** *(corrected — the real IDs)*: keep all **11** step IDs unchanged (`clinic-profile`, `price-services`, `invite-team`, `link-therapist`, `log-visit`, `wait-synced`, `clinical-notes`, `backup`, `billing`, `booking`, `notifications`) so the completed steps stored under `firstWeekChecklistCompletedSteps:{clinicId}` and the "done of total" count don't shift. Change only words and links:
  - `price-services`: action "Open services" → **"Open services & treatments"**.
  - `clinical-notes`: action "Open clinic profile" → **"Open After a visit"**, and link to that card, not just the tab (see below).
  - `billing`: title "Configure billing" → **"Set up payments & billing"**; why "Set up GST, tax preferences, and invoice prefixes." (prefixes moved to the Clinic code) → **"Add your UPI ID for payments, and your GST number if you issue invoices."** (the partner split is Clinic-plan only, so it isn't promised here); action → **"Open Payments & billing"**.
  - `booking`: title → **"Set hours & online booking"**; why → **"Check your open days and hours, and your booking link."**; action → **"Open Schedule & Booking"**.
  - `invite-team` / `link-therapist`: link to the Team members view (`teamView: 'members'`).
- **Linked change — land on the card:** checklist links today open a tab at its top. Extend `SettingsSearch.card` (added for Referral sources in 11a) with `'after-visit'` (and later other cards as needed), so `clinical-notes` opens General and scrolls to After a visit, using the same scroll-and-highlight `SettingsPage` already does.
- **Tests:** the 11 IDs are unchanged; each new label and link; `?card=after-visit` scrolls to that card.
- **Built 12d (2026-11-04):** `TherapistProfileOnboardingPage` greets with the clinic name and renders `OnboardingPasswordStep` when the user has no password identity; buttons use `w-full sm:w-auto`; all 11 setup step IDs preserved with refined labels and links (`teamView: 'members'`, `Open services & treatments`, `card: 'after-visit'`); `SettingsPage` anchors directly to `AFTER_VISIT_CARD_ID` with smooth scrolling and ring highlight.
- **Tests:** `TherapistProfileOnboardingPage.test.tsx` (4 tests), `setupGuide.test.ts` (18 tests), `sections.test.ts` (18 tests), `SetupPage.test.tsx` (3 tests).

---

### Step 13 — Schedule mini-calendar dots fix (Sonnet builds, Opus reviews)

**Problem (checked in the code, accurate):** clicking another date in the mini-month makes the dots on other days change. In Day view the admin's columns hide therapists who are off that day (`implicitSelection`, `ScheduleBookingsView.tsx` ~237). That selection feeds `selectedIds` → `visibleAppointments` → `byDate`, and `dayState(day)` counts dots from `byDate`, so the clicked date's off-duty filter is applied to the whole month. `hasFreeTime` also uses `visibleRoster`, which is limited to the clicked date's columns.
- **Split the two selections:** `explicitSelectedIds` (the link's `?therapist=` or the therapist's own id, never `implicitSelection`) for the month; keep the current `selectedIds` (with `implicitSelection`) for the Day grid's columns only.
- **Month data from the explicit selection:** `monthByDate` filtered by `explicitSelectedIds` and not-cancelled; `dayState(day)` counts from it, and `hasFreeTime` checks the explicitly selected (or all active) therapists who work on **that** day (`workingFor(t.id, day)`).
- **Make it testable:** move the per-day calculation into a pure helper (e.g. `monthDayState(day, { appointments, therapists, workingFor, closedFor, today, … })` in `src/domain/` or `components/schedule/`) and call it from the component; today it is a `useCallback` inside a 1,400-line view, which the plan's unit test can't reach.
- **Tests:** for an admin, the helper's `booked` and dot counts for every day of the month are identical whichever date is selected (e.g. a Tuesday with 1 therapist on vs a Saturday with 3); a therapist's own view is unchanged; Day-view columns still collapse off-duty therapists.
- **Built 13 (2026-11-04):** `ScheduleBookingsView.tsx` decouples `explicitSelectedIds` (from URL `?therapist=` or the therapist's own ID) from `implicitSelection` (Day view off-duty column hiding); month appointments and `monthByDate` are derived from the explicit selection so month dot counts and free-time status never mutate on clicking another date; extracted pure `monthDayState` in `src/domain/schedule.ts`; `MiniCalendarStrip` uses month uncancelled appointments.
- **Tests:** `src/domain/schedule.test.ts` (85 tests, including `monthDayState` suite with identical counts across dates, scoped therapist filter, closed days, past days, free-time checking).

---

### Step 14 — Shifts refinement (v2, revised 2026-11-04; Opus builds 14a, Sonnet the rest, Opus reviews)

**Live data (2026-11-04):** 15 clinics; **10 have one therapist**; only **2 use shift types** (2 with assignments, 3 custom-hours rows, 6 requests ever, 1 pending); **no therapist has two shift types** today. So: make the one-therapist clinic simple first, keep the team tools tidy, and don't build for multi-shift complexity nobody uses yet (the model still supports it).

**How professional apps do it (what we copy, what we don't):**
- Rostering apps (Deputy, When I Work, Homebase, 7shifts) are built for dated weekly rosters: shifts on dates, "publish", open shifts, swaps. Clinic apps (Jane, Cliniko, Practo) use a **recurring weekly pattern per practitioner** ("working hours"/"availability", breaks) plus **one-off exceptions** (time off, an extra day). Our model is the clinic one: keep it. No "publish", no open shifts, no swaps.
- Copy: **person-first editing** (tap a person, see their week, change it in one sheet); **reusable shift types** (Deputy/When I Work call them "shift templates"; plain words for a clinic owner are "shift types"); **conflict warning** before saving (appointments outside the new hours); **staff can ask for a change, the admin approves** (we have it); **the person is told** when their hours change (we show it in My working hours; a push is parked).
- Don't copy: day-by-day dated shifts, drag-to-roster, labour cost, clock-in.

**Words (owner to confirm; the database and code names stay):**
| Now | Proposed | Why |
|---|---|---|
| Team view "Shifts & coverage" | **Shifts** | shorter chip; coverage is one card in it |
| "Weekly coverage" | **Weekly shifts** | says what it shows |
| "Shift templates" | **Shift types** | a clinic says "morning shift", not "template" |
| "Clinic Default" / "Set Clinic Default Hours" / 🏢 | **Clinic hours** | same words as Settings → Hours; no emoji |
| "Custom hours (individual)" | **Own hours** | one person's own days and times |
| "Staff Member" (table) | **Therapist** | only therapists are on the roster |
| "Daily capacity" · "3 staff 21h" | **On shift** · "3 · 21h" | plain |
| "Active Weekdays", "+Add / −Removed / Active" on each day | **Days**, and one line under the days: "Adds Sat · Removes Mon" | the day buttons show on/off only |

**Who can change shifts:** the admin (Settings is admin-only). The RPCs also allow front desk, but front desk has no route to Settings, so in practice it is admin-only; keep it that way (owner rule: therapists never set these; a therapist only *requests*). Document this; no change.

| Sub-step | Scope | Build | Review |
|---|---|---|---|
| **14a** | Bugs: removed weekdays, split clinic hours in coverage, appointment conflicts (**one migration**) | Opus | Opus |
| **14b** | One person sheet (`SheetDialog`): Shift type \| Own hours \| Clinic hours; used from the Shifts card **and** the Team member card | Sonnet | Opus |
| **14c** | Weekly shifts card: clickable rows on desktop, real phone cards, session-gap note, `tab:` breakpoint | Sonnet | Opus |
| **14d** | Shift types list + sheet + name check + Hidden footer; palette tokens | Sonnet | Opus |
| **14e** | One-therapist clinics: a simple "Working hours" card instead of the roster tools | Sonnet | Opus |

Build order: 14a, 14b, then 14c/14d, then 14e.

#### 14a — Bug fixes (Opus, one migration) (unchanged)
1. **Unchecked weekdays stay on (confirmed):** `supersede_overlapping_weekdays` keeps an older assignment's days that the new one doesn't cover, so editing Mon–Sat down to Mon–Fri leaves Saturday on. Don't supersede **all** of a therapist's assignments (that would wipe a second shift type). When the admin **edits** an existing assignment, pass its id (`assign_shift(…, p_replaces uuid default null)`): the RPC supersedes that row entirely, supersedes overlaps on other rows as today, and rebuilds working hours. A new assignment behaves as now. Drop/recreate `assign_shift`, re-grant, add the file to `supabase/migrations/`, apply live.
2. **Split clinic hours in coverage:** `ShiftCoverageGrid` and `buildCoverage` read clinic hours as one block (`bookingStartHour`–`bookingEndHour`). Use the per-weekday sessions from `domain/operatingHours.ts` (the helper `describeSchedule` and the Hours editor use), so 9–1 and 4–8 is 8 hours, not 11. Same for the "Clinic hours" label (today "9–5" is built from the two numbers).
3. **Appointments outside the new hours:** reuse `appointmentsOutsideHours` and the `SetWorkingHoursFlow` confirm: "3 upcoming appointments fall outside these hours." **Save anyway** / Cancel. Applies to Shift type, Own hours and Clinic hours alike.
- **Tests:** Mon–Sat → Mon–Fri turns Saturday off; a two-shift-type therapist keeps both when one is edited; no `p_replaces` behaves as before (SQL); split hours give 8h; conflict count and Save anyway.
- **Status (2026-11-05):** Step 14 built, reviewed and pushed: 14a (migration `20261104100000` applied live by the owner and committed; the sheet sends `p_replaces`, one call per row), 14b `ShiftSheet`, 14c Weekly shifts, 14d Shift types, 14e solo Working hours card. Words changed by the owner: the Team view is **Working hours**, the card stays **Weekly shifts**, lists use **Active / Inactive**. Still to check on a real device: the two-row weekday case on a test therapist, and the 360px phone check.

#### 14b — One person sheet (Sonnet)
- **Replace** `AssignShiftDialog` (centred modal, ~900 lines, native select with an emoji, a second dialog for custom hours) with `ShiftSheet` on `SheetDialog` (bottom sheet on phones, pinned Cancel/Save).
- **Opened for one person** (tap a row/card, or "Edit shifts" on the Team member card — this replaces the separate "Set working hours" flow there, so there is one way to set hours):
  - Top: the person's name and current line (`describeSchedule`), and their week as a 7-day strip.
  - `Segmented` **Shift type | Own hours | Clinic hours**.
  - Shift type: the types as radio rows with their times ("Morning · 8:00–4:30 · 30m lunch"), then **Days** (7 chips, 44px, fit 360px) with three quick chips **Open days · Mon–Fri · Clear**, then one line "Adds Sat · Removes Mon". Break override stays behind "Change lunch time" (only for a type with a break).
  - Own hours: the hours editor inline (`ShiftTimesEditor`/the `SetWorkingHoursFlow` body), no second dialog.
  - Clinic hours: one line "Uses the clinic's opening hours (Mon–Sat 9:00–1:00, 4:00–8:00)."
  - Save runs 14a's conflict check first.
- **Opened from "+ Assign shift"** (header): same sheet with a person picker (chips, several allowed) — Shift type and Clinic hours only; Own hours needs one person (say so instead of a disabled option).
- `getTherapistScheduleInfo` lists every active shift type for a therapist (not just the first). Editing passes the assignment id (14a). Remove the unused `initialWeekday` branch.
- **Tests:** renders on `SheetDialog`; Own hours inline (one dialog); the Team member card opens the same sheet; days summary line; bulk assign to two people; editing passes the id.

#### 14c — Weekly shifts card & phone cards (Sonnet)
- `SectionCard` "Weekly shifts", "+ Assign shift" in the header; subtitle "Who works which days. Tap a therapist to change their shifts."
- **Breakpoint:** the table/cards split uses `tab:` (744px), not `md:` (768px) (the app rule in `index.css`).
- **Desktop/tablet table:** no inline Edit button (it cut names at 80px); the row is a button-like focusable row with a faint "Edit ›"; full names (wrap, don't truncate); header "Therapist"; footer "On shift" ("3 · 21h", amber "No one" on an open day).
- **Phones (below `tab:`):** one card per therapist: colour dot, **full name**, "40h / wk", the `describeSchedule` line ("Morning · Mon–Fri"), and a quiet **M T W T F S S** strip of dots (filled = on, ring = off, grey = clinic closed) — no cut words like "Mornin", "Cust", "Close". The whole card opens the sheet.
- **Session gap note:** when a day has two clinic sessions and no one on shift covers one, an amber "Evening gap"/"Morning gap" in that day's footer (desktop) or in the card list header (phones: "Sat evening: no one on shift"). Uses 14a's per-session hours.
- **Tests:** row click and card tap open that therapist's sheet; full name and schedule line on the card; gap note; split at `tab:`.

#### 14d — Shift types & palette tokens (Sonnet)
- `SectionCard` "Shift types" with "+ Add"; a calm list (name, times, "Used by Asha, Ravi") instead of the 3-column card grid and the inline add form; add/edit on `SheetDialog` with the existing `ShiftTimesEditor` (Continuous | Split).
- **Names:** `nameCheck` — an exact match blocks (two "Morning" types is always a mistake), a near match only notes (no `unique` in the database here; the check is app-side).
- Inactive types in `HiddenItemsFooter` ("Hidden (N)"); "Delete" only for a type never assigned, as a quiet red link behind the existing confirm; otherwise "Hide".
- "Add suggested shifts" stays for an empty list (team clinics only).
- **Palette:** 8 distinct palettes as tokens in `index.css` (`--shift-1-bg/-ink/-line` … `--shift-8-*`, with dark values); `SHIFT_PALETTES` uses `var(--shift-n-*)`. No hex literals in `shiftUtils.ts`; therapist dot colour fallback `#2c5f63` → `var(--teal)`.
- **Tests:** add/edit in the sheet; exact name blocks, near name notes; hidden in the footer; no hex in `shiftUtils.ts`.

#### 14e — One-therapist clinics (Sonnet)
- When the clinic has **one active therapist** (10 of 15 today), the Team → Shifts view shows a single **"Working hours"** card instead of requests, Weekly shifts and Shift types: the person's week (the same 7-day strip and hours lines), and "Edit hours" opening the 14b sheet straight on Own hours | Clinic hours (no Shift type tab unless the clinic already has types).
- Existing shift types and assignments keep working and stay visible under "Shift types (N)" if any exist, so nothing is hidden from a clinic that used them.
- The `Segmented` chip keeps the name **Shifts** (search still finds "working hours", "shift").
- **Tests:** one therapist → one card, no roster tools; two therapists → the full view; a one-therapist clinic with an existing type still sees it.

**Parked (Step 14):** a push to the therapist when an admin changes their shifts (in-app notice exists in My working hours); one-off exceptions ("off this Thursday", "extra Saturday") — belongs with Leave (other plan, P13); dated rosters, shift swaps, open shifts.

---

### Step 15 — Lite tier & Settings refinements (Sonnet builds, Opus reviews)

**Decisions with owner (2026-11-03):** the invoice preview and the authorised signature stay on every plan; the server's `issue_invoice()` already refuses Lite clinics.

**Live data (2026-11-03):** 11 Lite clinics, **0 invoices** among them; 4 Clinic+ clinics, 43 invoices.

| Sub-step | Scope | Build | Review |
|---|---|---|---|
| **15a** | Invoices on a plan without invoicing: keep past invoices printable, make the state clear | Sonnet | Opus |
| **15b** | Team seat cap on unlinked therapists; the unlinked banner at the cap | Sonnet | Opus |

#### 15a — Invoices on a plan without invoicing (Sonnet) *(revised 2026-11-05)*
- **Keep past invoices findable, not just printable.** The Ledger's Invoices tab is hidden when `canBill` is false (`filterLedgerTabs`, `LedgerPage.tsx`), so a downgraded clinic can't reach them. Show the tab read-only for a clinic on a plan without invoicing **only if it already has invoices**. A therapist hidden by `invoicingAccess: 'billing_staff'` stays hidden.
- **`InvoicePrintPage`:** keep print and PDF, with one quiet line: "Your plan doesn't issue new invoices. Invoices you already issued stay here to print or share." Void and amend stay hidden (already behind `canBill`). Issuing stays blocked; no second guard in `IssueInvoiceDialog`.
- **Tests:** downgraded clinic with invoices sees the tab and note, can open one, sees no void/amend; with no invoices no tab; a clinic with invoicing sees no note; a billing-staff therapist still sees no tab.

#### 15b — Team seat cap & unlinked banner (Sonnet) *(revised 2026-11-05)*
- **Email box:** pass `atSeatCap` and `loginsHint` to `TeamMemberCard`; for a therapist with no login at the cap, disable "Email for login" and show the hint.
- **Banner:** move it from `SettingsPage` into `Therapists`, where `atSeatCap` is known. Below the cap keep today's wording; at the cap: "N therapists are on the schedule without a login. Your plan's logins are all in use; upgrade to invite them."
- **Landing tab:** at the cap, unlinked therapists no longer send Settings to the Team tab (`SettingsPage`, `landedOnDefault`).
- **Setup checklist:** at the cap, `link-therapist` says it needs an upgrade and doesn't block essentials. Keep the step ID.
- **Tests:** email box and banner at and below the cap; landing tab; checklist step.

---

### Step 16 — Faster visit logging & package expiry (Sonnet builds, Opus reviews; 16c needs one migration)

**Who can change the catalog (owner rule, 2026-11-04):** only the admin. This is already true in the database (`catalog_insert/update/delete` need `is_clinic_admin`) and in the app (`canEditSettings = isAdmin`). Nothing here widens it. A therapist or front desk never sees an edit control for services, prices, expiry or usage settings. Every new control below is behind `canEditSettings`, and a non-admin sees a plain "Ask your admin" line instead.

#### 16a — Add a service from the visit screen (Sonnet) *(revised)*
- **Where:** when a search in the New Visit service picker finds nothing, an admin sees "+ Add 'Dry needling'", opening `ServiceFormSheet` with the name filled in; saving selects the new service. Needs a no-results slot on `SearchableSelect` and an initial name on the sheet. New Visit only, not Edit visit.
- **Others:** a therapist or front desk sees "Ask your admin to add it" in the same place.
- **Treatments:** the same add in the visit's treatment picker (it lists catalog treatments), admin only.
- **Tests:** admin adds and it is selected with the draft intact; non-admins see no button; a taken name is refused.

#### 16b — dropped (2026-11-05)
Already built: `quickServices` (`rankServicesByUsage`) shows the top 3 services of the last 90 days as one-tap chips on the visit.

#### 16c — Optional package expiry (Opus; one migration) *(revised)*
- **Setting:** on a package service, optional "Valid for (days)" in `ServiceFormSheet`; blank means no expiry; quick choices 30 / 60 / 90 plus a typed value. Admin only. (Live data: 20 packages, median 7 days to finish, 90% within 44, longest 66.)
- **Storage:** `service_catalog.validity_days` and `visits.package_validity_days` (smallint, nullable, 1–730, no backfill). Copy the days onto every session; the date is the package's first visit date + days, worked out in `packageTracking.ts`. Correcting the first visit's date moves the expiry, deleting that visit doesn't lose it, and editing the catalog never changes a package already held. Existing packages never expire.
- **Never blocks:** after the date, a quiet note on the visit: "This package expired on 12 Dec." Saving still works.
- **Shows on:** the picker's continue row ("session 3 of 5 (expired 12 Dec)"); Workspace → Packages: "Expiring soon" (within 7 days) and "Expired", which replaces the 14-day stale marker so a row never shows both; the service form.
- **Not on invoices for now** (fixed records); add if clinics ask.
- **Migration:** file in `supabase/migrations/`, applied by the owner **before** the client deploys (the sync pushes the new columns); both schema doc copies.
- **Tests:** days copied to each session; date moves with the first visit; catalog edit leaves held packages alone; blank means none; chip windows; note doesn't block; never both Expired and stale.

#### 16d — Service usage for the admin only (Sonnet) *(owner decision 2026-11-05)*
- Usage shows on by default for the admin on the Services and Treatments lists; the "Show usage" switch stays so it can be turned off on a device. This reverses Step 11's "off by default".
- **Front desk and therapists get no usage view.** No Reports list.
- **Tests:** on by default; switching off is remembered; counts are clinic-wide.

**Order:** 15a, 15b, 16a, 16d, then 16c last (its migration comes first). One commit each.

---

## Parked (not in this plan)

- **From Step 11:** price history (past bills keep their price; the edit form shows "Was ₹X"), drag-to-reorder services (replaced by 16b), and moving the other hand-made dialogs to `SheetDialog` (only the phone-critical ones, after a read-only list the owner approves: take payment, record advance, issue invoice, edit visit, follow-up). Moved into Step 16: package expiry (optional field), adding a service from the visit screen, usage for admin and front desk. Considered and dropped: starter-set buttons for empty lists (every clinic is seeded at setup), a clinic-wide usage *setting* (usage by default for the admin is now 16d), "≈"/"about" before prices, a side panel for editing on desktop, an inline add box for treatments on the Settings list (the visit-screen add in 16a covers it).

- Short descriptions under card titles: the tab header already explains each tab.
- One shared image-upload component for logo / partner logo / signature / UPI QR: nice tidy-up, no user-facing bug.
- Receipt tab in the letterhead preview: the preview is already a full receipt.
- Making "Schedule" a link in the Hours card's closures note (the tests render without a router).
- `font-bold` outside Settings (about 85 places; 700 is not loaded): separate sweep.
- **App-wide pass for redundant buttons, fields and options (deferred by the owner 2026-11-02):** read-only first, a list to approve before any change. Screens: New visit, the saved-visit screen, Ledger, Schedule, Workspace, Patient profile. Look for duplicate buttons doing the same thing, options nobody changes (check the live data), and the same setting asked in two places.
- **Future Feature Proposal (Care Settings & Therapist Access Scoping):** Inpatient (IPD), Outpatient (OPD), and Home Care segregation, department-wise partner splits, and per-therapist care setting access scoping drafted in `docs/superpowers/plans/2026-11-05-care-settings-ipd-opd-homecare.md` for Claude's review.

## Final check (Opus, whole plan)

**Already verified (tests, reviews and renders, 2026-11-02 and 2026-11-03):** Steps 1–11 and the phone layout pass: Lite UPI and Payments; partner settings in one card and a Lite clinic can turn partner mode off; fields typeable on first click, the Save bar only after a change; untouched cards never show Save; the three confirmations; search finds timezone, agenda, shift, signature, upi, partner, lunch, opening hours; Team views and the deep link; comparison with no toggle; Services & treatments (add a service and a package from one button, names can't duplicate on any write path, usage behind "Show usage", whole-rupee prices, Referral sources on General); `FEATURES_AND_SCHEMA.md` updated in each commit.

**Still open**
- [ ] **Phone check at 360px (the owner):** the Settings tab chips and search, the Hours card, the Partner card with its confirmation, Team views, the Services sheet with the keyboard open, the email box's keyboard, and the static Save bar at the end of a long card.
- [x] **Step 12:** a new clinic can sign up, invite or skip a team, check its starter services and finish on a phone without a dead nav bar or a doubled box; the checklist's words and links match the new Settings, and no step ID changed.
- [x] **Step 13:** the dots on every other day don't change when another date is clicked.
- [ ] **Step 14:** unchecking a weekday turns it off without losing a therapist's second shift; one sheet sets hours from both the Shifts card and the Team card; phone cards show full names with no cut words; a one-therapist clinic sees one Working hours card; split clinic hours count correctly; assigning shows appointments that fall outside the hours; the migration is applied live and committed.
- [ ] **Step 15:** a downgraded clinic can still print its old invoices; an unlinked therapist at the seat cap can't be sent an invite the plan refuses.
- [ ] **Step 16:** an admin can add a service from the visit and it is selected; a therapist and front desk cannot; usage is on by default for the admin only; a package service can carry an optional validity, changing it later leaves held packages alone, and an expired package warns but never blocks; migration applied live and committed.
- [ ] `FEATURES_AND_SCHEMA.md` updated in each commit; then delete this file.
