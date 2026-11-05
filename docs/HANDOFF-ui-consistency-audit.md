# Handoff: UI consistency & broken UX audit

**For:** Claude (or any reviewer) — review priorities, validate findings, propose or implement fixes  
**Status:** audit complete; **partial fix landed** on branch `cursor/home-visit-pay-plan-1f02` (commit `cd92676`, PR [#106](https://github.com/prem-anand89/thera-net/pull/106)). Most items below are **not implemented**.  
**Trigger:** User reported Team tab amber “unlinked” callout flashing on load despite linked therapists, and Schedule therapist dropdown clipped off the left on mobile. Investigation expanded into a repo-wide pattern audit.

**Do not** treat this file as product spec — it documents observed bugs and inconsistencies. Prefer minimal diffs; align fixes with patterns already in code (`useSetupProgress` loading gate, `KebabMenu` portal, `ScheduleSkeleton`).

Related: `CLAUDE.md` (docs + migration rules), `FEATURES_AND_SCHEMA.md`, `docs/HANDOFF-patient-comms.md` (handoff format reference), `src/components/ui.tsx` (`KebabMenu` overflow comment), `src/components/visit/VisitTable.tsx` (same overflow class documented for row menus).

---

## Context: what was already fixed (PR #106)

| Area | Change |
|------|--------|
| Team amber callout + Unlinked filter badge + “No login” pill | Gated on `membersLoaded` after `list_clinic_members_with_email` |
| `buildTeamList` | Name-based roster ↔ member merge when local `user_id` not synced yet |
| After member refetch | `syncEngine.schedule(0)` to pull roster `user_id` sooner |
| Duplicate Settings-level unlinked banner | Removed; single callout inside Team Directory |
| `TherapistFilter` | `left-0` on narrow viewports, `sm:right-0` on wider (fixes left-edge clip when trigger is on the left) |

**Tests added:** `src/features/settings/buildTeamList.test.ts`, `src/components/schedule/TherapistFilter.test.tsx` (class-only).

---

## Root cause patterns (repeat across the app)

### 1. Fast local data + slow server data → flash

Dexie (`useLiveQuery`) often resolves before Supabase RPCs. UI that merges both without a **loaded** gate shows warnings, empty states, or zero counts, then corrects when the RPC returns.

**Reference fix (Team):** `membersLoaded` in `SettingsPage.tsx` → `Therapists()` (~3189, 3267, 3448, 3497).

**Good patterns to copy:**

- `src/features/setup/useSetupProgress.ts` — returns `undefined` until all inputs ready
- `src/features/settings/ShiftAssignmentsSection.tsx` — returns `null` until therapists, templates, assignments defined
- `src/features/schedule/ScheduleBookingsView.tsx` — `ScheduleSkeleton` while `role === 'unknown'`
- `src/app/Shell.tsx` — waits on clinic + sync before “no clinic” / session guards

**Anti-pattern:** `data ?? []` or `data ?? 0` while `data === undefined` (loading treated as empty).

### 2. Three definitions of “unlinked therapist”

| Source | Rule | Waits for members RPC? |
|--------|------|-------------------------|
| `SettingsPage` `rosterUnlinkedCount` | active ∧ `!userId` (Dexie) | No — used for **default Settings tab** (~283, 365–373) |
| Team `unlinkedCount` | merged `buildTeamList`, active, `!member` | Yes — `membersLoaded` (~3267) |
| `useSetupProgress` / setup nudge | any therapist `!userId` | No — `src/features/setup/useSetupProgress.ts` ~61–71, `src/domain/setupGuide.ts` |

These can disagree on the same clinic. Setup bar and default tab can say “link therapists” while Team (after load) shows everyone linked.

### 3. Non-portal popovers inside scroll/overflow

`absolute` + `top-full` + `right-0` (or `left-0`) inside `overflow-x-auto` / `overflow-hidden` parents clips menus. Row actions in `VisitTable` were fixed with portaled `KebabMenu`; other pickers were not migrated.

**Reference:** `KebabMenu` in `src/components/ui.tsx` — `position: fixed` from `getBoundingClientRect()`, flip/clamp.

### 4. Same state, different copy (product inconsistency)

Multiple surfaces describe sync/offline, booking requests, shift requests, install nudge, and push alerts with different headlines and colors. Not always bugs, but feels broken when stacked on one screen.

---

## P0 — Likely broken (wrong action or clipped UI)

Reviewer should **confirm in browser** where possible.

| ID | Issue | Location | Notes |
|----|--------|----------|--------|
| P0-1 | **Waitlist banner misroutes** | `src/features/schedule/ScheduleBookingsView.tsx` ~827–835 | Copy: waitlist patients “could take an opening today”. Button **“See requests”** calls `setSchedule({ view: 'requests' })` → public **booking requests** inbox, **not** waitlist UI. Fix: correct label + navigation (waitlist management / kebab flow), or rewrite copy. |
| P0-2 | **Visit table Columns picker clips** | `src/components/visit/VisitTable.tsx` ~107+ | Columns ▾ uses non-portal `absolute`; table wrapper is `overflow-x-auto`. Row kebabs use portal. **Migrate Columns picker to same pattern as `KebabMenu`.** |
| P0-3 | **TherapistFilter right-edge overflow** | `src/components/schedule/TherapistFilter.tsx`, toolbar in `ScheduleBookingsView.tsx` | PR #106 fixed **left** clip. Trigger is often **right-aligned** on narrow layout; `left-0` panel can extend past **right** viewport. Fix: portal + clamp (like `NotificationBell.tsx` / `ClinicSwitcher.tsx`) or measure `getBoundingClientRect()`. Extend tests beyond class names. |

---

## P1 — Team tab remainder (same bug class as original report)

Partially fixed in PR #106; **still inconsistent:**

| ID | Surface | Location | Issue |
|----|---------|----------|--------|
| P1-T1 | Edit modal | `SettingsPage.tsx` ~2896–2905 | **“Email address (Link to login)”** when `!member && therapist` — **not** gated on `membersLoaded` |
| P1-T2 | Delete record | `SettingsPage.tsx` ~2669, 2828+ | `isUnlinkedTherapist = !member && therapist` drives delete affordance without load gate |
| P1-T3 | Unlinked filter | `SettingsPage.tsx` ~3234, 3247–3262 | While `members === null`, `buildTeamList` leaves `member: null` even when `therapist.userId` set → filter/list wrong if user opens tab before RPC |
| P1-T4 | Default Settings tab | `SettingsPage.tsx` ~365–373 | `rosterUnlinkedCount` (Dexie `!userId`) still jumps user to Team tab without members merge |

**Suggested approach:** Shared hook or context `useTeamMembers()` exporting `{ teamList, membersLoaded, unlinkedCount }` used by Team cards, filters, setup nudge, and optionally default tab. Single definition of “linked for UI”: `person.member` after merge, or optimistic `therapist.userId` only while `!membersLoaded`.

---

## P1 — Other loading / false-empty flashes

| ID | Surface | Location | Issue |
|----|---------|----------|--------|
| P1-W1 | Workspace today | `src/features/workspace/WorkspacePage.tsx` ~886–889 | `today === undefined` shows **“No visits logged today”** before worklist loads — use loading skeleton |
| P1-W2 | Unlinked therapist banner | `useWorkspaceScope.ts`, `WorkspacePage.tsx` ~807–816 | Dexie-only `!myTherapistId`; no members merge — banner until roster sync |
| P1-W3 | Schedule unlinked block | `ScheduleBookingsView.tsx` ~587–593 | Same Dexie-only semantics |
| P1-W4 | Feedback “new” counts | `src/features/schedule/scheduleSignals.ts` ~39–64 | Meta not loaded → can flash all feedback as new in Needs you / bell |
| P1-W5 | Catalog empty | `CatalogSection.tsx` and related (~193+, Treatment/Referring catalogs) | `items ?? []` → “No services yet” while `items === undefined` |
| P1-W6 | Plan / billing upsell | `SettingsPage.tsx` ~291–292, 517–519, 780–785; `useEntitlements.ts` | Fail-closed lite while `loading` → brief “not in plan” then flip |
| P1-W7 | Unsynced visit count | `WorkspacePage.tsx` ~343–344, 560–568 | `?? 0` while loading → Needs you may under-count then jump |

---

## P1 — Copy / duplication (design inconsistency)

Not necessarily logic bugs; reduce clutter in a dedicated polish pass.

| Theme | Surfaces | Example inconsistency |
|-------|----------|------------------------|
| Sync / offline | `SyncStatusBanners`, `SyncBadge`, Ledger caption, Workspace Needs you, login unsynced notice | Multiple simultaneous messages, different wording |
| Booking requests | `RequestsInbox`, Workspace `TodayAppointments`, `NotificationBell`, Shell badge | “waiting” vs “to confirm” vs “new” |
| Shift requests | `PendingShiftRequestsStrip` (Settings, amber), Schedule teal banner ~816–824 | Same queue, two colors + different actions |
| Install PWA | `InstallAppBanner` on Workspace **and** Schedule, `AccountMenu` install block | Two banner mounts per session; schedule-specific copy override |
| Push nudge | `NotificationNudge.tsx`, `PushSettingsCard.tsx` | Nearly duplicate promise text |
| Setup progress | `SetupProgressBar` on Workspace, Settings, Account menu | Triple placement for admins |

**Recommendation:** Pick canonical strings in one constants module (e.g. `src/domain/copy.ts` or per-feature `messages.ts`); one primary surface per concern (e.g. offline = full-width banner OR badge expand, not both).

---

## P2 — Layout system drift

| ID | Issue | Location |
|----|--------|----------|
| P2-1 | Breakpoint mismatch | `tab:` 744px, `desktop:` 1000px in `src/index.css`; many files use `sm:` 640 / `md:` 768. **ShiftCoverageGrid** uses `md:` while schedule/ledger use `tab:` — 744–767px layout mismatch |
| P2-2 | Bottom sheets | Mixed `rounded-t-[20px]` vs `rounded-t-2xl`, z-index 20–50, center at `sm:` vs `tab:` (`AppointmentDetailsPanel`) |
| P2-3 | Header vs menu z-index | Header `z-30`; some dropdowns `z-20` — overlap edge cases |
| P2-4 | Fixed bottom stack | `UpdateBanner`, schedule toasts, bottom nav share `bottom-[calc(5rem+safe-area)]` without coordinator |
| P2-5 | `InfoTip` | `src/components/ui.tsx` — absolute tooltips in Settings forms; clip/off-screen; no portal/flip |

**Recommendation:** Document breakpoint matrix in `FEATURES_AND_SCHEMA.md` or `index.css` header; optional shared `AnchoredMenu` + `BottomSheet` primitives.

---

## File index (primary touchpoints)

| Area | Paths |
|------|--------|
| Team / merge | `src/features/settings/SettingsPage.tsx`, `buildTeamList` (exported), `buildTeamList.test.ts` |
| Setup / nudge | `src/features/setup/useSetupProgress.ts`, `SetupProgressBar.tsx`, `src/domain/setupGuide.ts` |
| Workspace | `src/features/workspace/WorkspacePage.tsx`, `src/app/useWorkspaceScope.ts` |
| Schedule | `SchedulePage.tsx`, `ScheduleBookingsView.tsx`, `TherapistFilter.tsx`, `scheduleSignals.ts`, `RequestsInbox.tsx` |
| Visit / ledger UI | `src/components/visit/VisitTable.tsx`, `src/features/visits/LedgerPage.tsx` |
| Shell / chrome | `src/app/Shell.tsx`, `AccountMenu.tsx`, `ClinicSwitcher.tsx`, `NotificationBell.tsx`, `SyncBadge.tsx` |
| Dropdown reference | `src/components/ui.tsx` (`KebabMenu`, `InfoTip`) |
| Breakpoints | `src/index.css` |

---

## Suggested implementation order (for Claude)

1. **P0-1, P0-2, P0-3** — user-visible wrong navigation or clipped controls.
2. **P1 Team remainder (P1-T1–T4)** — finish the same fix class as PR #106; add tests for edit/delete/filter during `membersLoaded === false`.
3. **P1 loading honesty (P1-W1, W5, W6)** — highest-traffic false empty states.
4. **P1 copy dedupe** — product pass; can split by theme (sync, booking requests, install).
5. **P2** — design-system cleanup when touching related files anyway.

**Verification (per `CLAUDE.md`):** `npm run typecheck && npm run lint && npm run test`; `npm run build` if shared components or routing; manual mobile width for any popover fix.

**Docs:** Update `FEATURES_AND_SCHEMA.md` only if a fix changes a **business rule** or user-visible behavior worth onboarding (e.g. unified “linked” definition). Pure UI polish usually skips schema docs.

---

## Review checklist for Claude

- [ ] Reproduce P0-1 waitlist banner: confirm `view: 'requests'` vs waitlist intent with product owner or code search for waitlist entry points.
- [ ] Reproduce P0-2 Columns picker clip on Ledger/visit table at narrow width.
- [ ] Reproduce P0-3 TherapistFilter on phone with trigger on the right side of schedule toolbar.
- [ ] Confirm PR #106 Team fix; identify any remaining flash on Team edit modal / Unlinked filter on cold load.
- [ ] Decide whether `rosterUnlinkedCount` and setup nudge should use `buildTeamList` + `membersLoaded` (recommended) or document intentional Dexie-only semantics.
- [ ] Prioritize copy dedupe vs functional fixes — do not block P0 on copy pass.
- [ ] Split work: prefer **separate PR** from home-visit/docs branch #106 if merging unrelated changes is undesirable.

---

## Open questions (for human / product)

1. **Waitlist banner:** Should “See requests” open waitlist management, booking requests, or be removed?
2. **Unlinked definition:** Is “linked” = `clinic_members` row, = roster `user_id`, or = merged Team person with both? UI should use one rule everywhere.
3. **Offline messaging:** One primary surface (banner vs badge) or intentional redundancy?
4. **Install banner:** Show once per session globally (Shell-level) vs per-route?

---

*Generated from Cloud Agent audit (Nov 2026). Update this file when items are fixed or deprioritized.*
