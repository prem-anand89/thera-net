# Handoff: Multi-service / multi-therapist visits — review & refinement brief

**For:** Claude (or any reviewer) continuing design/UX/product refinement  
**Date:** 2026-10-22  
**Status:** Owner-approved directions in main design; this doc adds codebase alignment, UX refinements, and open decisions. **Do not implement yet** unless explicitly asked.

---

## What we are building (one paragraph)

One **billing visit** under a **primary (billing) therapist**: multiple **service lines** (each with catalog service, snapshot price, optional duration snapshot, **delivered-by therapist**). One visit-level discount, one bill, one payment, one invoice (primary only on invoice). **Revenue share** between therapists is derived from lines (auto) or edited in ₹/% (manual), stored as per-therapist rows that **sum exactly to `actual_bill_paise`**. Assistants see the visit in **their** day/history with **their share**, not the full bill; utilisation uses line durations or sitting length. Old visits without lines behave exactly as today.

**Full design:** paste or attach the owner draft titled *"Multi-service, multi-therapist visits — design"* (2026-10-22) — not necessarily committed to repo yet.

**Related (separate track):** `docs/superpowers/plans/2026-10-15-home-visits-and-therapist-pay.md` — HR payroll should attribute **clinic share** per therapist using credit rows, not only primary `clinicSharePaise`.

---

## Codebase facts to respect (verified on `main`)

| Topic | Today |
|--------|--------|
| Visit billing | `actualBillPaise`, snapshotted `computeVisitSplit` on visit; partner vs non-partner via `hasPartner` / `clinicBillingConfig()`. |
| Internal share | `sharedTherapistId` + `sharedPct` on visit; **one** assistant; % of **gross** moves `sharedPaise`; % of **postTaxPaise** moves `netPostTaxPaise`; **`clinicSharePaise` not moved** on monthly row. |
| Split after invoice | `visitService.setSplit` **allowed** on invoiced visits (attribution only); `updateBilling` **blocks** bill/primary/date changes when `invoiceId` set. |
| UI | `SplitModal` — Ledger + Workspace; % with ₹ preview; internal only copy. |
| Package attribution | `packageAttributionDeltas`: billing visit = visit with **max `actualBillPaise`** in group; per-session share from **billing visit `postTaxPaise`**. **Must change** when consult + package share one visit (design already calls this out). |
| Therapist split setting | `clinics.enableTherapistSplit` (default on) gates reporting/UI for sharing; design: lines always record deliverer; when off, all ₹ to primary. |
| Solo | `clinicType === 'individual'` — hide multi-therapist chrome elsewhere; same here: one line, no per-line therapist picker. |
| Offline | Visits synced via Dexie + outbox; new tables `visit_items`, `visit_credits` must follow same patterns (parent before children in one transaction). |

---

## Owner decisions (do not relitigate without owner)

1. Whoever logs can build multi-service visit; **secondary does not edit** visit.  
2. Per-line therapist; default primary.  
3. **All money collected under primary** — one visit, bill, discount, payment, invoice.  
4. Revenue share auto from lines; overridable ₹ or %.  
5. Primary edits share on **own** visit (even if invoiced); admin any visit.  
6. Assistant: **revenue credit only**, not a second billed visit; **time in utilisation**.  
7. Invoice: **primary only**; one line per service.  
8. Assistant sees visit in **their** list/history as their work.  
9. Primary/admin can bump assistant share **above** line totals (extra help).  
10. `enableTherapistSplit` = revenue only; line assignment always for time/patients-treated.  
11. No visit time entry — duration from **service catalog** (per session for packages) or sitting length.  
12. Treatments stay **visit-level**; services not linked to treatments.  

**Non-goals:** second appointment for assistant, secondary notes, per-line discount v1, multiple package lines per visit, two names on bill, rewrite old visits.

**Anti-goals:** double-count sitting; ₹ unattributed or double-attributed; break issued invoice immutability; online-only entry; solo extra steps.

---

## Proposed data model (summary)

- **`visit_items`**: lines (service, snapshots, `therapist_id`, `duration_minutes` snapshot, `is_package_line`, position).  
- **`visit_credits`**: per therapist `amount_paise` (sum = bill); `credits_mode` auto \| manual on visit.  
- **`service_catalog.duration_minutes`** optional.  
- Legacy: visits without lines = implicit single line; **`shared_*` columns** keep old report math for untouched history; editing split → write credits (same “edit changes report” as today).

---

## UX / product refinements recommended (please refine further)

### Terminology (therapist-facing)

- Avoid **“credits”** in UI → use **“Revenue share”**, **“Your share”**, **“Delivered by”**.  
- DB names can stay `visit_credits`.

### Primary vs deliverer

- Explicit **“Billing therapist”** (invoice, dues, collect) vs line **“Delivered by”** (defaults to billing).  
- Critical when front desk logs the visit.

### Permissions

- Design: after save, only **primary or admin** updates lines/shares.  
- **Open:** Should **front desk** (`canBill`) fix line assignments on visits they created? Options: same as billers / until invoiced / admin-only escalation.

### `enableTherapistSplit` off

- All ₹ to primary; lines can still assign other therapists.  
- **Need copy:** billing therapist hint on save; assistant row **“Assisted · revenue not shared”** vs **“Assisted · ₹X”** when on.

### Invoiced visits (freeze matrix)

| | Services / bill / adjustment | Revenue share |
|--|------------------------------|---------------|
| After invoice | Block (match `updateBilling`) | Allow (match `setSplit`) + show “does not change patient bill” |

### Flow

- Prefer **inline revenue share** on New Visit / editor (summary under total); demote separate modal to ledger quick-edit only.  
- Share editor: show **₹ and %** together; primary row = **“Remainder”** when editing others.  
- Manual mode: banner **“Services changed — update shares from services?”** → **Recalculate from services**.  
- Package row: one-line explain attribution; block second package line with plain error.

### Utilisation

- Don’t expose algorithm; on detail show **“Time counted: N min (from services)”** or **“(session length)”**.

### Assistant expectations

- No calendar block for assistant (non-goal). Optional copy: **“Not on your schedule — from Dr X’s visit.”**

### Reports / payroll alignment

- Monthly: **Bill** columns stay primary-billed; **Shared** = net moved; **Net** = payout figure (as today).  
- **Builder must:** attribute **`clinicSharePaise`** (and post-tax) per `visit_credits` row for HR / partner clarity — not only gross credit on primary row.  
- Package attribution base = **package line** post-tax share, biller = **package line therapist**; billing visit ≠ max bill visit when add-on on continuation.

### Server

- Recommend server/trigger validation: Σ line catalog = visit catalog; Σ line prices + adjustment = bill; Σ credits = bill.

### Release

- **Reports + package fix** must ship **with or before** UI that creates multi-line visits (release blocker).  
- Phasing / feature flag left open — if flag hides UI, reports should still understand lines.

---

## Open questions for owner / next review pass

1. Front desk edit policy after save (see above).  
2. Changing **billing therapist** after lines exist: re-default all “Delivered by” or confirm keep assignments?  
3. Post-invoice share edits: require audit trail / threshold? (Today: no audit on `setSplit`.)

---

## Acceptance stories (UX)

1. Solo / one therapist: indistinguishable from today.  
2. Primary + assistant, split on: two services, one discount, auto share, one payment.  
3. Assistant: own row, **their ₹**, “Assisted with Dr R”, no Collect/full bill.  
4. Split off: assistant still listed for time; clear “revenue not shared.”  
5. Invoiced: services locked; share still editable with immutable-bill messaging.

---

## What to do in the next Claude session

- Tighten the main design doc: UX addendum (terminology, freeze matrix, banners, permissions).  
- Resolve open questions with minimal new scope.  
- Align package + multi-line worked examples with `reportService` / `packageAttributionDeltas` test cases.  
- Cross-check HR handoff (`share_base`, attributed clinic share per credit row).  
- Optional: phone vs tablet wireframe notes for service rows + share sheet (no code).

**Out of scope unless asked:** migrations, React implementation, FEATURES_AND_SCHEMA edits.
