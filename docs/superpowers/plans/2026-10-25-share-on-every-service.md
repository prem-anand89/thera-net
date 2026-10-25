# Share on every service, clearer row labels, small New Visit refinements

Status: plan, not built. Owner approved the direction 2026-10-25. Executor: a Claude Code session (Sonnet), one
task at a time, in order. Work on branch `feat/new-visit-phone-action-bar` (or a branch off it if it has merged).

**Read first:** `CLAUDE.md` (docs-in-same-PR, migration convention, button `type`, verification commands) and the
"Visit entry" + "Revenue shares" + "Package attribution" sections of `FEATURES_AND_SCHEMA.md`.

## Why

Today a service row has two buttons that nobody can tell apart:

| Today | What it really does |
|---|---|
| "Assistant" | Someone else **did** this service: they get **all** of its money (`assistingTherapistId`, `line_share`). |
| "Share session" | Someone **helped**: they get a **%** of a package session; the runner keeps the rest. Package rows only. |

A therapist who helps on a normal paid service can only be paid through "Edit split" after saving. The owner wants
the same "Share" on every service, at billing time, with plain labels.

## The model after this plan (owner-approved wording)

```
Advance Therapy                          ₹2,000
[Done by: Prem ▾]   [Share]
   → Shared with [BM ▾] [30] %  = ₹600   ✕
```

- **Done by** — who did the service and gets its money. Defaults to the visit's therapist. Replaces "Assistant".
  Same data as today (`assistingTherapistId`; null = the visit's therapist).
- **Share** — a colleague who helped gets **% of this service**; whoever did it keeps the rest. Every service,
  paid or package. Same data as today (`sessionShareTherapistId`, `sessionSharePct`, 1–99, whole numbers).
- **Never** the words "helper", "assistant", "co-therapist" in the UI. "Shared with" / "Done by" only.
- "Set by hand" becomes **"Set manually"** everywhere.
- No ₹-amount share on the row (a % follows discounts and price changes). Exact ₹ = Edit split after saving.
- No Edit split on the New Visit form. The read-only "Revenue share" line under Total shows the result.

## How the money works (the rule to implement)

**Paid service (not a package line)** — the share is part of the visit's revenue shares (`autoCredits`):
- line net `N` (from `lineNets`, i.e. after the visit discount/extra), deliverer `D`, share `S` with `p`%:
  `S` gets `roundToRupeeHalfUp(N × p / 100)`, `D` gets `N − that`. Totals still equal the bill.
- Example: bill ₹2,000, done by Prem, shared with BM 30% → Prem ₹1,400, BM ₹600. With a ₹200 discount → net
  ₹1,800 → Prem ₹1,260, BM ₹540.
- It flows through the existing credit rows → `line_share` movements → monthly report / audit. No new mechanism.

**Package line (purchase or session)** — unchanged: the share moves through `package_attribution` in `payBase`
(the session's per-session share, biller → runner, part to the shared therapist). `autoCredits` must **ignore** the
share on a package line, or the money would count twice.

**Not changed:** visits whose `credits_mode` is manual (Edit split wins, as today); clinics with therapist split
off (`splitEnabled` false → everything to the primary, the share is ignored, as today); every existing visit (no
paid line has a share today, so every closed month reproduces to the rupee).

## Global constraints

- Money logic lives only in `src/domain/visitLines.ts` (`autoCredits`) and `src/domain/payBase.ts`. Do not compute
  shares anywhere else (UI calls these).
- Paise integers; whole-rupee rounding via the existing `roundToRupeeHalfUp`.
- Keep the DB column names `session_share_therapist_id` / `session_share_pct` (no rename — avoids sync/mapping
  churn). Update their comments/docs to "share of this service".
- Every `<button>` has an explicit `type`. 44px touch targets on phones for primary actions; the row pills may be
  32px (`min-h-8`) as today.
- Stage files by name; another session may have edits in the tree. No push / merge without the owner's say-so.
- Before every commit: `npm run typecheck && npm run lint && npm run test`; `npm run build` for task 3.

---

## Task 1 — Migration: allow a share on any service

**Check first** whether `20261026100000_package_session_share.sql` is already live:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='visit_items' and column_name like 'session_share%';
```
- **No rows (not applied):** edit `20261026100000_package_session_share.sql` in place: drop `and is_package_line`
  from `visit_items_session_share_check`; reword the header comment and the two trigger messages
  ("The therapist sharing a service must belong to the visit's clinic." /
  "A service can't be shared with the therapist who did it."). Then apply it live (Supabase MCP `apply_migration`).
- **Rows exist (applied):** add `supabase/migrations/20261026110000_share_on_every_service.sql` that drops and
  re-adds the constraint without `is_package_line` and replaces `check_visit_item()` with the reworded messages.
  Apply it live.
- Either way: verify live with
  `select pg_get_constraintdef(oid) from pg_constraint where conname='visit_items_session_share_check';`
- The trigger's other rules stay exactly as they are (clinic check; not the deliverer; deleted lines exempt).

Commit: `feat(visits): a share can be set on any service (migration)`.

## Task 2 — Domain + service: the money rule

**Files:** `src/domain/visitLines.ts`, `src/domain/visitLines.test.ts` (or the existing autoCredits test file),
`src/services/visitService.ts`, `src/services/visitService.test.ts`, `src/domain/payBase.test.ts`.

- `autoCredits(items, primaryId, billPaise, opts)`: for each live **non-package** line with
  `sessionShareTherapistId` + `sessionSharePct`, split the line's net as in "How the money works". Package lines:
  unchanged (whole net to the deliverer). Split off / bill ₹0 / no lines: unchanged early return.
- `visitService.checkSpecs`: remove `if (!sp.isPackage) throw new Error('Only a package session can be shared.')`.
  Reword the other two messages to match the trigger ("A share must be 1 to 99%.",
  "A service can't be shared with the therapist who did it.").
- `RevenueShareSummary` must show when any live line has an assistant **or** a share (today it checks
  `assistingTherapistId` only — `src/features/visits/RevenueShareSummary.tsx:35`).
- Everything that reads `sessionShare` for a package (`packageSessionShares`, `packageMoveNote`, NewVisitPage
  `helperShare`) keeps working for package rows only — confirm they look at the package line, not any line.

Tests (exact cases):
1. Paid ₹2,000, deliverer = primary Prem, share BM 30% → Prem ₹1,400, BM ₹600.
2. Same with a ₹200 discount → Prem ₹1,260, BM ₹540.
3. Two services: A ₹1,000 done by Prem shared BM 50%; B ₹500 done by BM → Prem ₹500, BM ₹1,000.
4. Share on a paid line where the deliverer is an assistant (done by BM, shared with Prem 20%) on ₹1,000 →
   BM ₹800, Prem ₹200.
5. Rounding: ₹999 shared 33% → shared ₹330 (half-up of ₹329.67), deliverer ₹669; totals equal the bill.
6. Package line with a share → `autoCredits` gives the whole line net to the deliverer (no double count);
   `payBase` package attribution unchanged (existing tests stay green).
7. Split off → everything to the primary even with a share.
8. `visitService`: saving a paid line with a share succeeds; sharing with the deliverer throws; pct 0 / 100 / 2.5
   throw; editing a visit to remove the share clears both fields (existing reconcile logic).

Commit: `feat(visits): a share on a paid service splits that service's money`.

## Task 3 — Service row UI: "Done by" and "Share"

**Files:** `src/features/visits/ServiceRows.tsx` (+ test), `src/features/visits/EditVisitModal.tsx` (uses
ServiceRows — only check it still works), `FEATURES_AND_SCHEMA.md`.

- Replace the "Assistant" pill and the "X · assisting ✕" chip with one pill **"Done by: {name} ▾"** (name =
  deliverer; the visit's therapist when none). Tapping opens the existing `FocusedPicker` listing **all** active
  therapists including the visit's therapist; picking the visit's therapist sets `assistingTherapistId: null`.
  Hidden when `showAssistant` is false (solo clinic / split off), as today.
- The "Share session" pill becomes **"Share"** on **every** named row (not only `isPackageRow`). Opened state:
  `Shared with [select] [pct] % = ₹X ✕`. ₹X is a **preview** only: row price × pct for paid rows (say
  "of this service"), and for package rows keep today's text "% of this session" (no ₹ — the session share is
  computed elsewhere). Candidates exclude the row's deliverer (as today).
- When "Done by" changes to the person the row is shared with, clear the share (same rule as today's `update()`).
- Rename the `SessionShare` component to `RowShare`; update the JSDoc.
- `rowProblems`: pct validation now applies to every row with a share (it is package-only today).
- Tests: "Done by" pill shows the visit therapist by default; choosing another therapist sets
  `assistingTherapistId`; choosing the visit therapist clears it; "Share" is offered on a paid row and a package
  row; share preview ₹ on a paid row; changing "Done by" to the shared therapist clears the share; pct 0 shows the
  row problem.

Commit: `feat(visits): Done by and Share on every service row`.

## Task 4 — "Set by hand" → "Set manually"

**Files:** `src/components/RevenueShareEditor.tsx` (status chip "Set manually", "Edited · saves as set manually",
titles), `src/components/visit/VisitSharedSplit.tsx` (ring title "Set manually (not following services)"), any
audit/report text that says "by hand" (`grep -rni "by hand" src`), their tests, `FEATURES_AND_SCHEMA.md`.
Pure wording; no logic.

Commit: `chore(visits): say "Set manually" instead of "Set by hand"`.

## Task 5 — Package sessions: carry the share forward

**Files:** `src/features/visits/ServiceRows.tsx` (`continuationLine`), `src/features/visits/NewVisitPage.tsx`
(where an open package's session row is created), tests.

- When a continuation row for a package is created, pre-fill its share from that package's **most recent logged
  session** that had one (same package group, live package line with `sessionShareTherapistId`), provided that
  therapist is still active and is not the new row's deliverer. Otherwise none.
- Show it as normal (editable, removable). Add a muted line under it: "Same as last session".
- No schema change. Test: previous session shared BM 30% → new row pre-filled BM 30%; previous BM inactive → none;
  new row done by BM → none.

Commit: `feat(visits): a package session starts with the last session's share`.

## Task 6 — Small New Visit refinements

1. **One total box when nothing is adjusted.** In `BillAdjustmentFields`, while `mode === 'none'`, hide the
   "Subtotal" box and show only the Total box (Subtotal reappears once a discount/extra is set). Used by both New
   Visit and Edit visit — check both. Test it.
2. **Date hint.** Under the New Visit date field, when the date is not today show a muted hint: "Yesterday",
   "3 days ago", or for a future date (rust colour) "In 2 days — check the date". Nothing when it is today. Use the
   app's existing local-date helpers (grep `todayLocal`/`toLocalDate` in `src/domain`), no new date maths library.
   Pure function + test.
3. **Label the free-text box.** The "Anything not in the list…" input under Treatments is the visit's `notes`.
   Give it a visible small label "Other treatments / notes" so staff know it is saved.

Commit: `feat(visits): New Visit — single total box, date hint, labelled notes`.

## Task 7 — Docs + manual check

- `FEATURES_AND_SCHEMA.md`: Visit entry (Done by / Share on every row, pre-filled package share, refinements),
  Revenue shares (paid-service share rule with the worked example), schema notes for the two columns
  ("share of this service; on a package line it moves through package attribution, otherwise through revenue
  shares"), and "Set manually".
- Add a section to `docs/superpowers/plans/2026-10-22-multi-therapist-visits-manual-check.md` with the three owner
  scenarios:
  1. Paid single session, Prem does it, BM shares 30% → Today's list ring 30%, Ledger, monthly report BM +₹600.
  2. Package session run by BM while Prem is away → "Done by: BM"; audit shows the session moving Prem → BM.
  3. Package with BM sharing 30% over several sessions → second session pre-filled; audit shows each session's
     30% to BM.
- Delete this plan file once every task is built and verified (repo convention), in the same commit as the docs.

Commit: `docs(visits): share on every service`.

## Review focus (for the reviewer after the build)

- Double counting: a package line with a share must not move money through both `autoCredits` and `payBase`.
- Closed months: no existing visit's credits change (no paid line has a share today) — check `recalculateShares`
  isn't run over old visits by this change.
- Manual-split visits: changing a row's share on a `credits_mode = 'manual'` visit behaves exactly like changing
  "Done by" does today.
- Dirty-form guard: opening "Share" or "Done by" pickers without choosing must not make a pristine form dirty.
- Offline: the new fields already sync (camelCase ↔ snake_case mapping); a paid line with a share created offline
  must not be rejected by the server after Task 1 is live. Task 1 must be live **before** this ships.
