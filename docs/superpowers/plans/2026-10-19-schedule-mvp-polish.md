# Schedule MVP polish — implementation plan

**Status:** ready to build. Owner decisions recorded 2026-10-19; revised the same day after reviewing Gemini's `schedule_mvp_polish_mockups.md` (decisions 7–10).
**Builds on:** `docs/superpowers/specs/2026-10-19-mobile-schedule-grid-v4.md` (all 5 commits done) and the follow-ups `0491785`, `5d60595` (phone Day = cards for one therapist, column grid for several; List folded into Day).
**Process:** work on `main`, one commit per step below, commit locally, never push. Claude reviews each commit before the next starts. Start with `git status --short` and `git log --oneline -5`.

## 0. Decisions (LOCKED — ask before changing)

1. **Booking for colleagues stays admin / front desk only.** Therapists keep: own column by default, colleagues addable read-only, book / move / manage only their own. No server or RLS change in this plan. `canBookFor` and `canManageAppointment` in `ScheduleBookingsView.tsx` are not to be changed.
2. Phone views stay **Day · 3-Day**. Phone Day is the proportional grid for one or many therapists (decision 7). No phone Week grid.
3. Desktop / iPad keep **Day · Week**. 3-Day stays phone-only.
4. The URL contract stays `mode = 'day' | 'week'`; don't touch `router.tsx` or `src/app/schedule.ts`.
5. Free time is shown by a light tint only, **empty — no text, no labelled block, no time buttons** — in every grid, including the phone Day for one therapist (decision 8).
6. Every tap target ≥ 44px on phones. Every `<button>` has `type`.
7. **Phone Day is always a proportional timeline** (owner, after asking for the Now line to cross cards "like the 3-Day / Week calendar"): with one therapist it is the same grid as with several, just **one full-width column**. The separate card timeline / rail design is dropped.
8. **Free time is literally empty** (tinted space on the grid; tap it to book). The labelled "Free" block and bare time buttons are dropped.
9. **Desktop / iPad Week with several therapists = always a true time grid** (Gemini's direction): one column per day, appointments at their real times, overlaps side by side, each block carrying a therapist pill. No 4-therapist cap. The roster idea is dropped.
10. **Phone booking = round 56px "+" floating button** (not the extended "+ Book" pill).
11. Therapist chips use the therapist's colour dot — there are no therapist photos in the app.

## 1. Rules for every step

- Reuse, don't re-implement: `blockGeometry`, `assignLanes`, `useGridDrag`, `dropAllowed`, `freeGaps`, `generateScheduleSlots`, `dayLoad` / `LoadLine`, `appointmentFill`, `BookSlotSheet`, `AppointmentDetailsPanel`, `TherapistFilter`, `MiniCalendarStrip`, `FindTimePanel`.
- Do not change existing tests' assertions. If a behaviour change makes one wrong, stop and say which test and why in the report; Claude decides.
- `npm run typecheck && npm run lint && npm run test` before each commit; `npm run build` for steps 2, 4 and 6 (shared components / layout).
- Update `FEATURES_AND_SCHEMA.md` in the same commit when behaviour changes. The Schedule section is duplicated: `grep -n "Layout by width" FEATURES_AND_SCHEMA.md` and edit **both** copies.
- Report per commit: hash, files, real tails of the checks, screenshots (see §9).

## 2. Step 1 — Phone top area (all phone views)

**Problem:** ~40% of a 780px screen is chrome before the first appointment (app bar, tab row with + Book, two toolbar rows, week strip). Date navigation is duplicated (‹ title › row and the week strip). The therapist filter is an unlabelled dot.

**Build:**
- `src/components/schedule/PhoneScheduleToolbar.tsx`: replace row 1 (‹ title › Today) with a **month line**: month + year ("October 2026", display font) on the left, the day summary under it in small text (Day view only; `daySummary` already exists), **Today** pill on the right (disabled when the visible window contains today). The month line toggles nothing.
- The **week strip (`MiniCalendarStrip`) becomes the date navigation on every phone view** (always visible on phones; remove the `phoneCalendarOpen` hide/toggle state from `ScheduleBookingsView.tsx`). In 3-Day, the three visible days are highlighted as a range in the strip (add an optional `rangeDays?: string[]` prop to `MiniCalendarStrip`; default behaviour unchanged).
- Row 2: a **labelled therapist chip** (`● Prem Anand ▾`, `● 3 therapists ▾`, `● All therapists ▾`; therapist's own colour dot first) opening the existing `TherapistFilter` popover, then the `Day | 3-Day` switch, then ⋮. Add an optional `variant="chip"` (or `showLabel`) prop to `TherapistFilter` so the label shows on phones; desktop look unchanged.
- **+ Book → floating action button** on phones: round 56px, `fixed`, bottom-right, above the bottom nav and the safe area (`bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)]`), `aria-label="Book appointment"`, opens `openBooking()` exactly like today's button. Hide the tab-row `+ Book` below `tab:` only; keep it from `tab:` up.
- The tab row (Schedule · History · Feedback) stays.

**Acceptance:** at 360×780 and 390×844 the first appointment / first time row starts at or above y ≈ 330px (today ≈ 465px). Date never truncated. FAB never covers the last row (add bottom padding to the scroll area equal to the FAB height).

**Tests:** toolbar renders month line + Today state; therapist chip label for 1 / many / all; FAB opens booking (component test with `onBook` spy); `MiniCalendarStrip` highlights `rangeDays`.

## 3. Step 2 — Phone Day for one therapist = one wide grid column

**Problem:** with one therapist selected, phone Day uses a different, list-based layout (`AgendaList`) from the several-therapist Day. The Now line can only sit between cards, free time is a pile of boxes, and finished time vanishes so a morning looks unbooked.

**Build:**
- In `ScheduleBookingsView.tsx`, make phone Day **always** render `MobileDayGrid` (remove `phoneDayIsGrid`; `showPhoneGrid` becomes `isPhone`). With one therapist, `gridTherapists` has one entry, so the grid has a single column that fills the width (the CSS template already uses `1fr`). Keep `Find a time` (⋮ menu) and its panel exactly as they are.
- **Full density by width:** a single column is ≈ 290px, so `densityFor` returns `full`: time range, patient name, flags (`BlockFlagBadges`) and reason on blocks ≥ 60 min. Make sure a 30-minute block (one slot tall, ≥ 44px) still shows name and range on two lines and the reason is dropped, not clipped.
- **Now line (all grids, phone and desktop):** keep the exact-time line crossing blocks, but make it **quiet so it never hides text**: 1px (`border-t` instead of `border-t-2`), `rgb(166 85 47 / 0.55)` (rust at ~55%), `pointer-events-none`, drawn above blocks (`z-[3]`). The weight moves to the **dot** (7px, solid rust) at the left end and the **time badge** on the axis (phone), which stay fully opaque. No line is drawn through text-heavy elements other than blocks. Verify at 390px that text under the line in a 60-minute block is fully legible.
- **Finished appointments:** for today, a block whose end is before now renders at 60% opacity (`opacity-60`), phone and desktop alike (`DayColumn`: compare `end` with `nowMinutes`). Cancelled / no-show styling is unchanged.
- **Free time:** the tint from step 3 only; no "+" glyph or labels. The dismissible one-line hint ("Tap a free time to book. Press and hold an appointment to move it.") stays and is the discoverability aid; show it again only after the owner clears site data.
- **Quiet days:** initial scroll goes to Now (today) or the first appointment (`initialScrollTop`), so an empty morning is not the first thing seen. No compression of the time axis — it stays proportional.
- **Day off / closed** for the single therapist: the existing hatched closed column plus the closed banner; for an off therapist the column shows the off-hours shading. No extra lines needed.
- **Delete dead code in the same commit:** `AgendaList.tsx`, `AgendaList.test.tsx`, `gapHourRows`, the `dayGaps` memo and `onBookGap` wiring in the phone branch, the `EmptyDay` phone usage — only if `grep -rn` shows nothing else imports them (the waitlist banner still uses `dayGaps`; keep that memo if so). Do not delete `FindTimePanel`.
- Update `FEATURES_AND_SCHEMA.md` (both copies of the phone-views paragraph, written in the previous commit `5d60595`): phone Day is the grid for one or many therapists; the card timeline and `AgendaList` are gone.

**Acceptance:** at 390×844 with one therapist: one column spans the width; a 60-minute block shows time range, name, flags and reason; the Now line is exact and crosses a block in progress; free time is tinted and empty; every free slot ≥ 44px tall (also for 15-minute clinics); tapping a free slot opens the booking sheet for that therapist and time; long-press move works.

**Tests:** single-therapist `MobileDayGrid` renders one column with `full` density content (reason visible on a 60-minute block, hidden on a 30-minute one); a block ending before `nowMinutes` has the dimmed class and a future one does not; the Now line renders for today only; no element in a free slot contains text. Existing `ResourceDayGrid.test.tsx` and `MobileGrids.test.tsx` pass unchanged.

## 4. Step 3 — Same free-time look on every device

**Problem:** phones tint free time; desktop / iPad grids show blank cells with a hover-only "+" (iPad has no hover).

**Build in `src/components/schedule/TimeGrid.tsx` `DayColumn`:** apply the light free-slot tint (`bg-[var(--moss-light)]/40`, off-hours `bg-slate-100/40`) for **all** sizes, not only `phone`. Keep the hover "+ 9:30 AM" label on pointer-fine devices. Check `MultiResourceWeekGrid` columns get it too (they render `DayColumn`).

**Acceptance:** desktop Day, desktop Week (one and several therapists), iPad Day — free time visibly tinted, booked blocks still clearly dominant (screenshot check at 1280 and 820).

**Tests:** existing `ResourceDayGrid.test.tsx` must pass unchanged; add one test asserting the tint class on a free slot without `phone`.

## 4b. Revisions after review (2026-10-20, owner agreed) — these override steps 4–7 below where they differ

Built so far: steps 1–3, plus the in-column hour rail, page scroll on phones (≤ 3 columns) and the fixes in `e93927e`.
**Order of work: step 4 → step 7 → step 5 → step 6.**

- **Step 4:** drop the per-column-header "Only" button (the therapist sheet and the desktop rail already have "Only"). Keep the date headline on `tab:` and up — iPad has no week strip.
- **Step 5:** no new chip row. In 3-Day the toolbar's therapist chip becomes **single choice** ("Kiran ▾"); the same bottom sheet picks one therapist, held in local state `threeDayPick` (URL filter unchanged). Keep the load dots and the start time on tall blocks.
- **Step 6:** precedence is (1) `therapist` in the URL, (2) the saved selection minus anyone off that day, (3) who's working. Apply a saved selection with a history **replace**, never a new entry. "N off" goes in the status line as a tappable part ("Today · 6 booked · 2 off"), not a new line.
- **Step 7:** at most **3 lanes** per time in a day column; further overlaps collapse into a "+N" chip that opens a short list of those appointments (tap → details panel). The < 72px initials rule applies to the remaining lanes. Free time is tinted only where at least one selected, bookable therapist is free **and working**; time outside everyone's hours stays blank. Tests: 5 overlapping appointments show 3 lanes + "+2".

## 5. Step 4 — Desktop / iPad toolbar aligned with phones

**Build in `ScheduleBookingsView.tsx` (the non-phone toolbar branch):** same order as phones — ‹ › + date headline + summary, Today, labelled therapist chip (below `desktop:`; the rail covers desktop), `Day | Week`, **Find a time** as a visible button (from `tab:`; today it is only in ⋮ on phones), ⋮. Extract the toolbar into `src/components/schedule/ScheduleToolbar.tsx` if it removes ≥ 40 lines from the view (it should).

**Also:** each column header in `ResourceDayGrid` gets an "Only" action on pointer devices below `desktop:` (the rail already has `onOnlyTherapist` on desktop) — a small text button in the header that calls the existing `setTherapists([id])`.

**Tests:** toolbar component test (order of controls, Today disabled state, Find a time toggles `findTime`).

## 6. Step 5 — 3-Day improvements (phone)

- Replace the **"Pick a therapist" dead-end card** with a slim, horizontally scrollable **therapist chip row** above the grid (one chip per visible therapist, colour dot + short name, `aria-pressed`). Default selection: the viewer's own therapist when they are one, else the first therapist in the current selection — visibly selected in the chip row (not silent). Admin / front desk choosing a chip **does not** change the URL filter (local state `threeDayPick`), so switching back to Day still shows everyone.
- Day headers: replace the bare count with up to 3 load dots (reuse the dot rule `loadDots` from `ScheduleRail.tsx`; export it if needed).
- Blocks ≥ 45 min tall show the start time on a second line even in compact density (`densityFor` result `compact` but height ≥ 45 × pxPerMinute → show time).
- Confirm initial scroll lands on Now (today in window) or the first appointment.
- Free slots keep the **light** tint from step 3 — not solid tiles (Gemini's mockup made free time as heavy as appointments).
- The 3 visible days show as one connected pill in the week strip (`rangeDays`, step 1).

**Tests:** chip row default selection for therapist vs admin; choosing a chip doesn't call `setSchedule`; header dots; compact tall block shows time.

## 7. Step 6 — Admin / front desk defaults

- **Default to who's working:** when the URL has no `therapist` filter, admin / front desk see only therapists with working intervals that day (`workingFor(id, date).length > 0`) **plus** anyone with an appointment that day. A quiet line under the toolbar: "2 off today · Show" (tap → show everyone for this session, local state). Applies to phone Day grid, desktop / iPad Day. Week keeps today's behaviour.
- **Remember the selection per device and clinic:** when admin / front desk change the filter, save the comma list in `localStorage` key `theranet:schedule-therapists:<clinicId>` (try/catch); on load with no `therapist` in the URL, apply it via `setSchedule({ therapist })` once. Therapists: don't persist (their default is themselves).
- **Find a time** visible (done in step 4 for tab+; on phones keep it in ⋮).

**Tests:** pure helper `workingTodayIds(roster, date, workingFor, appointments)`; saved selection read/write helper with try/catch (mirror `readStoredPhoneView`); "N off today" line shows / hides.

## 8. Step 7 — Week time grid for several therapists (desktop / iPad)

**Problem:** `MultiResourceWeekGrid` caps at 4 therapists (banner) and splits each day into narrow per-therapist sub-columns whose textless blocks rely on hover tooltips (no hover on iPad).

**Build (decision 9):** when `mode === 'week'` and more than one therapist is in view, render a **true week time grid**: 7 day columns, one shared time axis, appointments of all selected therapists placed at their real times. Reuse `GridFrame` / `DayColumn` via `WeekTimeGrid` (add a `multiTherapist` mode) rather than extending `MultiResourceWeekGrid`; delete `MultiResourceWeekGrid` and its test in the same commit only if nothing else imports it (`grep -rn MultiResourceWeekGrid src`).
- **Overlaps:** `assignLanes` places simultaneous appointments side by side within the day column (already how `DayColumn` lanes work). Each block: therapist colour left edge + a small **therapist pill** (short name, `shortName()` from `MultiResourceWeekGrid.tsx` — move it to a shared helper) + patient name; time on a second line when the block is ≥ 45 min tall.
- **Narrow lanes:** when a lane is < 72px wide (≈ 3+ overlaps on iPad), the block shows only the therapist colour + patient initials; tapping still opens the details panel (no hover dependency). One pill per block, never two.
- **Free time:** a slot is tinted (and tappable) only if **at least one** selected therapist the viewer can book for is free and working then. Tapping opens `BookSlotSheet` with date + time and **no** preset therapist, so the sheet's therapist picker offers only those free at that time. Add a `freeAt?: (minutes: number) => boolean` prop to `DayColumn` used instead of its built-in occupancy check when present.
- **Drag:** moving within the week keeps the appointment's therapist (columns have no `therapistId`); cross-therapist moves stay in Day view.
- **No cap**, no banner: remove `maxWeekTherapists` / `isAllTherapistsWeek` and the "Showing first 4 therapists" banner.
- Day header tap → that date in Day view (existing `onOpenDay`).
- Colleague appointments (therapist viewer) keep the read-only rules: no reason/flags, not draggable.

**Tests:** 3 therapists with overlapping appointments render side by side with one pill each; narrow-lane block shows initials only; free tint appears when one bookable therapist is free and not when all are booked; tapping free time calls booking with no therapist; no cap banner with 6 therapists.

## 9. Verification (every UI step)

Real browser, not only jsdom. The owner checks the logged-in app on `localhost:5173` with Firefox responsive mode; the builder provides screenshots from a fixture harness (a throwaway `harness-tmp.html` + `src/harness-tmp.tsx` rendering the components with fixture data, **deleted before commit**) at **360×780, 390×844, 820×1180 (iPad portrait) and 1280×800**, on a day **with** appointments, an overlap, a Now line inside working hours, one therapist off, and a colleague column (therapist viewer). Confirm `document.documentElement.scrollWidth === innerWidth` at each width.

Never kill processes with `pkill -f` (it can kill the agent's own shell); kill your own PIDs only. The owner's dev server on port 5173 must be left running.

## 10. Out of scope

Booking for colleagues by therapists (decision 0.1); a week roster view (dropped, decision 9); phone Week grid; multi-day drag; server / RLS / migration changes; Workspace and Ledger screens; notifications.
