# Multi-service, multi-therapist visits — design

Status: approved by owner · 2026-10-22

## Why

When two therapists treat one patient in one sitting (e.g. Dr Raghavender does the assessment, Dr Sneha does
dry needling), the clinic today has two bad options:

- log two visits, so the patient's day counts twice, the overall discount has to be split by hand across two
  bills, and the bills/payments are spread across two records; or
- log one visit under the primary and have an admin use the manual Shared/Split afterwards — one assistant
  only, a percentage only, nothing filled in from what was actually done, and the assistant's time is
  tied to the revenue percentage.

The app should handle this the way it is actually run: **the primary therapist records every service,
assigns a therapist to each service, and collects all the money; each therapist is credited with the
revenue and the time of the services they delivered.** It must work for a solo practitioner (who never sees
any of this) and for large clinics with several therapists per patient.

Prior art: clinical practice apps (Jane, Cliniko) keep one practitioner per visit and push revenue splits
outside the app. Salon/spa POS (Zenoti) uses one bill whose lines each name the staff member who performed
them, with optional per-line splits. This design takes the salon model for attribution and keeps the
clinical "billing practitioner" on the bill.

## Decisions made by the owner

1. **Whoever logs the visit** — front desk, admin, or a therapist — can build a multi-service visit and
   tag an assisting therapist on a service. The primary records the treatments for the visit. A secondary
   therapist does not write anything on the visit.
2. The **primary therapist is chosen once, for the whole visit** — never per service. A service is delivered
   by the primary unless someone **assigns it to an assisting therapist**; that therapist's name is then
   tagged on that one service only.
3. **The whole amount is collected under the primary** — one visit, one bill, one discount, one payment,
   one invoice.
4. **Revenue credit is automatic** from the lines and **shown on the visit**; it can be overridden by % or ₹.
5. Credits can be edited by the **primary therapist on their own visit** (whether or not it has been
   invoiced — invoicing is optional in this app) and by **an admin on any visit**.
6. The assisting therapist is credited **revenue only**, not a billed visit — but **their time counts in
   utilisation**.
7. The **invoice shows only the primary therapist**, with one line per service.
8. A secondary therapist should **see the work they delivered as their own** (in their day list and
   history), not have to look for a side number.
9. The primary (or an admin) can **raise or lower a secondary therapist's share beyond their lines** —
   e.g. the assistant did the modality line but also helped with the assessment — by % or ₹.
10. The clinic's **"therapist split" setting controls revenue sharing only**, and stays **on by default**.
    Recording who delivered each service always works, so time and patients-treated stay accurate even
    with sharing off.
11. **No time entry on the visit.** Time comes from an **optional duration on the service** (per session
    for a package), otherwise from the length of the sitting.
12. **Services and treatments stay separate lists.** Services are what's charged for; treatments are how
    the patient was treated. Treatments stay at the **visit level** (not per line), and services are
    **not linked** to treatments.
13. **Front desk can edit a saved visit** (services, who delivered each, the discount, and the revenue
    share), because they are the ones who troubleshoot when something goes wrong. They cannot delete a
    visit (unchanged). The same freeze rule applies to everyone once a visit is invoiced: services, bill and
    discount lock; the revenue share stays editable.
14. **No "usual assistant" per patient.** A new visit pre-fills only the primary (billing) therapist; any
    other therapist is chosen per service.

## Goals

- One visit can hold several service lines, each with its own service, price and therapist.
- Credits per therapist are computed from the lines and always add up exactly to the visit's bill.
- Each therapist's utilisation counts the time of the services they delivered, with no time entry.
- Each therapist sees the visits they delivered work on, marked as assisted where they weren't primary.
- Consultation + new package, and package session + paid add-on, both work in one visit.
- Every existing visit, report and invoice keeps working and reads the same as before.

## Non-goals (this project)

- Booking two therapists on one appointment, or blocking the secondary therapist's schedule.
- Secondary therapists writing their own notes or editing the visit.
- Treatments per service line, or linking services to treatments.
- A patient's "usual assistant" pre-filled on new visits (superseded by tagging an assistant on a service).
- Time entry on the visit, or a "helper" on someone else's line with split minutes.
- Several therapists' names on the patient's bill.
- Per-line discounts, per-line refunds, per-line insurance/procedure codes (the data model must not
  prevent these later).
- More than one package line in a visit.
- Rewriting existing visits into the new shape.

## Anti-goals (failure even if it "works")

- A patient's single sitting counted as two visits anywhere (clinic totals, attendance, patient history).
- Any rupee of a visit left unattributed, or attributed twice (credits must sum to the bill).
- Changing the money on an already-issued invoice, or breaking invoice immutability.
- Anything that only works online; visit entry must keep working offline.
- A solo practitioner seeing extra steps on the plain one-service visit.

## Design

### Shape: one billing visit, lines as work performed

The visit stays the **billing record** under the primary therapist: bill, catalog total, adjustment,
revenue-split/tax snapshot, payment, invoice link — all unchanged in meaning. A visit gains **lines**: each
line is one service delivered by one therapist. Credits say how the visit's bill is divided between
therapists for internal reporting.

Rejected alternatives:
- **A real second visit under the secondary therapist.** Creates a second bill and payment record, counts the
  sitting twice, forces the discount to be divided across two bills, and makes "change the split" mean
  "change bill amounts". Contradicts decision 3.
- **Lines as a JSON column on `visits`.** Sync is last-write-wins per row, lines can't be queried in SQL for
  service and therapist reports, and per-line features later (refunds, codes) would need a rewrite.

### Data model

**`visit_items`** (new, synced, client-writable) — one row per service line:

| column | meaning |
|---|---|
| `id`, `clinic_id`, `visit_id` (→ visits, cascade delete) | |
| `position` | display order; the first line is the "main" service |
| `service_catalog_id` | the service |
| `service_name`, `catalog_price_paise` | snapshots at entry, like the visit's own snapshot |
| `price_paise` | the line's price before the visit-level adjustment: always the catalog price at entry (₹0 for a package continuation). Not editable on the line — the only discount is the visit-level adjustment, which keeps "discounts given" reporting, the mandatory adjustment reason, and invoice-line reconciliation (`catalog + adjustment = total`) intact. Kept as its own column as the hook for per-line discounts later. |
| `assisting_therapist_id` | null = delivered by the visit's primary (the normal case); set = the assisting therapist tagged on this service. Must differ from the visit's therapist. Storing "null = primary" rather than copying the primary onto every line means changing the visit's primary therapist needs no line updates: untagged services follow it, tagged ones keep their assistant. |
| `duration_minutes` | snapshot of the service's duration at entry (null when the service has none); never typed in on the visit, so history doesn't move when the catalog changes |
| `is_package_line` | true for the one line that is a package purchase or a package session |
| `created_by`, `updated_by`, `updated_at` | as every synced table |

**`visit_credits`** (new, synced, client-writable) — one row per therapist credited on a visit:

| column | meaning |
|---|---|
| `id`, `clinic_id`, `visit_id` | |
| `therapist_id` | |
| `amount_paise` | this therapist's share of the visit's **bill** (`actual_bill_paise`) |
| `updated_by`, `updated_at` | who last changed it, shown on the visit |

**`visits`** gains `credits_mode` (`'auto' | 'manual'`, default `'auto'`).

**`service_catalog`** gains `duration_minutes` (nullable, optional, set in Settings → Services; for a
package service it means per session).

A line's **deliverer** = `assisting_therapist_id ?? visits.therapist_id`. Wherever this document says "a
line's therapist" or "the therapist who delivered it", it means the deliverer.

Invariants:
- `visits.catalog_price_paise` = Σ line `catalog_price_paise`; `actual_bill_paise` = Σ line `price_paise` +
  `adjustment_paise`. Money columns and the split/tax snapshot keep their current meaning and are computed
  the same way, once, on the visit.
- Σ `visit_credits.amount_paise` = `actual_bill_paise` exactly. The primary therapist always has a row (their
  remainder), so every rupee is attributed.
- `visits.service_catalog_id` = the first line's service and `visits.therapist_id` = the primary, so every
  existing reader still gets a sensible single answer.
- Treatments stay exactly as today: `visits.treatment_ids` and `treatment_notes`, recorded once per visit.
- At most one line has `is_package_line`; the visit's existing `package_group_id`, `session_index`,
  `package_total` describe that line.

RLS for both new tables follows the parent visit: any clinic member can read and **insert** (same as
`visits_insert`, so front desk can log a multi-service visit); **update** by an admin, **front desk**, or
the visit's own therapist; **delete** of lines only while the visit is not invoiced, by the same three.
**This also changes `visits_update`**: today only an admin or the visit's own therapist may update a visit,
so front desk could not correct one. `visits_update` gains front desk (the app's `canModify` in the Ledger
and Workspace changes with it); `visits_delete` is unchanged (admin or own therapist, not invoiced). The
app-level freeze rule (`updateBilling` refuses bill/primary/date changes once `invoiceId` is set) keeps
applying to everyone. So once a visit is saved, its primary therapist, front desk and admins can change its
lines or shares; an assistant therapist cannot.
Both tables get the sync tombstone trigger. (An RLS rejection on push is treated as permanent and reverts
the local row, so these policies must match the entry flows exactly — role tests should cover front desk,
admin, primary and a non-primary therapist.)

### Money and credits

- **Discount spread.** The visit's adjustment (₹ or %, one reason) is spread across lines in proportion to
  `price_paise`, rounding by largest remainder so the line nets sum exactly to the bill. This gives each
  line a **net amount** (not stored — derived).
- **Auto credits.** In `'auto'` mode, each therapist's credit = Σ net amounts of their lines. Recomputed
  whenever lines or the adjustment change.
- **Manual credits.** Editing any credit (by % of the bill or by ₹) sets `credits_mode = 'manual'`. The
  editor keeps the total fixed: the primary's row absorbs the difference, and no row can go below ₹0. Later
  line changes do **not** overwrite manual credits; the visit shows "Services changed since the split was
  edited — recalculate?" which returns to auto.
- **Package money is not hand-editable.** On a visit with a package line, the package line's net amount is
  always credited to that line's therapist and then moves only through package attribution (below); the
  credit editor redistributes the visit's *other* money only. This keeps package attribution from taking
  money from someone who already gave it away by hand, which could push a Net negative.
- **Post-tax credit.** A therapist's share of the visit's post-tax amount = `amount_paise / actual_bill_paise
  × post_tax_paise`, rounded so the shares sum exactly — the same proportional rule today's `shared_pct`
  uses.
- **Who can edit.** Primary therapist on their own visit, front desk and admin on any — enforced by RLS as
  above, and logged by the same audit trail visits already have (both new tables get it), which also
  covers share edits after an invoice. The visit shows who last edited the credits and when. Raising a secondary's share above their lines (they
  helped beyond their own service) is the normal use of the editor.
- **"Therapist split" setting** (`clinics.enable_therapist_split`, default on). **On:** credits as above.
  **Off:** every rupee is credited to the primary, no credit summary or editor is shown — but lines can
  still be assigned to an assisting therapist, so time and patients-treated stay accurate. The setting never
  hides who delivered a service. A clinic with one therapist never sees "Assign assistant".
- **Zero-bill visits** (a ₹0 package session with no paid add-on) have no credits to divide; time still
  counts (see utilisation).

Worked example: assessment ₹1,000 (Dr R) + dry needling ₹500 (Dr S), overall −₹200. Line nets: ₹867 and
₹433 (largest remainder). Auto credits: Dr R ₹867, Dr S ₹433. Bill ₹1,300, one payment, one invoice under
Dr R.

### Packages

- **Consultation + buy a package today:** two lines; the package line has `is_package_line`, and the visit
  becomes session 1 of the new package group exactly as a package visit does today. Bill = both lines.
- **Package session + paid add-on:** the package line is the ₹0 continuation (session N of the group), the
  add-on line carries its price. Bill = the add-on.
- **Package attribution in reports** (`packageAttributionDeltas`) must use the **package line's** post-tax
  share, not the whole visit's post-tax, as its base — otherwise a consultation billed in the same visit
  leaks into every session's share. Likewise the group's "billing visit" is the visit whose package line
  carries the package price, not simply the visit with the largest bill (an add-on can make a continuation
  visit's bill larger).
- **Who is the biller and who ran a session:** the *package line's therapist* in both places — on the
  billing visit (holds the package money, per the credits rule above) and on each later session's visit
  (delivered that session). For visits without lines, the visit's therapist, as today. The attribution
  audit view must reproduce the same numbers.

### Utilisation (time)

Nobody enters time. Per visit, per therapist who delivered at least one line:
- if **every** line they delivered has a duration → the sum of those durations;
- otherwise → the **length of the sitting**, once: the linked appointment's length if the visit came from
  one, else the clinic slot length. More services in one sitting never add up to more than the sitting.

So with no durations set anywhere, a normal one-therapist visit counts exactly as today (one slot), and an
assistant is counted for the sitting — an overstatement for a 10-minute modality that a clinic corrects by
setting that service's duration once in Settings.

- Credits never move time: revenue share and time are independent for visits that have lines.
- Visits without lines (all existing data) keep today's rule (one slot per visit, divided by `shared_pct`).

### Counts

- **Clinic totals and patient attendance:** unchanged — one visit is one sitting.
- **Per therapist:** the headline number becomes **patients treated** = visits where the therapist delivered
  at least one line (for visits without lines: where they are the visit's therapist). This is what rankings
  use. Where the breakdown matters (the monthly therapist table), show it as **billed by me** and
  **assisted**.
- **Revenue by service** report counts and sums **lines**, so a visit with two services shows under both.
- **Money on an assisted row.** The assistant sees **their credit** on the row, never the whole bill. Dues,
  Collected, the Ledger's per-therapist totals and the Collect/status pill stay with the **primary** (the
  money is collected under the primary), so per-therapist totals never add up to more than the clinic's.
- **Monthly Statement columns.** Bill, Share, TDS, Post-Tax and Partner Share stay **billed under my name**
  (the primary), exactly as today. **Shared** shows the credit moved in or out (net zero on the Total row),
  and **Net** is what the therapist is credited — so Net is the payout figure, as today.

### Invoices

- One invoice line per service line, merged across visits by the existing rules (packages by group; others
  by service and price), with the visit-level adjustment carried on the lines as their spread amounts.
- The invoice's therapist is the primary only (decision 7).
- Issued invoices stay immutable; visits without lines print exactly as before.
- Payments are unchanged: keyed by visit, one payment can still be drawn down across an invoice's visits.

### Screens

- **New Visit** (and the visit editor), for front desk, admin and therapists alike: a list of service rows —
  the primary therapist is chosen **once** at the top; each service row shows only the service and its
  price (read-only, from the catalog), plus a small **"Assign assistant"** action. Choosing an assistant
  tags that row with their name ("Dry needling · Dr Sneha, assisting", removable); untagged rows have no
  therapist shown at all. "+ Add service" adds a row. No time field. Treatments and notes stay one visit-level section, as today. Below: subtotal, one overall adjustment (₹ or %) with a
  reason, total. A credit summary ("Dr R ₹867 · Dr S ₹433") with an Edit control for % or ₹. A one-service
  visit by a solo practitioner looks and behaves as today: one row, no therapist control shown when the
  clinic has one therapist, no credit summary when everything is the primary's.
- **Package choice happens in the service picker; the "New service / package" vs "Continuation (₹0)"
  toggle is removed.** The picker lists the patient's open packages first ("Continue: Rehab package —
  session 5 of 10 (₹0)"), then every service by category (new packages included). Only one row can be a
  package row; picking a second shows a plain error on that row.
  - **Exactly one open package:** a continuation row is added automatically (today's shortcut kept). It is
    an ordinary row: tap to change it to another service, ✕ to remove it, or keep it and "+ Add service"
    for a paid add-on (the case the old toggle could not do).
  - **Two or more open packages:** nothing is added; all are offered at the top of the picker (as today,
    nothing is guessed).
  - **Guardrail:** if the patient has an open package and the visit has no package row, a quiet note under
    Services says "Rahul has an open package (session 5 of 10). It isn't used on this visit." It never
    blocks saving.
  - **₹0 share note:** when the primary's only line is a ₹0 package session, the revenue share shows them
    at ₹0 with one line: "Package sessions are credited through package attribution."

### New Visit form: changes beyond multi-service

Found while fitting this design into today's form (`NewVisitPage.tsx`); they ship with the screens step.

1. **Visit from an appointment takes the appointment's therapist.** Today "Complete visit" passes the
   appointment, but the therapist defaults to whoever saw the patient last (or the logged-in therapist),
   so completing Dr Sneha's appointment for a patient last seen by Dr Raghavender bills Dr Raghavender.
   Prefill the therapist (and date) from the appointment. This is a standalone bug and can be fixed ahead
   of the rest.
2. **The discount survives service changes.** Today every service change resets the adjustment; with
   several rows that would erase it on every edit. Keep it; clear it only if a ₹ discount becomes larger
   than the new subtotal; disable it while the subtotal is ₹0.
3. **Errors show on the row they belong to** ("Pick a service for row 2"), not only above Save.
4. **Service wording becomes the list of services** in the Billing card, the after-save screen and the
   bill dialog ("Assessment + Dry needling").
5. **"Another visit for [patient]" on the after-save screen becomes "Log a separate visit for [patient]"**,
   so it is used for a genuinely separate sitting, not a second service.
6. **Front desk's path stays four steps:** Patient → Therapist → Services → Payment; condition and
   treatments stay collapsed for front desk as today. The future Home/Clinic choice (home-visits plan 9a)
   sits beside Date at the visit level.
- **Secondary therapist's views** (Workspace today's visits, Ledger filtered by therapist, their history):
  the visit appears as its own row under their name — their service, patient, "Assisted · with Dr R" —
  read-only for them.
- **Visit details** (Ledger row, patient history): lines listed with their therapists; credits shown.
- **Shared/Split** (`SplitModal`) becomes the credits editor for the visit (several therapists, % or ₹)
  rather than a separate one-assistant mechanism.

### Existing data and the old split

- Visits without lines are read as one implicit line built from the visit's own columns (service, therapist,
  catalog price, bill, no duration — so it counts as one sitting, as today). No backfill of lines is required.
- **No backfill of the old split.** Visits with `shared_therapist_id` / `shared_pct` keep being reported
  with today's exact formula, so every closed month reproduces the same numbers to the rupee (FEATURES_AND_SCHEMA
  §2b). A visit uses credits once it has credit rows: new visits always do, and editing an old visit's split
  writes credit rows (that visit then switches to credits — the same "an edit changes the report" behaviour
  as editing a split today). The old columns are no longer written.

## Constraints

- Offline-first: a visit, its lines and its credits are written locally in one Dexie transaction, in that
  order; the outbox pushes in write order, so parents reach the server before children.
- Last-write-wins per row: lines and credits are separate rows so concurrent edits to different lines don't
  overwrite each other.
- Revenue-split snapshot stays per visit and is computed once (see FEATURES_AND_SCHEMA.md §2).
- Every schema change ships as both a live migration and a file in `supabase/migrations/`; FEATURES_AND_SCHEMA.md
  and README are updated in the same change (repo CLAUDE.md).
- The reports change (credits, package base, utilisation, counts, revenue by service) must ship with or
  before the screens that create multi-line visits; otherwise multi-line visits are mis-reported.

## Left to the builder

- Whether the server also validates the money invariants (Σ lines, Σ credits) with a trigger, or trusts the
  client as visits do today.
- Exact UI layout of the service rows on phone versus tablet/desktop.
- How the credit editor presents % versus ₹ (a toggle, or both fields).
- How the CSV visit import writes lines (one line per imported visit is enough).
- Phasing and whether to hide multi-line entry behind a clinic setting while it rolls out.

## Calls made by the designer (not owner decisions)

- Lines and credits as separate tables rather than JSON on `visits`.
- Credits stored as ₹ of the bill (what people see), with post-tax derived proportionally.
- Line price is always the catalog price; the only discount is the visit-level adjustment.
- Package money follows package attribution and is not hand-editable; biller and session runner are the
  package line's therapist.
- An assistant sees their credit, not the bill; Dues and Collected stay with the primary.
- Monthly Statement billed columns stay "billed under my name"; Net is the credited/payout figure.
- No backfill of the old split: old split visits keep today's formula so closed months don't move.
- The primary's credit row is the remainder that keeps the total exact.
- "Patients treated" as the per-therapist headline count and the ranking basis.
- Backfilling the old Shared/Split into credits and retiring the old columns from writes.
- A line's duration is a snapshot of the service's duration, not typed in.
- Time rule when a therapist's lines mix services with and without a duration: the sitting length.
- A one-therapist clinic never sees "Assign assistant".
- Lines store only an *assisting* therapist (null = primary), so changing the visit's primary moves every
  untagged service with it and leaves tagged ones alone; if shares were set by hand, the visit asks to
  recalculate. Changing the primary stays blocked once invoiced (today's rule).
