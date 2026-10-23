# Visit lists: Therapist / Service columns for primary and assisting views

Status: plan, not built. Follows `2026-10-22-multi-therapist-visits.md`. Ring (`cf6669c`) is already back.

## Principle
- **Therapist column = who did it and who is paid.** **Service column = what was done.** No sentences in either.
- One control for the split: the **ring**. It is the button for the new assisting-therapist attribute; it replaces the
  "Revenue share —" line and the "· X assisting" text.

## Primary / admin / front desk view (Today's visits, Ledger, patient history)
**Therapist column**
- Primary's pill (unchanged).
- Ring + assistants' combined % (`SharesRing`). Hover: "Revenue share — Prem ₹1,600 · BM ₹400".
- Ring is a `<button>` for people who may edit the split (admin, front desk, the visit's own therapist, visit not
  blocked by rules) -> opens the same `RevenueShareEditor` as the kebab "Edit split". Read-only span otherwise.
- Small "edited" dot on the ring when `credits_mode = 'manual'` (hover adds "set by hand").
- Legacy one-colleague visits keep `SharedSplitLine` ("30% → name") with the same ring; also a button.

**Service column**
- Service names only, one per line, max 2 lines then "+N more" (full list on hover / in the detail view).
- A tagged service gets a small initials chip: "Kinesio Taping [BM]" (full name on hover).
- Package progress dots stay as now.

Kebab "Edit split" / "Split revenue" stays (keyboard and touch route to the same editor).

## Assisting therapist view
Their rows are the **Assisted** section (Workspace "Assisted today", Ledger assisted rows, patient history).
Already built: `assistedVisitsFor` returns only the services they delivered, never the bill.

**Therapist column** : primary's pill with "with" prefix + their own share "₹300" (ring not shown: the % of a bill
they cannot see would leak it). Not clickable.
**Service column** : only the services they delivered (already so). No "+N more" for others' services, no hint that
others exist beyond "with Dr X".
**Never shown:** bill, payment, invoice, other therapists' shares, the ring.

## Refinements to include
1. Touch: no hover on phones, so tapping the ring opens a small popover with the shares line (cards keep the text
   line today; move them to the same ring + popover).
2. Ring accessible name: `aria-label="Revenue share: BM 20%"`; button has visible focus.
3. Ring only when the clinic's therapist split is ON (`splitEnabled`), matching `buildVisitDetails`.
4. Zero-share assistant (Eeshaan row: Prem ₹0 / BM ₹300): ring shows 100%; primary's pill stays so it is clear whose visit it is.
5. Table width: Therapist column stays one narrow stack (pill, ring); Service column no longer grows with sentences.
6. Keep the editor identical everywhere (single component) so rounding and permission rules cannot diverge.
7. Tests: ring renders only with share rows + split on; button vs span by permission; assistant row never renders
   ring or bill; "+N more" collapse; chip initials.

## Not in scope
Reports, utilisation, statements (unchanged). No schema change, no migration.

## Decision for owner
Ring text in tables: % (recommended, matches the old split) or ₹.
