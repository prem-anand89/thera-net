# Schedule MVP polish — implementation plan

**Status:** ready to build. Owner decisions recorded 2026-10-19; revised the same day after reviewing Gemini's `schedule_mvp_polish_mockups.md` (decisions 7–10).
**Builds on:** `docs/superpowers/specs/2026-10-19-mobile-schedule-grid-v4.md` (all 5 commits done) and the follow-ups `0491785`, `5d60595` (phone Day = cards for one therapist, column grid for several; List folded into Day).
**Process:** work on `main`, one commit per step below, commit locally, never push. Claude reviews each commit before the next starts. Start with `git status --short` and `git log --oneline -5`.

## 0. Decisions (LOCKED — ask before changing)

1. **Booking for colleagues stays admin / front desk only.** Therapists keep: own column by default, colleagues addable read-only, book / move / manage only their own. No server or RLS change in this plan. `canBookFor` and `canManageAppointment` in `ScheduleBookingsView.tsx` are not to be changed.
2. Phone views stay **Day · 3-Day**. Phone Day = card timeline for one therapist, column grid for two or more. No phone Week grid.
3. Desktop / iPad keep **Day · Week**. 3-Day stays phone-only.
4. The URL contract stays `mode = 'day' | 'week'`; don't touch `router.tsx` or `src/app/schedule.ts`.
5. Free time in the **grids** is shown by a light tint only (no text). In the phone **card timeline** it is a small labelled block ("Free" + time buttons) — owner decision 8 below, reversing the earlier "no free wording" for that view only.
6. Every tap target ≥ 44px on phones. Every `<button>` has `type`.
7. **Phone card Day keeps the timeline rail** (owner chose it over Gemini's full-width cards). Keep the rail narrow (≤ 48px) so cards stay wide.
8. **Card-timeline free time = labelled block** ("Free" heading + time buttons), light, not a solid tile.
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

## 3. Step 2 — Phone Day card timeline (one therapist)

**Problem:** cards float without a time structure; free times are heavy dashed boxes; passed time vanishes, so a morning looks unbooked; "Confirmed" adds noise; time shows as "10:00 AM / 60m".

**Build in `src/components/schedule/AgendaList.tsx`** (one-therapist path only; the component already receives `gaps`, `nowMinutes`, `slotMinutes`):
- A **timeline rail**: a 2px vertical line in a fixed left column (≈ 52px) with hour labels ("9 AM") at each clock hour that has content; appointment cards and free-time rows hang to the right. Pure CSS, no measuring.
- **Free time** = one light block per contiguous gap: a small "Free" label (muted moss, `text-xs`) and the `gapHourRows` start times as time buttons inside (`min-h-11`, white background, moss border/text). Background `bg-[var(--moss-light)]/40`, no dashed border, no heavy fill. Long gaps: show the first two hour rows and a "Show N more" toggle.
- **Card:** one header line = time range `10:00–11:00 AM` (no "(60m)", no divider) with the "Next · in N min" tag right-aligned; second line = patient name + up to 2 flag pills; second line = reason; status line **only** for `arrived`, `completed`/visit logged, `no_show`, `rescheduled`, `cancelled` (not for `confirmed`). Keep the colour edge and `appointmentFill`.
- **Now:** a rail dot + a thin line + "Now 3:19 PM" **between** rows at the right place — never drawn inside a card or a free block (Gemini's mockup did this; it reads as if the free block ends at now). The next upcoming appointment gets a small "Next · in 25 min" tag (computed from `nowMinutes`; hide when > 3h away).
- **Passed time:** for today, appointments that ended before now are rendered at 60% opacity; if passed working time had no appointments, show one quiet rail line "Earlier today · 9:00 AM – 12:00 PM" (no buttons).
- **Day off / closed** for the single therapist: one calm line ("Prem Anand is off today" / "Closed · {label}") plus one action (`Find a time` for another therapist when the viewer can book for others, else nothing). Replace the current `EmptyDay` for this path only.
- **Sticky date:** not needed after step 1 (the strip is directly above); skip.

**Tests:** rail hour labels appear only for hours with content; a free block shows the "Free" label and its time buttons call `onBookGap` with the right time; "Show N more" expands a long gap; status line hidden for confirmed, shown for arrived / no-show; past appointments get the dimmed class today only; "Next · in N min" logic (pure helper `nextUpLabel(appointments, nowMinutes)` with unit tests); off-day line. Update the one existing assertion only if unavoidable and report it.

## 4. Step 3 — Same free-time look on every device

**Problem:** phones tint free time; desktop / iPad grids show blank cells with a hover-only "+" (iPad has no hover).

**Build in `src/components/schedule/TimeGrid.tsx` `DayColumn`:** apply the light free-slot tint (`bg-[var(--moss-light)]/40`, off-hours `bg-slate-100/40`) for **all** sizes, not only `phone`. Keep the hover "+ 9:30 AM" label on pointer-fine devices. Check `MultiResourceWeekGrid` columns get it too (they render `DayColumn`).

**Acceptance:** desktop Day, desktop Week (one and several therapists), iPad Day — free time visibly tinted, booked blocks still clearly dominant (screenshot check at 1280 and 820).

**Tests:** existing `ResourceDayGrid.test.tsx` must pass unchanged; add one test asserting the tint class on a free slot without `phone`.

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
