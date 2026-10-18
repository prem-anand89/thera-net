# Mobile Schedule Grid — Corrected Plan (v4)

**Date:** 2026-10-19
**Status:** Approved by the owner for implementation by Gemini; Claude reviews every commit and pushes only when asked.
**Supersedes:** v2 (first mobile attempt, reverted in `56c3354`) and v3 (`2026-10-19-mobile-schedule-proportional-grid-design.md`, which mis-described the current grid and proposed a merged-lanes canvas).

---

## 1. Goal (the owner's words, condensed)

The phone schedule only has a list: no view of free slots, no "Now" line, no way to see several therapists side by side, no 3-day view. Bring the **same booking and scheduling ability** the iPad/desktop grid has to the phone, with a mobile-native layout. **Do not redesign the iPad/desktop schedule** — it already looks good.

## 2. Decided with the owner (LOCKED — stop and ask before changing)

1. **One column per therapist** in the Day grid. No merged "lanes" canvas.
2. **Therapists can see their colleagues' booked slots, including patient names**, so they know when colleagues are booked and which patients they are seeing. **Read-only**: a therapist can still only book for, move and manage their own appointments. This applies on **all devices** (phone, iPad, desktop), not just phones.
3. **iPad/desktop keep the Day/Week toggle** exactly as is. **3-Day is phone-only** for now.
4. Phone views: **List · Day · 3-Day**. Default **Day**, remembered per device in `localStorage` `theranet:schedule-phone-view` (try/catch). The URL `mode` stays `'day' | 'week'`; do **not** add a `'3day'` URL mode and do **not** touch `router.tsx` or `schedule.ts`.
5. **3-Day shows one therapist at a time.** If none or several are selected, show a "Pick a therapist" chip row; never silently default to one.
6. Built by Gemini in the commits of section 8; Claude reviews each.

## 3. What already exists (REUSE, do not re-implement) — verified in code

All in `src/components/schedule/TimeGrid.tsx` unless noted:

| Need | Existing piece |
|---|---|
| Proportional placement | `blockGeometry(start, duration, startHour, pxPerMinute)` (`src/domain/schedule.ts` ~L178). `PX_PER_MINUTE = 1.6` (96px/hour). |
| Side-by-side overlap inside one column | `assignLanes` (`src/domain/schedule.ts`, tested). |
| "Now" line | `nowMinutes` line + dot in `DayColumn` (~L318); `useNowMinutes()` supplies `now.minutes` / `now.today`. |
| Free, tappable slots | `generateScheduleSlots(slotMinutes, …)` + the `freeSlots` filter in `DayColumn` (hides past slots today, closed days, occupied time). |
| Off-hours / break / closed shading | `working` intervals, `offHours`, `CLOSED_HATCH_STYLE`. |
| Long-press → "Tap a free time to move X" (touch), cross-column/day moves, validation | `useGridDrag` (exported), `dropAllowed`; `dragOptions` in `ScheduleBookingsView.tsx` (~L513) incl. the off-hours / different-therapist / different-date confirm sheet (`setPendingMove`). |
| Booking sheet, details panel | `BookSlotSheet` via `openBooking`, `AppointmentDetailsPanel` (`canManage` prop gates actions). |
| Initial scroll to Now / first appointment | `initialScrollTop`, `useInitialScroll`. |
| Therapist picker | `TherapistFilter` (multi-toggle + show-all). |

The mobile grid is a **new presentation layer** (`src/components/schedule/mobile/`) that **composes these**. If something needed is not exported (e.g. `GridColumn`), export it without changing behaviour; the existing desktop/iPad tests must pass **unchanged**.

## 3a. Facts that shape the design (do not skip)

- `PX_PER_MINUTE` 1.6 makes a 30-min free slot 48px (OK). A 15-min slot would be 24px — too small to tap. **Rule:** on phones use `pxPerMinute = max(1.6, 44 / slotMinutes)` so a free slot is always ≥ 44px tall. Taps follow the clinic's slot length (`slotMinutes`); the booking sheet only offers those start times. 15-minute guide lines may be drawn for orientation only; they are **not** tap targets unless `slotMinutes` is 15.
- Phone breakpoint = Tailwind `tab` = 46.5rem. Use `matchMedia('(max-width: 46.49rem)')` (rem, not 743px), read once in initial state (no flash), tolerate a missing `matchMedia` (jsdom).
- Existing therapist scoping lives in `ScheduleBookingsView.tsx` (`selectedIds` ~L196, `scopedAppointments` ~L202, `visibleRoster` ~L226, `lockTherapist` ~L1106). Appointments are already readable clinic-wide by RLS (`is_clinic_member`), so a therapist's local data already contains colleagues' appointments; the scoping is only in the UI.
- `AppointmentDetailsPanel` (~L289) shows patient phone / call / WhatsApp actions whenever `patientPhone` exists, even when `canManage` is false. For a colleague's appointment that would expose a patient's phone number. **Fix required** (see 5.3).

## 4. Phone design

### 4.1 Toolbar (two rows — Gemini's first attempt crowded one row and clipped the date)
- Row 1: `‹`  **date title** (3-Day: range like `19 – 21 Oct`)  `›`  **Today**. The title is a button that toggles the `MiniCalendarStrip` (hidden by default in Day/3-Day; List keeps the strip as today).
- Row 2: therapist filter chip(s) · view switcher `List | Day | 3-Day` (`aria-pressed`) · ⋮ menu.
- All controls ≥ 44px. **Acceptance:** at 360px and 390px the date title is never clipped or overlapped; check with a long date ("Wed, 30 Oct") and 3 therapists selected.
- Step size: 1 day (Day, List), 3 days (3-Day). `Today` is disabled when the visible window contains today. No swipe gestures (the sticky header lives inside the scrolling grid box; a swipe there would scroll the grid).

### 4.2 Day grid (`MobileDayGrid`)
- Columns = selected therapists (admin/front desk: all active by default; therapist: themselves, plus any colleagues they add). Sticky time axis (left) and sticky column headers.
- Width: 1 therapist fills the width, 2 split it, 3 split it. With 4+ therapists each column keeps a minimum width (≈ 104px) and the grid scrolls sideways with the axis and headers pinned.
- **Content adapts to the measured column width** (use a `ResizeObserver`-based hook, with a pure `densityFor(columnWidthPx, blockHeightPx)` helper):
  - ≥ 150px: **full** — patient name, time range, short reason; flag badges only for the therapist's own appointments.
  - 110–149px: **medium** — name + start time.
  - < 110px: **compact** — name only (single line, truncated).
  - Blocks shorter than ~34px: one line `time name`.
- Overlap inside one column (same therapist cannot overlap; "no-show/cancelled shown" cases) uses `assignLanes`.
- Closed day / working-hours shading / breaks: reuse.
- **Free slots are visible**, not just hover: a subtle moss tint or a faint `+` on every free future slot, a slightly different treatment for outside-working-hours slots (already tappable with a warning in the sheet). Slots in the past (today) are not shown as free.
- **Now line:** line + dot spanning the day canvas, plus a **time badge** ("9:35 AM") on the axis side; only in today's column(s); `pointer-events: none`.
- Tap free slot → `BookSlotSheet` (date, time, therapist prefilled) **only if** `canBookFor(therapistId)`.
- Tap appointment → details panel (see 5.3 for colleagues).
- Long-press (450 ms) an own appointment → "Tap a free time to move …" banner with Cancel, vibration, 1.5 s click suppression — i.e. reuse `useGridDrag`; then the existing confirm flow. One-time dismissible hint, **one line, small** (not a permanent banner; it must not push the grid below the fold).
- Grid scroll box: `min-h-[320px]`, `max-h` based on `100dvh` minus header, toolbars and the 64px bottom nav (tune in a real browser), `overscroll-contain`. Initial scroll = Now (today) or first appointment.

### 4.3 3-Day grid (`MobileThreeDayGrid`)
- One therapist, three date columns, same axis, shading, Now line (today's column only), free slots and long-press move (moves may cross days).
- Column min width 98px (fits 360px and 390px). Compact density.
- Header cell tap → switch the phone view to **Day** for that date (set the date; do **not** change the URL `mode`).
- Therapist logins: own column by default; may pick a colleague (read-only, see 5). Admin/front desk with none/several selected: "Pick a therapist" chip row; picking writes `?therapist=<id>` (this also narrows Day — keep "All therapists" visible in the filter).

### 4.4 List
Unchanged `AgendaList` / Find-a-time behaviour, kept as the third option.

## 5. Therapists see colleagues' booked slots (all devices)

### 5.1 Behaviour
- Default for a therapist login = **their own column only** (today's behaviour). The therapist-visible `TherapistFilter` lets them add colleagues; added colleagues appear as extra columns, headed `Dr X · view only`.
- In a colleague's column: appointments show **patient name, time, status** (and the colour edge). **No** flags, reasons or notes. Free slots there are **not** tappable (no booking for a colleague). No drag, no long-press move, no resize.
- Admin/front desk behaviour does not change.

### 5.2 Implementation notes (`ScheduleBookingsView.tsx`)
- Replace the therapist hard-lock (`selectedIds` forced to `[myTherapistId]`, `scopedAppointments` filter, `visibleRoster`, `lockTherapist`) with: selection = `search.therapist` filtered to the roster, defaulting to `[myTherapistId]` for therapists. Keep `canManageAppointment` (own-only) and `canBookFor` (own-only) exactly as they are; they already gate drag, booking and moves.
- Placing/moving into a colleague's column is not allowed (drop validation must reject a column the user cannot book for).
- Other screens (Workspace, Ledger, notifications) are unchanged.

### 5.3 Details panel for a colleague's appointment (`AppointmentDetailsPanel`)
- Read-only: patient name, date/time, therapist, status. **Hide patient phone, call and WhatsApp actions, notes and every management action** when `!canManage`. (Today the phone/call block shows whenever a phone exists — fix it for the non-managing case without changing what managers and own-appointment therapists see.)
- Tests: a therapist opens a colleague's appointment and sees no phone/call/WhatsApp/reschedule/cancel; the same therapist opening their own appointment sees everything as today.

## 6. iPad / desktop
- **Unchanged** except: (a) the colleague view in section 5 (same filter, same read-only rules); (b) *optional, last commit:* the same **Now time badge** on the shared `DayColumn` Now line so phone and desktop match. Week view stays; no 3-Day outside phones.

## 7. Constraints
No new dependencies; no new nav tab; CSS variables only (no hex colours — use `var(--rust)` etc.); explicit `type` on every `<button>`; ≥ 44px touch targets; do not touch `router.tsx` / `schedule.ts`; localStorage always in try/catch; no push. Follow `.agents/rules/STANDING_HANDOFF_RULES.md`.

## 8. Commits (Gemini; Claude reviews each before the next)
1. **Pure helpers + tests:** `useIsPhone`, phone-view storage, 3-day dates / step / title, `phonePxPerMinute(slotMinutes)`, `densityFor(width, height)`, `selectedTherapistIds(role, myId, search, roster)`, `canViewAppointment` rules. No UI.
2. **Colleague view (all devices) + details-panel privacy fix + tests.** Smallest user-visible change; reviewed first because it changes data visibility.
3. **Mobile primitives:** axis, column, width-adaptive blocks, free-slot affordance, Now line + badge (composing the existing hooks), with component tests.
4. **`MobileDayGrid`, `MobileThreeDayGrid`, two-row toolbar and switcher wired into `ScheduleBookingsView`** for phones (List preserved, URL contract untouched).
5. **Polish:** one-line hint, scroll/height tuning, `FEATURES_AND_SCHEMA.md` (every duplicated section — `grep -n` the headings) and README only if significant; *optional* Now badge on the shared desktop `DayColumn`.

## 9. Verification (real browser, not only jsdom)
Per commit: `npm run check:fast`. At the end: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.

Screens to check at **360px, 390px and 1280px**, on a day that **has appointments** and (for the Now line) **today within working hours** — the previous attempt only showed a closed Monday, which proves nothing. Create test appointments if needed. Required evidence (screenshots): Day with 2 therapists and appointments; the Now line + badge; free slots visible; 3-Day for one therapist; the toolbar with a long date; the long-press "move" banner; **a therapist login** viewing a colleague's column (read-only) and opening that appointment (no phone/actions); and desktop/iPad unchanged. If screenshots cannot be captured, say so — do not claim it was checked.

## 10. Risks to test on a real phone
iOS long-press on a `<button>` (callout / text selection — no `touch-action`/`select-none` on blocks today); pull-to-refresh vs the grid scroll box; 4+ therapists scrolling sideways with sticky axis/headers; very short (5–15 min) appointments; a clinic with `slotMinutes` of 15 (tap size rule); an unlinked therapist login.
