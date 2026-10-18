# Mobile Schedule Grid — Design Brief (v2, after Claude review)

**Date:** 2026-10-18
**Status:** Revised design, bounded change. NOT yet approved for implementation. Waiting on the user's go and on the three open items in §6.
**Supersedes:** v1 (which proposed a `'3day'` URL mode, header swipe and a "default to first therapist" rule; all three dropped below).

## 1. Decided with the user (LOCKED — stop and ask before changing)

- 3-Day shows **one therapist at a time**.
- Phone default view is the **Day grid**.
- The existing list (`AgendaList`) stays as a **List** option.
- Phone gets: 1-day and 3-day grids, drag/long-press move, and the existing desktop grid features.

## 2. Review outcome (each claim re-checked against code)

| Claude's point | Verdict | Evidence |
|---|---|---|
| No `'3day'` URL mode; use a device-scoped phone view | **Accepted** | `WeekTimeGrid` takes `days: string[]` (`TimeGrid.tsx` L794-812). `displayHoursFor` only special-cases `'week'` (`schedule.ts` L527-528). `mode` also feeds `step()` L446, `d`/`w` keys L550-551, titles L711-718, Today logic L724, `isAllTherapistsWeek` L303/L843, waitlist banner L827. |
| Drop swipe on the header | **Accepted** (my v1 was wrong) | The sticky header is inside the same `overflow-auto` box as the grid (`TimeGrid.tsx` L654-671), so a swipe on it scrolls the grid. |
| Reuse `minimalBlocks` for narrow blocks | **Accepted, with a catch** | Exists (`TimeGrid.tsx` L58, `MultiResourceWeekGrid.tsx` L353/376/410). `GridFrame`'s props do not include it (L596-626), so it must be threaded `WeekTimeGrid → GridFrame → DayColumn`. |
| `MiniCalendarStrip` is the phone date nav | **Accepted** (I missed it) | `ScheduleBookingsView.tsx` L789-790, inside `desktop:hidden`. |
| Moves need no change | **Verified** | `dragOptions` L513-536: same options for touch and mouse; different date/therapist/off-hours go through `setPendingMove`; only `canManageAll` may reassign. Silent `return` at L530 for a therapist reassigning is an existing rough edge, out of scope. |
| `dvh` + `overscroll-contain` on the grid box | **Accepted** | Box is `max-h-[calc(100vh-240px)] min-h-[420px]` (`TimeGrid.tsx` L656). Exact value to be tuned in a real browser. |
| Persist in localStorage `theranet:schedule-phone-view` | **Accepted** | Matches `DONE_OPEN_KEY = 'theranet:today-done-open'` (`TodayAppointments.tsx` L16). |
| Rules files conflict with the worktree flow | **Partly stale** | `.agents/rules/STANDING_HANDOFF_RULES.md` and `docs/gemini/HANDOFF_RULES.md` both have uncommitted edits that are not mine; both still say "work on `main`" and call the worktree "optional". Not touched here. See §6.3. |

## 3. Design

1. **Phone view** `'list' | 'day' | '3day'`, default `'day'`, stored per device (try/catch). URL `mode` stays `'day' | 'week'`; desktop, tablet and shared links are unchanged. **Phone view applies only below 744px.**
2. **Phone detection:** a small `useIsPhone` hook using `window.matchMedia?.('(max-width: 743px)')`, matching the existing pattern in `useInstallPrompt.ts` L76 and `useCompactChart.ts`. It must tolerate a missing `matchMedia` (jsdom) so existing tests do not break.
3. **Effective mode on phones is always `'day'`.** A shared link with `?mode=week` must not trigger the week title, week stepping or the all-therapists-week banner on a phone.
4. **Day:** `ResourceDayGrid` (170px columns). One therapist fills the width; several scroll sideways. Same `?therapist=` filter as today.
5. **3-Day:** `WeekTimeGrid` with 3 dates. It needs a `minColumnWidth` prop (hard-coded 110 today, `TimeGrid.tsx` L875); phones use **98px** so 3 columns fit 360px and 390px. Appointments are the visible ones for those 3 dates for the chosen therapist. Pass `mode: 'day'` to `displayHoursFor`.
6. **3-Day therapist rule:** therapist logins use their own column (no picker). Admin/front desk with **none or several** selected see a "Pick a therapist" single-select chip row instead of the grid; no silent default. Picking writes `?therapist=<id>` (this also narrows Day view).
7. **Navigation (Day / 3-Day):** `‹ ›` and Today shown on phones; step is 1 day (Day) or 3 days (3-Day); title shows the date or the 3-day range; Today is disabled when the current window contains today. No swipe.
8. **Strips:** in Day and 3-Day the `MiniCalendarStrip` is replaced by `‹ ›` + Today so the grid starts higher; List keeps the strip.
9. **Grid box on phones:** `max-h-[calc(100dvh-20rem)]` (tuned in browser) + `overscroll-contain`; `tab:` and up keep today's value.
10. **Narrow blocks:** `minimalBlocks` on the phone 3-day grid; check overlapping (2-lane) blocks with real data.
11. **Moving a patient:** existing long-press → tap-free-slot, plus a one-time hint. Non-gesture path already exists (details panel → Reschedule).
12. **Accessibility:** `aria-pressed` on the switcher, matching the Day/Week toggle.

**Files:** `ScheduleBookingsView.tsx`, `TimeGrid.tsx`, one pure helper module (phone views, 3-day dates, step size) with tests, a `useIsPhone` hook, `FEATURES_AND_SCHEMA.md` (every duplicated section; `grep -n` the headings) and tests. **Not touched:** `router.tsx`, `schedule.ts`.
**Constraints:** no new dependencies, no new nav tab, CSS variables only, explicit `type` on buttons, 44px touch targets, no push.
**Out of scope:** live touch drag, Week on phones, tablet/desktop grid changes, the silent therapist-reassign `return` at L530.

## 4. Commit plan (Claude's breakdown, adopted)

1. Pure helper + tests: phone views, 3-day dates, step size.
2. Grid props: `minColumnWidth`, phone height, `overscroll-contain`; thread `minimalBlocks` through `GridFrame`.
3. `useIsPhone`, the switcher, persistence, grids shown on phones, `‹ ›` + Today, effective-mode-on-phone.
4. 3-Day therapist picker, `minimalBlocks` blocks, long-press hint, docs.

## 5. Verification

`npm run check:fast` per task; full gate at the end; `npm run gemini:report`. Real-browser check at 360px and 390px (and 1280px to confirm desktop is unchanged), screenshots in the report. jsdom cannot verify layout.

## 6. Open items needing an answer before implementation

1. **Date jump:** replacing the `MiniCalendarStrip` with `‹ ›` + Today loses quick "jump to Thursday". Accept that, or let tapping the date title reveal the strip?
2. **Persist the phone view per device?** Assumed yes (reviewer agreed); the user has not confirmed.
3. **Where to implement:** the main checkout has uncommitted edits that are not mine, and the rules say one agent edits at a time. Proposal: work in the existing worktree `/home/theranet/TN Project/thera-net-gemini` on `gemini/work`.

## 7. Known risk to test on a real iPhone

Long-press on a `<button>` block has no `touch-action` or `select-none` set (grep found none in `src/components/schedule`); text selection and the iOS callout are untested.
