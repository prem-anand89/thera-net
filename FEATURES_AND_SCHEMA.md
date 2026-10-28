# Thera.Net — Complete Features & Schema Documentation

## Overview

Thera.Net is an offline-first visit ledger, revenue-split tracker, and invoice book for physiotherapy clinics operating inside a partner hospital. Built with React + Vite + TypeScript, Supabase (Postgres/Auth/Realtime/Storage), Dexie (IndexedDB) local-first store with outbox sync, and Tailwind CSS.

**Multi-clinic from day one** with configurable revenue-split models (simple or hospital partnership), enforced server-side role-based access control, and complete offline-first capability.


### Recent Updates (October 2026 Settings Redesign)
- **Settings Architecture**: Transitioned to a 6-tab system (`general`, `team`, `services`, `booking`, `billing`, `account`) with a side-rail navigation layout. Replaced edit modes with set-once cards for simplicity.
- **Account Menu**: Personal settings (Profile, Password, Working Hours, Notifications) moved out of admin Settings into a global "Me" dropdown menu accessible by all roles.
- **Booking & Hours Split**: Online booking configuration moved to `Settings -> Booking`. Clinic working hours and closed days moved to the Schedule tab.
- **Workspace**: Added a notification setup reminder block.
- **Accessibility**: Added bell keyboard support for notifications.
- **Setup & Onboarding**: 
  - **Guided Setup (`/setup`)**: Replaced the "First week checklist" with a dedicated dashboard to track onboarding essentials (Pricing, Team invites, Logging first visit) and optional tasks.
  - **Onboarding Polish**: Expanded Team step to side-by-side layout with inline sent-invite chips; simplified the Password step phrasing.

---

## Features

### 1. Visit Management & Ledger

#### Visit Entry & Patient Lookup
- **Patient search** by MRNO or name with create-if-missing capability
- **Walk-in MRNO auto-generation** with sequential format `PREFIXYY-NNNN` (e.g., `W26-0001`, `W26-0002`)
  - Sequential per clinic per calendar year, resetting yearly
  - Auto-widening past 9999 with no configuration needed
  - Fully offline-supported via collision retry loop
  - Prefix configurable per clinic in Settings (defaults to 'W')
- **Visit entry** with catalog price autofill. The New Visit form (`NewVisitPage.tsx`) is three cards:
  **Visit** (date, therapist, condition/treatments — collapsed for front desk), **Services**, **Payment**.
  - **Layout on every device.** Phones: one column, the fixed bottom save bar (total + "2 services · UPI, collected
    now", Cancel, Save) and no tab bar. Tablet and desktop: Save, Cancel and the same total/summary stick to the bottom
    of the form column (`saveSummary` shared by both bars); from `tab:` the patient panel sits left and, once a
    patient is chosen, stays in view while the form scrolls. Touch sizes on phones: toggles 40px, row pills 40px, the
    row ✕ 40px, "+ Add another service" a 44px dashed button; the small selects/inputs on a service row use 16px text
    on phones so iOS does not zoom. Patient search is a labelled search box; Enter picks the first match.
  - **Edit from the saved screen.** The receipt has an Edit link (only for people who may edit that visit: admin, front
    desk, the visit's own therapist) opening the Edit visit dialog; on close the receipt re-reads the visit. After an
    edit the badge comes from the payments on record ("Payment due · ₹500 (paid ₹1,500)" when the bill rose,
    "✓ collected" otherwise), never from the collected-on-the-form flag. Escape closes an open service picker, not the
    dialog around it.
  - **Date and therapist** share one row on tablets and desktop (`sm:grid-cols-2`), stacked into full-width fields on phones to prevent `DD/MM/YYYY` overflow. The therapist picker features an active therapist badge for instant visual recognition. **After saving**: a visit collected on the
    form shows "✓ ₹2,000 collected · UPI" and never offers "Take payment" (`paymentStillDue`); "Take payment" appears
    only when the choice was "Take payment later", the payment failed to record, or part is still owed.
  - **Start a note first**: for clinics with clinical notes on, a quiet outlined button under the patient's Last visit / Package tiles ("Start a note first — Add the service later"), above "Change patient"; it opens the same start-note flow as before.
  - **Patient search & lookup**: Instant search by Patient ID, name or phone number. Result rows show the patient's name, Patient ID, and a second muted line with masked phone (`••••4821`) and age (`34y`) for clear disambiguation between duplicate names.
  - **Several services per visit.** The Services card is a list of service rows (`ServiceRows.tsx`,
    presentational: rows in, changes out, reused by the visit editor). One visit therapist is chosen once at
    the top; a row shows the service, its catalog price and two outlined pills (clinics with several therapists):
    **"Done by: Dr X ▾"** (a select dressed as the pill: who did the service and gets its money — defaults to the
    visit's therapist; picking another sets `assistingTherapistId`) and **"Share"** (a colleague who helped gets a %
    of this service — on any service, paid or package; the % starts empty (focused) and Save asks for it; the open row reads "Shared with [Dr Y] [30] % ≈ ₹600 ✕", the ₹ being a preview of the
    row price; "Same as last session" when a package session copied it). "+ Add another service" adds a
    row; a single row has no ✕, with two or more every row has one and removing the first promotes the next.
    Errors name the service ("Dry needling: only one package per visit.") and show on that row.
  - **Packages are chosen in the service picker** (there is no New/Continuation toggle): open packages
    first ("Continue: Rehab package — session 5 of 10 (₹0)"), then services by category. Exactly one open
    package adds a ₹0 continuation row automatically, once per patient; two or more add nothing. A package row
    reads "Session n of N · package (₹0)" with "Use a different service". Only one package row per visit
    (a continuation or a multi-session service). With an open package and no package row, a note reads
    "{patient} has an open package (session n of N). It isn't used on this visit." with "Add package session";
    it never blocks saving. Save sends `visitService.create({ lines })`.
  - **Rows belong to one patient.** Changing the patient (or clearing it) restarts the rows and the discount
    (one auto continuation row if the new patient has exactly one open package, else one empty row;
    `initialRowsForPatient`). Services chosen before any patient was picked are kept, and the discount with them
    (`rowsForNewPatient`; no continuation is added next to a kept package row). At Save every package row is re-checked against the patient's current open packages
    (`draftLinesToVisitLines`): a package that is no longer open blocks the save on its row ("That package is no
    longer open for this patient. Remove it or pick another service."), and the session number comes from the
    fresh package, not the row. `visitService.create` also refuses a `packageContinuation` whose group has a
    visit for another patient ("That package belongs to another patient."). "Repeat last visit" applies its
    package row once, and pre-fills the discount only when the original visit had a single service. Esc closes
    an opened change-service / assistant picker.
  - **Date hint, notes label, single total.** Under the date: "Yesterday", "3 days ago", or a red "In 2 days — check
    the date" (`visitDateHint`). The free-text box under Treatments is labelled "Other treatments / notes".
    While no discount/extra is set the form shows only the Total box (the Subtotal box appears once it differs; the
    Edit visit dialog keeps its price box).
  - **Bill.** Subtotal = the rows' catalog prices (₹0 for a continuation). The discount / extra control
    (`BillAdjustmentFields`, ₹ or %, reason required whenever the bill differs from the subtotal) starts collapsed
    behind a quiet "+ Discount / Extra" button when no adjustment exists, and starts expanded whenever an adjustment
    is already present (e.g. editing a visit or restoring a draft). Selecting "None" collapses it back and clears the adjustment; with None selected a "Hide" link also closes it.
    The disclosure state does not affect dirty form tracking. It applies to the
    subtotal and **survives row changes**; it is cleared only when a ₹ discount no longer fits the new subtotal
    or the subtotal reaches ₹0, and the control is disabled at ₹0. The UPI QR, the payment amount and the phone
    bar use the total.
  - **Payment method selection** (`PaymentMethodChips.tsx`): fast one-tap radio chips for the clinic's common methods (UPI, Cash, Card) and an "Other ▾" expandable chip for remaining methods (e.g., Bank transfer, Cheque, or "Collected by {partner}"). Arrow-key navigable with 44px touch targets. Opening "Other" never changes the method; only picking an item does. Selecting UPI reveals the dynamic UPI QR button.
  - **Revenue share** is a read-only line under Total ("Revenue share · from services — Dr A ₹867 (67%) · Dr B
    ₹433 (33%)", `RevenueShareSummary`, from `autoCredits`) shown only when an assistant is tagged and the clinic's
    therapist split is on; a ₹0 package session on the visit therapist adds "Package sessions are credited through
    package attribution." "Edit split" appears only when the caller passes `onEdit` (New Visit does not: an unsaved visit
    has no stored shares to edit; the editor is for saved visits, see below).
    When a package continuation is run by someone other than the package's biller (therapist split on), New Visit adds one muted line: "₹1,000 of Dr A's package moves to Dr B for this session." (`packageMoveNote` in `NewVisitPage.tsx`, from `packageSessionShares`).
    Assistant tagging and the share line are hidden for a solo clinic (`clinicType` 'individual') or one with a
    single active therapist; with the split off only the share line is hidden. Changing the visit's therapist
    untags that person as an assistant.
  - **Revenue share editor** (`src/components/RevenueShareEditor.tsx`, replaces the old one-assistant
    `SplitModal`; opened by "Edit split"/"Split revenue" on a saved visit in Ledger, Workspace and the visit
    editor via `RevenueShareEditorLoader`). Each non-primary therapist has linked ₹ and % fields (% of the bill,
    rupee-rounded); the visit's therapist is the "(remainder)" so the total always equals the bill; therapists
    are added from a picker of active clinic therapists or removed (their share returns to the primary). Package
    money is read-only ("Package money stays with {name}: ₹X"; the holder is the live package line's deliverer,
    the primary with split off) and no share can go below it. The rules are `rebalanceCredits`; the editor logic
    (package lock, "outdated" test, typed edits, add/remove, last editor) is the pure `features/visits/shareEdit.ts`.
    Errors show inline and Save is disabled while invalid. Save calls `visitService.setShares` (mode becomes
    'manual'); "Last edited by {name} · {when}" comes from the credit rows' `updatedBy`/`updatedAt` (name omitted
    when the login can't be matched to a therapist). The banner "Services changed. Update shares from services?" with "Recalculate from services"
    (`recalculateShares`) shows only for a 'manual' visit that has services and whose services or bill changed
    after the shares were last edited (`sharesAreOutdated`: a line saved later than the newest share row, or
    stored rows that no longer add up to the bill); a hand edit alone never shows it, nor does a visit without
    services. The editor opens with the primary absorbing any difference between the bill and the other stored
    shares (`initialShares`, primary row added if missing); if the bill fell below the other shares it shows the
    stored rows with "The bill is now lower than the shares. Recalculate from services or lower a share." and
    Save disabled. A legacy one-assistant split opens as two rows. Escape closes it, focus starts on the first
    field, and validation and save errors are shown separately. Saving always confirms the shares: `setShares` rewrites every live share row (even unchanged) with an
    `updatedAt` later than the newest service line's, which clears the banner. Shares stay editable after
    invoicing and never
    change the patient's bill. The package holder rule (`packageHolder` in `domain/visitLines.ts`) is shared by
    the editor and `setShares`.
  - **Visit editor** (`EditVisitModal`): structured dialog for correcting visits.
    - Header shows patient name and Patient ID. Accessible dialog behavior (focus trap, Escape, click-outside) with unsaved change confirmation before discarding.
    - Errors render inside the dialog via `<ErrorNote>` with automatic scroll-to-view.
    - For uninvoiced visits: sections for "When & Who" (date with cross-month shift warning and therapist with assistant reassignment alert), "Services & Bill" (reusing `ServiceRows`, payment status badge showing collected vs balance due, single Total box), and "Clinical Notes" (condition and treatments).
    - For invoiced visits: layout inverts to place Clinical Notes first, followed by locked read-only services and bill with invoice badge (`Locked on Invoice #...`).
    - Destructive action: quiet red "Delete this visit" text link at the bottom of the dialog body (gated by `perms.canDelete`), never beside Save in the footer.
    - Footer displays bill amount, payment status, Cancel, and Save.
    - Post-save screen integration: `VisitLoggedCard` includes a quiet `Edit` button in the receipt card header next to patient name to immediately correct the visit just logged.
  - **Who can modify a saved visit** (`features/visits/visitPermissions.ts`, mirrors RLS): admin, front desk, or
    the visit's primary therapist can edit it and its revenue share; delete stays admin or the primary and only
    before invoicing; an assisting therapist who is not the primary sees no edit controls. The share editor is
    offered only when the clinic's therapist split is on and it has more than one active therapist (Ledger and Workspace
    row action `canSplit` included).
  - **Assisted visits in the assistant's lists** (`features/visits/assistedVisits.ts`, `AssistedVisitList.tsx`): a
    visit where a therapist delivered at least one live service line but is NOT the primary appears for them as a
    read-only "Assisted" row — the patient, the services they delivered, "with {primary}", "Your share ₹X" (their
    share row; "revenue not shared" when the clinic's therapist split is off or they have no share row) and "Not on
    your schedule. Logged on {primary}'s visit." No bill, payment pill, Collect, invoice or edit/delete. Shown in
    Workspace ("Assisted today", for a non-clinic-wide viewer), the Ledger (below the visits only when filtered to that
    therapist; the unfiltered Ledger already lists every visit in full; hidden under the payment filters) and patient history (replacing the
    colleague's full row for that therapist). When someone else (admin, front desk) filters the Ledger to the assistant, the rows read "{name}'s share" and "Logged on {primary}'s visit." `assistedVisitsFor` is the one pure selection rule. **Money stays with
    the primary:** these rows are never part of the assistant's Dues, Collected, the Ledger totals line, the
    Workspace tiles or any needs-payment list (all filter by the visit's own `therapist_id`), so a visit's bill is
    counted once across the assistant and the primary.
  - **Visit details** (Today's visits, Ledger, patient history): the Service column lists service names (two, then
    "+N more") with the assistant's initials as a chip; the Therapist column shows the primary's pill and, when
    the bill is shared, the split ring with the others' combined % (`SharesRing` in
    `components/visit/VisitSharedSplit.tsx`; hover = each therapist's ₹). For anyone who may edit the split the
    ring is a button opening the same share editor as "Edit split"; its hover says whether the split follows the services or was set manually; the share editor opens with a status line ("Automatic" or "Set manually" with a confirmed "Reset to services"); the editor lists the visit's services, shows a stacked share bar, and with exactly one assistant (and no package money) the primary's own amount can be typed, the assistant taking the rest
    (`credits_mode = manual`). Cards keep a text "Share" line for touch (`features/visits/visitDetails.ts`,
    `components/visit/VisitServiceDetails.tsx`). An assisting therapist sees only their own services and share
    in their "Assisted" rows, never the ring or the bill. Share rows rule
    whenever they exist (also for a visit without services, which shows a shares-only line); the old
    `shared_therapist_id`/`shared_pct` line shows only for a visit with no share rows (`splitDisplay`), and the
    row action reads "Edit split" for a shared or legacy-split visit, else "Split revenue".
  - **Done by / Shared with lists** (`PickerMenu.tsx`): the browser's own dropdown (different on every device, unstyleable) is replaced by a small list under the pill — a caption ("Who did this service" / "Share with"), one row per therapist with their schedule colour dot, the current one highlighted with a ✓; arrow keys / Home / End / Enter, Escape closes only the list (also inside Edit visit's dialog), a click outside closes it. The button is named "Done by: Dr Sneha" / "Shared with: Dr Sneha" for screen readers.
- **Field text is 14px on every device** (the `.nv-form` rule in `index.css`, on the New Visit page): Date, Therapist, Condition and the notes box used to be 16px on phones, bigger than everything around them. Because iPhones zoom into any field under 16px, an `@supports (-webkit-touch-callout: none)` rule keeps them 16px on iOS phones only.
- **Save bar**: one bar fixed to the bottom edge at every width (it replaced a floating card on tablet and desktop), its content lined up with the form (same max width). Left: the total and what happens to it ("₹1,300 / 2 services · UPI, collected now"; a ₹0 visit says "1 service · no charge") — tap it to jump to Payment. Right: **Cancel** (from `sm:` up only; on a phone the header's back arrow is the way out, and a Cancel beside Save is one slip away from losing the visit) and a larger **Save visit**. The form has `pb-24` so the bar never covers the last field.
    (`bottom: 0`, padding `env(safe-area-inset-bottom)`), reads line 1 "₹1,300" (or "No service yet" until a service is chosen, disabling Save)
    and line 2 "2 services · UPI, collected now" (or "to collect later"), with Cancel and Save visit buttons; tapping the summary scrolls to Payment.
    The phone bottom tab bar is hidden on `/visits/new`. Unsaved edits (anything changed since the page opened, not what the page prefilled itself: a patient from the link, an open package's session, a repeated visit) are guarded by a router blocker so Cancel, the back arrow and browser back prompt once to discard; tablet/desktop keep Save and Cancel together under Payment.
  - After saving: the "Visit logged" screen (`VisitLoggedCard.tsx`) displays a compact receipt summary (patient, MRN, service, date, therapist, and payment status badge), a 2-column grid of patient-specific actions (Add clinical note, Give bill, Request review, and Another visit for {patient}), and a bottom exit block with "Log visit for next patient" (for fast back-to-back logging) and a clear "Done" dismissal button. One solid button at a time (Take payment if owed, else the note, else Give bill); a visit billed elsewhere reads "Billing handled separately" (never "Settled"). "Another visit" and "next patient" clear everything the last visit filled in (services, condition, treatments, notes, discount, payment choice) and restart the unsaved-changes guard from the blank form; "Another visit" offers the patient's open package again.
- **Discount or extra** on new visits — by fixed amount or percent, with mandatory adjustment reason (stored as `adjustment_paise` on the visit)
- **Package session tracking** (1/3, 2/3, etc.) with ₹0 continuations for subsequent sessions
- **Reference panel** showing patient's last visit and open-package progress

#### Edit Visit
- Editable fields: condition, treatment notes, and (while not yet invoiced) bill amount, therapist, and date
- **Clinical fields** remain editable after invoicing; only billing locks
- **Scoped access** — therapists can edit only their own visits; admins can edit any visit

#### Today-First Workspace
- **Default landing page** showing:
  - Today's visits with payment state at a glance (Paid / Collect ₹X / Package / No charge) — boxed cards on phone, a table on tablet/desktop
  - Packages panel (bottom of page) — **Open** (default: every open package, the ones needing attention sorted first and tagged Stale / Renew soon) and **Needs attention (n)** (stale or renew soon), plus a "Mine only" checkbox for anyone with a linked therapist record (admin included). "Stale" and "All" were dropped: Stale is a subset of Needs attention, and All only differed from Open by the stale rows
- **Stat strip** (`StatStrip` in `ui.tsx`, inside the Workspace header card) — one row of tinted tiles, no period captions (each label carries its own period). Each tile is lightly tinted in its own hue with a white icon badge (from `sm:`; phones drop the badge so three tiles fit at 390px), the number (`font-num`) over a short label. Phones split the row evenly; from `tab:` counts get a **fixed width** (`kind: 'count'`, 9rem) and money tiles **flex** for the spare room (`'money'` fits ₹99,999). **What it shows is chosen by role, so the header only holds numbers that aren't already one tap away:** Reports (admin / front desk only) already carries the month's revenue, visits, new patients and packages with trends, and the Today card's tabs already count today's appointments and visits. So admin / front desk see **Collected** (today, opens the Ledger daybook) and **Dues** (everything still owed across all visits — `dashboardService.duesSummary`, per visit via `visitDuePaise`: a "Take payment later" visit with no invoice counts, an invoiced-but-unpaid visit counts, a part-paid visit counts only its rest; labelled "Dues · 3" with the visit count; opens the Ledger on the unpaid visits, all dates: `/ledger?tab=visits&filter=not_collected`), followed by one muted line "October: ₹4,82,300 net revenue · 86 visits — Reports ›" linking to `/insights`. Therapists (no Reports access, so this is their only view of it) see **Collected** (their own today), **Dues** (what's owed on their own visits, via `duesSummary(clinicId, therapistId)`; opens the Ledger on their unpaid visits) and **Oct visits** — when billing is open to them; otherwise Collected, Oct visits and Oct packages (open packages are listed below on the page). One icon and hue per kind of number (`src/components/StatIcons.tsx`): collected = moss ₹, dues = amber wallet, visits = sky patient-tick, packages = plum stack; `--sky` / `--plum` are tokens for stat icons only. `StatTile` remains for Reports/print
- **Quick actions** — take payment / issue invoice / split revenue / delete directly from each visit row's kebab menu; "Log visit" from a Packages row resumes the right package

#### Ledger & History
- **Dense table view** with patient enrichment (last visit + count, treatment, condition, bill amount)
- **Multi-tab interface** (`/ledger` with sub-tabs `visits`, `patients`, `invoices`, `daybook`; `/patients` redirects to `/ledger?tab=patients`):
  - Visits tab — all-time visit history, URL-addressable (`/ledger?tab=visits`)
  - Patients tab — patient roster list (`/ledger?tab=patients`), visible to all roles, with All and My patients chips (replaces standalone `/patients` route; redundant "Needs invoice" chip removed)
  - Invoices tab — issued invoice records, billing-access-gated, URL-addressable (`/ledger?tab=invoices`)
  - Daybook tab — end-of-day cash reconciliation log tracking payments, advances, and discounts (`/ledger?tab=daybook`)
- **Shared Date Preset Bar** — unified `DatePresetBar` control (`This week`, `This month`, `Last month`, `All time`, `Custom`) across Visits and Invoices tabs, preserving tab defaults (Visits = This week, Invoices = This month)
- **Filtering** — therapist dropdown, date range search, consistent segmented control styling
- **Bulk actions** on individual rows — Invoice, Repeat, Edit split (revenue share editor), Delete
- **Only real visits can be invoiced** — no standalone "manual invoice" path

---

### 2. Clinical Assessment & Notes

#### Core Assessment (Initial & Follow-up)
- **Comprehensive consultation notes** with automatic episode-of-care tracking via patient enrollments
- **Two modes**:
  - **Initial** — full form entry
  - **Follow-up** — auto-collapses read-only carry-forward sections (medical history, screening), editable only for clinical follow-up sections

#### Multi-Section Accordion Layout
1. **Chief Complaint & History**
   - Anatomical region selection (9 regions: Cervical/Thoracic/Lumbar Spine, Shoulder, Elbow, Wrist/Hand, Hip, Knee, Ankle/Foot)
   - Onset/mechanism/episode pattern timeline
   - Occupation/activity context
   - Trauma & surgical history with structured dates
   - Secondary complaints array for multi-region presentations

2. **Subjective Assessment**
   - **Pain Profiling**: NRS current/best/worst (3-point scale), pain pattern (constant/intermittent/night-only/morning stiffness), sleep disturbance, aggravating/easing factors
   - **Previous pain history** — tracking historical episodes

3. **Body Chart**
   - Interactive tap-to-mark front/back/left-lateral outline
   - 4 mark types: pain, numbness, stiffness, referred
   - Responsive canvas layout

4. **Functional Status (PSFS)**
   - Up to 5 activities with baseline (locked on first save, carryable to follow-ups)
   - Current function scores
   - MCID (Minimal Clinically Important Difference) crossing counter

5. **Objective Examination**
   - **ROM (Range of Motion)**: region-driven movements with quick spine preset table (cervical/thoracic/lumbar with flexion/extension/lateral flexion/rotation)
   - **Manual Muscle Testing** with nerve-root tags
   - **Derived read-only myotome display**
   - **4-state neurological screening** (dermatomes/myotomes, T1/L2/L3/S2 extended levels)
   - **Red/Yellow flag tri-state screening banner** with collapsible detail

6. **Treatment & HEP (Home Exercise Program)**
   - Load management block (weight-bearing %, PWB %, brace, ROM limits)
   - Structured interventions with session duration quick-pick
   - HEP exercise rows with sets/reps/frequency
   - Plan & goals with target timeframe (short/long-term)

7. **Outcome Tracking**
   - Direction-aware outcome cards per instrument
   - NRS: ▼ Improving for lower scores
   - PSFS: ▲ Improving for higher scores
   - Comparison against most recent prior note in same episode

#### Note Features
- **Derived scalar columns** extracted at save time: `nrsScore`, `psfsMean`, `redFlagCount` (for filtering/reporting)
- **Patient profile integration** — "Clinical notes" section drilling into note editor
- **Contraindication banner** for clinical safety flags

#### Light Session Notes (SOAP) — per-visit documentation, distinct from Core Assessment
Two editors share the `consultation_notes` table, distinguished by `noteMode`
(`src/domain/types.ts`): **heavy** (`'initial' | 'followup'`, the Core
Assessment accordion above, `NoteEditorPage.tsx`) for initial evaluation and
periodic full re-assessment, and **light** (`'session'`,
`SessionNoteEditorPage.tsx`) for routine per-visit documentation — a small
single-screen SOAP form (`src/domain/sessionNote.ts`'s `SessionNotePayload`):
Subjective (pain 0–10 via the shared `ScaleWidget`, optional one-liner),
Objective (free text), Intervention (multi-select from
`src/domain/treatmentOptions.ts`'s combined manual-therapy/exercise/modality
vocabulary — the same list the heavy editor's Treatment section uses, kept
in one place so `dashboardService.ts`'s Modality-usage report recognizes
picks from either note kind), Assessment and Plan (single-choice chip
groups). No PSFS, no red-flag screening — `psfsMean`/`redFlagCount` are
written `null`/`0` for a session note by design.

**No heavy-first gate.** A light session note can be written for any visit
at any time — there is no requirement for a completed heavy (initial/
follow-up) assessment to exist first. (Billing & Notes Rebuild Phase 2
originally shipped this as a hard gate, "C8"; Phase 3 removed it — session
logs are meant to stand on their own, unpaired from the Core Assessment
episode.) A visit row's "+ Note" link (`VisitNoteLink` in
`src/components/VisitCard.tsx`) always routes to the light editor once the
visit `needsNote`. Patient Profile's own "New assessment" button always
opens the heavy editor (C5) — the two entry points are simply independent,
not one gating the other.

**Standalone entry point + batch editing (Phase 3).** Patient Profile's
main column has a "Session notes" section (above Visit History) showing
how many visits still need a note and a **"Write session notes"** button
that opens all of them back-to-back — `SessionNoteBatchPage.tsx`
(`/patients/$patientId/notes/session-batch`, `visitIds` search param).
Each visit gets its own mount of the shared `SessionNoteEditorBody.tsx`
(the form/autosave logic extracted out of `SessionNoteEditorPage.tsx` into
`useSessionNoteEditor.ts` so the two flows share one implementation),
keyed on visit id so switching visits gets a clean hook instance rather
than carrying over the previous visit's state. "Save & Next"/"Save draft &
Next" advance the queue (labeled "…& Finish" on the last visit); "Skip"
advances without saving; "Prev" revisits an earlier note in the queue
(read-only once completed). Nothing about the queue is durable session
state — every note that reaches draft or completed is saved immediately
via the same path the single editor uses, so leaving mid-queue just means
the remaining visits are still `needsNote` and reappear next time the
queue is recomputed. If another tab/device completes a queued visit's note
concurrently, the batch page auto-skips it with an inline notice rather
than erroring. "View session log"/"Insurer packet" links live in the same
section, resolved against the patient's active enrollment
(`patientModuleEnrollments.getActive`) rather than "whichever episode's
note was most recently touched" — the latter could point at a stale,
non-active episode for a patient with more than one enrollment over time.

**`/notes/$noteId` is mode-dispatched**, the first route in this app whose
rendered component depends on loaded data rather than the URL shape alone
(`NoteEditorDispatch.tsx`) — renders the heavy or light editor based on the
note's own `noteMode`, defaulting a legacy `null` value to heavy (never to
session — the reverse default would run a real Core Assessment through the
light editor's shallow-merge upcast and let autosave overwrite it with a
blank session payload). `/notes/$noteId/print` similarly guards against
rendering a session note as a blank Core Assessment: session notes print
only from the session log below, never individually.

**Multi-visit session log** (`SessionLogPrintPage.tsx`,
`/patients/$patientId/session-log/$enrollmentId`) — one enrollment's
completed session notes as a compact trend grid (date/therapist/pain/
assessment/plan/treatments, one row per session), narrative blocks for
sessions with a one-liner, and a single certifying attestation (clinic
signature + every treating therapist deduped by id — there is no
per-therapist signature field in the data model, only a clinic-level one).

**Insurer packet** (`InsurerPacketPage.tsx`,
`/patients/$patientId/insurer-packet/$enrollmentId`) — composes the most
recent completed heavy note, the session log, and whichever invoice(s)
already cover the episode's visits (read exactly as issued via the existing
`visitId → visits.invoiceId → invoice` join, no schema/RPC change) in one
print job, generated fresh, never stored. A visit with no invoice yet is
called out rather than silently omitted. Writing *new* clinical fields
(diagnosis, referring physician) onto an invoice would need schema/RPC
changes and stays out of scope here — deferred to whenever the billing
rebuild touches `issue_invoice()` for other reasons.

**Migration:** `consultation_notes.note_mode`'s CHECK constraint was widened
to allow `'session'` (`20260827000001_allow_session_note_mode.sql`) — a
**deploy-ordering requirement, not just a schema change**: a CHECK
violation is a permanent sync failure (`src/sync/status.ts`), and
`src/sync/engine.ts`'s handling for a permanent failure on an unsynced row
is to delete it locally (`revertToServerTruth`). The migration must be live
in Supabase before any deployed client can write `noteMode: 'session'`, or
the first session note a therapist writes is silently destroyed rather than
queued with a visible error.

---

### 3. Revenue & Invoicing

#### Revenue Split
- **Per-visit computation** at billing time with rate snapshot storage
- **Model**: BM Share (75% configurable), Post-Tax (90% of share), TDS (configurable basis), HV share
- **Rounding**: half-up to the rupee, once per visit — rollups reconcile by construction

#### Invoice Issuance
- **Server-issued gap-free sequential numbers** per clinic per FY (format: `PREFIX/FY-LABEL/NNNN`, e.g., `BM/26-27/0001`)
- **Immutable once issued** via DB triggers
- **Printable** on A4/A5 with clinic letterhead + optional partner-hospital branding
- **Document title**: "BILL" while outstanding, "BILL CUM RECEIPT" once paid — not
  "Invoice"/"Tax Invoice", which reads as GST terminology that doesn't apply to
  (generally GST-exempt) healthcare services and doesn't match how insurers/TPAs
  expect these documents to be labeled
- **Online-only** — gap-free numbers require the server counter
- **TPA-facing print layout**: dates-of-service get their own column,
  "Catalog price" becomes "Rate" (per-session, `/session`), a treatment
  period line ("Treatment period: 1 Jan – 15 Jan") sits above the
  itemization, and the old "Show visit dates" checkbox is gone — dates are
  always shown now, for legacy invoices too. See "Invoice line items (v2)"
  and "Clinical context on the bill" under the `invoices` schema entry
  above for what actually changed underneath.

#### Payment Status Badge & Collect Action
- **4-state display collapse** (`src/domain/paymentState.ts`'s
  `paymentBadge()`) over the raw 6-state `VisitPaymentState`: Paid /
  Partial / Due / Overdue / (no badge for `zero_session`). A visit reads
  **Overdue** once its bill has sat unpaid past `OVERDUE_AFTER_DAYS` (30) —
  the clock anchors on `visitDate` for an uninvoiced visit, or
  `max(visitDate, issuedAt)` once an invoice exists, so a package invoiced
  weeks after the visit gets a fresh 30-day window instead of reading
  Overdue the instant it's issued. A `partially_collected` balance past the
  threshold gets Overdue's urgent tone while keeping its "₹X of ₹Y" label —
  losing the partial-payment detail on an already-informative row would be
  a regression, not a simplification.
- **Collect promotion**: wherever money can still be taken (`take_payment`
  available), the passive status pill is replaced by a filled `Collect ₹X`
  button rather than shown alongside it; `Give bill` (was "Issue invoice") moved out of the
  visible row entirely into the row's kebab menu, so there's exactly one
  primary action per row. Two independent implementations both carry this
  (the desktop table's `PaymentStatusDisplay` and the mobile
  `SharedVisitCard` — confirmed they were never actually sharing markup
  despite an old doc comment implying otherwise) plus New Visit's "Last
  visit" summary tile, a third, easy-to-miss `PAYMENT_CHIP` consumer.

#### Needs-Receipt Queue
- **Ledger → Invoices tab**: a "Needs receipt (N)" section lists every
  visit that's `collected_no_receipt` (money taken, no invoice ever
  issued) clinic-wide, oldest first, each with a one-click "Give bill"
  into the existing dialog. `dashboardService.needsReceipt()` is the single
  source of truth for both this section and the tab's own count badge, so
  the two can never disagree — deliberately unbounded (no date filter),
  matching the sibling `outstandingInvoices()`'s own precedent, since a
  backlog like this is by definition old and shouldn't vanish behind a
  Ledger date preset.

#### Issue Invoice Right After Logging a Visit
- **`NewVisitPage.tsx`'s post-save screen** ("Visit logged") gained an
  "Give bill" button (originally "Issue invoice"), gated on `canBill` (same entitlement/role check
  every other invoicing entry point uses), alongside the existing "Add
  clinical note"/"Log a separate visit for {patient}"/"Done" actions — billing staff no longer
  have to leave the page and find the visit again on Ledger/Workspace to
  invoice it immediately. Opens the same `IssueInvoiceDialog` those two
  pages use (`returnTo="/visits/new"`, added to `INVOICE_PRINT_BACK_TARGETS`
  in `router.tsx`), built from fields already computed at save time
  (`serviceLabel`, `isPackage`, `alreadyCollected`) rather than a second
  query — no new invoicing logic, just a third call site into the existing
  dialog/service.

#### Payment Status & HV Settlement
- **Three-fact payment model**: Billed / Collected / Receipted
  - Distinguishes cash collected without receipt from issued-but-unpaid invoice
  - Neither reads as the other
- **Zero-bill visits are labeled by why, not just that**: `zero_session`
  (bill = ₹0) covers two situations staff read very differently — a
  **package continuation** (session already billed on an earlier visit
  in the same package, `sessionIndex`/`packageTotal` both set — labeled
  "Package"/"package session") vs. a **standalone complimentary visit**
  (never meant to be charged, no package involved — labeled
  "No charge"/"complimentary session"). Both share one `VisitPaymentState`
  (nothing to collect or invoice either way); only the label differs,
  computed per-row from session/package fields via
  `isPackageContinuation()` (`src/domain/paymentState.ts`) rather than
  stored on the state itself.
- **Dues = what visits still owe** (`visitDuePaise` / `hasDue` in `paymentState.ts`, the single definition): `uninvoiced` and `outstanding` owe the whole bill, `partially_collected` owes bill − collected, everything else owes nothing. Used by Workspace's Dues tile (`duesSummary`), the Ledger's **Not collected** filter (which includes part-paid visits) and the Ledger totals line (billed = collected + outstanding, a part-paid visit splits), and `todayWorklist.outstandingPaise`. `outstandingInvoices` (invoice-flag based, misses uninvoiced visits) now only feeds the Ledger's "Unpaid invoices" card; like the Invoices tab's Outstanding tile it counts **invoice total minus payments recorded on the invoice's live visits** (`OutstandingInvoiceRow.remainingPaise`; rows show "of ₹total" when part-paid), so partial payments never inflate what is owed. **Invoice paid/outstanding status is reconciled from that balance** (`paymentService.reconcileInvoiceStatus`) after any money write that bypasses `recordInvoicePayment`: applying an advance (`advanceService.applyAdvance`) and amending an invoice (`invoiceService.amendInvoice`, whose new invoice would otherwise have no status row and read as paid). Issuing an invoice whose status write fails now warns with a Retry on the success screen instead of logging to the console. **Lookups use indexes, not clinic scans:** Dexie v23 adds `payments.advanceId` and `[clinicId+receivedDate]`; invoice balances and reconcile use `visits.listByInvoiceId`, an advance's draw-downs use `payments.listByAdvanceId`, and a day's payments (Daybook) use the compound index. `reconcileInvoiceStatus` also runs after a direct payment on an invoiced visit, and (best effort, after the money is saved) after applying an advance. **Payment dates:** `TakePaymentDialog` has a *Date received* field defaulting to today (not the visit date), so collecting on an old visit lands in today's Daybook; "Collected now" while logging a visit uses the visit date capped at today (`receivedDateAtVisit`). A payment that fails after its visit saved leaves the visit in place and shows the saved screen with the error and Take payment, not the form (a retry would duplicate the visit). Each row there acts directly (billing roles): **Take payment** when the invoice still has a live visit (`OutstandingInvoiceRow.visitId`), otherwise — the visit was removed, so no payment can be recorded against it — **Review and void**, which opens the invoice where *Void invoice* lives. The Invoices tab applies the same rule: it only offers Take payment when the invoice has a live visit.
- **"Collected now" at invoice time records the cash**: `IssueInvoiceDialog` calls `paymentService.collectInvoiceNow` — it logs whatever the invoice's visits haven't received as a `payments` row (method from the chosen payment mode: UPI→upi, Cash→cash, Card→card, Insurance→bank_transfer; received today) and marks the invoice paid. Flipping only the paid flag left the cash out of the Daybook and the by-method totals, which are built from `payments`. A visit saved as "paid" already logged its payment, so nothing is added twice.
- **The Workspace "Collected" tile is money received today** (`dashboardService.receivedOnDate`): payments received that day (not those drawn from an advance) plus advances deposited — exactly the Daybook's total for the day, which the tile opens; a therapist login counts only payments against their own visits. It is no longer the sum of today's visits' bills, which missed a payment today on an older visit and a part-payment. A printed bill (`InvoicePrintPage`) now shows **PART PAID** with "Received ₹X · Balance due ₹Y" for a part-paid invoice, and shows no PAID/DUE stamp until the payment status has loaded (it used to flash PAID).
- **Partial payments against an invoice**: recording an amount less than
  the invoice total leaves it `outstanding` with the balance tracked, not
  a full-or-nothing toggle. No amount column exists on `invoice_payments`
  (invoices are immutable, and that table is just a paid/outstanding flag)
  — instead the amount is logged as a visit-scoped `payments` row, the same
  mechanism the no-invoice direct-payment path already used, via
  `paymentService.recordInvoicePayment()`. A payment entered against an
  invoice spanning several visits (a package billed together) is allocated
  across those visits in date order, each visit's own bill as the ceiling
  for what lands on it, so every visit's individual payment state stays
  correct. The invoice flips to `paid` automatically once the running
  total reaches its total. (There is no bare "Mark paid" toggle any more:
  it flipped the flag without recording any cash. The Invoices tab offers
  "Mark outstanding" only for an invoice flagged paid with no payment
  recorded against its visits, to undo a mis-click — `canMarkOutstanding` in
  `src/domain/invoiceStatus.ts`. The Invoices tab reads a missing status row
  as **paid** (`invoiceRowStatus`), like every other screen.) Entry
  points: the Invoices tab's "Take payment" action (works for
  multi-visit invoices), and the existing "Take payment" dialog on any
  visit card (works standalone; for an invoiced visit it now looks up and
  is bounded by that invoice's real total rather than assuming one visit
  is the whole bill).
- **Split one collection across payment methods** (e.g. part cash, part
  UPI): `TakePaymentDialog`'s "Split across methods" toggle replaces the
  single method dropdown with a list of `{amount, method}` rows that must
  sum to the entered total. This was always possible by reopening the
  dialog once per method — `payments` has no invoice-level singular
  method constraint, it's already a multi-row ledger — the toggle just
  does the same sequential `recordInvoicePayment`/`logPayment` calls in
  one sitting instead of three round trips.
- **Monthly report** shows HV settlement card for variance tracking

#### Advance Payments
- **Record ahead of treatment**: Patient Profile's "Record advance" button
  logs money received with no visit attached yet — amount, method, date,
  optional note — and prints its own small receipt (`ADVANCE RECEIPT`,
  A5, no dates-of-service block, "Adjustable against future treatment").
- **Draws down against real visits**, not a separate ledger: applying an
  advance writes ordinary `payments` rows (stamped `advance_id`), so every
  existing payment-state computation, badge, and report already handles it
  correctly with zero special-casing. `TakePaymentDialog` surfaces "₹X
  advance available — apply" whenever the patient has an open balance,
  applying oldest-advance-first and capping at what's actually still owed.
  An advance flips to `exhausted` automatically once its balance reaches
  zero.
- **Not visible anywhere payment-state is read** until drawn down — an
  unapplied advance balance shows only in the two places above (the
  Patient Profile pill, `TakePaymentDialog`'s nudge), never in the
  needs-receipt queue, dashboard KPIs, or a visit's own badge.

#### Daybook (End-of-Day Reconciliation)
- **Ledger → Daybook tab**: a dedicated log for front desk and admins to reconcile cash and electronic payments at the end of the day.
- **Role-gated**: Visible only to roles with billing access (admin and front desk, or governed by the clinic's billing access toggle).
- **Payment tracking**: Shows physical collections for the selected day, explicitly excluding advance drawdowns (to prevent double-counting) while logging the initial advance deposit on the day it was received.
- **Discount transparency**: Explicitly logs all discounts given that day, including the mandatory adjustment reason, to ensure staff accountability for lowered prices.
- **Date presets**: Includes "Today", "Yesterday", "This week", and "This month" presets to quickly review the relevant reconciliation window.

#### Billing Access Control
- **Clinic-level toggle** restricts who is allowed to issue invoices
  - "Everyone" vs. "Billing staff only"
  - Enforced server-side inside `issue_invoice()` RPC, not just hidden in UI

#### Monthly Report
- **Fiscal-year-aware** (Apr–Mar)
- **Per-therapist metrics**: Bill, BM Share, TDS, Post-Tax, HV, unique patients, total. Each row also carries `visitCount` (visits as primary), `patientsTreated` (visits the therapist delivered at least one service line on, or as primary for visits without lines; each visit once per therapist, so a primary who also delivers counts once) and `assistedVisitCount` (delivered a line without being the primary). The Total row's `patientsTreated` is the number of visits (no double count) and its `assistedVisitCount` is 0. Every therapist who delivered a live line in the period has a row (zero money when nothing moved to them: ₹0 visits, therapist split off), so assisted work is always listed. **Monthly statement / comparison table:** an "Assisted" column (from `assistedVisitCount`) sits next to Visits and appears only when any row has assisted visits, with the note "Total counts each visit once; therapists' patients treated can add up to more."; Bill/Share/TDS/Post-Tax/Partner stay "billed under my name" and Shared/Net come from the pay base (`MonthlyReportTable`, `TherapistComparisonTable`). `treatedTherapists` in `domain/visitLines` is the one rule for who was treated on a visit.
- **Service mix** (`dashboardService.serviceUsage`, "frequently used services"): a visit with service lines contributes one entry per live line (count +1, amount = that line's net from `lineNets`, so the discount lands pro rata); a visit without lines keeps its single entry. The name comes from the catalog, else the line's name snapshot.
- **CSV export** capability
- **Attribution audit tab** (Reports → "Attribution audit"): a per-visit
  ledger of every rupee a revenue share, a legacy manual split or automatic
  package attribution moved between therapists that month — see §2b.

---

### 4. Data & Offline

#### Offline-First Architecture
- **All entry works offline** — changes queue in an outbox
- **Automatic sync** when connection returns
- **Invoice issuance is deliberately online-only** — gap-free numbers need server counter
- **Dexie (IndexedDB)** local store with Supabase sync engine
- **Pull paging**: each table is pulled in `(updated_at, id)` order (PostgREST `or` keyset, `afterKeyFilter`) so rows that share a timestamp across a 1,000-row page edge are never skipped, and every pull starts `PULL_OVERLAP_MS` (2 minutes) before the saved cursor so a slow transaction that commits late is still picked up (re-pulled rows are identical)
- **Deletes sync too**: an `after delete` trigger on every synced table (`record_sync_tombstone`) writes `sync_tombstones` (clinic_id, table_name, row_id, updated_at); devices pull it after the tables and delete their copy unless it has a pending edit or changed after the delete (`rowsToDelete`). Markers older than 90 days are pruned nightly by pg_cron `prune-sync-tombstones`
- **Role changes re-pull**: memberships are remembered as `clinic:role`, so a role change resets every cursor like a new clinic does; a front-desk membership deletes clinical notes already cached for that clinic

#### Data Backup (Settings → Account)
- `backupService` exports and restores the clinic's data as a JSON bundle (version 3): therapists, catalog, patients, visits, **visit service lines (`visitItems`) and revenue shares (`visitCredits`)**, invoices, payments, settlements and notes. Restore writes visits before their lines and shares (outbox order). A backup taken before multi-service visits has no `visitItems` / `visitCredits` keys and restores as none; the restore message reports the counts.

#### Historical Import
- **Settings → Import historical visits** — one-time import from clinic's Excel ledger
- **Smart matching**:
  - Matches/creates patients by MRNO
  - Parses freeform service names into catalog items and package sessions
  - Flags anything it can't confidently resolve for manual review
  - Commits only after approval

---

### 5. Analytics & Dashboard

#### Dashboard
- **Rolling last-6-months view**:
  - Post-Tax BM revenue trend chart
  - Open packages sorted by days since last visit (flagged stale past 14 days)
  - Outstanding invoices summary
- **Hand-built SVG charts** (no charting dependency)
- **Validated categorical color palette**

#### Therapist Comparison
- **Opt-in chart** (off by default; admin enables in Settings → Features)
- **Single dual-bar chart** (visits + revenue per therapist, month picker) plus live month table with retention % and new packages
- **Visible to therapists too**, not just admins — deliberate exception to "financial aggregates are admin-only"
- **3 key metrics** per therapist
- **Utilisation column** (`src/domain/utilisation.ts`, hook `useTherapistUtilisation`): work actually done ÷ time made available, from logged **visits** — not bookings, so walk-ins and last-minute bookings count. A visit **without service lines** counts as one clinic slot (`slotDurationMinutes`); a visit **with** lines counts each therapist's minutes from the lines they delivered (`therapistMinutes`: the sum of their lines' durations when every one has one, else the sitting once, capped at the sitting; 0 if they delivered nothing — so an assistant's time counts even on a ₹0 bill). The sitting is the linked appointment's `durationMinutes` (appointments whose `visitId` is the visit), else the clinic slot; `loadUtilisationVisits` (`src/services/utilisationVisits.ts`) attaches lines and sitting with one range query each; available time is the therapist's working hours (breaks excluded) over non-closed days, or the clinic's booking hours when none are set (shown with `*`). Each day is capped at 100% of that day's available time, so overlapping entries can't overstate it; the in-progress month only counts elapsed time; a legacy visit (no service lines) keeps the old shared-percentage time rule (`sharedPct`) even if its money split is later edited in the share editor, because the editor writes share rows and never changes `shared_pct`; a visit with lines uses `therapistMinutes` only (durations capped at the sitting, else the sitting once); visit time on days off isn't counted. No schema change. Same column on the Trends print page.
- **Top performers**: no blended score. The comparison table's Net / Visits / Retention / Utilisation headers sort (click again to restore the default order), and the best value in each column gets a "Top" marker (`src/domain/therapistRanking.ts`). The Visits column is **patients treated** (assisted visits included, each visit once), and only therapists with at least 20 patients treated in the period are eligible, a column needs two eligible therapists to have a leader, ties share it, and a best value of zero marks nobody.
- **Clinic utilisation card** (Reports → Trends, admin only; `ClinicUtilisationCard`, `src/domain/utilisationReport.ts`, `utilisationPeriods.ts`, `therapistStatus.ts`): bar chart of clinic-wide utilisation (total work done ÷ total available time across therapists) by **month** (last 12), **fiscal quarter** (last 4, following `fyStartMonth`) or **fiscal year** (last 3), with a dashed 70% target line, in a dedicated blue (`UTILISATION_COLOR`). Clicking a bar selects that period; the table lists each therapist's utilisation, change vs the previous period (points) and a status. A period includes active therapists plus any inactive one who logged work in it. Status (thresholds in `STATUS_THRESHOLDS`): **Strong** = 70%+ and at or above the clinic; **Needs attention** = under 50%, 15+ points under the clinic, or a 10+ point drop while under the clinic; **Not enough data** = under 20 patients treated or no available hours. Each status shows its reason. Independent of the revenue period bar. Known limits: a visit without service lines still counts as one slot whatever its real length, and a therapist added mid-period is measured against the whole period.
- **6-month trend charts** need at least 2 months of history to render (otherwise read as a false spike);
  below them, a **live "this month" table** (revenue, visits, open packages per therapist) always shows
  as soon as there's at least one visit this month — not gated behind the trend's own history requirement

#### Analytics Capabilities
- Condition pie chart (grouped raw text)
- Referral source breakdown (doctor/hospital detail-name)
- Visit count aggregation
- **Revenue trends** (Reports → Trends): unified **trend period** bar (**MoM** | 6m | YTD | FY) on URL (`?period=&year=&month=`) drives the **revenue trend** block and **therapist comparison** together; KPI strip above stays **current calendar month** only. **MoM** picks a focus month and loads that month plus the prior month for waterfall/MoM charts. **revenue ₹ waterfall**; dual visits + revenue bars; scrollable month table. Therapist scope uses `netPostTaxPaise`; clinic-wide uses post-tax or billed total per split settings.

---

### 6. Team & Permissions

#### Three Roles (Enforced Server-Side via RLS)
- **admin** — full read/write on everything: roster, catalog, all therapists' visits, billing settings, feature toggles
- **therapist** — clinic-wide reads, scoped writes (own visits/notes only), no roster/catalog/pricing changes
- **front_desk** — reads and visit/invoice entry, and can correct any visit (its lines and revenue shares too: `visits_update` / `visit_items_update` / `visit_credits_update` allow admin, front desk or the visit's own therapist since `20261023100000`; deleting a visit stays admin or own therapist, and since `20261024100000` the soft delete — an update setting `deleted = true` — is refused for front desk on the server too), no clinical-notes access (enforced by `consultation_notes` RLS since `20261022100000`, so notes never reach a front-desk device; bills get the referral block through `get_invoice_referral(visit_id)`), no roster/catalog writes, excluded from clinical dashboards

#### Visits, service lines and revenue shares (who can do what)
Enforced by RLS (`visits_*`, `visit_items_*`, `visit_credits_*`, helpers `can_add_visit_children` / `can_edit_visit_children`) and mirrored in `features/visits/visitPermissions.ts`:

| Action | admin | front desk | primary therapist | assisting therapist (not primary) |
|---|---|---|---|---|
| Add a visit (with its lines and shares) | yes | yes | yes | yes (any member can log a visit; they get the lines/shares rule below) |
| Add lines or shares to a visit | yes | yes | yes | only if they created the visit (`visits.created_by`) and it isn't invoiced yet |
| Edit a saved visit, its lines and its shares | yes | yes | yes | no |
| Delete a visit | yes | no (enforced on the server: trigger `visits_guard_soft_delete`) | yes, before invoicing | no |
| Edit lines after invoicing | no (frozen) | no | no | no |
| Edit shares after invoicing | yes | yes | yes | no |

"Whoever created the visit may add lines/shares" lets a therapist who logs a visit for a colleague save its services and revenue share, including when pushed later from offline. Since `20261024100000` it holds only while the visit is not invoiced. Accepted residual: until then, a creator with API access could add a line or a share to the visit they logged for a colleague (crediting themselves); the write is audit-logged and the attribution audit flags it as "repaired". An assisting therapist sees the visit read-only in their own lists.

Delete is enforced on the server for the soft delete too (the app deletes a visit by updating `deleted = true`, which `visits_update` alone would let front desk do): trigger `visits_guard_soft_delete` refuses the false → true flip (42501, "Only an admin or the visit's therapist can delete a visit.") unless the caller is an admin or the visit's therapist before the update; server-side work without a user (`auth.uid()` null) is let through.

Front desk's `visits_update` reach is the same as an admin's or the visit's own therapist's: through the API it can change a visit's therapist and the old split columns (`shared_therapist_id` / `shared_pct`) even on an invoiced visit (those columns are not in `protect_invoiced_visit()`'s frozen list). The app only offers what the table above says.

#### Self-Service Sign-In (Email/Password and Google)
- **`LoginPage.tsx`** offers both email/password (`signInWithPassword`/`signUp`)
  and "Sign in/up with Google" (`signInWithOAuth`) — either can create the
  account, and both can coexist on one `auth.users` row as separate linked
  identities once the person adds both.
- **OAuth redirects to `/workspace`**, not `/reset-password` — `/reset-password`
  unconditionally shows a mandatory "choose a new password" form to any
  session that lands on it (see Onboarding below), so routing OAuth through
  it forced every Google sign-in into a confusing, skippable-looking password
  step it never needed. Google sign-in now lands straight in the app, same
  as email/password sign-in.
- **Adding a password to a Google-only account is deliberate, not automatic**:
  the account-menu action reads "Set a password" instead of "Change password"
  when `session.user.identities` has no `provider: 'email'` entry
  (`Shell.tsx`'s `hasPasswordIdentity`), and `ChangePasswordDialog`'s copy
  adjusts accordingly (`isFirstPassword`). Same underlying `updateUser({
  password })` call either way — Supabase doesn't require an existing
  password to set one on a session that's already authenticated via Google.
- **"Email not confirmed" sign-in failures** get a **Resend confirmation
  email** action right on `LoginPage.tsx` (`auth.resend({ type: 'signup' })`)
  — previously a self-signup with a lost/undelivered confirmation email had
  no in-app recovery path at all.

#### Onboarding
- **Therapist invites** from Settings → Team create login *and* service-roster entry in one step
- **Admin/front_desk invites** only need login
- **Bookable admin/front_desk invites**: the form sends `bookable: true` and `invite-therapist` creates/links the roster row to the new login (same `linkTherapistRosterRow` as therapist invites), so one person is one card. The client never creates an unlinked roster row for an invited login.
- **Deactivation** (keeps history intact) or **permanent deletion** (zero visits/notes/invoices only)
- **Invite email → password setup**: `invite-therapist` calls
  `auth.admin.inviteUserByEmail()` with `redirectTo` set to the inviting
  browser's own origin + `/reset-password` (sent as `redirectOrigin` in the
  request body from `SettingsPage.tsx`). New invites also set
  `user_metadata.require_password_setup = true`; `Shell.tsx` redirects any
  signed-in user with that flag to `/reset-password` before they reach
  Workspace. `ResetPasswordPage.tsx` clears the flag when a password is chosen.
- **Member onboarding status in Team → Logins** (`src/domain/memberOnboarding.ts`,
  `memberOnboardingStatus()`) — three states, not the earlier flat
  Pending/Active split, derived from the same two fields
  `list_clinic_members_with_email()` already joined
  (`auth.users.last_sign_in_at`, `raw_user_meta_data.require_password_setup`):
  - **Invited** (slate badge) — `last_sign_in_at` still null; mail sent
    (`invited_at` shown in the badge), nothing else has happened yet.
  - **Opened invite — setting up** (amber badge) — `last_sign_in_at` is set
    but `require_password_setup` is still true. Supabase's invite link is a
    magic-link-style token: clicking it *is* the sign-in event, establishing
    a session before the invitee has chosen a password — so this is the
    only "did they engage with the invite" signal available without a
    transactional email provider's own delivery/open-tracking webhooks
    (Resend, Postmark, SendGrid, ...). Supabase's built-in mailer has no
    such tracking; a literal "opened in an inbox" pixel isn't available
    without adding one of those. The badge reports "clicked the invite
    link," worded that way rather than a plain "opened" to stay accurate
    about what's actually being detected.
  - **Active** (moss badge) — `require_password_setup` is false;
    `ResetPasswordPage.tsx` clears it once a password is actually chosen.
  Both non-Active states get a **Resend email** action (`invite-therapist`
  with `action: 'resend'`, recovery mailer → `/reset-password`) — unchanged
  from before, just re-keyed off `status !== 'active'` instead of the old
  boolean.
- **Revoke** unlinks any `therapists.user_id` pointing at the removed login.
- **Delete clinic** (Settings → Data → Danger zone): `admin_delete_clinic()`
  RPC — admin-only, disables invoice/visit immutability triggers, deletes the
  `clinics` row (ON DELETE CASCADE to all child tables). Distinct from
  `admin_wipe_clinic_data()` which keeps the clinic shell. Client clears
  local Dexie and reloads afterward.
- **Invite email content**: the invite also seeds `user_metadata` with
  `clinicName`/`invitedByName`/`role` (looked up server-side from
  `clinics.name` and the caller's `clinic_members.display_name`), but the
  stock Supabase "Invite user" email template doesn't reference these —
  the email stays generic (no clinic name, no "invited by") until that
  template is edited in the Supabase dashboard (Authentication → Email
  Templates → Invite user) to include e.g. `{{ .Data.clinicName }}` /
  `{{ .Data.invitedByName }}`. This repo has no way to edit that template
  from code — it's hosted-project configuration, not migration-tracked.

#### Clinic-Level Toggles (Settings → Features/Billing)
- **Billing access** — who's allowed to issue invoices
- **Therapist comparison** — visible to therapists (off by default)

---

### 7. Patient Management

#### Patient Creation & Lookup
- **Search by MRNO, name, or phone**
- **Create-if-missing** on visit entry
- **Walk-in MRNO auto-generation** (sequential per clinic per year)
- **Editable fields**: age, sex, phone, primary condition, referring source
- **Patients list toolbar** — embedded in `/ledger?tab=patients`: the All / My patients segmented switch, then search and two period selects: a **fiscal year** (current + two previous, or Custom range) and, within it, **Full year** (default) / **Year to date** (current FY only) / a month (current FY lists months up to now). Typing in search ignores the period (searches the whole directory). The list is **paged** (10 or 25 rows, remembered per device, back to page 1 on any filter/sort change) via `src/components/Pager.tsx` (`usePagination` + `<Pager>`), also used by Ledger → Visits (totals still cover every filtered visit, not just the page). The desktop table has no separate Phone column: the phone (tap to call) sits beside age / sex under the name, and the fixed column widths add up to ~1070px so it fits a 1280px screen without a horizontal scrollbar. Row actions use the shared pill ladder in `ui.tsx` (`pillPrimary` + Visit, `pillAttention` Needs invoice → opens that patient's visits in the Ledger, `pillAccent` Book, `pillNeutral` Remind).
- **Ledger polish** — (1) **Paging** (`Pager`/`usePagination`) also on Invoices (and its Needs-receipt list, 10/page) and Visits; (2) the Visits **totals strip** covers every filtered visit across all pages ("N visits across all pages"), docked at the bottom on all sizes (above the fixed phone nav, bottom-0 on desktop); minimal and adaptive (`summariseTotals` in `ledgerTotals.ts`, no progress bar or %): shows Billed and an interactive Due pill when dues exist, collapses to "N visits · ₹x collected · All clear ✓" when all paid, and "no charges" when bill is ₹0; the Due pill shows the unpaid visit count and functions as a two-way toggle (turns Not-collected filter on with solid rust active state, or off when clicked again); (3) a patient deep link shows a labelled **"Visits for Name (MRN) ✕"** chip (the duplicate "Clear filter" in the patient overview card is gone; "View profile →" stays); (4) the Ledger **remembers the last tab and Visits filters** per clinic on this device (`ledgerPrefs.ts`, localStorage `ledger:prefs:<clinicId>`: preset recomputed from today so it never goes stale, custom range kept, therapist dropped if removed; a Dues landing or `?patientId=`/`?tab=` always wins and never overwrites it) with a **Reset filters** link when anything differs from the default; (5) shared `EmptyState` (`src/components/EmptyState.tsx`) gives every empty Visits/Invoices/Patients list a reason and next steps (Show last month / Show all time / Clear filters / Clear search / Show full year / + New visit).
- **Patients list "Bill" column** — a patient-level summary (lifetime
  billed total, plus an outstanding-due figure when nonzero), not the
  latest visit's own status phrase or package-session detail — those stay
  exclusively on the Ledger/Workspace visits table and the Packages
  panel, which already show them in full. Same reasoning for "Last
  visit," which is just date + visit count with no per-session dots.

#### Patient Profile
- **Visit history** — responsive table (tab-and-up widths) / card list
  (phone) shared with Ledger and Workspace, with a "hide ₹0 visits"
  filter for package sessions billed as part of the package's own invoice,
  and bulk visit selection for issuing one invoice across several visits
- **Payments summary** — lifetime billed / collected / outstanding for the
  patient, alongside the outstanding-balance pill in the header
- **Billing-lock indicator** — a small lock icon on invoiced-but-unpaid
  visit rows, since their billing fields are frozen even though the
  payment chip alone ("Due") doesn't say so
- **Clinical notes section** — drilling into note editor
- **Package tracking** — open and completed packages, with days-since-last-visit
  shown next to the date so staleness doesn't require doing the math
- **Referring source** shown as a badge next to the outstanding-balance and
  condition pills (not buried in small text)

#### Patient Hiding & Deletion
- **Hide (soft delete)** — default remediation for duplicates/mistakes, propagates to all devices via outbox
- **Restore** — unhide a hidden patient
- **Hard delete** — zero-visit patients only, enforced server-side by RPC, online-only

---

### 8. Settings & Configuration

**File layout** (`src/features/settings/`): `SettingsPage.tsx` is only the shell (tabs, search, unsaved-changes guard); each area lives in its own file — `ClinicSections` (profile, region and agenda, hours), `BillingSections` (billing, partner), `BookingSections` (patient communications, public booking), `PlanSection`, `DataSections` (import, backup, danger zone) and `TeamSection` (team list, `TeamMemberCard`, add member, colors) — with the shared save mechanics (`useClinicSectionForm`, `SectionSaveBar`, `LockedSectionNotice`, `SetOnceEditButton`, `BoolToggle`, accent colors) in `settingsShared.tsx`. Older mentions of `SettingsPage.tsx` below refer to these files.

Admin-only, clinic-wide. One route, `/settings?tab=…`, with six sections in a fixed order (identity, then operations, then money, then system). The list lives once in `src/features/settings/sections.ts`; the router validates `?tab=` with its `parseSettingsSearch`.

| Tab | Contains |
|---|---|
| `general` | Clinic profile |
| `team` | Therapists, invites, logins |
| `services` | Catalog (`catalogView` = packages / treatments / referrals) |
| `booking` | Online booking page, WhatsApp, feedback |
| `billing` | Billing & invoicing (locked below the invoicing tier), Partner & split (hidden without `revenueSplit`) |
| `account` | Plan, historical data import, backup, danger zone |

Old tab values still resolve: `profile` → general, `patientComms` → booking, `partner` → billing, `catalog` → services, `plan` / `data` → account, `treatments` / `referrals` → services with that view. Chips on phones and iPad portrait, a side rail from `desktop:`. Unsaved edits warn when switching tabs (in-page dialog) and when leaving Settings or reloading (`useBlocker` + `beforeunload`). Personal settings (profile, password, notifications, working hours) are not here; they're in the account menu.

#### Clinic Profile
- Name, address, phone, email, GST number
- Logo upload
- Partner hospital name and logo
- Invoice prefix (e.g., "BM" → `BM/26-27/0001`)
- Revenue split % (BM share, default 75%)
- Tax % (default 10%)
- TDS basis selection (gross bill or BM share)
- Fiscal year start month (default April → FY 26-27)
- **Walk-in MRNO prefix** (configurable, defaults to 'W')

#### Catalog (Settings → Services)
Single settings section with three sub-tabs — **Services & packages**, **Treatments
performed**, and **Referral sources** — each using a set-once card pattern. Legacy `?tab=services|treatments|referrals`
URLs redirect to `?tab=catalog&catalogView=…`.

#### Clinic onboarding wizard (new self-service clinics)
- **Step 1** — Create clinic (`CreateClinicForm`): address required, progress “1 of 3”, then `/onboarding`.
- **Step 2** — Team: optional self-link on the service roster (“I treat patients”), therapist invite
  (same `invite-therapist` edge function as Settings).
- **Optional** — Google-only sign-in: skippable password step (`/onboarding?step=password`) before catalog.
- **Step 3** — Services: editable starter templates (`STARTER_CATALOG_TEMPLATE` in
  `onboardingCatalogTemplates.ts`) — same groups/names/session counts as the old RPC seed;
  admin sets prices and can add groups, singles, and packages before any `service_catalog` rows
  are written.
- Completion sets `clinics.onboarding_completed_at`; Shell **blocks all in-app routes** except
  `/onboarding` (wizard only), `/reset-password`, and public `/f/*` / `/book/*` until then.
  `create_clinic_with_admin` no longer inserts `service_catalog` rows (other catalog
  seeds unchanged). Existing clinics are backfilled as already complete.
- **Catalog draft persistence** — step 3 edits are stored in `localStorage` per clinic until finish
  (one-time migrate from legacy `sessionStorage` keys); catalog row ids reuse template draft keys so
  retries are idempotent.
- **Wizard phase** — `localStorage` tracks `team` → `password` (optional) → `catalog`; deep links
  cannot skip ahead of the phase reached. `/onboarding` is **admin-only** (non-admins redirect to workspace).
- **Therapist profile** — `/onboarding/profile` for any login linked to a `therapists.user_id` row:
  invoice name, registration no., phone. Completion sets `therapists.profile_confirmed_at` (synced).
  RLS `therapists_update_self` plus trigger `therapists_guard_self_update` limit self-updates to safe
  columns only.

#### Service Catalog (Services & packages tab)
- **Service groups** — stored as `category` on each row; UI shows editable group
  panels (rename rewrites all items in the group). New groups are created by name
  when adding the first service or package in that group.
- **Single-session services** (`session_count = 1`) and **packages** (`session_count ≥ 2`)
  per group — add via **+ Single session** or **+ Package** on the group header; session
  count and total price on each row (per-session rate derived for packages).
- Name per item — autocompleted group names via datalist when moving a row between groups
- Session count — editable after create; 1 = one visit, 2+ = package line on invoices
- Base price (in paise) — price changes affect future visits only
- **Duration (minutes, optional)** — `service_catalog.duration_minutes` (whole number 1–480, check
  constraint); per session for a package. Blank saves `null` = "count the whole session" in time
  reports. Shown on the row as "· 20 min" when set. The form rejects anything else inline
  ("Enter minutes between 1 and 480, or leave it blank.") and never sends it. It is snapshotted onto
  a visit's service line when entered, which is what utilisation reports read.
- Active toggle (deactivate, not delete) — inactive items are shown in their own
  collapsed "Inactive services" section below the active groups, not interspersed
- **Permanent delete** (`hard_delete_catalog_item` RPC) — admin-only, zero-history
  items only (blocked if any visit or visit service line references the row, same shape as
  `hard_delete_therapist`/`hard_delete_patient`); only offered once deactivated.
  A service with any usage must stay on Deactivate.
- Unique constraint per clinic

#### No-Return Reason Catalog
- Clinic-editable list of predefined reasons for patient no-shows
- Linked to visit records for reporting

#### Feature Toggles
- Therapist comparison chart (off by default)
- Billing staff restriction (on by default)

### 9. Patient Communications (Phase 0–5, plus Phase 9's Business API)

Full spec/roadmap: `docs/HANDOFF-patient-comms.md`. Phase 0 (foundation),
Phase 1 (visit "Ask for feedback"), Phase 2 (Requests → Feedback page),
Phase 3 (Google review nudge), Phase 4 (stale-package/single-visit
reminders), and Phase 5 (public booking → confirmed appointments →
Workspace "Expected today", folding in the doc's own Phase 6
reschedule/no-show/cancel actions since they share the same schema/RPC
surface) have shipped. Weekly availability/slot picker (Phase 7) and
analytics (Phase 8) remain later, un-started phases. Phase 9's WhatsApp
Business Cloud API is wired into all six patient-facing send actions —
see its own bullet below — but sends nothing for real until a clinic
configures it in Settings with a genuine Meta phone number ID, access
token, and at least one approved template name; until then every send
still falls through to the existing share sheet, unchanged.

- **`clinics.enable_patient_comms`** — module gate, off by default, same
  pattern as `clinicalDocsEnabled`/`enableExpectedToday`. Public token routes
  refuse to resolve when a clinic hasn't turned this on. Toggled from
  Settings → **Patient communications** (its own section/chip, admin-only —
  just the on/off switch for now; slug, Google review URL, message
  templates, and WhatsApp Business fields arrive with later phases).
- **`patients.do_not_message`** — opt-out flag, staff-settable, no automated
  detection. **Not actually checked anywhere client-side** — every send
  action (share-sheet and the Phase 9 Business API path alike) fires
  regardless of this flag; `doNotMessage` exists on `Patient` but nothing
  reads it. Pre-existing gap, not introduced by Phase 9's Business API
  wiring — flagged here rather than silently left implied-done by the
  field's own existence.
- **Public feedback link (`/f/$token`)** — the app's first and only
  anonymous write path. A therapist/front-desk/admin action creates a
  `feedback_requests` row with a server-generated 256-bit token; a patient
  opens `/f/$token` with no login, submits a 1–5 star rating and optional
  comment via `submit_feedback_response()`, and that's the entire
  interaction. Both public RPCs are rate-limited per IP and return an
  identical generic error for every failure case (invalid, expired, already
  responded, module off) — deliberately not distinguishable, so the endpoint
  can't be used to enumerate which tokens exist.
- **Feedback visibility is admin-only, at the RLS layer, not just the UI.**
  Front desk and therapists can see that a request exists/its status (no
  rating or comment content), but `feedback_responses` SELECT is restricted
  to `is_clinic_admin()` — this is a real access boundary, not a hidden menu
  item.
- **"Ask for feedback" trigger (Phase 1)** — an inline action on a visit
  row, next to the existing "+ Note" link (`VisitFeedbackLink` in
  `VisitCard.tsx`, kept inline rather than in the row's kebab menu, same
  convention as Note). Visible only when `enablePatientComms` is on and the
  viewer may act on that visit (`is_clinic_admin() OR is_own_therapist()`
  mirrored client-side, same shape as `canEdit`/`canSplit` — a per-row
  computed boolean, not a flat `Permissions` field, since the underlying
  RLS check is row-scoped). Also offered as a one-click button on
  `NewVisitPage`'s post-save screen, right after logging a visit.
  - **Creating a request is an online-only RPC,
    `create_feedback_request(p_visit_id uuid) returns table(...)`**, not
    Dexie + outbox. An earlier version went through the outbox (column
    default `generate_url_safe_token()` firing server-side, token
    round-tripping back on the next pull) — but that meant the very first
    "+ Feedback" click never had a token to share, so it never opened a
    WhatsApp share sheet at all; only Resend did. The RPC derives
    `clinic_id`/`patient_id`/`therapist_id` from the visit row rather than
    trusting the client, inserts (or, on a double-click race against the
    `feedback_requests_one_pending_per_visit` partial unique index, rotates
    the existing pending row — same `ON CONFLICT` shape as a fresh ask), and
    returns the full row in one round trip so the client can write it
    straight into Dexie (`putLocal`) and open the share sheet immediately.
    `security invoker`: the existing `feedback_requests_insert` RLS policy
    already gates who may call it correctly.
  - **Resending rotates the token via a dedicated RPC,
    `rotate_feedback_request_token(p_request_id uuid) returns text`** —
    column defaults never fire on UPDATE, so extending the 21-day expiry and
    generating fresh entropy needs a small online-only RPC instead of the
    outbox, the same reasoning `issue_invoice()` is an RPC rather than
    outbox-synced. `security invoker` (not definer): the existing
    `feedback_requests_update` RLS policy already gates who may call it
    correctly, so no elevated privileges are needed. One click both rotates
    the token and opens the WhatsApp share sheet with the new link
    (`feedbackService.resend`).
  - **Resend has a 3-day cooldown, client-side, no override.** Both create
    and resend stamp `feedback_requests.updated_at` to the moment the link
    went out, so the UI (`VisitFeedbackLink` in `VisitCard.tsx`) reads that
    as "last sent at" with no extra field: within 3 days it shows a plain
    "✓ Feedback" (no button at all), and only past that does "↻ Resend"
    appear. Deliberate — an easily-clickable resend invites back-to-back
    messages to a patient who just hasn't answered yet, so this is a hard
    floor rather than a confirm-to-override.
  - **Sharing** reuses the Web Share API + `wa.me` fallback pattern from
    `pdfShare.ts` (`shareTextViaWhatsApp`, the plain-text sibling of
    `shareFileToWhatsApp`) — no WhatsApp Business API required for v1. The
    message template is a hardcoded string for now; per-clinic template
    editing is a later phase.
  - **One pending request per visit** — the foundation's own unique index
    enforces this. A visit whose last request is `expired` offers
    "+ Feedback" again (a fresh row); a `pending` request offers "Resend"
    instead of creating a duplicate; a `responded` request shows a plain
    "★ Responded" marker instead of either — the same marker for every
    role, since the actual rating/comment stays admin-only at the RLS
    layer (rating is simply never populated client-side for a non-admin
    viewer — RLS filters the row out at the sync-pull level, not a
    client-side check).
  - The visit row's "★ Responded" marker only says a response exists, not
    what it says — see the **Requests → Feedback** page below for that.
- **Requests → Feedback page (Phase 2)** — `/schedule?tab=feedback`, admin-
  only (`SchedulePage.tsx`), lists every `feedback_responses` row with its
  rating (★★★★☆) and comment, joined locally against the already-synced
  `feedback_requests`/`patients`/`therapists`/`visits` tables for context
  (patient, visit date, therapist) rather than duplicating that data. A
  `Bookings` tab sits alongside it — a stub through Phase 4, real as of
  Phase 5 (see below) — matching the doc's own "Requests" naming/IA
  decision (one page for both workflows).
  - **`feedback_responses` is a synced-but-read-only Dexie table**, same
    shape as `invoices` (`ALL_SYNCED_TABLES` but not
    `CLIENT_WRITABLE_TABLES`) — a response is only ever written by the
    anonymous patient's own SECURITY DEFINER RPC call, never the client.
    The table originally had no `updated_at` column (responses are
    immutable, never updated) but the sync engine hardcodes `updated_at`
    as the delta column for every synced table, so a migration added one
    (`updated_at = created_at` always, a permanent alias for the sync
    engine's benefit, not a real "last modified" signal).
  - **Nav**: desktop gets a top-nav item, **Requests**, originally
    admin-only (Feedback was the only tab that existed) and widened at
    Phase 5 to admin + front_desk — front_desk's whole reason to be on
    this page is Bookings, its primary surface per the handoff doc's role
    table. (It was the sixth item when added; Settings has since moved to
    the account menu to get the row back within its width budget — see
    **Header layout budget** below — so it's the fifth now.)
    The mobile bottom tab bar is a separate hand-built 5-item row
    (Workspace/Schedule/+New/Ledger/More; Patients is in More), not driven by the same array,
    so this doesn't add a 6th phone tab; mobile reaches it via **More**
    instead (also widened to the same admin + front_desk gate), per the
    handoff doc's own "no sixth phone tab" decision. A front_desk viewer
    who lands on `?tab=feedback` directly is redirected to `?tab=bookings`
    rather than shown a disabled tab, per the doc's own resolved note.
    **Bookings is the first tab and the default landing tab for every
    role** (including admin) — it's the busier, more actionable surface
    day to day; the un-parameterized `/schedule` URL defaults to
    `?tab=bookings` rather than `?tab=feedback`.
  - **Workspace "new response" banner** — admin + module-on only, counting
    responses newer than the user's synced **`user_seen_markers`** "feedback"
    marker (see that table's section; it replaced a per-device `db.meta`
    "last viewed" timestamp, which made a new phone or browser show every old
    response as new) that gets stamped the moment `SchedulePage` mounts; the count is exported from a small
    `scheduleSignals.ts` module rather than `SchedulePage.tsx` itself so
    that reading it from the eagerly-bundled `WorkspacePage.tsx` doesn't
    pull the route-code-split Requests page into that eager bundle.
- **Google review nudge (Phase 3)** — `clinics.google_review_url` (nullable
  text; unset means the nudge never shows, even for a 4-5★ response). Two
  surfaces, both gated on rating ≥ 4 **and** the URL being set — 1-3★ never
  gets a Google button, anywhere, per the spec:
  - **Patient-facing**: the `/f/$token` thank-you screen shows "Leave a
    Google review" (a plain external link) when eligible.
    `submit_feedback_response()` itself decides eligibility and returns
    the URL (or `null`) as its result — the RPC's return type changed from
    `void` to `text`, so the migration drops and recreates it (grants
    don't survive a drop, re-stated explicitly same as the original). No
    second round trip or extra client-side rating logic needed; the public
    page just shows the button if the return value is non-null.
  - **Staff-facing**: an "⭐ Google review" nudge on the visit row, next to
    the "★ Responded" marker — a pure share action (`shareTextViaWhatsApp`,
    no DB write, no `message_log` entry), gated the same way.
    `VisitCardData.feedbackRequest.googleReviewEligible` is a bare boolean
    (not the rating itself), populated two different ways depending on
    role: an admin caller derives it from the synced, RLS-filtered
    `feedback_responses.rating` (`>= 4`), the same bulk fetch the
    "★ Responded" marker already uses. A front_desk caller has no rating
    available at all — `feedback_responses_select` is
    `is_clinic_admin()`-only, so the row never reaches their Dexie, not
    even filtered client-side — so they instead call
    `list_google_review_eligible_requests(clinic_id)`, a `security
    definer` RPC that answers "which request_ids currently qualify"
    without ever returning a rating or a comment. This closes the gap the
    Phase 3 slice originally shipped with (spec's send-table lists front
    desk as eligible to send; the first cut only worked for admins).
    `useGoogleReviewEligibleRequestIds` (`scheduleSignals.ts`) is the
    front_desk-only fetch — a one-shot RPC call on mount/clinic-change,
    re-run on window focus, skipped entirely for admin.
- **Re-engagement reminders (Phase 4)** — "No new detection" per the
  handoff doc: both surfaces reuse existing dashboard queries rather than
  adding a new signal. Pure `shareTextViaWhatsApp` actions, no DB write, no
  `message_log` entry, no booking link (public booking is a later phase,
  nothing to link to yet) — same shape as the Google review nudge.
  - **Stale packages** — a "Send reminder" button on `OpenPackageRow`s where
    `stale` is already `true`, in Workspace's Packages section at the bottom
    of the page (mobile card + desktop table; Stale filter). Ledger no longer
    duplicates a separate follow-up list. Gated on `clinic.enablePatientComms`.
  - **Single-visit patients** — a "Send reminder" button next to the
    existing `tel:` call link on Reports' single-visit-patients list
    (`dashboardService.singleVisitPatients`), gated the same way plus
    `p.phone` present — mirroring the existing call link's own gating,
    even though the share itself doesn't target that number directly (see
    below). Backed by `feedbackService.sendReturnReminder` (renamed from
    `sendSingleVisitReminder` once the Patients list below started reusing
    it for any stale patient, not just single-visit ones — the message
    text never claimed "first visit," so nothing else needed to change).
  - **Same reminder, reused on the Patients list** (`PatientsPage.tsx`) —
    a "Remind" action (table + phone card) next to Book, shown whenever a
    patient's own `visitStatsByPatient` entry is stale
    (`isStale(lastVisitOn)`, the same `STALE_PACKAGE_DAYS` threshold as
    the package follow-up queue) and they have a phone on file, gated on
    `clinic.enablePatientComms` same as everywhere else. Lets front desk
    nudge a patient they're already looking at without a detour through
    Reports; package-specific wording (`sendStalePackageReminder`) stays
    Ledger/Workspace-only since this view doesn't carry a per-patient
    service name to plug into that message.
  - **Deliberately not phone-targeted.** `SingleVisitPatientRow.phone` and
    the `tel:` link already on that row could in principle build a
    number-specific `wa.me/<digits>` deep link, but patient phone numbers
    aren't stored in a guaranteed international format (no confirmed
    country-code convention) — a malformed number there fails silently.
    Every WhatsApp share in this module (feedback link, resend, Google
    review, reminders) instead uses the same generic Web-Share-sheet
    fallback (`shareTextViaWhatsApp`) and lets staff pick the recipient
    themselves, consistent behavior across the whole feature rather than
    a special-cased, riskier path for reminders alone.
- **Package nearing completion** — `isNearingCompletion()` in
  `packageTracking.ts` (2 or fewer sessions left, package still open),
  threaded onto `OpenPackageRow.nearingCompletion` alongside the existing
  time-based `stale` flag. Purely an in-context "Renew soon" badge
  wherever package progress already shows (Workspace's package list/table,
  Patient Profile's care plan, the visit-logging patient overview, New
  Visit's package summary tile) — no separate Ledger filter yet, and
  `stale` still takes priority over it in the one place both could apply
  (Workspace's single status pill) since a package can't need
  re-engaging and be actively finishing up at the same time in any way
  staff should act on.
- **"Remind to pay" (Invoices page)** — a seventh `message_log` kind,
  `payment_reminder`, alongside a "Remind to pay" action next to "Record
  payment" on any outstanding invoice, gated on `clinic.enablePatientComms`
  same as the reminders above. Unlike those, this is staff-initiated on a
  specific invoice rather than driven by a staleness signal, so
  `feedbackService.sendPaymentReminder()` takes the amount due and invoice
  number as given rather than deriving anything. When the clinic has UPI
  collection configured (`clinicCanShowUpiQr`), the message includes a
  `upi://pay?...` deep link pre-filled with the balance due — this opens a
  UPI app when the *recipient* taps it on their own phone, but there's no
  payment gateway behind it (no order tracking, no confirmation webhook),
  so the invoice still needs to be marked paid by hand once money actually
  arrives.
- **Public booking, no slots (Phase 5, folding in the doc's own Phase 6)**
  — a public form collects name/phone/optional-therapist/preferred-
  day-time-as-text; front desk or admin confirms it by hand into a real
  scheduled appointment, which becomes Workspace's "Expected today". No
  slot picker/availability matrix — that's a later, separate phase the
  doc explicitly says not to start here.
  - **There was no legacy "Expected Today" to retire.** An earlier
    session fully dropped `expected_visits`/`clinics.
    enable_expected_today` (table, column, service, UI — zero
    consumers). The doc's "retire the legacy path" framing was moot by
    the time this phase shipped; Workspace's "Expected today" section is
    new, not a replacement.
  - **`clinics.booking_slug`** — nullable unique text, the public
    `/book/$slug` segment. Not a secret (meant to live on Google/the
    clinic's own website), unlike a feedback token — `get_booking_clinic_info`
    and `list_booking_therapists` just need the slug to exist and the
    module to be on, no rate-limited-oracle concern beyond the same
    generic-error/IP-throttle discipline every public RPC in this module
    uses.
  - **`appointment_requests`** — one row per public submission: `name`,
    `phone`, `email` (raw, unresolved against any patient), `preferred_
    therapist_id` (nullable), `notes` (free text — reason for visit,
    symptoms, anything else; deliberately its own column, not folded
    into the time preference — an earlier version of the form did that
    and silently dropped it whenever the patient didn't also tick
    "flexible"), `preferred_date` + `preferred_time_text`
    (both plain preferences — **no availability checking against either**,
    per the doc's "do not start here" on slots; front desk still picks
    the real `scheduled_at` by hand at confirm), `status`
    (`pending|confirmed|declined`), `appointment_id` (set on confirm).
    The form itself was redesigned mid-phase after reviewing a fuller
    reference design (richer than the locked spec's plain "name, phone,
    optional therapist, preferred day/time as text") — added email as a
    genuinely useful optional field, and gave the date/time preference a
    real date input plus a "flexible" quick-toggle, but deliberately did
    not adopt that reference's "pick a date to see available times"
    behavior, which implies real per-therapist slot availability the doc
    reserves for a later, separate phase. A `service_catalog_id` field
    and its `list_booking_services` RPC were added in that same redesign
    pass and then removed shortly after (dropped, not hidden — matching
    this repo's convention of not leaving unused scaffolding behind):
    the service picker didn't earn its place on a form patients fill out
    unauthenticated, and front desk already asks reason-for-visit via the
    `notes` field.
  - **`appointments`** — one row per confirmed expected attendance, **not**
    a billed visit. `patient_id` is **null from confirm until arrival** —
    identity is resolved exactly once, at arrival, reusing the existing
    New Visit typeahead rather than a confirm-time judgment call on a raw
    public submission. `patient_name`/`patient_phone` (the request's raw
    values) are kept on the row throughout, so it always has something to
    display before/without a resolved identity. `status`:
    `confirmed|rescheduled|no_show|cancelled|arrived`. `visit_id` is set
    only once arrival creates the real `visits` row.
  - **Both tables are synced-but-read-only Dexie tables** — same
    `ALL_SYNCED_TABLES`-without-`CLIENT_WRITABLE_TABLES` shape as
    `feedback_responses`/`invoices`, for the same reason: every write is
    an online-only RPC (public submit; confirm/decline; reschedule/
    no-show/cancel; mark-arrived/link-visit), never a client Dexie write.
    Both carry `updated_at` from creation (unlike `feedback_responses`,
    which needed one added after the fact) so the sync engine's
    hardcoded delta-pull column works from day one.
  - **RLS is SELECT-only for staff; every mutation is a `security
    definer` RPC with its own in-body role check**, not a matching RLS
    write policy — confirm/decline/reschedule/no-show/cancel need *admin
    or front_desk* (a new `is_front_desk(p_clinic)` helper, mirroring
    `is_own_therapist`'s shape), but marking an appointment arrived or
    linking it to a freshly-created visit needs the same broad membership
    check `visits_insert` already uses (`is_clinic_member`) — two
    different rules that don't map to one clean RLS policy, the same
    reasoning `list_google_review_eligible_requests` (Phase 3's
    front-desk-parity fix) already established. `appointment_requests`
    SELECT is admin/front_desk-only (matches who can reach the Bookings
    tab at all); `appointments` SELECT is clinic-member-wide, since it's
    the day list every role needs to see.
  - **Both tables also needed `created_by`/`updated_by`, added in a
    follow-up migration** (bug found live, not caught in review): the
    shared `set_updated_at()` trigger was redefined by an earlier,
    unrelated migration to unconditionally stamp `updated_by`/`created_by`
    on every row it fires for — it never checks whether the table
    actually has those columns. Every other synced staff table already
    carried them; these two were the first to attach the trigger without
    them, so any UPDATE (confirm, decline, reschedule, ...) failed with
    `record "new" has no field "updated_by"` until the columns were
    added, matching `feedback_requests`' own shape.
  - **Ten RPCs**: three public (`get_booking_clinic_info`,
    `list_booking_therapists`,
    `submit_appointment_request` — anon + authenticated grants,
    rate-limited); seven staff-only
    (`confirm_appointment_request` returns the new appointment id,
    `decline_appointment_request`, `reschedule_appointment`,
    `mark_appointment_no_show`, `cancel_appointment`,
    `mark_appointment_arrived`, `link_appointment_visit` — authenticated-
    only, explicit `revoke ... from public, anon` same grant-hygiene
    discipline as every RPC in this module). `link_appointment_visit` is
    the one `NewVisitPage.tsx` calls right after a visit saves, when that
    visit was started via `?appointmentId=...` — sets `patient_id`,
    `visit_id`, and flips `status` to `arrived` in one call. A visit started
    via `?appointmentId=...` also starts with **that appointment's therapist
    and date** (`visitPrefillFromAppointment` in `domain/schedule.ts`),
    applied once so a manual change sticks; the usual "whoever saw them
    last" default stands back for it (`appointmentSetsTherapist`) unless the
    appointment is unassigned or not on the device. **It is
    queued, not called inline** (`src/sync/pendingLinks.ts`, persisted in
    `meta`): `appointments.visit_id` is a foreign key to `visits`, and the
    visit only reaches the server on the next push, so calling the RPC right
    after the local save failed every time (and could never work offline).
    The sync engine sends queued links right after `push()` once the visit is
    no longer in the outbox, drops one only on a permanent error ("already
    linked", "not found"), keeps it through network failures, and
    `repos.appointments.listByClinic` overlays pending links (linked,
    arrived) so Workspace and Schedule already treat the appointment as done
    — no "in progress" row left to log a second time.
    **`create_appointment_staff(clinic_id, name, phone, therapist_id,
    scheduled_at)`** was added later, alongside the manual-booking form on
    the Bookings tab — same admin-or-front_desk check and
    `security definer` shape as the other six, but inserts straight into
    `appointments` with no `appointment_requests` row at all (`request_id`
    stays null): a staff member entering a booking by hand already knows
    the confirmed date/time/therapist, so there's no "pending" state to
    pass through first.
  - **Workspace → Two stacked cards (Appointments & Today's visits)** (`features/workspace/WorkspacePage.tsx`, `components/schedule/TodayAppointments.tsx`): replaces the Appointments/Visits tab switch with two stacked cards on every size — **Appointments** (top, header "Appointments · N left" or "Appointments · all done", action "Schedule →" on phones, "Open schedule →" from `sm:`) and **Today's visits** (below, header "Today's visits · N", unchanged `ResponsiveVisitList`). The Appointments card appears when comms is enabled or a walk-in is in progress. Inside Appointments: upcoming rows have a one-tap **Arrived** button (`pillAccent`); finished appointments fold under a single unified **Done today (n) · k logged · s no-show · c cancelled · d due** dropdown (default closed, remembered in `localStorage` `theranet:today-done-open`), containing labelled sub-lists for **Logged** (capped at 10 rows with "Show all"), **No-show** (with **Undo** via `pillDanger` and **Rebook** via `pillNeutral`), and **Cancelled** (with **Restore** via `pillAccent` when still ahead of time). Logged visits display read-only **Paid ✓** or **Due** markers (`hasDue(paymentState)` from `dueByVisitId`; collecting happens in the visits card below). The Arrived / Undo / Restore buttons are guarded per row (one request at a time). **Row layout**: from `sm:` a fixed time column, then name/detail, therapist (w-32), length (w-12) and a fixed-width (w-44, no-wrap) action column so rows line up; on phones the time sits inline on line 1 (`9:00 AM  Name  Next`) and the action button is compact (36px), with the reason, notes and `PatientFlagPills` on line 2. An in-progress row shows just **Complete visit** (the Arrived / Walk-in word is already on line 2). Row actions use the shared pill ladder with 44px mobile touch targets (`min-h-11 sm:min-h-8`). When nothing is pending and all finished, the Appointments card shrinks to just the single collapsed "Done today (N)" fold without duplicate text, letting Today's visits take over the screen. Carried-over appointments from earlier days completed today land under the Logged sub-list with date displayed under time.
  - **Restoring no-shows and cancellations** (`20261014120000_restore_appointment_status.sql`): `restore_no_show_appointment` (no_show -> confirmed, or rescheduled when `reschedule_count > 0`; a no-show still holds its slot, so it cannot clash) and `restore_cancelled_appointment` (cancelled -> same, only while the time is in the future; the slot was freed, so `appointments_overlap_guard` re-checks it on the status change and refuses if someone booked it since). Both need `can_manage_appointment`, refuse an appointment that already has a visit, and are authenticated-only. `reschedule_appointment` now also accepts a `no_show` appointment (a patient who calls back rebooks from the same card). **Guards** (`20261015130000_restore_and_arrived_guards.sql`): `mark_appointment_arrived` now uses `can_manage_appointment` (it only checked membership, so a therapist could mark another therapist's appointment arrived through the API), and `restore_cancelled_appointment` also refuses an inactive therapist and a day the clinic has since closed (closed weekday or `clinic_closed_dates`). UI: the appointment panel shows **Undo no-show** and **Reschedule** on a no-show, and **Restore appointment** on a cancelled one (managers only). Series restore is not provided.
  - **Undo arrived** (`20261022140000_restore_arrived_appointment.sql`): "Mark arrived" pressed by mistake is reversible. `restore_arrived_appointment` moves `arrived` back to `confirmed` (`rescheduled` when `reschedule_count > 0`); an arrived appointment still holds its slot, so it cannot clash. Needs `can_manage_appointment`; refused when a visit already exists (the visit would point at an appointment that "never happened" — delete the visit first) and for walk-ins (created as `arrived`, no booked status to return to — cancel them instead); authenticated-only. The same migration makes `appointments_push_trigger` and `trigger_notify_therapist` skip a change that comes *from* `arrived`, so undoing never sends the therapist a "new appointment" push or email; `20261022150000_quiet_status_undo.sql` extends that to **undo no-show** (`no_show` back to confirmed/rescheduled) — the skip applies only while `scheduled_at` is unchanged, so a no-show rebooked to a new time still notifies. UI: **Undo arrived** beside the amber "Complete visit…" note in the appointment panel, and an **Undo** pill on in-progress rows of Workspace → Today (`TodayAppointments` `onUndoArrived`); both are hidden for walk-ins, for people who cannot manage the appointment, and once a visit exists.
  - **Schedule MVP permission and duration rules** (`20261001100000_schedule_mvp.sql`): `appointments.duration_minutes` (5–240, backfilled from the clinic slot length) — every overlap check, client (`appointmentsOverlap`) and server (`therapist_has_overlap`), uses **each row's own length**, ignoring cancelled rows. `can_manage_appointment(clinic, therapist_id)` = admin OR front desk OR `is_own_therapist`; `confirm_booking_slot` (now with `p_duration_minutes`), `reschedule_appointment` (now with optional `p_duration_minutes`), `cancel_appointment` and `mark_appointment_no_show` all use it, and only admin / front desk may pass a `p_request_id`. Both RPCs were drop-and-recreated per pattern 3c. **Fixed**: `confirm_booking_slot` / `create_appointment_staff` used to check `p_therapist_id` (a `therapists.id`) against `clinic_members.user_id`, which rejected every booking; they now check `therapists` (same clinic, active). `create_appointment_staff` now delegates to `confirm_booking_slot`.
  - **`bookingService.ts`'s eight staff-mutation wrappers all call
    `syncEngine.schedule(0)` right after their RPC succeeds** — found
    missing in the same post-ship workflow review, not present originally.
    `appointment_requests`/`appointments` carry no outbox (see
    `src/lib/db.ts`'s comment on why), so nothing tells the sync engine to
    pull after one of these RPCs the way a normal Dexie write does;
    without an explicit kick, confirming/declining/rescheduling/marking
    no-show or cancelled or arrived/linking a visit/creating a manual
    booking would all succeed server-side while the Bookings tab's
    `useLiveQuery`-driven lists (and Workspace's "Expected today") kept
    showing the pre-mutation state for up to 5 minutes — e.g. a just-
    confirmed request still listed under "Pending requests" with its own
    Confirm/Decline buttons, inviting a double-click. `schedule(0)` is the
    same near-immediate debounced pull the manual "Sync now" button and
    `CreateClinicForm`'s post-create refresh already use.
    `feedbackService.ts` didn't need this fix — it already writes the
    RPC's returned row straight into Dexie via `putLocal()` (see its own
    file comment) rather than waiting on a pull, but most of the booking
    RPCs return only void or a bare id, not a full row, so a pull kick was
    the simpler fix here than adding `putLocal` to both booking repos.
  - **All five appointment-mutating RPCs (reschedule/no-show/cancel/
    mark-arrived/link-visit) row-lock and check the appointment's current
    status before acting**, same discipline as
    `confirm_appointment_request`/`decline_appointment_request` already
    had — found missing during a post-ship workflow review, not shipped
    this way originally. Without it, two staff acting on one appointment
    at once, a stale browser tab, or a double-click could flip an
    already-arrived appointment (with a real linked visit) back to
    `no_show`, resurrect a cancelled one via reschedule, or double-link a
    second visit onto one appointment row, silently overwriting the first
    `visit_id`. The UI already only offers each action from the right
    states; this closes the gap server-side too.
  - **`NewVisitPage.tsx`'s existing `?prefillName=...` mechanism grew a
    `?prefillPhone=...` sibling** (feeds `newPatient.phone` the same way
    `prefillName` feeds `newPatient.name`) plus a new `?appointmentId=...`
    — "Create visit" links from an appointment row pass all three, so the
    same existing search-or-create typeahead this mechanism already
    drives surfaces likely-existing-patient candidates for free; staff
    still explicitly pick or create, never auto-selected (no silent
    find-or-create by phone, per the doc's explicit-scope list).
  - **Schedule (`/schedule`, `ScheduleBookingsView.tsx` + `features/schedule/`)** — the clinic calendar. Tablet/desktop-first for the front desk (Athena-style therapist columns, Google-Calendar details panel, Calendly-style free times); phones get an agenda list. The nav item stays "Schedule". URL state: `?view=schedule|requests|history`, `?mode=day|week`, `?date=YYYY-MM-DD`, `?therapist=<id>[,<id>…]` (empty = everyone); every change uses `replace`, so Back leaves the page.
    - **Who sees what**: admin / front desk see every therapist plus Requests and History. A **therapist** sees "My schedule" (their own column by default, always kept) and History scoped to themselves; they can add colleagues from the therapist filter to see when colleagues are booked and which patients they see — **read-only**: those columns are headed "view only", show patient name, time and status only (no flags, reasons or notes), offer no free slots to book, and can't be moved into; opening a colleague's appointment shows name, time, therapist and status but never the patient's phone, call/WhatsApp actions, condition, notes or manage actions (`canManage` gates the details panel); they can book for themselves for any clinic patient or a new patient, and reschedule / cancel / mark no-show their own appointments. Requests stay admin / front desk. An unlinked therapist login gets a "ask your admin to link your login" message. The server enforces all of this (`can_manage_appointment`, below); the UI only mirrors it.
    - **Layout by width**: from `desktop:` (1000px) a left rail (`ScheduleRail`, each section a white card on the paper page) holds a mini month (up to three teal load dots under each day by bookings — `loadDots`: 1–2 → 1, 3–5 → 2, 6+ → 3; a rust corner dot on future days that are fully booked; closed days with a fine hatch; today ringed; selected solid teal; weekends' letters dimmed), therapist toggles with the day's load ("6 · 4h30"), and upcoming closures. Below `desktop:` the Monday–Sunday `MiniCalendarStrip` replaces the month, and therapist chips replace the toggles. From `tab:` (744px) the Day view is `ResourceDayGrid` — one column per therapist, blocks absolutely positioned and sized by `duration_minutes` (`blockGeometry`, 1.6px/min), free slots tinted and clickable (opens the booking sheet prefilled with date, time and therapist), a current-time line on today, closed days hatched with their label, overlapping blocks side by side (`assignLanes`; only the synthetic Unassigned column can overlap). **Phones (below `tab:`)** have two views, **Day** and **3-Day**, remembered per device in `localStorage` `theranet:schedule-phone-view` (default Day; an old stored `list` means Day). **Day is always the proportional grid** (`MobileDayGrid`), for one therapist (one full-width column with **no axis column**: one continuous rail line inside the column carries the hours as "9 AM", the scale is 80px per hour — a 30-minute block is 40px, `phoneSingleColumnPxPerMinute` — and `WideBlock` lays each card out by its height: under ~28px one line "10:00 Name"; to ~52px two lines, name with the time range then the reason (or the flags when there is no reason); taller, three lines with up to two flag pills; the Now badge sits on the rail so it never covers card text) or several (one column per therapist, columns at least 96px with sideways scroll beyond that, time scale `max(1.6, 44/slotMinutes)` px/min so a free slot is always at least 44px tall, free time visibly tinted, block detail adapting to the measured column width — full ≥150px, medium 110–149px, name-only below — and a Now line with a time badge on the axis). **Free time is literally empty**: a light tint with no text, no "+" and no buttons, tapped to book (a dismissible one-line hint explains it); appointments that ended before now fade to 75% so a morning reads as done and names stay readable; the one-column Day also draws faint dashed half-hour lines, and its hour label steps aside while the Now badge sits on it. On phones, grids of up to three columns (one-therapist Day, 3-Day, up to three therapists) have no scroll box of their own: the page scrolls, the column headers stick under the app header, and the tab row scrolls out of the way; wider grids keep an inner scroll box for sideways scrolling. The grids open on "now" (or the first appointment) once; changing the date or view never moves the page. The column headers stick under the app header at its measured height (`--app-header-h`, published by the shell from `src/lib/appHeaderHeight.ts`), and the "Tap a free time to move" bar is pinned above the bottom nav so its Cancel stays in reach. On phones a therapist's "My hours" is in the ⋮ menu (the tab row keeps just Schedule · History). The Now line is 1px at about 55% strength (the dot and the axis badge stay solid) so it never hides text. There is no separate list view on phones any more; Find a time is the free-slot list: in the ⋮ menu on phones, and a visible button in the tablet / desktop toolbar (`ScheduleToolbar`, same control order as the phone toolbar, day view only) that swaps the grid for `FindTimePanel`. And **3-Day** (`MobileThreeDayGrid`: one therapist, three date columns, header tap opens that day; it shows the therapist picked in the toolbar chip, which in 3-Day is a single-choice sheet with each therapist's booked count for the three days (default: the viewer's own therapist, else the first in the current selection; the pick is local, the URL filter is untouched so Day still shows everyone). Day headers show up to three load dots (`loadDots`), and blocks 45+ minutes tall show their start time even at compact width). Hold-and-drag move, booking and the details panel work as on tablet in both grid views. `PhoneScheduleToolbar` is one row with no date headline: the therapist chip (`TherapistFilter showLabel sheet`: "All therapists" / the name / "2 of 3 therapists"), the Day·3-Day switcher and the ⋮ menu. The chip opens a **bottom sheet** on phones (`Panel`: a row per therapist with a checkbox, colour dot, name and day summary, an "Only" shortcut, Show all and Done) because the popover could run off a narrow screen; desktop and iPad keep the popover. The ⋮ menu (`ScheduleMenu`) is a bottom sheet on phones — rows 52px tall with an icon, label and one-line hint, grouped View (Find a time, Show cancelled), Do (Send reminders, Add to waitlist) and Manage (Set closed days, Assign shift, Working hours; admin and front desk only) — and a compact popover with the same groups on tablet and desktop (plus Keyboard shortcuts on pointer devices). `PhoneStatusLine` sits under the week strip: "Today · 2 booked · 1 to come", "Tue, 20 Oct · No appointments" or "19 – 21 Oct 2026 · 3 booked", with "↩ Today" at its right end only when away from today. The Monday–Sunday week strip (`MiniCalendarStrip`) is always shown on phones and is the date navigation (tap a day, ‹ › or swipe for the week); in 3-Day it highlights the three visible days as one connected range (`rangeDays`). **Book** on phones is a round floating button (`BookFab`) above the bottom nav that slides away while scrolling down and returns on scroll up; the tab-row "+ Book" starts at `tab:`. The URL `mode` stays `day|week` (3-Day is phone-only local state). **Who admin / front desk see by default** (Day, no therapist in the link): the therapists they last chose on this device (`localStorage` `theranet:schedule-therapists:<clinicId>`, written whenever they change the filter; "Show all" clears it), else everyone, minus anyone with no working time and no appointment that day (`defaultTherapistSelection`, `workingTodayIds`). It is display-only (the URL is not rewritten, so no history entry) and the status line says "2 off · Show" (tablet and desktop add "today" when viewing today); tapping it, or choosing "Show all", shows everyone for the session without touching the saved choice. Week and therapist logins keep today's behaviour (therapists default to themselves). The pure helpers are in `src/features/schedule/schedulePhoneHelpers.ts` (`densityFor`, `phonePxPerMinute`, therapist selection, 3-day dates). Below `tab:` the List view is `AgendaList` (time-ordered rows, now divider, free gaps inline when one therapist is in view) and "Find a time" shows `FindTimePanel` (free start times as buttons per therapist). In Week view the desktop left panel is hidden so the day columns get its ~240px (`showRail` is false when `mode=week`); the toolbar headline opens the month calendar (`MiniMonth`, also available in Day), the therapist chip shows at every width, and the booking-requests strip replaces the rail's requests card. Week view (from `tab:`) is `WeekTimeGrid`: 7 day columns with one shared time axis, drag across days. With one therapist in view it is that therapist's week. With several (no cap) the same grid shows everyone's appointments at their real times: each block carries a therapist pill (short name; the therapist's colour is the left edge), simultaneous appointments sit side by side, at most 3 lanes per cluster (`capLanes` in `src/domain/laneCap.ts`) with a "+N" chip that opens a list (therapist, patient, time; tap to open details), and lanes narrow the content in steps: 72px and up show therapist pill, patient and start time; 40–72px show the patient's first name with the therapist's short name under it; under 40px only the patient's initials (every block keeps a full accessible name). Free time is tinted where at least one therapist the viewer can book for is free and working; time nobody works stays blank. Tapping it opens the booking sheet with the date and time set and the therapist list limited to those free then (`onlyTherapistIds`). Dragging keeps the appointment's therapist (it can only clash with that therapist's own appointments); moving to another therapist stays a Day-view action. The Day/Week toggle and the `w` shortcut are always available from `tab:`; phones never show Week (they have Day and 3-Day, above). The old 7-card week board was removed.
    - **Colours** (existing tokens only, never colour alone): block left bar = therapist (`therapistColor`, the `chartColors.ts` palette by roster order); fill = status (`APPOINTMENT_BLOCK_STYLE`: confirmed teal-light, rescheduled teal-light + ↻, arrived moss-light + ✓, no-show rust-light + ✕, cancelled slate-light struck through and hidden unless "Show cancelled"); free time moss-light; closed = slate hatch + label; now line rust.
    - **Telling same-name patients apart**: the Patient ID (`mrno`) shows beside the name in the appointment panel, Today's appointments and History (`usePatientDirectory.mrnoFor`), and every patient picker (Book, Start note, New visit) lists name · ID · age sex · condition · phone. Creating a patient in New visit, Book or Start note runs `findSimilarPatients` (same phone by last 10 digits, or a name at least 85% similar, up to three, hidden patients skipped) and shows `SimilarPatients`: each match with ID, age and sex, condition and last visit, plus **Use this patient** and **Different person**. Saving is blocked until one is chosen; New visit and Start note then also require age and sex for a different person (Book has no such fields, so it only records the choice). **Clinic region and server times**: Settings → General → **Region** sets `clinics.timezone` (default Asia/Kolkata) and `clinics.default_country_code` (default +91). Every server-side "today", "8 pm" or clock time is computed in the clinic's zone through `supabase/functions/_shared/zoned.ts` (edge functions run in UTC, which once made a 9 AM booking read "3:30 am" in an email); the public booking page gets the zone from `get_booking_clinic_info` and `clinicNow(date, timeZone)`; `restore_cancelled_appointment` checks closed days on the clinic's local date. Staff screens still use the device's clock. **Push notifications** (`send-push`) name what happened and when ("New appointment · Ananya Rao · Tomorrow, 10:00 am"), one notification per change except that bookings for one therapist inside five minutes share a tag and read "3 new appointments"; tapping opens `/schedule?…&date=…&appointment=<id>` (the schedule opens that appointment's panel once, `?appointment=` in the route's search); nothing is pushed from 11 pm to 6 am clinic time except changes to today's appointments, so booking requests that arrive overnight are summed up in one "N new booking requests came in overnight" push to admin and front desk in the first quarter hour after 6 am (`send-agenda`'s 15-minute run calls `send-push` with `overnight_requests`, which counts pending `appointment_requests` since 11 pm); a subscription that answers 403 is deleted when other sends in the same batch worked (`subscriptionsToRemove`); people with `hide_patient_names` get the time without the name. **Daily agenda** (the clinic's choice: Settings → General → Region and agenda, `clinics.agenda_enabled`, default on, and the send hour `clinics.agenda_hour`, default 8 pm, chosen from 4 pm–10 pm; therapists only choose their own per-appointment email in Notifications): pg_cron calls `send-agenda` every 15 minutes; for a clinic whose local hour equals `agenda_hour` it emails each therapist with a login one list of tomorrow's appointments plus one `.ics` (event UIDs match the per-appointment invite), once per therapist per day (`agenda_log`). **Therapist colors**: a therapist's schedule color (`therapists.color`, default = a palette color picked from the ID by `therapistColor`) is chosen with `TherapistColorPicker`: the eight validated swatches from `chartColors.ts` (each marked with the therapist already using it), a "Custom…" color that must have a contrast of at least 1.8 against white (`isReadableColor`), and a live preview. It appears in Settings → Team → edit, and in a `TherapistColorSheet` opened by tapping a therapist's color dot in the schedule's column header (admins for anyone, a therapist for their own column; the server's therapists update policy enforces the same). New roster-only and onboarding therapists get `nextUnusedColor` so two therapists don't share a color; Settings → Team shows a notice (`colorClashes`) when active therapists do, with "Give X a new color". With more than eight therapists colors repeat. **Phone entry**: every staff-side phone field (Book, Start note, New visit including the alternate phone, the waitlist sheet, Edit patient and its alternate phone, the clinic phone in Settings and Create clinic, and therapist phones in Settings, My account and onboarding) uses `PhoneField` (a compact "+91 ▾" country picker plus the number). The value stays one string in the stored form `"+91 9876543210"` (`joinPhone`/`splitPhone` and the code list live in `src/domain/countryCodes.ts`, shared with the public booking form); numbers saved without a code read as the default country's, and phone comparisons use the last 10 digits. The default code is +91 until a per-clinic setting exists. **`AppointmentDetailsPanel`**: tapping a block/row opens a right-side panel (tab+) or bottom sheet (phone) holding every action. Facts first, in reading order: the patient (condition and the patient's request note in a soft card; the phone number is not printed, Call dials it and shows it as a tooltip), then the therapist (dot + name, with a small **Message** button on the same line when they have a phone), then the booking ("Thu, 1 Oct · 10:00–11:00 AM · 60m", `lengthLabel`) and "Moved from" only when a reschedule actually changed the time. Then **one main action by state** — "Mark arrived" (moss) before arrival; once arrived, "Complete visit" (teal) — with **Add note** and **Create visit** side by side as the secondary pair (Create visit becomes the teal Complete visit after arrival). Below a rule, a row of four icon quick actions: Call, Remind (WhatsApp), Reschedule and No-show (manage rights only). The footer holds Copy details and, for managers, a rust "Cancel appointment" text link (via `ConfirmDialog`); a one-line hint asks managers to add the therapist's phone when it's missing. Close is an ✕ icon. Blocks and rows themselves only show name, time, length and status.
    - **Grid file layout** (`src/components/schedule/`): `TimeGrid.tsx` holds the grid frames (`ResourceDayGrid`, `WeekTimeGrid`, `TimeAxis`); one column is `DayColumn.tsx`; touch/mouse drag and resize is `useGridDrag.tsx`; their shared types and constants (`GridColumn`, `DragGhost`, `PX_PER_MINUTE`, …) are in `gridShared.tsx`. `TimeGrid.tsx` still re-exports the old names, so imports from it keep working.
    - **Grid behaviour**: free time carries a light tint on every device (moss green, slate outside working hours), with "+ time" on hover and a faint "+" on touch screens; the grid opens at the top and only auto-scrolls when "now" (today, within booking hours) or the first appointment would be off-screen (`initialScrollTop`), and only once per date — never while the user is scrolling. Free-time offers (agenda gaps, Find a time) start on the clinic slot grid (`freeGaps(…, { alignToSlots: true })`), not at "now" or right after a 45-minute booking. Below `desktop:` the header drops Today/‹/› (the week strip has them) and Show cancelled / Set closed days move into a ⋮ menu. Declining a request uses `ConfirmDialog`.
    - **Patients list "Book"** opens the same `BookSlotSheet` with the patient pre-selected (`prefilledPatientId`) and their last therapist pre-picked; the old `BookAppointmentDialog` (free datetime field, "No preference" therapist the server now rejects) was removed, along with the unused `bookingService.createAppointmentStaff` wrapper — the RPC remains for older clients.
    - **Keyboard (tab+)**: `t` today, `d` / `w` day/week, ←/→ previous/next, `?` shortcuts help, Esc closes panels and sheets.
    - **Notifications (in-app, no calendar feed)**: WhatsApp via wa.me, one tap per recipient. Wording lives in `src/domain/bookingMessages.ts` (tested); therapist messages use the patient's first name + surname initial only. The booking/reschedule toast offers "WhatsApp patient" and "Notify therapist" (needs `therapists.phone`); the details panel has "Remind", "Message therapist", and after a cancel "Message patient" / "Message therapist". `ReminderSheet` (header "Reminders" on desktop, ⋮ → Send reminders elsewhere; admin/front desk) lists a day's live appointments with a Send per patient and a "Send list" day summary per therapist, ticking to Sent for the session.
    - **Install nudge**: `useInstallPrompt` + `InstallAppBanner` on Schedule and Workspace — phones only, not already installed (standalone), from the second visit, "Not now" snoozes 14 days (localStorage, per device). Android/Chrome uses the captured `beforeinstallprompt`; iPhone shows Share → Add to Home Screen.
    - **No-show history**: `patientAttendance` (last 6 months, by patient id, else last 10 phone digits; past appointments only) feeds `AttendanceNote` in the details panel and booking sheet ("2 no-shows, 1 cancelled… consider calling to confirm"); History rows badge patients with ≥2 no-shows. The booking sheet also warns when the patient already has an upcoming appointment (`nextAppointmentFor`).
    - **Requests inbox**: `RequestsInbox` — a collapsible "N booking requests · oldest 2h" strip above the calendar below `desktop:`, and a Requests section in the rail on desktop; Confirm opens the booking sheet on the requested date (if not past) with the preferred therapist; Decline uses `ConfirmDialog`. **Chrome: two rows.** (1) `ScheduleTabs` (`src/features/schedule/ScheduleTabs.tsx`): Schedule ("My schedule" for therapists) · History · Feedback (admins) on the left, page actions on the right (My hours for therapists, Reminders from `tab:` for admin/front desk, + Book). The page title is screen-reader only. URLs are unchanged (`?tab=bookings&view=schedule|history`, `?tab=feedback`). (2) The day toolbar, in the grid column so the desktop rail lines up with it: ‹ › (from `tab:`), the date as a display-font headline ("Thu, 1 Oct" on phones) with a "Today" marker, a plain summary line ("10 booked · 5 to come · 3 arrived · 1 no-show"), a Today button when away from today, then `TherapistFilter` (below `desktop:`, a popover of checkboxes replacing the old name-chip row), Day/Week, and ⋮ (show cancelled, send reminders on phones, closed days, working hours per therapist, keyboard shortcuts). Below `desktop:` the week strip (`MiniCalendarStrip`) is one row: ‹ days ›, with appointment counts as up to three dots (exact count in the label). **Therapist load**: each grid column header and rail row shows `LoadLine` (`src/components/schedule/LoadLine.tsx`), a capacity bar (booked ÷ working minutes) with a caption from `dayLoad()` in `src/domain/schedule.ts` that says the next useful thing. Today: "4 free now", "3 free from 2:30 PM", "Break till 2:00 PM" (between two working intervals), "1 free from …" (the amber bar says nearly full), "Fully booked"; once the day's working hours are over, a quiet recap "Finished · 6 seen" (no-shows not counted) or "Finished today". Other days: "6 free", "1 free", "Fully booked". Any day: "Off today" / "Day off" (no working hours), "Closed". `tone` colours the bar and caption: the therapist's colour, amber from 70% booked or one slot left, rust when full, grey (`done`) once today's hours are over, no bar when off or closed.
    - **Patient flags and condition** (`src/domain/patientFlags.ts`, loaded once per screen by `usePatientFlagContext` in `src/components/schedule/`): `patientFlags()` → "New patient" (unlinked, or no visits on record), "Package 3/6" (the session this appointment is), "Balance due" (an outstanding invoice, matched by patient ID), "N no-shows" (2+; a rust dot in lists). `PatientFlagPills` shows up to 2 in Today rows and the phone agenda, 1 in History, all in the details panel. `appointmentReason()` gives the condition on file (primary condition, else the latest visit's), else the booking request's note as "Patient says: …"; it's the second line of Today, agenda and History rows, line 3 of grid blocks an hour or longer (and their tooltip), and "Condition" / "Patient says" in the details panel. Grid blocks show the time range only (no "· 1h").
    - **History** (`HistoryView`, `src/components/schedule/HistoryView.tsx`): two control rows. (1) A Past / Upcoming pill switch (teal when selected, as the Ledger's) beside the search field. (2) One row — scrolling sideways on phones — of pill selects (Last / Next 7, 30 or 90 days or a chosen date, whose date input then sits inline; status; therapist for admin / front desk) and, after a thin divider, the past's tappable outcome counters (attended / no-shows / cancelled; a zero counter is hidden unless it's the active filter). Then rows grouped by day ("Yesterday", "Tue, 29 Sept") in one bordered list with the Schedule colour code, flags and condition, and "Show more" every 50.
    - **Phones**: the tabs row shows Schedule · History · Feedback and + Book (Reminders from `tab:`, in ⋮ on phones); "Find a time" lives in ⋮ and in the empty-day card; on a closed day with nothing booked the empty card is the closed notice ("Closed every Thursday. Public booking is off. You can still book here.") instead of a banner plus a card. **Blocks show status by fill** (`appointmentFill`, shared with Workspace's Today rows): upcoming = white card with the therapist's edge; arrived without a visit = tinted in the therapist's colour; visit logged = grey; no-show = rust; cancelled = struck through. `.chip-row` sits in `@layer components` in `index.css` so Tailwind display utilities can hide it (unlayered, it beat `desktop:hidden`). There is no Requests tab: "See all" / "All" (and `?view=requests`, e.g. Workspace's Review link) opens the full list in a `Panel`.
    - **History**: Past / Upcoming toggle, a since/until date, day headings, outcome counts (attended / no-show / cancelled), search, status and therapist filters.
    - **Booking sheet extras**: "First available →" (`firstAvailableSlot`, next 21 days, respects closures, working hours and length); the submit button carries the summary ("Confirm booking · Thu, 1 Oct, 10:30 AM · 30m"); sticky footer on phones.
    - **Working hours and booking outside hours** (`therapists.working_hours`, see schema): the grid shades non-working time (paper) and offers free slots inside it as normal, while off-hours empty cells remain clickable with a dimmer look and explicit aria-label. Staff can visibly book outside hours in both `BookSlotSheet` and the schedule grid. In `BookSlotSheet`, slot generation covers an extended day window based on `bookableWindow`: clinic hours ± `staffBookingBufferHours` (default 3, clamped 0–12; 0 disables booking outside clinic hours) plus the therapist's own hours (if their shift extends further), and the hard `runsPastClose` disable is removed (past times and occupied slots stay disabled). Outside-hours slots are grouped into a single toggle button "Outside hours (N)" that expands into Morning, Afternoon, and Evening groups (auto-expanded if the therapist has no working hours that day or if an outside slot is selected). Booking or rescheduling to an off-hours slot shows a `ConfirmDialog` ("Outside Dr X's hours... Book anyway?" or "Outside clinic hours. Book anyway?"); cancel keeps the sheet open. Dragging or moving an appointment to an off-hours slot in the grid asks the same confirm via `pendingMove`. The schedule grid dynamically extends its vertical hours (`displayHours`, computed via pure `displayHoursFor`) by the staff booking buffer (`staffBookingBufferHours`) on both sides of clinic hours — so a block can be dragged or stretched past closing/before opening (drag and resize clamp to the grid range) — and further to cover the working hours of the therapists in view (a shift running past clinic hours still gets rows) and any early or late bookings beyond that so they are not clipped, strictly filtering to the current week in week mode. Closed days and past times remain blocked; double-booking is still prevented by occupancy checks. Single bookings may go outside therapist or clinic hours after a confirm; repeat (series) bookings cannot. Public booking remains strictly restricted to working hours. Admin/front desk configure the staff booking buffer in Settings → Hours & closures, and assign shifts or custom hours directly from Settings → Team or the schedule kebab.
    - **Repeat bookings**: booking sheet "Repeat this booking" — weekday chips + session count (defaults to sessions left in the patient's open package via `dashboardService.openPackages`), a per-date preview (`seriesDates`, `seriesProblem`) marking clashes / outside hours / past with "Find a time" or "Skip" per date; submits via `confirm_booking_series` (all-or-nothing). The details panel shows "Session k of n" and offers "Cancel this and all following sessions" (`cancel_appointment_series`). Single bookings may go outside therapist or clinic hours after a confirm; repeat (series) bookings cannot.
    - **Start times vs. length** (`clinics.start_step_minutes`, Settings → Hours & closures → "Start times every", 15 / 30 / same as duration; helper `startStepMinutes(clinic)` in `schedule.ts`): `slot_duration_minutes` is the default appointment length (and the length of legacy rows with none); the start step is how often *staff* can start one. The schedule grids (`stepMinutes` prop on `ResourceDayGrid` / `WeekTimeGrid` / phone grids → free-time tint and tap-to-book), Find a time (`FindTimePanel`), the phone free-gap list (`freeGaps` `alignStep`) and the `BookSlotSheet` time list use the step; free time must still hold the default length where a booking is made. The booking sheet's length chips are 15 / 30 / 45 / 60 / 90 (plus the clinic default and a rescheduled appointment's own length). **Public online booking is unchanged and keeps `slot_duration_minutes`.** When an appointment is being moved in the all-therapists Week view, tap targets count only the moving appointment's own therapist (its own time is free, the whole length must fit), not "any therapist is free".
    - **Drag (tab+)**: mouse/pen drag a block to move it (15-minute snaps, across therapist columns in Day view, across days in the single-therapist Week view) or drag its bottom edge to resize; a dashed ghost shows the target and turns red when it isn't free / is closed / past (`dropAllowed`, which allows off-hours slots). Touch (phones and iPad): a swipe scrolls as usual; press and hold a block for 300 ms (a short buzz) to lift it, then drag it with the finger in the same 15-minute steps, across columns too (`useGridDrag` in `TimeGrid.tsx`; a non-passive `touchmove` listener on the grid stops page scrolling only while a block is lifted). Lifting and letting go without moving enters "Tap a free time to move …" mode instead: its targets come every 30 minutes (`PLACE_STEP_MINUTES`, so each is a full finger-height whatever the clinic slot) and only where the appointment's whole length fits, before closing, ignoring its own current time. While dragging (mouse or touch) the grid auto-scrolls near the top/bottom 60px of the visible area (`edgeScrollSpeed`; page scroll on phones, the grid's box elsewhere), faster closer to the edge, and the scrolled distance counts toward the drop time; a lifted block held still never auto-scrolls. The clinic's `slot_duration_minutes` still sets booking targets and default length, not drag steps. Same-therapist in-hours drops save at once with a 10 s Undo toast; dropping on another therapist, another date, or an outside-hours slot asks to confirm via `pendingMove`. Only confirmed/rescheduled appointments the viewer can manage are draggable; therapists can't reassign (server-enforced).
    - **`BookSlotSheet` layout (phone-first)**: a fixed header (title, close ×) and footer (what will be booked, "Fri, 2 Oct, 11:00 AM · 30m · Dr Aishwarya", then a full-width action), with the body scrolling between them; 94dvh bottom sheet on phones, centred dialog from `sm:`. Sections: Patient (Existing / New toggle), Therapist and length (therapist chips with their Schedule colours, length chips), Day (7 day cards, closed days greyed, "Other date" for the calendar), Time (Morning / Afternoon / Evening groups, 4 columns on phones; taken or past times faded; "First available"), then a "Repeat this booking" switch. A request being confirmed shows what the patient asked for at the top.
    - **`BookSlotSheet`**: one sheet for "+ Book", grid/agenda/free-time clicks, request confirmation, and **reschedule** (`rescheduleAppointment` prop: patient and therapist fixed, the moved appointment is ignored when checking occupied time, submits `reschedule_appointment`). A length picker (30/45/60/90 minutes, plus the clinic slot if different — always labelled in minutes via `lengthLabel()`, never "1h"/"1h30") drives the occupied check; times that already passed or overlap the therapist's bookings for the chosen length are disabled. Therapist defaults to the logged-in therapist or the only therapist, and is locked for therapist logins. Closed weekdays and holidays show a warning but can still be booked. A patient with no phone must have one entered. State resets on every open; the reschedule snapshot is taken at open time so a sync mid-edit can't reset the form. `onBooked` returns `{ kind: 'booked' | 'rescheduled', appointmentId, scheduledAt, durationMinutes, … }`; the toast offers WhatsApp and auto-dismisses after 15s.
    - **Clinic closures**: weekly closed days stay in Settings (`clinics.closed_weekdays`); one-off dates and ranges (holidays) are set from the calendar (`ClosedDaysSheet`, admin / front desk) and shown in the rail, strip, grid, booking sheet and the public `/book/$slug` form. Existing appointments on a newly closed day are kept. `isClosedDay` (holiday wins over weekday) and `groupClosedRanges` live in `src/domain/schedule.ts`.
    - **Public form layout**: time first, then details — header (clinic initial/logo, visit length, hours), step 1 "Choose a time" (clinician chips "Anyone available" / each therapist, a scrollable 14-day strip with uniform day cards and "Closed" days, "More dates" inline month, time grid), step 2 "Your details" (name, phone with compact country picker, optional email and reason), and a summary + "Request appointment" bar pinned to the bottom on phones (safe-area padded). The clinic clock is fixed to `Asia/Kolkata` and refreshed every minute via `useClinicNow`. Day status evaluates past, far, closed, holiday, therapist off, and finally end-of-day cutoff. Phone input normalises leading zeros, spaces/dashes, and pasted `+91` or `91` (when 12 digits), storing standardized `+<code> <digits>`.
    - **Workspace header**: one compact card (about 150–180px tall on a phone) — the greeting (therapist's first name when linked) with the short date ("Thu, 1 Oct") beside it on the same line, "+ Book" (opens `BookSlotSheet`; therapist-locked for therapists) and "+ New visit", the stat strip (see Today-First Workspace), then a "needs you" line **only when something needs attention that the page doesn't already list**: the therapist's notes to finish (opens the oldest draft), new feedback, and visits not synced yet (amber). Visits in progress and booking requests aren't repeated there — the Today card right below lists both (with Complete / Confirm). With nothing to show, the line is hidden rather than saying "All caught up"; the header's sync dot covers the synced state. Book / New visit carry icons. While setup is incomplete, an admin sees the guided-setup bar (`SetupProgressBar`) above this card.
    - **Workspace Today card**: one card with tabs "Appointments (n) | Visits (n)" (tab remembered per device) instead of separate "Expected today" and "Today's visits" cards. Appointments (`TodayAppointments`) use flat divided rows at the same density as the Visits list, coloured like the Schedule grid (`appointmentFill` in `scheduleColors.ts`: therapist-colour left edge; white = upcoming, therapist tint = arrived, grey = visit logged, rust = no-show) (time, name, therapist and length from `sm:`, a small status pill; "Next" pill on the next appointment): in-progress visits first (arrived, no visit yet, today's plus any left open in the last 7 days) with a compact "Complete visit" button, then the next 5 upcoming with "Show all", finished ones (visit logged / no-show) folded under "Done (n)". For admin / front desk, **Requests to confirm (n)** comes first: the oldest three pending public booking requests (`RequestsInbox variant="list"`, "See all" → `/schedule?view=requests`) with Confirm (Workspace's `BookSlotSheet` on the requested date if not past, with the preferred therapist, name/phone, notes and time wish — same as Schedule) and Decline (`ConfirmDialog` → `declineAppointmentRequest`); the Appointments tab count includes them.
    - **Visit in progress (notes before the service)**: a "draft visit" is an **arrived appointment with no `visit_id`**, never a row in `visits` (whose service/price/split snapshots feed invoices, payouts and reports). `StartVisitSheet` (appointment panel "Add note", New Visit's "Start a note first") finds or creates the patient, then either **Start note** — for a booked appointment it marks it arrived; for a walk-in it calls `start_walk_in` (arrived appointment now, `source = 'walk_in'`, no overlap check, accepts a not-yet-synced patient by name/phone) — and opens the Core Assessment with `?appointmentId=`, or **Log visit now** (normal New Visit). The note stores `appointment_id`; when New Visit later saves with that `appointmentId`, `consultationNoteService.linkAppointmentNotesToVisit` sets the notes' `visit_id` (and marks the visit documented if a note is completed). "Mark arrived" stays optional — logging a visit marks arrival anyway. Workspace loads appointments even with patient comms off, so a walk-in in progress shows under Today → Appointments (the tab appears only while one is open). A "New patient" created by a Start note attempt that then fails (e.g. offline) is reused on retry, not duplicated.
    - **Patient form**: Name, Phone, Age, Sex, Primary condition, Referring source, then a collapsed "More details (optional)" with Email, Alternate phone and Patient ID (blank = auto-generated; fill only to keep an old record's number) — in New Visit's create-patient step and the Edit patient modal. Search matches the alternate phone too.
    - **App header**: the Thera.Net mark on the left (`BrandMark`, wordmark from `desktop:`, links to Workspace) — the product; nav in the middle (labels from `tab:`); on the right the **clinic pill** (`ClinicSwitcher`: the clinic's uploaded logo or its initial + name; name hidden between `tab:` and `desktop:`, where five nav labels leave no room — tooltip and menu carry it), then `SyncBadge` (a quiet green dot when synced, expanding with text when offline / syncing / pending / failed; its popover is pinned full-width under the header on phones) and the account avatar. The clinic pill is the only clinic switcher, and for admins it also has "+ Add another clinic" (a non-admin with one clinic gets a static label). No date in the header (Workspace shows it).
    - **Thera.Net branding**: `src/components/BrandMark.tsx` — `BrandMark` (header, account menu footer "Thera.Net · v{version}" from `__APP_VERSION__`, defined in `vite.config.ts` from package.json), `AppLoading` (full-screen loading / "Preparing…" in `Shell`), `PoweredBy` ("Powered by Thera.Net" under the public booking and feedback forms). Sign-in/reset use `AuthBrandHeader`, which renders `BrandMark`. The clinic's own logo appears only in the clinic pill, on the public forms' header and on printed documents.
    - **Public form** (`BookingFormPage.tsx` + `src/domain/publicBookingDays.ts`): dates more than 90 days out aren't offered (availability is only fetched that far), and a failed availability fetch no longer blocks the whole form. A start time is hidden when it overlaps the preferred therapist's bookings for their full length; with no preference, only when every therapist is busy (`isPublicSlotTaken`). Past times today are hidden.
      - **Clinician availability**: availability under "Anyone available" is computed across *bookable* clinicians (`list_booking_therapists`). Clinicians with default clinic hours (null working hours) are treated as working clinic hours, fixing false "off" statuses when custom-hours clinicians are off.
      - **Today closing & waitlist**: once the last bookable time or clinic closing time has passed, today is marked unavailable. Waitlist submissions for an ended day are blocked, while fully booked future days or a day with remaining time keep the waitlist option intact.
      - **Clinic timezone**: today and current time are evaluated in `Asia/Kolkata` (`clinicNow()`) rather than the local device clock.
      - **Validation & accessibility**: client-side phone validation (+91 requires 10 digits; international requires 6–15 digits; custom code requires leading '+' and 8–15 digits) and RFC-compliant optional email validation. Touch targets meet `min-h-11` on mobile, calendar cells have descriptive `aria-label`s with availability states, and errors link to form fields via `aria-invalid` / `aria-describedby` with autofocus on the first error.
      - **Book another**: confirmation screen provides a complete reset for booking additional appointments while preserving the country code.
    - **History**: `HistorySurface` — search by name/phone, status and therapist filters (therapist filter hidden for therapist logins), 30-day paging; rows open the same details panel.
  - **Workspace "Expected today"** — a new section (not a replacement of
    anything, per the point above), sourced from
    `dashboardService.todayAppointments`, scoped the same way "Seen
    today" already is (clinic-wide for admin/front_desk, own-therapist
    otherwise). Row actions: "Mark arrived" (any clinic member, matching
    the RPC's own membership check), "No-show"/"Cancel"
    (admin/front_desk only), "Create visit" (once `visit_id` is still
    unset). Reschedule is deliberately Schedule-only, not offered inline
    on Workspace — a more deliberate action than a single click, better
    suited to the dedicated management surface. The Schedule's History table carries the same "Create visit" condition (found
    missing in review — an appointment manually marked arrived without a
    visit yet had no way back to New Visit once it wasn't "today" anymore
    and had dropped off Workspace's list; History's table has no
    date-scoping, so it's the recovery path for that case). A second banner
    surfaces the pending-booking-request count for admin/front_desk, linking to
    `/schedule?view=requests`.
  - **Settings** gained a booking-link field in the same Patient
    communications section (client-validated lowercase-alphanumeric-plus-
    hyphens pattern; the DB only enforces uniqueness) with a "Copy link"
    button, alongside the existing module toggle and Google review URL.
  - **`message_log` gets its first writer via the Phase 9 wiring below** —
    every send action, `shareTherapistNotify` included as of the
    `therapists.phone` addition below, now goes through the Business API
    path first (when a recipient phone number is known), and a successful
    send there writes a `message_log` row server-side. Until a clinic
    actually configures the Business API and has an approved template,
    every send still falls through to the share sheet — which still
    doesn't log anything, same gap as before.
  - **A "Book" action on each Patients-list row** (`BookAppointmentDialog.tsx`)
    — same `create_appointment_staff` RPC as the Bookings tab's own "New
    booking" card, reachable straight from a patient's row instead of a
    detour through Requests. Pre-fills name/phone from the patient record
    (phone stays editable — some patients predate having one on file) and
    defaults Therapist to whoever ran their last visit, since "book with
    the same therapist" is the common case. Gated on
    `clinic.enablePatientComms` **and** admin-or-front_desk (`canBook` in
    `PatientsPage.tsx`) — the RPC itself rejects any other role, so the
    role check isn't optional the way the comms-flag check is; a plain
    therapist never sees the button at all, same as Requests → Bookings'
    own gate.
  - **Optional `patient_id` linking at booking/confirm time** — both
    `create_appointment_staff` and `confirm_appointment_request` grew a
    trailing `p_patient_id uuid default null` parameter (drop+create, not
    `create or replace` — see §3c), used at exactly the two entry points
    where identity is already unambiguous, without relaxing the documented
    "`appointments.patient_id` stays null until arrival" rule for every
    other path (a public form submission or a hand-typed name still
    carries real duplicate-name risk, so it still waits for New Visit's
    own search-or-create typeahead):
    - The Patients-list "Book" action above always passes it —
      `BookAppointmentDialog` opens from an already-clicked patient row,
      so there's no name to match and no ambiguity to defer.
    - The Bookings tab's Confirm mini-form (`SchedulePage.tsx`) grew a
      third, optional field alongside Scheduled-for/Therapist: a
      `SearchableSelect` "Link to existing patient · optional" picker
      (options built from `repos.patients.list`, broadened from
      admin-only to admin-or-front_desk for this). Left blank — the
      default — it's exactly today's behavior, identity resolves later.
      Staff only fill it in when they explicitly recognize the requester
      (by the name/phone already shown on the request card) as someone
      already on file; nothing else on the form depends on it.
    Both RPCs check the passed id belongs to the same clinic before
    trusting it. `bookingService.confirmAppointmentRequest` and
    `.createAppointmentStaff` both take the new id as a trailing optional
    parameter, defaulting to `null`, so every existing call site is
    unaffected.
  - **Every "Create visit" link now passes `patientId` through when the
    appointment already has one** (Workspace's "Expected today", both
    mobile card and desktop table, plus Requests → Bookings' Appointments
    table) — found in review right after the two entry points above
    shipped: `NewVisitPage.tsx`'s `?patientId=…` search param already
    pre-selects that exact patient (`repos.patients.get`, skipping the
    typeahead entirely — the same fast path Patient Profile's own "New
    visit" button and the repeat-visit flow use), but every "Create
    visit" `Link` still only passed `prefillName`/`prefillPhone`, on a
    now-stale assumption (a comment on the desktop-table one said so
    outright) that `patientId` is only ever set alongside `visitId`. Once
    the Book/Confirm-picker linking above could set it earlier, that
    assumption broke: a patient already linked at booking time would hit
    "Create visit" and land in the create-new-patient form instead of
    being recognized, risking a duplicate patient record for someone
    already correctly identified.
  - **`NewVisitPage.tsx`'s Condition/Treatments fields collapse behind a
    "+ Add condition / treatments (optional)" disclosure for front_desk
    only** — reception usually doesn't know either at log time (that's
    the therapist's own read of the patient after seeing them, not
    something a booking or walk-in carries), so their path is Patient →
    Therapist → Service → Payment, the four things they always have,
    without two clinical fields sitting in the middle of it. Still one
    click away, and admin/therapist never see it collapsed — this is a
    front_desk-only default, not a permission: the fields were never
    access-gated, only de-prioritized in the one role that usually can't
    fill them in yet. **Auto-expands the moment either field gets a
    non-empty value from anywhere else** — "Repeat last visit" and the
    `?patientId=` prefill (a patient's own `primaryCondition`) both set
    `condition` programmatically, and without this a value could sit
    filled in behind the still-collapsed button and get submitted without
    front desk ever seeing it (found in review, not the shipped behavior).
- **WhatsApp Business Cloud API — wired, pending real templates (Phase 9)**
  — built ahead of the clinic actually having Meta credentials, so that
  turning real sending on is a config step, not a code change.
  - **`clinic_whatsapp_config`** — `phone_number_id`, `access_token`
    (a real Meta secret), `enabled`. Carries **no SELECT policy for any
    client role at all** (RLS enabled, zero policies) — only
    `service_role`, used exclusively inside the Edge Function below,
    can ever read it. Two RPCs give the client everything it legitimately
    needs without exposing the token: `set_whatsapp_config(...)`
    (admin-only write; a `null` access token argument leaves the stored
    one untouched, so re-saving the phone number ID or flipping `enabled`
    doesn't force re-entering the secret) and
    `get_whatsapp_config_status(...)` (admin-only read of `enabled` /
    `phone_number_id` / `has_token: boolean` — never the token itself).
  - **`supabase/functions/send-whatsapp-template/index.ts`** — the one
    place in the app that would ever call Meta's Graph API
    (`https://graph.facebook.com/v20.0/{phone_number_id}/messages`),
    structurally mirroring `invite-therapist/index.ts` (JWT-verified
    caller, a `clinic_members` membership check, a service-role client
    for the privileged read). Template-shaped from the start — the
    caller supplies `templateName`/`languageCode`/`bodyParams`, never
    freeform text — because Meta requires an approved template for any
    business-initiated message outside a 24h customer-service window;
    this function has no opinion on what a given clinic's approved
    template actually says. Returns `{ configured: false }` (not an
    error) when the clinic has no config row or hasn't enabled it. On a
    successful send, writes a `message_log` row (`channel:
    'wa_business_api'`) — see the note above.
  - **Settings** gained a collapsed-by-default "WhatsApp Business API
    (advanced)" sub-block in the Patient communications section
    (`WhatsAppBusinessSubsection` in `SettingsPage.tsx`) — enable toggle,
    phone number ID, and a password-type access-token field that's never
    re-populated with the real value, only a "Connected ✓" / "Not
    connected" status line. Its own small save/status state, not part of
    the section's shared `useClinicSectionForm` dirty-tracking — this is
    a separate table with write-only semantics, not a few more `Clinic`
    columns.
  - **`src/lib/whatsappSend.ts`'s `sendWhatsAppMessage()`** is now the one
    place any send action decides *how* to send: try
    `whatsappBusinessService.sendViaBusinessApi()` first when a recipient
    phone number is known, and fall back to the existing
    `shareTextViaWhatsApp` share sheet whenever the clinic hasn't
    configured it, there's no phone number, Meta rejects the send (e.g. an
    unrecognized template name), or the request fails outright — so
    turning this on for real is purely a Settings config change plus a
    template-name/param swap in `WHATSAPP_TEMPLATES`, not a code change.
    All seven patient/staff-facing send actions (`askForFeedback`,
    `resend`, `askForGoogleReview`, `sendStalePackageReminder`,
    `sendReturnReminder`, `shareBookingConfirmation`,
    `shareTherapistNotify`) go through it, reading the recipient's phone
    off `Patient.phone` (added to `VisitCardData` as `patientPhone`,
    `OpenPackageRow` as `phone`, and threaded through `NewVisitPage`'s
    post-save state and `SchedulePage`'s `justConfirmed` state to reach the
    call sites) or, for `shareTherapistNotify`, off the new
    `therapists.phone` column (nullable text; `RosterCard`'s edit form in
    Settings, next to Registration no. — absent still means share-sheet-
    only for that therapist, exactly like every other action falls back
    when its recipient's phone is unknown).
  - **Template names are hardcoded placeholders** (`WHATSAPP_TEMPLATES` in
    `whatsappSend.ts`, e.g. `'feedback_request_v1'`) — Meta assigns the
    real name when a clinic's own template is approved, and it has no
    relationship to this string; an unrecognized name is exactly what
    makes Meta return `{ configured: true, success: false }`, which this
    wrapper treats the same as "not configured" and falls back to the
    share sheet. Swap these for the clinic's actual approved template
    names (and adjust `bodyParams` ordering to match that template's own
    `{{1}}`, `{{2}}`, ... variables) once real ones exist — there's no way
    to know a template's variable shape in advance, so `bodyParams` here
    is a best-effort guess at "the same information the share-sheet text
    already sends," in the same order.
  - **Phone numbers are normalized, not validated** —
    `normalizePhoneForWhatsApp()` in `whatsappSend.ts` strips non-digits
    and prepends `91` to a bare 10-digit number (this app's phone fields
    are free text with no format enforced, and a 10-digit local number is
    what staff overwhelmingly type); anything else passes through as-is
    and Meta's own validation is the real backstop.
- **Trends review print** (`/insights/trends-print?period=&year=&month=`, linked from
  Reports → Trends as "Print / PDF review") — **internal team review** handout,
  **not** the official **Monthly statement** (`/insights/print`, per-therapist
  Bill/BM/TDS/split for hospitals/partners/therapists). Carries the same
  `period` window as the on-screen trend bar, a focus-month KPI snapshot,
  `RevenueTrendPanel`, therapist dual-bar + `TherapistComparisonTable` when
  enabled, and live retention lists. **No** `MonthlyReportTable`, **no**
  conditions (deferred — free-text condition field would not produce a useful
  pie). `/insights/performance-print` redirects here. Same admin/front_desk gate
  as Reports.
  - **Clinic totals** — `reportService.monthly` for the focus month (revenue +
    visits vs prior month).
  - **Per-therapist breakdown** — dual-bar + comparison table for the focus
    month only (retention % + packages via `repeatVisits` / `monthlyNewCounts`).
  - **Retention follow-ups** — live `singleVisitPatients` and stale
    `openPackages`, labeled as-of today, not historical to the focus month.
- **Trends dashboard's "at a glance" KPI strip gained a Visits card** —
  `ReportsOverviewPage.tsx`'s `KpiCard` strip already had month-over-month
  trend badges on Revenue, Repeat visits, New patients, and Packages
  (`pctChange` against the `revenueTrend` array's last two entries, no
  extra query); raw visit count — "are we busier or quieter," not a
  rate/quality metric like everything else in the strip — was the one gap.
  `visitsThisMonth`/`visitsLastMonth` reuse the same already-fetched
  `trend` array the Revenue card reads from. Grid went from 5 to 6 cards,
  and its breakpoint moved from `lg:grid-cols-6` (1024px) to
  `xl:grid-cols-6` (1280px) — six cards at the narrower width squeezed the
  Revenue card's longest value ("₹1,84,500 ▲ 12%") into wrapping past its
  own card edge; `sm:grid-cols-3` already covers every width from 640px up
  with two comfortable rows of three in the gap between.

---

### 9b. Account menu (personal settings, every role)

Everything about the signed-in person lives in the header avatar menu, separate from the clinic-wide, admin-only Settings page. A bottom sheet on phones, a dropdown from `sm:` up.
- **My account** (sheet): *Profile* (display name for everyone; for a linked therapist also name on invoices, registration no., phone, photo; email read-only) and *Security* (change/set password, sign out of other devices via `auth.signOut({ scope: 'others' })`).
- **My working hours**: a linked therapist's `ShiftRequestSheet` with a live "Your current schedule" summary block at top (headline, last change date and author, Mon–Sun weekly hours list with break intervals, pending requests, and declined requests with admin decision notes). The account menu row displays a one-line subtitle (`useMySchedule`: effective hours summary or "Request pending") and an "Updated" dot until opened (tracked via device `localStorage` `myHoursSeen:<therapistId>`). Pick a shift template + weekdays (submits a pending request for admin approval) or fall through to `WorkingHoursSheet` for custom hours that don't match any template (also a request). A therapist can no longer write `working_hours` directly; see **Shift-based scheduling**. A separate `BreakPlacementControl`, shown alongside it, lets a therapist move their break within an already-approved shift immediately, no approval needed.
- **Notifications**: this device's push switch, a **"Which alerts do you want?"** list of switches for the alerts that apply to the person (booking requests for admin / front desk, changes to my appointments for anyone linked to a therapist profile, low-rated feedback for admin; on by default, per clinic, all devices; stored in `user_push_preferences`) and, for a linked therapist, "Email me appointment updates".
- **Settings**: admins only. Install app and Help & feedback for everyone.
- The avatar shows the linked therapist's photo, otherwise initials.

### 10. Push Notifications

Web Push alerts reach staff and therapists when the app is closed. Opt-in per device from the account menu → Notifications, available to every role (not the admin-only Settings page).

- **Therapist:** confirmed, rescheduled, or cancelled appointment on their own schedule.
- **Admin and front desk:** every new public booking request for the clinic.
- **Admin only:** 1–2 star feedback responses.
- **Content rule:** therapist and feedback payloads carry no patient data (time only, or fixed text). Booking-request payloads carry the patient's name, preferred date, and the chosen slot time (`H:MM AM/PM`), since the staff member chose to see these on the lock screen. The slot is validated server-side and dropped if it isn't a slot label; the name is capped at 60 characters with control characters removed.
- **Shared devices:** signing out removes this browser's subscription, so the next login doesn't receive the previous user's alerts. A single browser subscription can only ever belong to one user, so `register_push_subscription` intentionally reassigns it to whoever enables push most recently on that device — correct for a kiosk, but it used to leave the *previous* user's Settings screen claiming "On for this device" even though their alerts had silently stopped. `pushState()` (`src/features/notifications/pushSubscription.ts`) now also checks that the server-side `push_subscriptions` row for this device's endpoint still belongs to the signed-in user (RLS scopes the check to their own rows) before reporting "on", so a bumped-off user correctly sees the enable prompt again instead of a stale "on" status.
- **iOS:** push works only after the app is added to the Home Screen; Settings shows an install prompt instead of the enable button until then.
- **Delivery:** triggers on `appointments`, `appointment_requests`, and `feedback_responses` call the `send-push` edge function asynchronously via `pg_net`. Recipients are resolved at send time from clinic membership. Subscriptions returning 404 or 410 are removed.

## Application Architecture

### Directory Structure

```
src/domain/              Pure business logic (no framework imports)
                         Money, splits, fiscal year, clinical assessments
                         Unit-tested, fully offline-capable

src/repositories/        Data-access interfaces + Dexie implementations
                         UI reads/writes local only; sync handles remote

src/sync/                Outbox push / delta pull engine
                         Against Supabase realtime & storage

src/services/            Orchestration layer (no React imports)
                         Visit, invoice, report, patient, dashboard,
                         consultation-note, therapist, advance services

src/features/            UI pages and components (React + TanStack Router)
  ├── workspace/         WorkspacePage (Today, Recent, Open Packages, Pending)
  ├── visits/            LedgerPage at /ledger (Visits/Invoices/Daybook sub-tabs); DaybookPage; NewVisitPage
  ├── patients/          PatientsPage, PatientProfilePage, NoteEditorPage
  ├── reports/           ReportsPage at /insights (Trends + monthly statement +
                         performance report), MonthlyLedgerPrintPage,
                         MonthlyPerformancePickerPage, MonthlyPerformanceReportPage
  ├── settings/          SettingsPage at /settings; CreateClinicForm
  ├── invoices/          InvoicePrintPage
  ├── import/            Historical Excel visit import (preview + commit)
  ├── auth/              Login, reset-password
  ├── schedule/          SchedulePage at /schedule (Feedback tab, admin;
                         Bookings tab, admin + front_desk); scheduleSignals.ts
                         (the "new response" count + the front-desk Google-
                         review-eligibility hook, kept out of SchedulePage
                         itself so Workspace's eager bundle can read them
                         without pulling in the route-code-split page)
  ├── publicFeedback/    FeedbackFormPage at /f/$token (anonymous, no Shell)
  ├── publicBooking/     BookingFormPage at /book/$clinicSlug (anonymous, no Shell)
  └── more/              Mobile-only overflow nav page

src/components/          Shared UI components — VisitCard (shared card/table
                         list), BodyChart, ScaleWidget, IssueInvoiceDialog,
                         TakePaymentDialog, RevenueShareEditor, UpiQrModal, SyncBadge,
                         BarChart/PieChart/IndexedTrendChart, MonthlyReportTable,
                         TherapistComparisonCard, SearchableSelect, ui.tsx
                         (shared primitives: Pill, buttons, table cells)

src/lib/                 Utilities (Supabase client, errors, image resize, db)

src/app/                 Shell, router, hooks (useClinicRole, usePermissions,
                         useVisitColumnPrefs, useWorkspaceScope)

supabase/                SQL migrations, RLS policies, RPCs, realtime
                         publications, seed data
```

### App Routes

| Route | Purpose | Access |
|-------|---------|--------|
| `/workspace` (default) | Today's work, recent history, open packages, pending items | All roles |
| `/visits/new` | New visit entry | All roles (billing fields gated by `canBill`) |
| `/ledger` | Historical visit records, patients list, invoices & daybook, URL-addressable sub-tabs (`?tab=visits\|patients\|invoices\|daybook`) | All roles (Invoices/Daybook tabs require billing access) |
| `/patients` | Redirects to `/ledger?tab=patients` | All roles |
| `/patients/$patientId` | Individual patient profile, visit history, payments summary, clinical notes (Back returns to `/ledger?tab=patients`) | All roles |
| `/patients/$patientId/notes/new`, `/patients/$patientId/notes/$noteId` | Core Assessment note editor (Initial/Follow-up) | Therapists & admins (`canViewClinicalNotes`) |
| `/patients/$patientId/notes/$noteId/print` | Printable consultation note | Therapists & admins |
| `/insights` | Dashboard + monthly per-therapist statement (`?tab=monthly`) + monthly performance report picker (`?tab=performance`) | Admins & front_desk (monthly statement and performance report sub-views further gated admin-only, same `canViewPayouts` check) |
| `/insights/print` | Printable monthly ledger (portrait A4) | Admins & front_desk |
| `/insights/performance-print` | Printable monthly performance report — clinic totals, per-therapist chart + table, referral/condition mix, retention follow-ups (portrait A4) | Admins & front_desk |
| `/invoices/$invoiceId/print` | Printable Bill/Bill Cum Receipt (A4/A5) | Anyone who can reach the invoice |
| `/settings` | Clinic configuration, MRNO settings, billing mode, rate setup, feature toggles (in main header nav for admins) | Admins only |
| `/settings/import-visits` | Historical Excel visit import | Admins only |
| `/more` | Mobile-only overflow nav: Reports (admin/front desk), Settings (admin) — icon rows. Booking requests aren't listed; the Schedule tab carries their badge and inbox | All roles |
| `/schedule` (`?tab=feedback\|bookings`, `?view=schedule\|requests\|history`, `?mode=day\|week`, `?date=`, `?therapist=`) | Clinic calendar (see Patient Communications → Schedule), booking requests, appointment history; Feedback tab | Calendar + History: all roles (therapists scoped to their own appointments). Requests: admins + front_desk. Feedback: admins only |
| `/reset-password` | Password reset | Unauthenticated |
| `/f/$token` | Public patient feedback form (Patient Communications, Phase 0) | Unauthenticated — token-scoped, no clinic membership |
| `/book/$clinicSlug` | Public booking request form (Patient Communications, Phase 5) | Unauthenticated — slug-scoped, no clinic membership |
| `/archive`, `/setup`, `/setup/import-visits`, `/invoices`, `/reports`, `/reports/print` | Legacy redirects for old bookmarks | All roles |

---

## Database Schema

*Verified against the live schema (`information_schema.columns`), not
hand-maintained from memory — if this section and the actual database ever
disagree again, trust the database and fix this doc, not the other way
around.*

### Core Tables

#### `clinics`
```sql
id                          uuid PRIMARY KEY
name                        text NOT NULL
address, phone, email, gst_no, logo_path  text (NULLABLE)
partner_hospital_name, partner_hospital_logo_path  text (NULLABLE)
invoice_prefix              text NOT NULL (e.g., "BM")
bm_split_pct                numeric NOT NULL (default 75)
tax_pct                     numeric NOT NULL (default 10)
tds_basis                   text NOT NULL CHECK (IN 'gross_bill', 'bm_share')
fy_start_month              int NOT NULL (default 4 = April)
clinic_type                 text (NULLABLE) — 'individual' | 'multiple'
has_partner                 boolean NOT NULL
billing_mode                text NOT NULL — legacy, maps to clinic_type+has_partner
enable_therapist_split      boolean (NULLABLE)
own_share_label, partner_share_label  text (NULLABLE) — default "BM"/"HV"
last_split_change_at        timestamptz (NULLABLE) — stamped whenever an
                             admin changes hasPartner/bmSplitPct/taxPct/
                             tdsBasis/clinicType; Workspace shows a 14-day
                             "your split changed on X" banner off this
billing_enabled              boolean NOT NULL — legacy: no longer read or editable (billing is always on); server invoice checks still read it (all true)
partner_collects             boolean NOT NULL DEFAULT false — the partner collects patients' payments (only with has_partner)
default_payment_method       text NULL — what payment screens preselect (CHECK: the six methods)
invoicing_access            text NOT NULL — 'everyone' | 'billing_staff'
invoice_policy              text NOT NULL DEFAULT 'on_request' — 'on_request' | 'always' | 'never_nag'
clinical_docs_enabled       boolean NOT NULL DEFAULT true — new clinics start on (migration 20261025110000); existing clinics keep their value
show_therapist_comparison   boolean NOT NULL
walk_in_mrno_prefix         text (NULLABLE, default 'W')
visit_column_prefs          jsonb (NULLABLE) — legacy, superseded by per-user
                             Dexie prefs (useVisitColumnPrefs); no client code
                             reads/writes this column today
upi_vpa, upi_payee_name, upi_qr_path  text (NULLABLE)
upi_qr_enabled               boolean (NULLABLE)
signature_path               text (NULLABLE)
slot_duration_minutes        integer NOT NULL (default 30) — 15|30|45|60
start_step_minutes           smallint NULL — 15|30; staff start times come every this many minutes (null = every slot_duration_minutes). Public booking ignores it
timezone                     text NOT NULL DEFAULT 'Asia/Kolkata' — IANA zone for every server-sent time (emails, push, the agenda, the public booking page); a trigger rejects names Postgres does not know (migration `20261021100000_clinic_region.sql`)
default_country_code         text NOT NULL DEFAULT '+91' — `^\+[0-9]{1,4}$`; the code a phone number without one belongs to (`PhoneField`)
agenda_enabled               boolean NOT NULL DEFAULT true — the clinic sends the evening agenda email (migration `20261021130000_clinic_agenda_switch.sql`)
agenda_hour                  smallint NOT NULL DEFAULT 20 — 0-23, the clinic-local hour `send-agenda` mails tomorrow's appointments (migration `20261021120000_daily_agenda.sql`)
booking_start_hour, booking_end_hour  integer NOT NULL (default 9, 17) — the
                             Schedule grid and every slot picker (staff + public)
staff_booking_buffer_hours   smallint NOT NULL (default 3, range 0–12) — hours
                             before opening and after closing staff may book in
                             BookSlotSheet; 0 disables outside-clinic booking
closed_weekdays              integer[] NOT NULL (default '{}') — 0 = Sunday;
                             weekly closed days (Settings → Online Booking)
onboarding_completed_at      timestamptz (NULLABLE) — set when admin finishes
                             the post–create-clinic wizard; NULL ⇒ Shell keeps
                             redirecting to `/onboarding`
created_by, updated_by       uuid (FOREIGN KEY → auth.users.id, NULLABLE)
updated_at                  timestamptz NOT NULL
```

#### `clinic_members`
```sql
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
user_id         uuid NOT NULL (FOREIGN KEY → auth.users.id)
role            text NOT NULL CHECK (IN 'admin', 'therapist', 'front_desk')
title           text (NULLABLE)
display_name    text (NULLABLE)
last_active_at  timestamptz (NULLABLE) — set by touch_last_active(p_clinic_id) RPC,
                called at most once per device per calendar day (Dexie db.meta
                throttle keyed by BOTH clinic and user id, so a staff member's
                ping on a shared/kiosk device never suppresses a second staff
                member's ping that same day). Settings → Team shows a plain
                "Active today" badge from it — no "N minutes ago" granularity,
                since a once-daily write can't honestly support that precision.
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
PRIMARY KEY (clinic_id, user_id)
```

#### `therapists`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
active          boolean NOT NULL (default true)
user_id         uuid (FOREIGN KEY → auth.users.id, NULLABLE) — linked login
photo_path      text (NULLABLE)
registration_no text (NULLABLE) — printed on invoices under the therapist's name
email_appointment_updates boolean NOT NULL DEFAULT true — when false, `notify-therapist` skips the confirmation/reschedule/cancellation email (push and the manual WhatsApp button are unaffected). The linked therapist sets it from account menu → Notifications.
email_daily_agenda boolean NOT NULL DEFAULT true — no longer read: the agenda is switched per clinic (`clinics.agenda_enabled`, migration `20261021130000_clinic_agenda_switch.sql`). Since `20261021120000_daily_agenda.sql` the DEFAULT of `email_appointment_updates` is false (new therapists get the agenda, not a mail per booking); existing rows keep their value
phone           text (NULLABLE) — lets `shareTherapistNotify` use the WhatsApp
                Business API instead of always falling back to the share sheet
profile_confirmed_at timestamptz (NULLABLE) — set when linked login finishes
                `/onboarding/profile`; NULL triggers profile onboarding
working_hours   jsonb (NULLABLE) — weekly hours: {"0"–"6": [[startMin, endMin], …]},
                gaps are breaks, a missing weekday is a day off, NULL = clinic
                booking hours. Admin/front desk can still write it directly
                via `set_therapist_working_hours` (a therapist can no longer
                write their own — see Shift-based scheduling below). The
                shift-template paths (`assign_shift`,
                `approve_shift_assignment` on a shift request,
                `set_break_placement`, `update_shift_template`'s cascade)
                derive this same JSON shape via `derive_working_hours()`;
                the custom-hours paths (`assign_custom_hours`,
                `approve_shift_assignment` on a custom-hours request) write
                the submitted `custom_hours` JSON verbatim, or NULL for
                "Clinic hours". Either way it stays the single source of
                truth every downstream consumer (TimeGrid, booking form,
                slot generation) already reads — those never needed to
                change. Always validated by `working_hours_valid`. CHECK
                therapists_working_hours_valid (NOT VALID: new writes only)
                guards the column too, and the sync push drops working_hours
                from therapist upserts so a stale local row can't revert it
                (`src/sync/engine.ts`). Client `workingIntervals` reads a
                malformed day as "not working" instead of throwing
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```

#### Shift-based scheduling (`shift_templates`, `therapist_shift_assignments`)

Replaces a therapist's own direct editing of `working_hours` with an admin-controlled model: admin assigns (immediately) a reusable shift template or custom hours; a therapist can request a change (admin-approved) and self-service move their break's placement within an already-approved shift, no approval needed (moving a fixed-duration break never changes total capacity). Both tables are RPC-gated like `appointment_requests` — reads sync normally, no insert/update/delete RLS policy exists on either, every write goes through a `security definer` RPC. A single `derive_working_hours()` function builds the exact same JSON shape `therapists.working_hours` already held, so every downstream consumer (TimeGrid, the booking form, slot generation) needed zero changes.

```sql
-- shift_templates: clinic-defined, reusable envelopes (admin CRUD, Settings → Team).
id                          uuid PRIMARY KEY
clinic_id                   uuid NOT NULL (FOREIGN KEY → clinics.id)
name                        text NOT NULL
start_minute                integer NOT NULL
end_minute                  integer NOT NULL
break_duration_minutes      integer NOT NULL (default 0)
default_break_start_minute  integer (NULLABLE; required whenever break_duration_minutes > 0)
active                      boolean NOT NULL (default true) — deactivated, not deleted
created_at, updated_at      timestamptz NOT NULL

-- therapist_shift_assignments: one row per "which shift (or custom hours) +
-- which weekdays", request/approval history kept, not deleted.
id                  uuid PRIMARY KEY
clinic_id           uuid NOT NULL (FOREIGN KEY → clinics.id)
therapist_id        uuid NOT NULL (FOREIGN KEY → therapists.id)
shift_template_id   uuid (FOREIGN KEY → shift_templates.id, NULLABLE) — exactly one
                    of this or custom_hours is set
custom_hours        jsonb (NULLABLE) — same shape as therapists.working_hours;
                    replaces it wholesale on approval (unlike a shift
                    assignment, which merges by weekday). The JSON-null
                    literal 'null'::jsonb is a sentinel used only on a
                    *pending request* for "Clinic hours" (SQL NULL would
                    violate the exactly-one-of check); the client sees it
                    as `customHours === null` with `shiftTemplateId === null`
                    and labels it "Reset to clinic hours"
weekdays            integer[] (NULLABLE) — required iff shift_template_id is set;
                    NULL on the custom_hours path (weekdays live inside that JSON)
break_start_minute  integer (NULLABLE) — shift-template path only; NULL = the
                    template's own default_break_start_minute
status              text NOT NULL — 'pending' | 'approved' | 'declined' | 'superseded'
                    (superseded: another approved assignment claimed some/all
                    of this row's weekdays, or a custom-hours assignment
                    replaced it entirely — kept as history, not deleted)
note                text (NULLABLE)
decision_note       text (NULLABLE) — admin note recorded when declining a request;
                    decline RPC writes this without touching the therapist's request note
requested_by, decided_by  uuid (FOREIGN KEY → auth.users.id, NULLABLE)
decided_at          timestamptz (NULLABLE)
created_at, updated_at  timestamptz NOT NULL
```

RPCs (all `security definer`, revoked from `anon`): `create_shift_template`/`update_shift_template` (admin/front_desk; the latter cascades — re-derives `working_hours` for every `approved` assignment bound to the edited template, resetting a break placement to the template's new default if it no longer fits), `assign_shift`/`assign_custom_hours` (admin/front_desk, immediate — the admin is already the approver), `request_shift_assignment`/`request_custom_hours` (`is_own_therapist` only, pending; a new request supersedes an existing unactioned one), `approve_shift_assignment`/`decline_shift_assignment` (**admin only** since migration `20261025100000` — front desk can still assign shifts directly but cannot review a therapist's request; the Schedule "N shift requests pending · Review" banner and Settings → Team's pending strip are admin-only too; decline writes `decision_note` while leaving the therapist's `note` intact), `set_break_placement` (`is_own_therapist` or admin/front_desk, immediate, only on an `approved` shift-template assignment — bounds re-validated against the template's current `start_minute`/`end_minute`/`break_duration_minutes` at call time, never cached). A newly-approved assignment's weekdays supersede any overlap on the therapist's other approved shift assignments (`supersede_overlapping_weekdays`); approving a custom-hours assignment supersedes every other approved assignment for that therapist (`supersede_all_assignments`), and assigning/approving a shift supersedes an approved custom-hours row (`apply_shift_hours` checks for one first; if found it is superseded and the shift's hours are derived from `'{}'` rather than merged into the old custom hours — safe because an approved custom-hours row can never coexist with an approved shift row) — custom hours and shift templates are mutually exclusive per therapist. **Days with no shift are days off:** otherwise `apply_shift_hours` builds `working_hours` from the therapist's remaining approved shift assignments only (`rebuild_working_hours_from_shifts`) plus the new shift, never from whatever was stored, so hours set before shifts existed can't linger on days an admin left out (migration `20261012100000`, which also rebuilt existing therapists once). The Team weekly-coverage grid mirrors the schedule: a day missing from stored hours reads as Off, and clinic default hours apply only when a therapist has no stored hours at all.

**"Clinic hours" (NULL working hours).** `WorkingHoursSheet`'s "Clinic hours" option sends `null`. `assign_custom_hours(therapist, null)` inserts no assignment row: it supersedes every approved assignment and sets `therapists.working_hours = NULL` directly, returning NULL (a therapist with zero approved assignments simply uses whatever `working_hours` is). `request_custom_hours(therapist, null)` stores the `'null'::jsonb` sentinel on the pending row; approving it does the same supersede-all + `working_hours = NULL`, never passing the sentinel to `apply_custom_hours`.

**Internal helpers are not callable by clients.** `derive_working_hours`, `supersede_overlapping_weekdays`, `supersede_all_assignments`, `apply_shift_hours`, `apply_custom_hours`, `rebuild_working_hours_from_shifts` have no authorization check of their own, so `execute` is revoked from `public`/`anon`/`authenticated`; the authorized `security definer` RPCs call them as the function owner. `set_break_placement` rejects a NULL break start (it would otherwise delete the break — a capacity increase with no approval).

**Sync.** Both tables carry a `before update` trigger (`set_shift_scheduling_updated_at()` — updated_at only; the shared `set_updated_at()` also writes `updated_by`/`created_by`, which these tables don't have), and every RPC UPDATE also sets `updated_at = now()`, so the sync engine's `updated_at > cursor` pull sees approve/decline/supersede changes. Client mirror: Dexie `version(22)` adds `shift_templates` (`id, clinicId, active`) and `therapist_shift_assignments` (`id, clinicId, therapistId, status, shiftTemplateId`), read-only sync like `appointment_requests`.

**UI.** Settings → Team: `ShiftTemplatesSection` (template CRUD/deactivate) and `ShiftAssignmentsSection` (per-therapist current assignment, a pending-request badge showing the requested shift + weekdays or the actual custom hours / "Reset to clinic hours", the therapist's note, Approve, and Decline with an optional reason). Team member cards display real schedule summaries (`describeSchedule`: template name and days or custom intervals, never generic "Custom schedule" for shift therapists) and a "Set working hours" button opening `SetWorkingHoursFlow` with upcoming conflict checks (`appointmentsOutsideHours`). `AssignShiftDialog` offers a "Custom hours (individual)" option replacing shifts. Coverage grid displays the span of intervals (e.g. `9–5`) rather than "Custom". Schedule view: admin/front desk see a "N pending shift request(s). Review" banner linking to Settings → Team whenever any request is pending. Therapist side: `ShiftRequestSheet` (account menu → My working hours), which displays a "Your current schedule" block (headline, change notice, Mon–Sun hours with breaks, pending request, declined request with note), break control, and the request form with `WorkingHoursSheet` fallback.

#### `user_seen_markers`

Per-user "I have seen X up to <time>" markers behind the notification bell's "new" counts, so they follow a person to every device (migration `20261018120000_user_seen_markers.sql`, Dexie `version(24)`). One row per (user, clinic, marker): `id text` (**deterministic** `"<user_id>:<clinic_id>:<marker_key>"`, enforced by a check constraint, so two devices write the same row), `user_id`, `clinic_id`, `marker_key` (`feedback` | `therapist_appointments`), `seen_at`, `created_at`, `updated_at`. RLS: a user selects/inserts/updates only their own rows (`user_id = auth.uid()` and `is_clinic_member`); no delete policy. A `before insert or update` trigger (`user_seen_markers_guard`) makes `seen_at` **only move forward** and never more than 5 minutes past `now()` (a stale device can't undo a newer look; a wrong clock can't silence the bell), and sets `updated_at`. In `ALL_SYNCED_TABLES` and `CLIENT_WRITABLE_TABLES` (outbox), published to realtime. **Client:** `repos.userSeenMarkers.markSeen/get`; `scheduleSignals.ts` hooks (`useNewFeedbackResponseCount`, `useNewLowRatingFeedbackCount`, `useNewTherapistAppointmentCount`) take the user id and count items newer than `effectiveSeenSince(marker, legacy)` (`domain/seenMarker.ts`): the newest of the synced marker and any old per-device `db.meta` value (carried over into the synced marker once, then deleted), or, with neither, only the **last 30 days** so a cold device never shows years of feedback as new. Counts read **0 until this device has synced once** (no flash). `SchedulePage` stamps the marker on open.

#### `user_push_preferences`

Per-person switches for push alerts (migration `20261018150000_user_push_preferences.sql`, Dexie `version(25)`). A fourth category, **`hide_patient_names`**, was added by `20261021110000_push_hide_patient_names.sql` and is the one switch that is **off by default** (a row with `enabled = true` means "hide"; `PUSH_CATEGORY_DEFAULT` in `send-push/preferences.ts`). **Everyone is on by default; a row exists only once someone has chosen**, so a new alert type needs no backfill. One row per (user, clinic, alert): `id text` (**deterministic** `"<user_id>:<clinic_id>:<category>"`, enforced by a check constraint), `user_id`, `clinic_id`, `category` (`booking_request` | `appointment_changes` | `low_rating_feedback`), `enabled`, `created_at`, `updated_at`. RLS: a user selects/inserts/updates only their own rows (`user_id = auth.uid()` and `is_clinic_member`); no delete policy (switch back on with `enabled = true`); a `before insert or update` trigger keeps `updated_at` server-authoritative. In `ALL_SYNCED_TABLES` and `CLIENT_WRITABLE_TABLES` (outbox), published to realtime; partial index on the "off" rows for the lookup below. **Server:** `send-push` resolves recipients as before, then `withoutSwitchedOff()` drops anyone with an explicit `enabled = false` row for that kind's category in that clinic (**fails open**: a lookup error sends the alert rather than losing it). **One shared mapping:** `supabase/functions/send-push/preferences.ts` (dependency-free) holds the categories, the `kind -> category` map (all four `appointment_*` kinds are `appointment_changes`), the screen copy and `pushCategoriesFor(role, hasTherapistProfile)`; the edge function and the app (`src/domain/pushPreferences.ts` re-exports it) both import it, and a typecheck guard in `pushPreferences.test.ts` fails if a `PushKind` has no switch. **Client:** `repos.userPushPreferences.listForUser/setEnabled`; `MyNotificationsSheet` shows the switches. Email (`therapists.email_appointment_updates`) is a separate switch.

#### `service_catalog`
```sql
id               uuid PRIMARY KEY
clinic_id        uuid NOT NULL (FOREIGN KEY → clinics.id)
category         text NOT NULL — free text, autocompleted client-side
name             text NOT NULL
session_count    int NOT NULL (default 1, package pricing)
base_price_paise bigint NOT NULL
active           boolean NOT NULL (default true)
duration_minutes smallint (NULLABLE, 1–480) — optional length of one session
                 (per session for a package); snapshotted onto visit_items
created_by, updated_by  uuid (NULLABLE)
updated_at       timestamptz NOT NULL
```

#### `patients`
```sql
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
mrno                  text NOT NULL
mrno_source           text NOT NULL — 'hospital' | 'auto'
name                  text NOT NULL
age                   int (NULLABLE)
sex                   text (NULLABLE) — 'M' | 'F' | 'Other'
phone                 text (NULLABLE) — searchable everywhere, but only
                       *displayed* on Patient Profile, not the Patients list
email                 text (NULLABLE) — "More details" section
alt_phone             text (NULLABLE) — alternate phone; also matched by search
primary_condition     text (NULLABLE)
referring_source      text (NULLABLE) — legacy fixed enum, kept only so
                       patients tagged before referring_source_catalog
                       existed keep displaying correctly; no longer written
referring_source_id   uuid (FOREIGN KEY → referring_source_catalog.id, NULLABLE)
                       — current source of truth for new/edited patients
referring_source_detail text (NULLABLE)
no_return_reason_id   uuid (FOREIGN KEY → no_return_reason_catalog.id, NULLABLE)
deleted_at            timestamptz (NULLABLE) — soft delete
created_by, updated_by  uuid (NULLABLE)
updated_at            timestamptz NOT NULL
```

#### `visits`
```sql
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id            uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id          uuid NOT NULL (FOREIGN KEY → therapists.id)
visit_date            date NOT NULL
condition, treatment_notes  text (NULLABLE)
treatment_ids         uuid[] NOT NULL (default '{}') — which treatment_catalog
                       entries were performed this visit. The visit-entry
                       picker (NewVisitPage, EditVisitModal) ranks a clinic's
                       treatments by how often each was tagged in the last 90
                       days (dashboardService.treatmentUsageCounts, via
                       domain/treatmentUsage.ts's rankTreatmentsByUsage) into
                       a "Frequently used" group plus an alphabetical "All
                       treatments" rest — only once there are enough
                       treatments (8+) and some usage history to rank by;
                       otherwise it's a single alphabetical list as before.
service_catalog_id    uuid NOT NULL (FOREIGN KEY → service_catalog.id)
catalog_price_paise   bigint NOT NULL — snapshot at billing time
actual_bill_paise     bigint NOT NULL
adjustment_paise      bigint NOT NULL — actual − catalog
adjustment_reason     text (NULLABLE)
session_index, package_total  int (NULLABLE)
package_group_id      uuid (NULLABLE)
shared_therapist_id   uuid (FOREIGN KEY → therapists.id, NULLABLE) — internal
                       revenue-split assist, reporting only
shared_pct            numeric (NULLABLE)
bm_split_pct, tax_pct, tds_basis  NOT NULL — rate snapshot at billing
bm_share_paise, post_tax_paise, tds_paise, hv_paise  bigint NOT NULL — computed
invoice_id            uuid (FOREIGN KEY → invoices.id, NULLABLE)
pending_payment_note  text (NULLABLE) — "collect later" reason
patient_consent_confirmed  boolean NOT NULL
patient_signature_url text (NULLABLE)
clinical_status       text NOT NULL — 'pending' | 'documented' | 'reviewed'
consultation_note_id  uuid (FOREIGN KEY → consultation_notes.id, NULLABLE)
reauthorization_required  boolean NOT NULL
location              text (NULLABLE) — 'clinic' | 'home'
credits_mode          text NOT NULL (default 'auto') — 'auto' | 'manual': whether the
                       visit_credits rows follow the service lines or were edited by hand
service_lines_count   smallint (NULLABLE, >= 0) — how many live visit_items the visit was saved
                       with (set by visitService.create / updateLines); null = older visit, no
                       check. Read by the invoice builder only (since 20261024100000)
deleted               boolean NOT NULL (default false)
created_by, updated_by  uuid (NULLABLE)
updated_at            timestamptz NOT NULL
INDEXES: clinic+date, patient, clinic+updated
```
RLS (since `20261023100000`): select/insert any clinic member; **update** admin, front desk or the
visit's own therapist (`visits_update`); delete admin or own therapist (`visits_delete`). The soft
delete (an update setting `deleted = true`) follows the delete rule: trigger `visits_guard_soft_delete`
(`guard_visit_soft_delete()`, since `20261024100000`) refuses it with 42501 unless the caller is an
admin or the visit's own therapist (the therapist before the update), or there is no signed-in user.

Triggers:
- `visits_enforce_package_limit` (`enforce_package_session_limit()`): ensures a package cannot exceed its total session limit. Since `20261028210000`, excludes the row itself (`id != new.id`) so upserts (`INSERT ... ON CONFLICT DO UPDATE`) when editing an existing visit session never falsely count the row being updated.
- `visits_enforce_plan` (`enforce_clinic_plan_on_visit_insert()`): checks monthly visit quotas per clinic plan; also excludes `id != new.id` so editing existing visits does not count against new-visit quotas.

#### `visit_items` / `visit_credits` (multi-service, multi-therapist visits)

Migration `20261023100000_visit_items_and_credits.sql`, Dexie `version(26)`. Both hang off a visit
(`visit_id → visits.id ON DELETE CASCADE`), sync through the outbox like visits (in `ALL_SYNCED_TABLES`
and `CLIENT_WRITABLE_TABLES`, published to realtime), soft-delete with `deleted`, carry
`created_by/updated_by/updated_at` set by `set_updated_at()`, and have the sync tombstone and audit
(`audit_row_change`) triggers. A visit with no `visit_items` rows (all older visits) is read as one
implicit line built from its own columns; no backfill.
```sql
-- visit_items: one row per service on a visit
id, clinic_id, visit_id   uuid NOT NULL
position                  int NOT NULL — display order; position 0 = the visit's main service
service_catalog_id        uuid NOT NULL (FOREIGN KEY → service_catalog.id)
service_name              text NOT NULL — snapshot at entry
catalog_price_paise       bigint NOT NULL — snapshot at entry
price_paise               bigint NOT NULL — the line's price before the visit-level adjustment
assisting_therapist_id    uuid (FOREIGN KEY → therapists.id, NULLABLE) — null = the visit's
                           primary delivered it; set = assistant tagged on this service
duration_minutes          smallint (NULLABLE, 1–480) — snapshot of the service's duration
is_package_line           boolean NOT NULL (default false)
session_share_therapist_id uuid (FOREIGN KEY → therapists.id, NULLABLE) — "Share": a colleague who helped
                           with this service (never the one who did it = assisting_therapist_id ?? visit therapist)
session_share_pct         smallint (NULLABLE, 1–99) — their % of this service; whoever did it keeps the rest. Both
                           set or both null. On a PACKAGE line the money moves through package attribution (payBase);
                           on any other line through the visit's revenue shares (autoCredits). Migrations
                           20261026100000 (package lines), 20261026110000 (any service). Names kept for sync
deleted                   boolean NOT NULL (default false)
INDEXES: visit_id; (clinic_id, updated_at, id); UNIQUE (visit_id) WHERE is_package_line AND NOT deleted

-- visit_credits: one row per therapist credited on a visit
id, clinic_id, visit_id   uuid NOT NULL
therapist_id              uuid NOT NULL (FOREIGN KEY → therapists.id)
amount_paise              bigint NOT NULL (>= 0) — share of the visit's actual_bill_paise
deleted                   boolean NOT NULL (default false)
INDEXES: visit_id; (clinic_id, updated_at, id)
```
- A line's **deliverer** is `assisting_therapist_id ?? visits.therapist_id`, so changing the primary
  needs no line updates. Trigger `check_visit_item` rejects an assistant equal to the visit's
  therapist (not checked on a deleted line), a line whose `clinic_id` differs from its visit's, and an
  assistant who isn't a therapist of that clinic; `check_visit_credit` does the clinic check for shares
  and requires the credited therapist to be of that clinic (all errcode 23514).
- **Invoiced visits freeze their lines**: `protect_invoiced_visit_items` rejects insert/update/delete
  of a line whose visit has `invoice_id` (errcode 42501, "This visit is on an invoice; its services are
  frozen."; a delete cascading from a visit/clinic delete is let through, for `admin_delete_clinic` /
  `admin_wipe_clinic_data`). Since `20261024100000` an UPDATE is refused only when a content column
  changes (`visit_id`, `service_catalog_id`, `service_name`, `catalog_price_paise`, `price_paise`,
  `assisting_therapist_id`, `duration_minutes`, `is_package_line`, `deleted`, `position`). The sync and
  backup restore push with an upsert (INSERT … ON CONFLICT DO UPDATE): an upsert of an EXISTING line skips
  the insert check and is judged as an update, so one that changes no content column is accepted; a new
  line, or a changed content column, on an invoiced visit is refused. Shares stay editable after invoicing (internal, not on the invoice; the audit trail logs it).
- Invariants kept by the app (not the server): Σ line `catalog_price_paise` = `visits.catalog_price_paise`;
  Σ line `price_paise` + `adjustment_paise` = `actual_bill_paise`; Σ live credits = `actual_bill_paise`,
  the primary always has a row.
- RLS (both): select any clinic member; **insert** admin, front desk, the parent visit's own therapist,
  or whoever created the visit (`visits.created_by = auth.uid()`, stamped by `set_updated_at()` on the
  server insert, so a therapist logging a visit for a colleague can add its lines and shares, also when
  pushed later from offline; since `20261024100000` only while the visit is not invoiced) — helper
  `can_add_visit_children(visit_id)`; **update/delete** admin, front
  desk or the parent visit's own therapist (`can_edit_visit_children(visit_id)`; update's `with check`
  applies it to the new row, so a line or share can't be moved onto a visit the caller couldn't edit).
  An assisting or unrelated therapist cannot add, change or delete lines or shares, so nobody can credit
  themselves on someone else's visit.
- Client: `repos.visitItems` / `repos.visitCredits` — `listByVisitIds(ids)`, `listByClinic(clinicId,
  range?)` (range = the parent visit's date, inclusive; deleted visits skipped), `bulkPut(rows)` (rows +
  outbox entries in one transaction). Reads skip `deleted` rows, except `listByClinicIncludingDeleted(clinicId)`
  (only for "does anything still reference this?" checks). Dexie indexes: `visit_items: id,
  clinicId, visitId, [clinicId+updatedAt]`; `visit_credits: id, clinicId, visitId, therapistId`.
- **Saving visits (`visitService`)**: `create` takes `lines: {serviceCatalogId, assistingTherapistId?,
  packageContinuation?}[]` (the old single `serviceCatalogId` input still works and becomes one line) and
  writes the visit, its lines and its auto shares (`autoCredits`; a clinic with the therapist split off
  gets one primary share = the bill) through `repos.visits.putWithChildren(visit, items, credits)` — ONE
  Dexie transaction, outbox entries queued visit, then lines, then shares. `visits.service_catalog_id` =
  first line; package columns come from the package line (a continuation, or a multi-session service).
  Both `create` and `updateLines` set `visits.service_lines_count` to the number of live lines written.
  A package continuation (on a line, or the old input's `packageGroupId`) must belong to the same patient
  ("That package belongs to another patient.").
  `updateLines(visitId, lines, adjustment)` refuses invoiced visits ("its services are frozen"), writes
  only rows that changed, recomputes bill and rate snapshot as `updateBilling` does, rewrites shares in
  `auto` mode and returns `sharesOutdated: true` in `manual` mode. `setShares(visitId, rows)` (allowed on
  invoiced visits) requires Σ = bill, no negative share, the package holder (deliverer of the package
  line; the primary with split off) never below that line's net, the primary present, everyone in the
  visit's clinic, and sets `credits_mode = 'manual'`; `recalculateShares` returns to `auto` (both refuse a
  deleted visit: "This visit was deleted.").
  `updateBilling` follows a bill or primary change (auto shares rewritten, manual → `sharesOutdated`);
  a line tagged with the new primary has its tag cleared. **Push order matters** (the server rejects
  some intermediate states permanently and the sync would revert the local row): a line that frees the
  visit's single package slot (removed, or no longer the package line) is queued BEFORE the one that
  takes it (known gap: the sync merges queued entries for a row at its oldest position, so a slot-taking
  row that already had an older pending entry can invert this; the server answers 23505 and the row
  reverts), and a tag-clearing line write is queued before the visit row as a safety ordering
  (`putWithChildren` option `itemsFirst`; the server doesn't require it). `updateLines` without an
  explicit bill keeps the visit's adjustment (new subtotal + old adjustment, reason kept; cleared only
  if that would go below ₹0), refuses deleted visits, keeps an existing line's package flag, and refuses
  to remove a package purchase line while later sessions of that package exist. In manual mode a primary
  change moves the old primary's share row to the new primary when they had none. Legacy `setSplit` still
  writes `shared_therapist_id/shared_pct` and now also two manual share rows (assistant = bill × pct
  rounded to the rupee, primary = remainder); clearing it returns the visit to auto shares.
- **Catalog "never used"**: `visits.countByService` counts visits on the service plus live `visit_items`
  on it (a service used only as a later line of a multi-service visit can't be hard-deleted).
- **Deleting a therapist**: `hard_delete_therapist` (redefined in `20261024100000`) counts, as linked
  records, each visit the therapist is on once — as its therapist, the old split's shared therapist, an
  assistant on a line, or the holder of a share (live and soft-deleted lines/shares: a soft-deleted row
  still references the therapist) — plus their notes and invoices, and refuses with "therapist has N
  linked record(s); deactivate instead of deleting" rather than a raw foreign-key error. Settings → Team
  checks the same first (`features/settings/therapistLinks.ts` `countTherapistLinkedRecords`).

#### `invoices`
```sql
id                  uuid PRIMARY KEY
clinic_id           uuid NOT NULL (FOREIGN KEY → clinics.id)
invoice_no          text NOT NULL — `PREFIX/FY-LABEL/NNNN`
fy_label            text NOT NULL (e.g., "26-27")
seq                 int NOT NULL
issued_at           timestamptz NOT NULL
patient_snapshot    jsonb NOT NULL — patient details at issue time
line_items          jsonb NOT NULL — see "Invoice line items (v2)" below
total_paise         bigint NOT NULL
payment_mode        text NOT NULL — 'Cash' | 'Card' | 'UPI' | 'Insurance'
therapist_id        uuid (FOREIGN KEY → therapists.id, NULLABLE)
supersedes_invoice_id uuid (FOREIGN KEY → invoices.id, NULLABLE) — set on an amendment
clinical_snapshot   jsonb (NULLABLE) — see "Clinical context on the bill" below
created_by, updated_by  uuid (NULLABLE)
updated_at       timestamptz NOT NULL
```
Immutable once issued (DB trigger) — with one narrow exception:
`clinical_snapshot` alone can be corrected in place afterward, see "Editing
clinical details after issuance" below and §3d. Payment status is **not** a
column here — see `invoice_payments` below.

**Invoice line items (v2).** `line_items` is opaque jsonb — a legacy invoice's
entries have only the original 6 fields (`serviceName`, `sessionCount`,
`sessionDates`, `catalogPricePaise`, `adjustmentPaise`, `adjustmentReason`,
`totalPaise`); every invoice issued or amended since the Billing & Notes
Rebuild Phase 1 gets a v2 entry, marked by `lineItemVersion: 2`, adding
`billedSessionCount`, `authorizedSessionCount` (null = not a package),
`ratePerSessionPaise` (snapshotted, never re-derived from live catalog
prices), `rateBasis`, `adjustmentReasons` (a merged group can span more than
one), and `therapistIds` (ditto). `sessionCount`'s meaning is unchanged
(`authorizedSessionCount ?? billedSessionCount`) so old readers of the raw
field still work. All build- and print-side code goes through
`src/domain/invoiceLine.ts` (`isV2Line`, `lineRatePerSessionPaise`,
`sessionCountLabel`, `lineReconciles`, `normalizeAuthorizedCount`,
`invoicePeriod`) rather than reading either shape directly, so the two
sides can't drift the way the invoice-print page and the insurer-packet
summary once did.

**Bill by service, not just by package.** Invoice line grouping
(`invoiceService.ts` → `invoiceLine.ts`'s `groupVisitsForInvoicing`) keys on
`packageGroupId` when present, otherwise on `service + catalog price` — so
several independently-logged (non-package) visits of the same service at
the same price collapse into one line reading "10 sessions," not ten
separate ₹0-context rows. A merged line's `catalogPricePaise` is always the
**sum** of every visit's own snapshot in the group (not one visit's), which
is what keeps `catalogPricePaise + adjustmentPaise = totalPaise` holding
exactly for every line, by construction.

**One invoice line per service.** Billing units, not visits, are what get
grouped: a visit with live `visit_items` contributes one unit per line,
carrying that line's net (`lineNets` — the visit's bill spread pro rata, whole
rupees, exact sum); a visit without live lines is one unit and prints exactly
as before. A unit's catalog snapshot is the line's `catalogPricePaise` and its
adjustment is net − catalog price (with the visit's adjustment reason), so
`lineReconciles` stays true. Only the PACKAGE line groups by `packageGroupId`
(and takes `authorizedSessionCount` from the visit's package total); an add-on
line on a package visit groups by `svc:{serviceCatalogId}:{catalogPricePaise}`
like any other service. The invoice shows only the primary therapist: line
`therapistIds` and the invoice-level `p_therapist_id` (highest total billed
wins) are computed over the visits' primaries, never assistants. Issuing and
amending refuse ("Some of these services are still syncing…") while any of
the visits, their lines or their shares still has an outbox entry
(`pendingVisitSync`; an entry the server refused, i.e. with `error` set, gets its own message telling the user to fix or discard it from the unsynced changes notice), because the server freezes a visit's lines once it
has an invoice and a line pushed afterwards would be rejected and reverted.
They also refuse ("This visit's services haven't all arrived on this device yet. Try again in a
moment.") a visit whose live lines on this device are fewer than its `serviceLinesCount`: its lines
reached the server after the visit and haven't been pulled here yet, so billing it now would bill the
wrong services and freeze the late lines out. Preview, issue and amend share this check (`buildLineItems`);
visits without a count (older ones) are not checked.

**Long-running packages (e.g. post-op TKR/THR rehab, 20-30+ sessions).**
Nothing in the schema or invoicing logic caps a package's session count —
a 24-session package invoices through the exact same line-item build as a
3-session one. The one place volume affects the printed layout: a line's
"Dates of service" column would otherwise list every individual date,
wrapping into an unreadably dense cell past a handful of sessions.
`sessionDatesDisplay()` (`src/domain/invoiceLine.ts`) condenses to a
"from – to (N sessions)" range once a line has more than 8 session dates;
at or under that it still lists every date. Used by both
`InvoicePrintPage.tsx` table variants (legacy and v2); the Insurer Packet's
invoice summary and the issue-invoice preview step never showed the date
list in the first place — they already use the compact `sessionCountLabel`
— so neither needed a change. `SessionLogPrintPage`'s trend grid is
unaffected by volume in a different way: it's one row per session with no
condensing, since a clinical trend genuinely needs every date as its own
row; print pagination (not this page) is what splits a long table across
pages.

**Partial-package printing.** A package billed in full but only partly
delivered prints its real total (not a fabricated partial amount), with a
caption under the service name whenever the row's own arithmetic doesn't
reconcile (`lineReconciles()` — checks `billedSessionCount ×
ratePerSessionPaise + adjustmentPaise = totalPaise` exactly, catching both
a genuine partial delivery and a plain rounding mismatch on a fully-billed
package). The Sessions column itself reads "N delivered of M authorised" on
a non-reconciling row so the printed numbers don't invite the reader to
multiply Rate × the smaller number and land on the wrong answer.

**Clinical context on the bill.** `clinical_snapshot` (nullable jsonb, old
invoices predate it) holds `diagnosis`, `diagnosisIcdCode`,
`referringPhysician`, `physicianRegistrationNo`, `placeOfService`
('clinic' | 'home'), `treatmentPerformed`, `sourceNoteId` (provenance), and
`editedByBiller`. Pre-filled in `IssueInvoiceDialog` from the visit's own
completed note, falling back to the patient's most recent completed heavy
(initial/follow-up) note — a light session note (see Light Session Notes
below) has no referral field to pull from. Editable before issuing, then
frozen with the rest of the invoice (never re-read from the note
afterward). **Multi-visit billing.** Patient Profile's select-visits bar shows the running total ("14 selected · ₹21,000") and one button. For billing users it opens `IssueInvoiceDialog` with `target.visitIds` (all selected, not yet invoiced), which previews and issues ONE invoice via `issueForVisits` and, with "Collected now", records the payment through `collectInvoiceNow` (split across the visits oldest-first) — issue and collect in one step; the same clinical pre-fill and payment-mode choice as a single visit apply. Without billing (Lite) the same bar offers "Collect ₹X", opening `BulkCollectDialog`: one direct payment per owing visit, in full, one method and date; a mid-way failure keeps the earlier ones and says how many. A row's own "Collect ₹X" opens `TakePaymentDialog` on the profile (previously a dead click).

**Preview before issuing.** `IssueInvoiceDialog` is a two-step flow: "Review
invoice" moves from the fields form to a review screen built from
`invoiceService.previewLineItems()` — the same line-item build
`issueForVisits` itself calls (via the shared `buildLineItems` closure in
`invoiceService.ts`), so the preview can never drift from what actually
gets issued. No RPC call happens until "Confirm & issue" on the review
screen; "← Back to edit" returns to the form with every field intact.

**Editing clinical details after issuance.** Once issued, `clinical_snapshot`
alone can still be corrected — a typo'd diagnosis, a missed physician
registration number — without reopening the financial record. "Edit
details" on `InvoicePrintPage` opens `EditInvoiceDetailsDialog`
(`src/components/EditInvoiceDetailsDialog.tsx`), pre-filled from the
invoice's existing snapshot, calling the `update_invoice_clinical_details()`
RPC (§3d). This is deliberately narrower than an amendment: the amount,
line items, and invoice number are untouched and no new invoice number is
minted — for those, "Amend this invoice" (§3b) is still the only path. The
clinical-fields form itself (`InvoiceClinicalFieldsForm`,
`src/components/InvoiceClinicalFields.tsx`) is shared between this dialog
and `IssueInvoiceDialog` rather than duplicated.

**Share via WhatsApp.** "Share via WhatsApp" on `InvoicePrintPage` renders
the same DOM node "Print / Save PDF" shows into an actual PDF, entirely
on-device (`renderElementToPdf` in `src/lib/pdfShare.ts`, via `html2canvas`
+ `jsPDF` — no server round trip, matching this app's offline-first
design), then hands that file to the Web Share API so WhatsApp — or any
other installed app — shows up in the OS share sheet with the real PDF
attached (`shareFileToWhatsApp`). Both libraries are dynamically imported
only when the button is clicked (a ~180KB-gzip chunk that every invoice
view would otherwise pay for, whether or not Share is ever used). Web
Share API's `files` support is mobile-browser-only (recent Chrome/Android,
Safari/iOS); on a browser without it (desktop, mainly), this falls back to
a `wa.me` click-to-chat link carrying just a text summary — WhatsApp's own
link scheme has no way to carry a file, so the fallback is deliberately
text-only rather than silently doing nothing.

**UPI listed and defaulted first.** `PAYMENT_MODES` in `IssueInvoiceDialog`/
`AmendInvoiceDialog` and `PAYMENT_METHODS` in `NewVisitPage`'s direct-
payment collector all list UPI before Cash, and `IssueInvoiceDialog`/
`NewVisitPage` default their selection to UPI — the most common collection
method at an Indian clinic front desk. `AmendInvoiceDialog` is the one
exception: its default still carries over the original invoice's own
`paymentMode` rather than defaulting to UPI, since it's correcting an
already-issued bill's record, not starting a fresh collection.

#### `invoice_counters`
```sql
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
fy_label        text NOT NULL
next_seq        int NOT NULL (default 1)
PRIMARY KEY (clinic_id, fy_label)
```

---

### Financial Tables

#### `invoice_payments`
```sql
id              uuid PRIMARY KEY
invoice_id      uuid NOT NULL (FOREIGN KEY → invoices.id)
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
status          text NOT NULL — 'paid' | 'outstanding' | 'void'
paid_at         timestamptz (NULLABLE)
void_reason     text (NULLABLE) — only on a void row
voided_at       timestamptz (NULLABLE) — only on a void row
created_by, updated_by  uuid (NULLABLE)
created_at, updated_at  timestamptz
```
Lives apart from `invoices` (which is immutable once issued). A missing row
for an invoice reads as **paid** — see the payment-state note in Key Design
Patterns below. Deliberately has **no amount column** — flipping `status` is
the only write this table itself supports; a partial amount toward an
invoice is tracked via `payments` below instead (see
`paymentService.recordInvoicePayment()`), keyed to the invoice's own
constituent visits.

`'void'` is reachable only through `void_invoice()` (see §3c): the
`guard_invoice_void` trigger rejects a client writing it directly and makes
it final.

#### `payments`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
visit_id        uuid NOT NULL (FOREIGN KEY → visits.id)
amount_paise    bigint NOT NULL
method          text NOT NULL — 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque' | 'partner' (collected by the partner; not cash in hand)
received_date   date NOT NULL
notes           text (NULLABLE)
advance_id      uuid (FOREIGN KEY → patient_advances.id, NULLABLE — see below)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```
A payment toward one visit's bill — cash/UPI collection recorded without
requiring an invoice, and supports partial payments (an amount less than
the visit's bill). No `invoice_id` column: this same table is also how a
*partial* payment against an **invoiced** visit's bill is recorded (an
invoice itself has no amount-paid field — see `invoice_payments` above),
so a payment stays keyed to the visit it was collected for either way. For
an invoice spanning several visits, one entered amount is allocated across
those visits' `payments` rows in date order — the shared
`allocateAcrossVisits()` helper in `src/services/advanceService.ts` (both
`paymentService.recordInvoicePayment` and advance draw-down use it, so the
two paths can't allocate differently). `advance_id` is set only when this
payment was drawn down from a patient's advance balance rather than
collected fresh; `visit_id` still stays required either way, so
`computeVisitPaymentState` needs no special-casing for advance-funded
payments.

#### `patient_advances`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
amount_paise    bigint NOT NULL (> 0)
method          text NOT NULL — 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque' | 'partner' (collected by the partner; not cash in hand)
received_date   date NOT NULL
receipt_no      text (NULLABLE) — no numbered series yet, see below
notes           text (NULLABLE)
status          text NOT NULL default 'open' — 'open' | 'exhausted' | 'refunded' | 'void'
deleted         boolean NOT NULL default false
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (id, clinic_id) — backs the composite FK on payments.advance_id below
```
Money received ahead of treatment. **Not a `payments` row until drawn
down** — `computeVisitPaymentState` and everything derived from it (badges,
the needs-receipt queue, dashboard KPIs) stays untouched by an advance
until a real `payments` row is written against a real visit
(`advanceService.applyAdvance`), which stamps that row's `advance_id` and
flips this row's `status` to `'exhausted'` once the balance reaches zero.
Remaining balance is computed, not stored:
`amount_paise − Σ payments.amount_paise where advance_id = this.id`.
`payments.advance_id` is a **composite** FK to `(id, clinic_id)` rather
than a plain `references patient_advances(id)`, so a payment can never
reference a different clinic's advance even by a client bug — RLS already
scopes reads correctly, but this closes the write-side gap outright.
`method` uses the `PaymentMethod` vocabulary (`'cash'|'upi'|…`), not the
older `PaymentMode` (`'Cash'|'Card'|'UPI'|'Insurance'`) that belongs only
to `Invoice.paymentMode` — easy to confuse. **No gap-free numbered receipt
series yet** — `receipt_no` exists but is unused; the printed
`AdvanceReceiptPrintPage` identifies a receipt by date + a short slice of
its id instead. A real counter can be added later with no data migration
if it turns out to matter. Entry point: Patient Profile's "Record advance"
button; `TakePaymentDialog` also surfaces "₹X advance available — apply"
and draws down (oldest advance first) when a patient with an open balance
is being collected from elsewhere.

#### `settlements`
```sql
id                     uuid PRIMARY KEY
clinic_id              uuid NOT NULL (FOREIGN KEY → clinics.id)
year, month            int NOT NULL
amount_received_paise  bigint NOT NULL
received_date          date (NULLABLE)
notes                  text (NULLABLE)
created_by, updated_by uuid (NULLABLE)
updated_at             timestamptz (NULLABLE)
```
Per-month partner-hospital (HV) settlement record, for the Monthly Report's
variance tracking. **Deprecated single-entry model** — superseded by
`settlement_payments` below; left in place (not dropped) for audit/rollback,
and its rows were backfilled into `settlement_payments` as each period's
first tranche (migration `20260912070000_settlement_payments.sql`).
`settlementService.get`/`.save` still read/write it for backward
compatibility, but no UI writes new rows to it anymore.

#### `settlement_payments`
```sql
id                     uuid PRIMARY KEY
clinic_id              uuid NOT NULL (FOREIGN KEY → clinics.id)
year, month            int NOT NULL
amount_received_paise  bigint NOT NULL
received_date          date (NULLABLE)
notes                  text (NULLABLE)
created_by, updated_by uuid (NULLABLE)
updated_at             timestamptz NOT NULL
```
One row per partner-hospital payment **tranche** for a month — replaces
`settlements`' assumption that a month settles in one lump sum. A real
payout is often an advance plus a final payment, sometimes with a deduction
that only makes sense noted against the specific tranche it applied to.
Any number of rows can share `[clinic_id, year, month]`; the month's total
received is their sum (`settlementService.totalReceived`), computed
client-side, not stored. `SettlementCard` (Monthly Statement page) lists
every tranche with edit/delete, and a form to record another.

---

### Clinical Documentation Tables

#### `consultation_notes`
```sql
id                        uuid PRIMARY KEY
clinic_id                 uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id                uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id              uuid NOT NULL (FOREIGN KEY → therapists.id)
visit_id                  uuid (FOREIGN KEY → visits.id, NULLABLE)
appointment_id            uuid (FOREIGN KEY → appointments.id, NULLABLE) — note
                           started from an appointment / walk-in before the
                           visit existed; visit_id is filled in when it's logged
enrollment_id             uuid (FOREIGN KEY → patient_module_enrollments.id, NULLABLE)
note_mode                 text (NULLABLE) — 'initial' | 'followup' | 'session'
                           ('session' = light SOAP note, everything else is
                           the heavy Core Assessment editor; null = legacy
                           row predating this field, treated as heavy)
status                    text NOT NULL — 'draft' | 'completed' | 'archived'
assessment_payload        jsonb (NULLABLE) — either the whole Core Assessment
                           form (history, pain, PSFS, body chart, objective
                           exam, treatment/HEP) or, when note_mode='session',
                           domain/sessionNote.ts's small SOAP payload — one
                           versioned/upcastable blob either way, shape keyed
                           off note_mode, not separate columns per section
authorized_session_count  int (NULLABLE)
notes_text                text (NULLABLE)
nrs_score                 int (NULLABLE) — derived, for outcome tracking
psfs_mean                 numeric (NULLABLE) — derived
red_flag_count            int NOT NULL — derived
created_by, updated_by    uuid (NULLABLE)
updated_at                timestamptz NOT NULL
```

**`visits.consultation_note_id` only ever points at a *completed* note —
a draft never gets written back onto the visit row.**
`consultationNoteService.saveAssessment()` deliberately updates
`visits.clinical_status`/`consultation_note_id` only when `status ===
'completed'` ("a draft save deliberately does not — the note isn't
finished yet, so the visit should keep prompting until it is"). So any
UI that wants to show a visit's note status (draft vs. completed vs.
none) — the Ledger/Workspace/Patient-Profile visit-row "Note" column —
can't trust the visit's own field alone; it has to join against
`consultation_notes` on `visit_id` (`VisitCardData.consultationNoteId`/
`noteStatus`, computed independently at each of those three call sites,
same pattern as `packageInvoicePending` above). Ledger/Workspace fetch
`consultationNotes.listByClinic()` once (clinic-wide, skipped for a
viewer without `canViewClinicalNotes`) and index it by `visitId`; Patient
Profile already loads the patient's full note history via
`listByPatient`, so it just re-indexes what it has.

#### `patient_module_enrollments`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
module_type     text NOT NULL, CHECK in ('gut_screening', 'return_to_sport',
                 'scoliosis_screening', 'face_scale', 'facial_palsy',
                 'consultation_notes')
status          text NOT NULL — episode open/closed state
created_by, updated_by  uuid (NULLABLE)
enrolled_at, updated_at  timestamptz NOT NULL
```
Only `'consultation_notes'` is actually written client-side today
(`consultationNoteService.ts`) — the other five values are schema-permitted
(matching the five region-module response tables above) but nothing in
`src/` creates an enrollment with them.

#### `ai_generation_log`
```sql
id                uuid PRIMARY KEY
clinic_id         uuid NOT NULL (FOREIGN KEY → clinics.id)
consultation_id   uuid NOT NULL (FOREIGN KEY → consultation_notes.id)
raw_ai_output     text NOT NULL
model_name        text NOT NULL
created_at        timestamptz NOT NULL
```

#### Region-module response tables
Each region module (opt-in extensions to Core Assessment) has its own
response table, all following the same shape: `id`, `clinic_id`, `patient_id`,
`enrollment_id` (FK → `patient_module_enrollments.id`, NULLABLE), a `responses
jsonb` blob, one or two derived score/category columns, `created_by`/
`updated_by`, `updated_at`.

- **`screening_responses`** — `computed_score numeric`, `triage_level text`
- **`return_to_sport_responses`** — `computed_score numeric`, `risk_category text`
- **`scoliosis_screening_responses`** — `cobb_angle numeric`, `severity_level text`
- **`face_scale_responses`** — `side_affected`, `visit_label`, `vas_movement`,
  `vas_qol`, `domain_scores jsonb`, `total_score numeric`
- **`facial_palsy_assessments`** — `side_affected`, `visit_label`, `hb_grade`,
  `sunnybrook_resting/voluntary/synkinesis jsonb`, `sunnybrook_score numeric`,
  `synkinesis_total int`

None of the five has a Dexie table, repo, sync entry, or any UI anywhere in
`src/` — they're reserved schema for modules that haven't been built, not
available features. Only `face_scale_responses` and
`facial_palsy_assessments` even have `can_use_module()`-gated RLS on insert/
update (see `clinic_module_settings`/`clinic_entitlements` below); the
other three (`screening_responses`, `return_to_sport_responses`,
`scoliosis_screening_responses`) have no entitlement check at all — any
clinic member can write to them.

#### Consent tables
```sql
consent_form_templates:
  id, clinic_id, consent_type, version, locale, title, body_text, purpose,
  is_active, effective_from, created_by, updated_by, updated_at

consents:
  id, clinic_id, consent_type, template_id (FK), subject_type,
  patient_id (NULLABLE), therapist_id (NULLABLE), granted, granted_at,
  granted_via, evidence_url, withdrawn_at, withdrawn_reason, captured_by,
  created_by, updated_by, updated_at
```
`current_consents` is a **view** (not a table) over `consents` exposing the
latest, still-in-force consent per subject (`is_in_force boolean`).

---

### Additional Tables

#### `feedback_requests` / `feedback_responses` / `message_log` (Patient Communications, Phase 0–3)
```sql
-- feedback_requests: one row per "ask this patient for feedback" action
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
visit_id        uuid NOT NULL (FOREIGN KEY → visits.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id    uuid NOT NULL (FOREIGN KEY → therapists.id) — denormalized from the visit for RLS
token           text NOT NULL UNIQUE — 256-bit, base64url, server-generated default
status          text NOT NULL — 'pending' | 'responded' | 'expired'
expires_at      timestamptz NOT NULL (default now() + 21 days)
created_by, updated_by  uuid (NULLABLE)
created_at, updated_at  timestamptz NOT NULL
-- one pending request per visit — unique partial index on visit_id where status = 'pending'

-- feedback_responses: the patient's submission (only written by
-- submit_feedback_response(), a SECURITY DEFINER function — no client INSERT policy exists)
id           uuid PRIMARY KEY
request_id   uuid NOT NULL UNIQUE (FOREIGN KEY → feedback_requests.id)
clinic_id    uuid NOT NULL (FOREIGN KEY → clinics.id) — denormalized so admin-only RLS needs no join
rating       smallint NOT NULL (1-5)
comment      text (NULLABLE)
created_at   timestamptz NOT NULL
updated_at   timestamptz NOT NULL (default now()) — always == created_at;
             the row is immutable, this column exists only because the
             sync engine hardcodes updated_at as every table's delta
             column (Phase 2 migration)

-- message_log: shared audit trail for every send action across all four
-- patient-comms workflows (only feedback_request is wired up so far)
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
kind                  text NOT NULL — 'feedback_request' | 'booking_confirmation' | 'therapist_notify' |
                        'google_review' | 'reminder_stale_package' | 'reminder_single_visit' |
                        'payment_reminder'
recipient_patient_id  uuid (NULLABLE, FOREIGN KEY → patients.id)
recipient_phone       text (NULLABLE)
channel               text NOT NULL — 'wa_share' | 'wa_business_api'
sent_by               uuid (NULLABLE, FOREIGN KEY → auth.users.id)
sent_at               timestamptz NOT NULL
```
RLS: `feedback_requests` is member-visible (status carries no rating/comment
content) but only admin/front_desk/own-therapist can insert or update it —
same shape as the visits table's own admin-or-own-therapist policies.
`feedback_responses` SELECT is `is_clinic_admin()` only — front desk and
therapists get zero visibility into ratings/comments, at the database layer,
not just hidden in the UI. Two SECURITY DEFINER RPCs — `get_feedback_request_by_token()`
and `submit_feedback_response()` — are explicitly granted EXECUTE to `anon`;
every other function in this schema either relies on `is_clinic_member()`
failing for an anonymous caller or explicitly revokes that default. A
`public_rpc_rate_limit` table (self-pruning, no cron dependency) throttles
both by client IP.

`feedback_requests` is a synced Dexie table (`ALL_SYNCED_TABLES`, pulled
like any other clinic data) but **not** in `CLIENT_WRITABLE_TABLES` — staff
creation and resend both go through online-only RPCs
(`create_feedback_request`, `rotate_feedback_request_token`) rather than
the outbox, so the local write is always a `putLocal` caching a
server-confirmed row, never a queued push. (An earlier version created
through the outbox with `token` left unset for the column default to fill
in; that meant the token — and so the ability to share it — didn't exist
until the next sync pull, so the very first "Ask for feedback" click never
opened a share sheet. See `create_feedback_request` below.)
`feedback_responses` (Phase 2) is also synced, but read-only client-side —
`ALL_SYNCED_TABLES` without `CLIENT_WRITABLE_TABLES`, same shape as
`invoices` — since a response is only ever written by the anonymous
patient's own SECURITY DEFINER RPC call; it needed an `updated_at` column
added (a permanent alias for `created_at`, purely so the sync engine's
hardcoded delta-column assumption holds) since the row is otherwise
immutable. `message_log` has no Dexie table or repo at all — the app never
reads or writes it directly.

`create_feedback_request(p_visit_id uuid) returns table(...)` (Phase 1,
added after the outbox-creation gap above was found) — `security invoker`,
EXECUTE revoked from `public`/`anon` and granted only to `authenticated`.
Derives `clinic_id`/`patient_id`/`therapist_id` from the `visits` row
rather than trusting client-supplied values, then inserts a new
`feedback_requests` row — or, on `ON CONFLICT (visit_id) WHERE status =
'pending'` against the existing `feedback_requests_one_pending_per_visit`
partial unique index (a double-click race), rotates the existing pending
row's token instead of erroring — and returns the full row in one round
trip. The existing `feedback_requests_insert` RLS policy is the real
authorization boundary.

`rotate_feedback_request_token(p_request_id uuid) returns text` (Phase 1) —
`security invoker`, EXECUTE revoked from `public`/`anon` and granted only
to `authenticated`. Rotating an existing row's token is an UPDATE, where
column defaults never fire, so "resend" needs this small RPC rather than
the outbox; the existing `feedback_requests_update` RLS policy is the real
authorization boundary, same as any other invoker-security RPC in this
schema.

**`clinics.google_review_url`** (Phase 3) — nullable text; unset means the
Google review nudge never shows, on either the public thank-you page or
the staff visit-row action, regardless of rating.
`submit_feedback_response(p_token text, p_rating int, p_comment text)
returns text` (was `returns void` through Phase 0-2) — now returns the
clinic's `google_review_url` when `p_rating >= 4` and one is configured,
`null` otherwise; the public thank-you page conditions "Leave a Google
review" on this return value instead of a second round trip. Return-type
changes require dropping the function first (grants don't survive a drop,
so the migration re-states them).

`list_google_review_eligible_requests(p_clinic_id uuid) returns setof uuid`
— `security definer` (unlike `rotate_feedback_request_token` above, this
one must bypass RLS on purpose), EXECUTE revoked from `public`/`anon` and
granted only to `authenticated`. Lets a front_desk caller — who has zero
RLS visibility into `feedback_responses` at all, not just a filtered view
of it — ask "which requests currently qualify for a Google review nudge"
without the function ever returning a rating or a comment, just bare
`request_id`s where `rating >= 4`. The function body re-implements its own
narrower check (`is_clinic_member`) rather than relying on RLS, since RLS
itself is what's being deliberately bypassed here.

#### `appointments` / `appointment_requests` / `clinic_closed_dates` (Patient Communications, Phase 5 + Schedule MVP)
```sql
-- appointments: one confirmed expected attendance (not a billed visit)
id                     uuid PRIMARY KEY
clinic_id              uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id             uuid (NULLABLE, FOREIGN KEY → patients.id) — resolved at arrival
patient_name, patient_phone  text NOT NULL — raw values, kept after patient_id resolves
therapist_id           uuid (NULLABLE, FOREIGN KEY → therapists.id)
scheduled_at           timestamptz NOT NULL
source                 text NOT NULL (default 'booking') — 'booking' | 'walk_in'
                        (start_walk_in: a visit in progress started at the desk)
series_id              uuid (NULLABLE, indexed) — shared by the sessions of one
                        repeat booking (confirm_booking_series)
duration_minutes       integer NOT NULL (default 30, CHECK 5–240) — Schedule MVP;
                        backfilled from clinics.slot_duration_minutes
status                 text NOT NULL — 'confirmed'|'rescheduled'|'no_show'|'cancelled'|'arrived'
request_id             uuid (NULLABLE, FOREIGN KEY → appointment_requests.id)
visit_id               uuid (NULLABLE, FOREIGN KEY → visits.id)
reschedule_count       integer NOT NULL (default 0)
previous_scheduled_at  timestamptz (NULLABLE)
created_by, updated_by uuid (NULLABLE)
created_at, updated_at timestamptz NOT NULL

-- clinic_closed_dates: one row per closed calendar day (holiday / one-off closure)
id           uuid PRIMARY KEY
clinic_id    uuid NOT NULL (FOREIGN KEY → clinics.id)
closed_date  date NOT NULL — UNIQUE (clinic_id, closed_date)
label        text (NULLABLE) — "Diwali", "Staff training"
removed_at   timestamptz (NULLABLE) — soft delete: the sync pull only sees
             upserts, so "reopen" sets this instead of deleting the row
created_at, updated_at  timestamptz NOT NULL (set_updated_at trigger)
```
RLS: `appointments` SELECT is clinic-member-wide; `appointment_requests`
SELECT is admin/front_desk; `clinic_closed_dates` SELECT is clinic-member-wide
(RLS was missing entirely on this table until `20261001100000`). None of the
three has a write policy — every write is a SECURITY DEFINER RPC:
`confirm_booking_slot`, `create_appointment_staff`, `reschedule_appointment`,
`cancel_appointment`, `mark_appointment_no_show` (all gated by
`can_manage_appointment`, overlap checked by `therapist_has_overlap` using each
row's `duration_minutes`), `mark_appointment_arrived` / `link_appointment_visit`
(any clinic member), `confirm_booking_series` (same rules as a single booking,
all-or-nothing; clashes listed as UTC ISO times the client localises) /
`cancel_appointment_series(series, from)`, `set_therapist_working_hours`
(admin/front_desk only — see **Shift-based scheduling** for
`create_shift_template`, `update_shift_template`, `assign_shift`,
`assign_custom_hours`, `request_shift_assignment`, `request_custom_hours`,
`approve_shift_assignment`, `decline_shift_assignment`, `set_break_placement`,
all on `shift_templates`/`therapist_shift_assignments`, the same RPC-gated,
no-direct-write pattern as this table),
`start_walk_in(clinic, therapist, name, phone?, patient?)` (arrived walk-in, no
overlap check, own therapist or admin/front desk), `restore_appointment_slot`
(drag Undo, see Review fixes below), and
`set_clinic_closed_dates` /
`remove_clinic_closed_dates` (admin/front_desk, ranges up to 366 days). The
public `get_booking_availability(slug, start, end)` returns weekly closed
days, live (`removed_at is null`) closed dates, and non-cancelled
appointments with their `duration_minutes`, plus `therapistHours` (id → working_hours
for active therapists with custom hours). `reschedule_appointment(id, at, duration?, therapist?)`
(drop-and-recreate, pattern 3c): reassigning needs `can_manage_appointment` for both the
current and the new therapist; a pure resize (same start and therapist) doesn't bump
`reschedule_count` or the status.
**Review fixes** (`20261004100000_schedule_review_fixes.sql`):
- **No double booking under concurrency**: trigger `appointments_overlap_guard`
  (BEFORE INSERT OR UPDATE on `appointments`) takes a per-therapist
  `pg_advisory_xact_lock` and re-runs `therapist_has_overlap`, so two bookings at the
  same moment can't both commit. It skips walk-ins (`source = 'walk_in'`), cancelled
  rows, unassigned rows and updates that don't change the time, length or therapist
  (status changes, sync re-saves).
- `confirm_booking_series` compares requested starts by position, so duplicate
  timestamps in one request are flagged as clashes.
- `cancel_appointment_series` requires `can_manage_appointment` for **every** session it
  would cancel (sessions can have been moved to another therapist).
- `restore_appointment_slot(id, at, duration, therapist|null, status, reschedule_count,
  previous_scheduled_at)` backs the calendar's Undo after a drag. It restores the exact
  previous state, including Unassigned (admin / front desk only), and can only wind
  `reschedule_count` back, never forward.
- The `clinic_closed_dates` dedup in `20261001100000` breaks `created_at` ties on
  `ctid`, so a rebuild with duplicates from one transaction no longer aborts.
All three are synced, read-only Dexie tables (`ALL_SYNCED_TABLES` without
`CLIENT_WRITABLE_TABLES`); `clinic_closed_dates` arrived in Dexie `version(20)`,
and `repos.clinicClosedDates.listByClinic` filters out soft-deleted rows.
**Deploy order**: apply the migration before shipping the client — the sync
pull of `clinic_closed_dates` needs its `updated_at` column.

#### `audit_log`
```sql
id           bigint PRIMARY KEY
clinic_id    uuid (NULLABLE, FOREIGN KEY → clinics.id)
table_name   text NOT NULL
row_id       uuid NOT NULL
action       text NOT NULL — 'create' | 'update' | 'delete'
old_data, new_data  jsonb (NULLABLE)
changed_by   uuid (NULLABLE, FOREIGN KEY → auth.users.id)
changed_at   timestamptz NOT NULL
```

#### `no_return_reason_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
is_closed       boolean NOT NULL
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```
Every clinic gets an 8-item starter set (Moved away / relocated, Discomfort
with treatment, Cost / could not afford, Recovered — no longer needed care,
Switched to another provider, Lost contact / unreachable, Scheduling
conflict, Referred elsewhere) — seeded by `create_clinic_with_admin()` for
new clinics and by a one-time backfill migration for existing ones. Fully
editable afterward from Reports' "Manage reasons" panel (add / deactivate /
mark "counts as closed"); the starter rows aren't locked, just pre-filled.

#### `referring_source_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
detail_label    text (NULLABLE) — label for the follow-up detail field this
                source needs (e.g. "Referring doctor"), null if it needs none
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (clinic_id, name)
```
Clinic-editable list of referral channels shown when adding/editing a
patient (Settings → Catalog → Referral sources), same add / deactivate-not-delete / edit
pattern as `no_return_reason_catalog`. Seeded with the app's original six
labels (Hospital referral, Doctor referral, Walk-in, Word of mouth, Online,
Other) for every clinic — new via `create_clinic_with_admin()`, existing via
a backfill migration. `patients.referring_source_id` is the source of truth
for patients tagged after this catalog existed; the legacy
`patients.referring_source` enum column is kept (not backfilled) so older
patients keep displaying via the old `REFERRING_SOURCE_LABELS` fallback —
see `dashboardService.referralSourceStats` for how both are reconciled.

#### `treatment_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (clinic_id, name)
```
Clinic-editable list of treatment types (Manual Therapy, Exercise Therapy,
Kinesio Taping, ...), managed from Settings → Treatments, its own tab
alongside Services and Referral sources (all three used to be stacked in
one "Services" tab; split apart so each is its own scroll). Independent of
the billing-side `service_catalog` — one visit is
billed under one service package but can record several treatment types
performed via `visits.treatment_ids`, picked from the catalog on both the
visit-logging and edit-visit forms — plus a free-text add-on
(`visits.treatment_notes`, the same field clinical shorthand notes always
used) for anything not in the list, grouped under one "Treatments" field
on both forms. Displayed as a single combined "Treatments" column/cell
everywhere the visits table shows it (Ledger, Workspace, Patient Profile)
— catalog names joined by commas, then the free-text add-on after a dash
if present (`treatmentsDisplayText` in `components/VisitCard.tsx`) — not
two separate columns. Independent of Core Assessment/clinical docs too, so
it works for every clinic regardless of `clinicalDocsEnabled`. Patient
Profile's Care plan card shows a per-package breakdown (e.g. "Manual
Therapy: 4 · Exercise: 6") computed client-side from the patient's own
visits — no separate
aggregation query. Seeded with a 6-item starter set for every clinic.
Also shown as a toggleable "Treatments" column/row on the Visits table
(Ledger, Workspace, Patient Profile) — a separate `VisitColumnKey` from the
pre-existing free-text `'treatment'` (treatmentNotes) column.

#### `clinic_module_settings`, `clinic_entitlements` — live at the RLS layer, zero client integration
Not dead — `can_use_module(clinic_id, module_key)` (defined in
`20260718000001_module_registry.sql`, revised in
`20260721000001_entitlements_audit_log.sql`) checks `clinic_entitlements`
(fail-open: no row = entitled) then `clinic_module_settings` (fail-closed
otherwise, further gated by the caller's `clinic_members.role` against
`allowed_roles`), and is called from the insert/update RLS policies on
`consultation_notes`, `face_scale_responses`, and `facial_palsy_assessments`.
Every write to those three tables runs through it today.

What's genuinely missing is the **client side**: no Dexie table, no repo,
no sync, no UI anywhere in `src/` reads or writes either table — so nothing
in the app currently sets a narrower entitlement or surfaces a "this module
is off" state. In practice every clinic reads as fully entitled, because
nothing has ever populated `clinic_entitlements` with a restrictive row,
and every clinic gets a `clinic_module_settings` row for `'consultation_notes'`
seeded `enabled = true` (both the one-time backfill and the
`seed_default_module_settings()` AFTER INSERT trigger, in
`20260721000001_entitlements_audit_log.sql`). This is `can_use_module()`'s
**real, always-on gate for whether a note can be written at all** — but
there's no Settings toggle for it, so it stays on for every clinic by
construction, indefinitely, until someone writes SQL by hand.

**This is easy to conflate with `clinics.clinical_docs_enabled` (client-side,
has a Settings toggle) — but they act at different layers and never
conflict.** `can_use_module()` decides whether a note *can be written*
(server-side, RLS, always on). `clinical_docs_enabled` is a client-side
*visibility* flag deciding which clinical-documentation surfaces render.
Four read it:

| Surface | What `clinical_docs_enabled` gates |
| --- | --- |
| `visitService.ts` | auto-flags a new visit `clinicalStatus: 'pending'` |
| `NewVisitPage.tsx` | the "Add clinical note" CTA on the post-save screen |
| `LedgerPage.tsx` | the "Not documented" filter checkbox |
| `ReportsOverviewPage.tsx` | the modality-usage chart (query, nav entry, section) |

**One surface differs from those four, deliberately.**
`PatientProfilePage`'s `ConsultationNotePanel` — "New note" / "Continue
draft" — is gated on role (`canViewClinicalNotes`, i.e. every therapist,
never front desk) and *not* on `clinical_docs_enabled`. **Confirmed
intentional, not an inconsistency to fix:** notes access is role-based only
— every therapist always has it, full stop. The `clinical_docs_enabled`
surfaces above are a separate, opt-in layer on top of that baseline: does
*this clinic* want the per-visit reminder, the "Not documented" filter, and
the modality report — a workflow/reporting preference, not an access gate.
A clinic with the flag off still has every therapist able to write notes
from Patient Profile at any time; it just isn't nudged to do so on every
visit or tracked for completeness.

**Rule for any new consultation-notes entry point:** gate on
`canViewClinicalNotes` for access (matches Patient Profile). Gate on
`clinical_docs_enabled` only if the new surface is itself a reminder/filter/
report in the same spirit as the four above — not if it's a place to
actually write a note, which should behave like Patient Profile's baseline
and stay available regardless of the flag.

**Confirmed not tier-gated either** — no `PlanFeature` in `src/domain/plans.ts`
covers clinical notes today, by design (its own docstring excludes
"anything clinical-note- or advanced-module-content-shaped ... still open
design work"). **Tier restriction — note printing:** Lite cannot print or save-as-PDF a clinical note, session log or insurer packet. `PlanFeature` `notePrinting` (Lite off, Solo and above on) feeds `usePermissions().canPrintNotes`; `NotePrintPage`, `SessionLogPrintPage` and `InsurerPacketPage` render a `LockedSectionNotice` instead of the document (so a typed URL gets the same answer), and the entry links (note editor "Print", patient profile "Session log / Insurer packet") become a disabled "· Solo+" label. Writing notes is never gated. Display-level only — printing is client-side.

Note also that no admin-facing control exists for the *real* gate: turning
consultation notes genuinely off for a clinic means flipping
`clinic_module_settings.enabled` for `'consultation_notes'` by hand in SQL.
The Settings toggle does not do this, despite reading like it might.

The `modules` reference table these two originally pointed to was dropped
(`20260820000001_drop_unused_modules_table.sql`), taking its FK on
`module_key` with it via CASCADE. Restored as a plain `CHECK` constraint
(`20260823120000_restore_module_key_check.sql`) against the same seven
keys the `modules` table used to hold: `'gut_screening'`,
`'return_to_sport'`, `'scoliosis_screening'`, `'face_scale'`,
`'facial_palsy'`, `'consultation_notes'`, `'invoicing'`. Don't build new
gating logic on top of this without first confirming the tier-subscription
plan is what's meant to populate it — `can_use_module()`'s fail-open
default is backwards for a paywall and would need to change before these
tables can gate a paid tier.

#### `clinic_plans` — the tier boundary, service-role write only
Added as Phase 0 of the tier-subscription plan
(`20260823120001_clinic_plans.sql`). One row per clinic:

```sql
clinic_plans (
  clinic_id             uuid PRIMARY KEY (FOREIGN KEY → clinics.id, CASCADE)
  plan_tier             text NOT NULL, CHECK in ('lite', 'solo', 'clinic', 'clinic_plus')
  status                text NOT NULL DEFAULT 'active', CHECK in ('active', 'past_due', 'read_only')
  max_members           int NOT NULL       -- tunable per clinic, seeded from tier
  visit_cap_per_month   int                -- NULL = unlimited
  updated_at            timestamptz NOT NULL DEFAULT now()
)
```

RLS is deliberately asymmetric: `clinic_plans_select` lets any clinic
member read their own clinic's row, and there is **no write policy at
all**. With RLS enabled and zero write policies, Postgres denies every
`INSERT`/`UPDATE`/`DELETE` from the `authenticated` role outright — only
`service_role` (which bypasses RLS) can write this table. This is the
actual fix for the plan-tier-must-not-be-self-serve-editable problem: a
`plan_tier` column on `clinics` itself couldn't get this property, since
`clinics_update` already grants clinic admins unrestricted column access
and `clinics` rides the client-writable outbox.

Seeded automatically, mirroring `add_creator_as_admin()` and
`seed_default_module_settings()` (both existing AFTER INSERT triggers on
`clinics`): `seed_default_clinic_plan()` inserts a `lite` / `active` / 1
seat / 50 visits-per-month row for every newly created clinic. All four
existing clinics at migration time were backfilled as `clinic_plus` /
`active` / unlimited — a deliberate placeholder that grandfathers today's
de-facto behavior (nothing has ever been gated), not a real tier
assignment; real per-clinic tiers need deciding before enforcement
(seat cap, visit cap, invoicing gate — none of it is wired up yet) lands
on top of this table.

**Read path (Phase 1):** `useEntitlements(clinicId)` (`src/app/useEntitlements.ts`)
is the sole read point. `clinic_plans` has no Dexie table and isn't part of
the sync engine's generic per-table pull (`ALL_SYNCED_TABLES` in
`src/lib/db.ts`) — that loop assumes every table has an `id` primary key,
and this one is keyed by `clinicId`. Instead the hook fetches it directly
via Supabase, exactly mirroring `useClinicRole`'s pattern: cached as JSON in
Dexie's `meta` table (key `plan:${clinicId}`) so the tier survives offline,
a fresh online fetch always wins, and an unresolved fetch never flashes the
least-restrictive default (`lite`/1 seat/50 visits — the same fail-closed
default `DEFAULT_PLAN` uses when nothing has loaded yet). The hook also
returns `seatsUsed` (a live `clinic_members` count, online-only — `null`
when unknown) and `visitsThisMonth` (computed from local Dexie visits via
`repos.visits.list`, so it works offline). `src/domain/plans.ts` holds the
pure tier → feature map (`tierIncludes()`) the hook's `can()` reads, plus
`currentMonthRange()` — both unit-tested.

No UI reads this yet — Phase 1 only builds the read path. Enforcement
(Phase 2) and the Settings `plan` section (Phase 3) are what consume it.

**Enforcement (Phase 2):** four gates, all reading `clinic_plans` directly
(server-side) so none of them can be bypassed by a client that doesn't call
`useEntitlements()`:

- **Invoicing** — `issue_invoice()` checks plan status and tier *before*
  the pre-existing `clinic_entitlements('invoicing')` /
  `billing_enabled` / `invoicing_access` chain. Full precedence: **plan
  status (`read_only` blocks outright) → plan tier (`lite` blocks) →
  `clinic_entitlements` → `billing_enabled` → `invoicing_access`.** Each
  layer raises its own distinct error message.
- **New patients** — `enforce_clinic_plan_on_patient_insert()`, a
  `BEFORE INSERT` trigger on `patients`, blocks while `status <> 'active'`.
  Edits to existing patients are unaffected — only new rows are gated.
- **New visits** — `enforce_clinic_plan_on_visit_insert()`, a
  `BEFORE INSERT` trigger on `visits`, blocks while `status <> 'active'`,
  and separately enforces `visit_cap_per_month` **with a +20 buffer**
  (a hard block at the exact cap risks losing a real visit to a
  multi-device offline-sync race — the buffer absorbs that, the client
  pre-check below is the real day-to-day gate). Counted by the visit's own
  `visit_date`'s calendar month, not today's date — this is also what
  makes `importVisitsService.ts`'s bulk historical importer safe with no
  special-casing: it writes through this exact same insert path (no
  separate RPC to exempt), but imported rows are virtually always dated in
  past months, so they don't touch the current month's count. A same-month
  bulk import can still hit the buffer.
- **Seat cap** — the `invite-therapist` edge function counts
  `clinic_members` against `clinic_plans.max_members` before inviting or
  re-linking an existing account to the clinic (both add a
  `clinic_members` row, both count). Fails open if a clinic somehow has no
  `clinic_plans` row (shouldn't happen — every clinic is seeded one).
- **Client pre-check** — `NewVisitPage.tsx`'s `save()` reads
  `useEntitlements(clinic.id)` and blocks before attempting to save once
  `visitsThisMonth >= visitCapPerMonth`, so a normal user sees a clear
  message before ever reaching the server buffer above.

Deliberately **not** touched: `can_use_module()` / `consultation_notes` /
the five assessment-module keys. `clinics.clinical_docs_enabled` and
`clinic_module_settings('consultation_notes')` were previously suspected of
being two conflicting gates on the same feature; traced precisely, they act
at different layers — server-side write permission vs. client-side surface
visibility — and never conflict. See the dead-infrastructure section above
for the full mechanism, including a real inconsistency it surfaced (Patient
Profile's notes entry point isn't gated by `clinical_docs_enabled` while
three comparable surfaces are) that is still undecided. Adding a third
(plan-tier) gate would need to go through `can_use_module()` specifically,
since that's the one that actually governs whether a note can be written.
The five module keys have zero client code today regardless, so gating them
has no practical effect yet. Deferred to the still-open "advanced modules
content" planning pass.

**Bug fixed during Phase 2 testing:** `clinic_plans_updated` (Phase 0) used
the generic `set_updated_at()` trigger function, which unconditionally sets
`updated_by`/`created_by` — columns `clinic_plans` doesn't have (there's no
write path through an authenticated user's own session for this table).
Every `UPDATE` failed until `20260823130001_fix_clinic_plans_updated_trigger.sql`
gave it its own minimal trigger function that only sets `updated_at`. Caught
by direct testing before anything in production exercised the broken path.

**Settings UI (Phase 3)** — the first user-visible part of the tier plan.
`SettingsPage.tsx` gains an "Account" group with a read-only `plan` section
(`PlanSection`): tier, status, seats used/limit, visits this month/cap, and
a per-feature "what's included" list, all read from `useEntitlements()`.
Every section resolves to one of three states, per the design in Part 3 of
the tier plan:

- **available** — normal.
- **locked** — above the tier (`billing`, gated on `can('invoicing')`).
  Stays visible in the rail, greyed with a lock glyph; clicking it shows
  `LockedSectionNotice` (informational only — "Included in Solo and
  above," no CTA button, since there's no self-serve upgrade flow yet) in
  place of the real form.
- **hidden** — genuinely inapplicable, not a paywall (`partner`, gated on
  `can('revenueSplit')` — a Lite/Solo clinic can't have a hospital
  revenue-split relationship at all under its plan). Filtered out of both
  nav lists at render time; a mid-session redirect effect bounces `activeKey`
  away from `partner` if the resolved plan stops including it, mirroring
  the existing pattern `LedgerPage.tsx`/`ReportsPage.tsx` already use for a
  role changing mid-session.

**Lite can collect, not invoice.** `usePermissions().canCollectPayment` (`collectPaymentAllowed`) is `canBill` without the plan term (`invoicingAccess`, plus `billingEnabled` — which is ignored on a plan without invoicing, since Lite cannot reach that switch and collecting cash isn't billing), so a Lite clinic records direct payments on a visit (`Collect ₹X`, the "Due" footer and Not-collected filter all stay meaningful) and is never told to "Ask billing" — that pill shows only when the user can neither invoice nor collect. New Visit's **Payment** card (Collected now / Take payment later, method, UPI QR), the post-save "Take payment" button and Workspace's Dues tile, Patient Profile's "Record advance" and Ledger's **Daybook** tab (a register of payments received, with no invoice dependency; Ledger's Invoices tab stays `canBill`) all follow `canCollectPayment`, so a Lite visit can be saved as collected in the form itself; "Give bill" and the invoice-policy prompt stay on `canBill`. Visit components take a separate `canCollect` prop (defaults to `canInvoice`); issuing an invoice stays on `canInvoice`/`canBill`. **Payments for every clinic (billing is always on).** The "Billing module" off switch is gone: collecting a payment depends only on `invoicing_access` (`collectPaymentAllowed`), never on plan or partner settings. A partner that collects at its own counter is a payment method, `partner`, offered only when `hasPartner` and labelled **"Collected by {partner name}"** (`paymentMethodLabel`, `src/domain/paymentMethods.ts`). It settles the visit (no dues) but is not cash in hand: `isCashInHand()` keeps it out of Workspace "Collected" (`receivedOnDate`), `paymentService.collected*`, and the Daybook total, which shows it on its own muted line ("Not in your drawer — settled with them later"). A visit whose whole bill the partner collected (`isFullyPartnerCollected`, from `VisitCardData.partnerCollectedPaise`) shows a slate "Collected by …" pill instead of the green Paid, is left out of Needs receipt, cannot be selected for an invoice or given a bill, and its advance has no printable receipt. Settings → General **Payments** card: "Who collects patient payments?" (We do / {Partner} does, only with a partner) and "Default payment method". Preselect order in New Visit / Take payment / Bulk collect / Record advance (`defaultPaymentMethod`): partner when it collects → clinic default → the method last used on this device (only when the clinic set no default) → UPI. Migration `20261025120000`. **Partner settlement both ways** (Monthly statement, `SettlementCard`): with a partner and *Partner does* collect, it reads "Expected from {partner}" / "Total received" / "Variance" (expected = the clinic's share); with *We do* it reads "{Partner} share to pay" / "Total paid to {partner}" / "Still to pay" (expected = the partner's share), the same `settlement_payments` rows with "Amount paid / Paid on" labels. It also shows "Collected by {partner} this month ₹X (N visits)" (`dashboardService.monthlyCollection.partnerCollected*`). The direction follows the current setting, so changing it mid-month re-reads that month. A clinic with no partner sees Billed / Collected (with what is still due) / Visits instead of an identical Clinic Share card. Post-save screen: one primary next step (Take payment if owed, else Add clinical note, else Give bill, else Done); the rest are quieter and "Log a separate visit" is a text link. Onboarding accepts ₹0 as a price (`isPricedDraft`) with a "We don't charge patients here — set every price to ₹0" shortcut, so a free clinic never meets the Payment card. **Lite UX around the plan limits.** (1) *Visit cap:* the 50-visits/month block stays, but `VisitCapNotice` (New visit page and Settings → Your plan) warns from 80% (`visitCapStatus`, `VISIT_CAP_WARN_AT` in `src/domain/plans.ts`) and says so plainly when reached, with an "Ask to upgrade" mailto from `upgradeMailto()` (`src/lib/support.ts`, needs `VITE_SUPPORT_EMAIL`; without it the text is "Contact us to upgrade"); the save error says nothing entered is lost. (2) *Seat cap:* hitting the login limit no longer hides the Add team member form — `loginsLocked` turns "Needs login" off and disables it with a hint, so a no-login roster therapist (bookable, appears on the schedule) can always be added. (3) *Monthly statement:* `usePermissions().canViewMonthlyStatement` (admin, any plan) gates Reports → Monthly statement; without a partner/therapist split configured it is billed totals, visits and patients. The Attribution audit stays on `canViewPayouts` (`revenueSplit`).

The **Clinical notes** toggle (`clinicalDocsEnabled`) lives on Settings → General (`ClinicalDocsSection`), not in the plan-locked Billing tab.

`usePermissions()` folds `useEntitlements()` into `canBill` (also requires
`can('invoicing')` now, ahead of the pre-existing `billingEnabled`/
`invoicingAccess` checks) and `canViewPayouts` (also requires
`can('revenueSplit')`) — since `LedgerPage.tsx`'s Invoices tab and
`ReportsPage.tsx`'s Attribution Audit tab both already consume those two
booleans, tier-gating happens there for free. `TherapistComparisonCard.tsx`
needed its own `can('revenueSplit')` check instead (it's gated on
`clinic.showTherapistComparison`, not a `usePermissions()` flag).

Team's Invite form locks (with the same informational-only copy) once
`clinic_members.length >= maxMembers` — a client-side hint only, since
`invite-therapist`'s own seat-cap check (Phase 2) is the real boundary.

**Guided setup** (`/setup`, admin-only; replaced the First-Week Checklist card). Eleven steps in three groups. *Essentials:* clinic profile, price services, invite team, link every therapist. *Your first week:* log a visit, wait for Synced, decide on clinical notes, take a backup. *Optional setup:* configure billing, configure online booking, turn on notifications. Optional steps do not count towards progress or completion.
- Pure logic in `src/domain/setupGuide.ts` (`buildSetupSteps`, `summarizeSetup`, `isSetupNudgeVisible`); live data in `src/features/setup/useSetupProgress.ts`.
- **Six steps detect themselves** from real data: `clinic.address`, catalog length, `seatsUsed > 1` (a `clinic_members` row exists from the moment an invite is issued), no unlinked therapist, any visit, and the `lastBackupExportedAt:${clinicId}` meta key written by Data backup. **Two are ticked by hand** ("Wait for Synced" is a habit; "clinical notes" is a decision where on and off are both valid), stored as a JSON array of step ids in `firstWeekChecklistCompletedSteps:${clinicId}`.
- **Keys and step ids are unchanged** from the old checklist so finished steps stay finished on real devices. All meta keys are clinic-scoped, since `db.meta` is shared by every clinic on the device.
- **Progress is drawn as treatment-course ticks** (`SetupTicks`): filled moss for done, a teal ring for next, hollow for pending.
- **Pinned bar** (`SetupProgressBar`, "Step 3 of 8: …"): top of Workspace, top of Settings, and in the account menu, admins only. It shows only while the clinic lacks the basics (no profile address, an empty catalog, or an unlinked therapist), so established clinics that never ticked the manual steps aren't nudged again. A clinic that dismissed the old checklist (`firstWeekChecklistDismissed:${clinicId}`) stays dismissed; `/setup` stays reachable from the menu.
- Onboarding's Done screen offers "Continue setup" (to `/setup`) and "Go to Workspace"; either marks onboarding complete first, since Shell keeps an unfinished clinic on `/onboarding`.

**Header layout budget** below — so it's the fifth now.)
    The mobile bottom tab bar is a separate hand-built 5-item row
    (Workspace/Schedule/+New/Ledger/More; Patients is in More), not driven by the same array,
    so this doesn't add a 6th phone tab; mobile reaches it via **More**
    instead (also widened to the same admin + front_desk gate), per the
    handoff doc's own "no sixth phone tab" decision. A front_desk viewer
    who lands on `?tab=feedback` directly is redirected to `?tab=bookings`
    rather than shown a disabled tab, per the doc's own resolved note.
    **Bookings is the first tab and the default landing tab for every
    role** (including admin) — it's the busier, more actionable surface
    day to day; the un-parameterized `/schedule` URL defaults to
    `?tab=bookings` rather than `?tab=feedback`.
  - **Workspace "new response" banner** — admin + module-on only, counting
    responses newer than the user's synced **`user_seen_markers`** "feedback"
    marker (see that table's section; it replaced a per-device `db.meta`
    "last viewed" timestamp, which made a new phone or browser show every old
    response as new) that gets stamped the moment `SchedulePage` mounts; the count is exported from a small
    `scheduleSignals.ts` module rather than `SchedulePage.tsx` itself so
    that reading it from the eagerly-bundled `WorkspacePage.tsx` doesn't
    pull the route-code-split Requests page into that eager bundle.
- **Google review nudge (Phase 3)** — `clinics.google_review_url` (nullable
  text; unset means the nudge never shows, even for a 4-5★ response). Two
  surfaces, both gated on rating ≥ 4 **and** the URL being set — 1-3★ never
  gets a Google button, anywhere, per the spec:
  - **Patient-facing**: the `/f/$token` thank-you screen shows "Leave a
    Google review" (a plain external link) when eligible.
    `submit_feedback_response()` itself decides eligibility and returns
    the URL (or `null`) as its result — the RPC's return type changed from
    `void` to `text`, so the migration drops and recreates it (grants
    don't survive a drop, re-stated explicitly same as the original). No
    second round trip or extra client-side rating logic needed; the public
    page just shows the button if the return value is non-null.
  - **Staff-facing**: an "⭐ Google review" nudge on the visit row, next to
    the "★ Responded" marker — a pure share action (`shareTextViaWhatsApp`,
    no DB write, no `message_log` entry), gated the same way.
    `VisitCardData.feedbackRequest.googleReviewEligible` is a bare boolean
    (not the rating itself), populated two different ways depending on
    role: an admin caller derives it from the synced, RLS-filtered
    `feedback_responses.rating` (`>= 4`), the same bulk fetch the
    "★ Responded" marker already uses. A front_desk caller has no rating
    available at all — `feedback_responses_select` is
    `is_clinic_admin()`-only, so the row never reaches their Dexie, not
    even filtered client-side — so they instead call
    `list_google_review_eligible_requests(clinic_id)`, a `security
    definer` RPC that answers "which request_ids currently qualify"
    without ever returning a rating or a comment. This closes the gap the
    Phase 3 slice originally shipped with (spec's send-table lists front
    desk as eligible to send; the first cut only worked for admins).
    `useGoogleReviewEligibleRequestIds` (`scheduleSignals.ts`) is the
    front_desk-only fetch — a one-shot RPC call on mount/clinic-change,
    re-run on window focus, skipped entirely for admin.
- **Re-engagement reminders (Phase 4)** — "No new detection" per the
  handoff doc: both surfaces reuse existing dashboard queries rather than
  adding a new signal. Pure `shareTextViaWhatsApp` actions, no DB write, no
  `message_log` entry, no booking link (public booking is a later phase,
  nothing to link to yet) — same shape as the Google review nudge.
  - **Stale packages** — a "Send reminder" button on `OpenPackageRow`s where
    `stale` is already `true`, in Workspace's Packages section at the bottom
    of the page (mobile card + desktop table; Stale filter). Ledger no longer
    duplicates a separate follow-up list. Gated on `clinic.enablePatientComms`.
  - **Single-visit patients** — a "Send reminder" button next to the
    existing `tel:` call link on Reports' single-visit-patients list
    (`dashboardService.singleVisitPatients`), gated the same way plus
    `p.phone` present — mirroring the existing call link's own gating,
    even though the share itself doesn't target that number directly (see
    below). Backed by `feedbackService.sendReturnReminder` (renamed from
    `sendSingleVisitReminder` once the Patients list below started reusing
    it for any stale patient, not just single-visit ones — the message
    text never claimed "first visit," so nothing else needed to change).
  - **Same reminder, reused on the Patients list** (`PatientsPage.tsx`) —
    a "Remind" action (table + phone card) next to Book, shown whenever a
    patient's own `visitStatsByPatient` entry is stale
    (`isStale(lastVisitOn)`, the same `STALE_PACKAGE_DAYS` threshold as
    the package follow-up queue) and they have a phone on file, gated on
    `clinic.enablePatientComms` same as everywhere else. Lets front desk
    nudge a patient they're already looking at without a detour through
    Reports; package-specific wording (`sendStalePackageReminder`) stays
    Ledger/Workspace-only since this view doesn't carry a per-patient
    service name to plug into that message.
  - **Deliberately not phone-targeted.** `SingleVisitPatientRow.phone` and
    the `tel:` link already on that row could in principle build a
    number-specific `wa.me/<digits>` deep link, but patient phone numbers
    aren't stored in a guaranteed international format (no confirmed
    country-code convention) — a malformed number there fails silently.
    Every WhatsApp share in this module (feedback link, resend, Google
    review, reminders) instead uses the same generic Web-Share-sheet
    fallback (`shareTextViaWhatsApp`) and lets staff pick the recipient
    themselves, consistent behavior across the whole feature rather than
    a special-cased, riskier path for reminders alone.
- **Package nearing completion** — `isNearingCompletion()` in
  `packageTracking.ts` (2 or fewer sessions left, package still open),
  threaded onto `OpenPackageRow.nearingCompletion` alongside the existing
  time-based `stale` flag. Purely an in-context "Renew soon" badge
  wherever package progress already shows (Workspace's package list/table,
  Patient Profile's care plan, the visit-logging patient overview, New
  Visit's package summary tile) — no separate Ledger filter yet, and
  `stale` still takes priority over it in the one place both could apply
  (Workspace's single status pill) since a package can't need
  re-engaging and be actively finishing up at the same time in any way
  staff should act on.
- **"Remind to pay" (Invoices page)** — a seventh `message_log` kind,
  `payment_reminder`, alongside a "Remind to pay" action next to "Record
  payment" on any outstanding invoice, gated on `clinic.enablePatientComms`
  same as the reminders above. Unlike those, this is staff-initiated on a
  specific invoice rather than driven by a staleness signal, so
  `feedbackService.sendPaymentReminder()` takes the amount due and invoice
  number as given rather than deriving anything. When the clinic has UPI
  collection configured (`clinicCanShowUpiQr`), the message includes a
  `upi://pay?...` deep link pre-filled with the balance due — this opens a
  UPI app when the *recipient* taps it on their own phone, but there's no
  payment gateway behind it (no order tracking, no confirmation webhook),
  so the invoice still needs to be marked paid by hand once money actually
  arrives.
- **Public booking, no slots (Phase 5, folding in the doc's own Phase 6)**
  — a public form collects name/phone/optional-therapist/preferred-
  day-time-as-text; front desk or admin confirms it by hand into a real
  scheduled appointment, which becomes Workspace's "Expected today". No
  slot picker/availability matrix — that's a later, separate phase the
  doc explicitly says not to start here.
  - **There was no legacy "Expected Today" to retire.** An earlier
    session fully dropped `expected_visits`/`clinics.
    enable_expected_today` (table, column, service, UI — zero
    consumers). The doc's "retire the legacy path" framing was moot by
    the time this phase shipped; Workspace's "Expected today" section is
    new, not a replacement.
  - **`clinics.booking_slug`** — nullable unique text, the public
    `/book/$slug` segment. Not a secret (meant to live on Google/the
    clinic's own website), unlike a feedback token — `get_booking_clinic_info`
    and `list_booking_therapists` just need the slug to exist and the
    module to be on, no rate-limited-oracle concern beyond the same
    generic-error/IP-throttle discipline every public RPC in this module
    uses.
  - **`appointment_requests`** — one row per public submission: `name`,
    `phone`, `email` (raw, unresolved against any patient), `preferred_
    therapist_id` (nullable), `notes` (free text — reason for visit,
    symptoms, anything else; deliberately its own column, not folded
    into the time preference — an earlier version of the form did that
    and silently dropped it whenever the patient didn't also tick
    "flexible"), `preferred_date` + `preferred_time_text`
    (both plain preferences — **no availability checking against either**,
    per the doc's "do not start here" on slots; front desk still picks
    the real `scheduled_at` by hand at confirm), `status`
    (`pending|confirmed|declined`), `appointment_id` (set on confirm).
    The form itself was redesigned mid-phase after reviewing a fuller
    reference design (richer than the locked spec's plain "name, phone,
    optional therapist, preferred day/time as text") — added email as a
    genuinely useful optional field, and gave the date/time preference a
    real date input plus a "flexible" quick-toggle, but deliberately did
    not adopt that reference's "pick a date to see available times"
    behavior, which implies real per-therapist slot availability the doc
    reserves for a later, separate phase. A `service_catalog_id` field
    and its `list_booking_services` RPC were added in that same redesign
    pass and then removed shortly after (dropped, not hidden — matching
    this repo's convention of not leaving unused scaffolding behind):
    the service picker didn't earn its place on a form patients fill out
    unauthenticated, and front desk already asks reason-for-visit via the
    `notes` field.
  - **`appointments`** — one row per confirmed expected attendance, **not**
    a billed visit. `patient_id` is **null from confirm until arrival** —
    identity is resolved exactly once, at arrival, reusing the existing
    New Visit typeahead rather than a confirm-time judgment call on a raw
    public submission. `patient_name`/`patient_phone` (the request's raw
    values) are kept on the row throughout, so it always has something to
    display before/without a resolved identity. `status`:
    `confirmed|rescheduled|no_show|cancelled|arrived`. `visit_id` is set
    only once arrival creates the real `visits` row.
  - **Both tables are synced-but-read-only Dexie tables** — same
    `ALL_SYNCED_TABLES`-without-`CLIENT_WRITABLE_TABLES` shape as
    `feedback_responses`/`invoices`, for the same reason: every write is
    an online-only RPC (public submit; confirm/decline; reschedule/
    no-show/cancel; mark-arrived/link-visit), never a client Dexie write.
    Both carry `updated_at` from creation (unlike `feedback_responses`,
    which needed one added after the fact) so the sync engine's
    hardcoded delta-pull column works from day one.
  - **RLS is SELECT-only for staff; every mutation is a `security
    definer` RPC with its own in-body role check**, not a matching RLS
    write policy — confirm/decline/reschedule/no-show/cancel need *admin
    or front_desk* (a new `is_front_desk(p_clinic)` helper, mirroring
    `is_own_therapist`'s shape), but marking an appointment arrived or
    linking it to a freshly-created visit needs the same broad membership
    check `visits_insert` already uses (`is_clinic_member`) — two
    different rules that don't map to one clean RLS policy, the same
    reasoning `list_google_review_eligible_requests` (Phase 3's
    front-desk-parity fix) already established. `appointment_requests`
    SELECT is admin/front_desk-only (matches who can reach the Bookings
    tab at all); `appointments` SELECT is clinic-member-wide, since it's
    the day list every role needs to see.
  - **Both tables also needed `created_by`/`updated_by`, added in a
    follow-up migration** (bug found live, not caught in review): the
    shared `set_updated_at()` trigger was redefined by an earlier,
    unrelated migration to unconditionally stamp `updated_by`/`created_by`
    on every row it fires for — it never checks whether the table
    actually has those columns. Every other synced staff table already
    carried them; these two were the first to attach the trigger without
    them, so any UPDATE (confirm, decline, reschedule, ...) failed with
    `record "new" has no field "updated_by"` until the columns were
    added, matching `feedback_requests`' own shape.
  - **Ten RPCs**: three public (`get_booking_clinic_info`,
    `list_booking_therapists`,
    `submit_appointment_request` — anon + authenticated grants,
    rate-limited); seven staff-only
    (`confirm_appointment_request` returns the new appointment id,
    `decline_appointment_request`, `reschedule_appointment`,
    `mark_appointment_no_show`, `cancel_appointment`,
    `mark_appointment_arrived`, `link_appointment_visit` — authenticated-
    only, explicit `revoke ... from public, anon` same grant-hygiene
    discipline as every RPC in this module). `link_appointment_visit` is
    the one `NewVisitPage.tsx` calls right after a visit saves, when that
    visit was started via `?appointmentId=...` — sets `patient_id`,
    `visit_id`, and flips `status` to `arrived` in one call. A visit started
    via `?appointmentId=...` also starts with **that appointment's therapist
    and date** (`visitPrefillFromAppointment` in `domain/schedule.ts`),
    applied once so a manual change sticks; the usual "whoever saw them
    last" default stands back for it (`appointmentSetsTherapist`) unless the
    appointment is unassigned or not on the device. **It is
    queued, not called inline** (`src/sync/pendingLinks.ts`, persisted in
    `meta`): `appointments.visit_id` is a foreign key to `visits`, and the
    visit only reaches the server on the next push, so calling the RPC right
    after the local save failed every time (and could never work offline).
    The sync engine sends queued links right after `push()` once the visit is
    no longer in the outbox, drops one only on a permanent error ("already
    linked", "not found"), keeps it through network failures, and
    `repos.appointments.listByClinic` overlays pending links (linked,
    arrived) so Workspace and Schedule already treat the appointment as done
    — no "in progress" row left to log a second time.
    **`create_appointment_staff(clinic_id, name, phone, therapist_id,
    scheduled_at)`** was added later, alongside the manual-booking form on
    the Bookings tab — same admin-or-front_desk check and
    `security definer` shape as the other six, but inserts straight into
    `appointments` with no `appointment_requests` row at all (`request_id`
    stays null): a staff member entering a booking by hand already knows
    the confirmed date/time/therapist, so there's no "pending" state to
    pass through first.
  - **Schedule MVP permission and duration rules** (`20261001100000_schedule_mvp.sql`): `appointments.duration_minutes` (5–240, backfilled from the clinic slot length) — every overlap check, client (`appointmentsOverlap`) and server (`therapist_has_overlap`), uses **each row's own length**, ignoring cancelled rows. `can_manage_appointment(clinic, therapist_id)` = admin OR front desk OR `is_own_therapist`; `confirm_booking_slot` (now with `p_duration_minutes`), `reschedule_appointment` (now with optional `p_duration_minutes`), `cancel_appointment` and `mark_appointment_no_show` all use it, and only admin / front desk may pass a `p_request_id`. Both RPCs were drop-and-recreated per pattern 3c. **Fixed**: `confirm_booking_slot` / `create_appointment_staff` used to check `p_therapist_id` (a `therapists.id`) against `clinic_members.user_id`, which rejected every booking; they now check `therapists` (same clinic, active). `create_appointment_staff` now delegates to `confirm_booking_slot`.
  - **`bookingService.ts`'s eight staff-mutation wrappers all call
    `syncEngine.schedule(0)` right after their RPC succeeds** — found
    missing in the same post-ship workflow review, not present originally.
    `appointment_requests`/`appointments` carry no outbox (see
    `src/lib/db.ts`'s comment on why), so nothing tells the sync engine to
    pull after one of these RPCs the way a normal Dexie write does;
    without an explicit kick, confirming/declining/rescheduling/marking
    no-show or cancelled or arrived/linking a visit/creating a manual
    booking would all succeed server-side while the Bookings tab's
    `useLiveQuery`-driven lists (and Workspace's "Expected today") kept
    showing the pre-mutation state for up to 5 minutes — e.g. a just-
    confirmed request still listed under "Pending requests" with its own
    Confirm/Decline buttons, inviting a double-click. `schedule(0)` is the
    same near-immediate debounced pull the manual "Sync now" button and
    `CreateClinicForm`'s post-create refresh already use.
    `feedbackService.ts` didn't need this fix — it already writes the
    RPC's returned row straight into Dexie via `putLocal()` (see its own
    file comment) rather than waiting on a pull, but most of the booking
    RPCs return only void or a bare id, not a full row, so a pull kick was
    the simpler fix here than adding `putLocal` to both booking repos.
  - **All five appointment-mutating RPCs (reschedule/no-show/cancel/
    mark-arrived/link-visit) row-lock and check the appointment's current
    status before acting**, same discipline as
    `confirm_appointment_request`/`decline_appointment_request` already
    had — found missing during a post-ship workflow review, not shipped
    this way originally. Without it, two staff acting on one appointment
    at once, a stale browser tab, or a double-click could flip an
    already-arrived appointment (with a real linked visit) back to
    `no_show`, resurrect a cancelled one via reschedule, or double-link a
    second visit onto one appointment row, silently overwriting the first
    `visit_id`. The UI already only offers each action from the right
    states; this closes the gap server-side too.
  - **`NewVisitPage.tsx`'s existing `?prefillName=...` mechanism grew a
    `?prefillPhone=...` sibling** (feeds `newPatient.phone` the same way
    `prefillName` feeds `newPatient.name`) plus a new `?appointmentId=...`
    — "Create visit" links from an appointment row pass all three, so the
    same existing search-or-create typeahead this mechanism already
    drives surfaces likely-existing-patient candidates for free; staff
    still explicitly pick or create, never auto-selected (no silent
    find-or-create by phone, per the doc's explicit-scope list).
  - **Schedule (`/schedule`, `ScheduleBookingsView.tsx` + `features/schedule/`)** — the clinic calendar. Tablet/desktop-first for the front desk (Athena-style therapist columns, Google-Calendar details panel, Calendly-style free times); phones get an agenda list. The nav item stays "Schedule". URL state: `?view=schedule|requests|history`, `?mode=day|week`, `?date=YYYY-MM-DD`, `?therapist=<id>[,<id>…]` (empty = everyone); every change uses `replace`, so Back leaves the page.
    - **Who sees what**: admin / front desk see every therapist plus Requests and History. A **therapist** sees "My schedule" (their own column by default, always kept) and History scoped to themselves; they can add colleagues from the therapist filter to see when colleagues are booked and which patients they see — **read-only**: those columns are headed "view only", show patient name, time and status only (no flags, reasons or notes), offer no free slots to book, and can't be moved into; opening a colleague's appointment shows name, time, therapist and status but never the patient's phone, call/WhatsApp actions, condition, notes or manage actions (`canManage` gates the details panel); they can book for themselves for any clinic patient or a new patient, and reschedule / cancel / mark no-show their own appointments. Requests stay admin / front desk. An unlinked therapist login gets a "ask your admin to link your login" message. The server enforces all of this (`can_manage_appointment`, below); the UI only mirrors it.
    - **Layout by width**: from `desktop:` (1000px) a left rail (`ScheduleRail`, each section a white card on the paper page) holds a mini month (up to three teal load dots under each day by bookings — `loadDots`: 1–2 → 1, 3–5 → 2, 6+ → 3; a rust corner dot on future days that are fully booked; closed days with a fine hatch; today ringed; selected solid teal; weekends' letters dimmed), therapist toggles with the day's load ("6 · 4h30"), and upcoming closures. Below `desktop:` the Monday–Sunday `MiniCalendarStrip` replaces the month, and therapist chips replace the toggles. From `tab:` (744px) the Day view is `ResourceDayGrid` — one column per therapist, blocks absolutely positioned and sized by `duration_minutes` (`blockGeometry`, 1.6px/min), free slots tinted and clickable (opens the booking sheet prefilled with date, time and therapist), a current-time line on today, closed days hatched with their label, overlapping blocks side by side (`assignLanes`; only the synthetic Unassigned column can overlap). **Phones (below `tab:`)** have two views, **Day** and **3-Day**, remembered per device in `localStorage` `theranet:schedule-phone-view` (default Day; an old stored `list` means Day). **Day is always the proportional grid** (`MobileDayGrid`), for one therapist (one full-width column with **no axis column**: one continuous rail line inside the column carries the hours as "9 AM", the scale is 80px per hour — a 30-minute block is 40px, `phoneSingleColumnPxPerMinute` — and `WideBlock` lays each card out by its height: under ~28px one line "10:00 Name"; to ~52px two lines, name with the time range then the reason (or the flags when there is no reason); taller, three lines with up to two flag pills; the Now badge sits on the rail so it never covers card text) or several (one column per therapist, columns at least 96px with sideways scroll beyond that, time scale `max(1.6, 44/slotMinutes)` px/min so a free slot is always at least 44px tall, free time visibly tinted, block detail adapting to the measured column width — full ≥150px, medium 110–149px, name-only below — and a Now line with a time badge on the axis). **Free time is literally empty**: a light tint with no text, no "+" and no buttons, tapped to book (a dismissible one-line hint explains it); appointments that ended before now fade to 75% so a morning reads as done and names stay readable; the one-column Day also draws faint dashed half-hour lines, and its hour label steps aside while the Now badge sits on it. On phones, grids of up to three columns (one-therapist Day, 3-Day, up to three therapists) have no scroll box of their own: the page scrolls, the column headers stick under the app header, and the tab row scrolls out of the way; wider grids keep an inner scroll box for sideways scrolling. The grids open on "now" (or the first appointment) once; changing the date or view never moves the page. The column headers stick under the app header at its measured height (`--app-header-h`, published by the shell from `src/lib/appHeaderHeight.ts`), and the "Tap a free time to move" bar is pinned above the bottom nav so its Cancel stays in reach. On phones a therapist's "My hours" is in the ⋮ menu (the tab row keeps just Schedule · History). The Now line is 1px at about 55% strength (the dot and the axis badge stay solid) so it never hides text. There is no separate list view on phones any more; Find a time is the free-slot list: in the ⋮ menu on phones, and a visible button in the tablet / desktop toolbar (`ScheduleToolbar`, same control order as the phone toolbar, day view only) that swaps the grid for `FindTimePanel`. And **3-Day** (`MobileThreeDayGrid`: one therapist, three date columns, header tap opens that day; it shows the therapist picked in the toolbar chip, which in 3-Day is a single-choice sheet with each therapist's booked count for the three days (default: the viewer's own therapist, else the first in the current selection; the pick is local, the URL filter is untouched so Day still shows everyone). Day headers show up to three load dots (`loadDots`), and blocks 45+ minutes tall show their start time even at compact width). Hold-and-drag move, booking and the details panel work as on tablet in both grid views. `PhoneScheduleToolbar` is one row with no date headline: the therapist chip (`TherapistFilter showLabel sheet`: "All therapists" / the name / "2 of 3 therapists"), the Day·3-Day switcher and the ⋮ menu. The chip opens a **bottom sheet** on phones (`Panel`: a row per therapist with a checkbox, colour dot, name and day summary, an "Only" shortcut, Show all and Done) because the popover could run off a narrow screen; desktop and iPad keep the popover. The ⋮ menu (`ScheduleMenu`) is a bottom sheet on phones — rows 52px tall with an icon, label and one-line hint, grouped View (Find a time, Show cancelled), Do (Send reminders, Add to waitlist) and Manage (Set closed days, Assign shift, Working hours; admin and front desk only) — and a compact popover with the same groups on tablet and desktop (plus Keyboard shortcuts on pointer devices). `PhoneStatusLine` sits under the week strip: "Today · 2 booked · 1 to come", "Tue, 20 Oct · No appointments" or "19 – 21 Oct 2026 · 3 booked", with "↩ Today" at its right end only when away from today. The Monday–Sunday week strip (`MiniCalendarStrip`) is always shown on phones and is the date navigation (tap a day, ‹ › or swipe for the week); in 3-Day it highlights the three visible days as one connected range (`rangeDays`). **Book** on phones is a round floating button (`BookFab`) above the bottom nav that slides away while scrolling down and returns on scroll up; the tab-row "+ Book" starts at `tab:`. The URL `mode` stays `day|week` (3-Day is phone-only local state). **Who admin / front desk see by default** (Day, no therapist in the link): the therapists they last chose on this device (`localStorage` `theranet:schedule-therapists:<clinicId>`, written whenever they change the filter; "Show all" clears it), else everyone, minus anyone with no working time and no appointment that day (`defaultTherapistSelection`, `workingTodayIds`). It is display-only (the URL is not rewritten, so no history entry) and the status line says "2 off · Show" (tablet and desktop add "today" when viewing today); tapping it, or choosing "Show all", shows everyone for the session without touching the saved choice. Week and therapist logins keep today's behaviour (therapists default to themselves). The pure helpers are in `src/features/schedule/schedulePhoneHelpers.ts` (`densityFor`, `phonePxPerMinute`, therapist selection, 3-day dates). Below `tab:` the List view is `AgendaList` (time-ordered rows, now divider, free gaps inline when one therapist is in view) and "Find a time" shows `FindTimePanel` (free start times as buttons per therapist). In Week view the desktop left panel is hidden so the day columns get its ~240px (`showRail` is false when `mode=week`); the toolbar headline opens the month calendar (`MiniMonth`, also available in Day), the therapist chip shows at every width, and the booking-requests strip replaces the rail's requests card. Week view (from `tab:`) is `WeekTimeGrid`: 7 day columns with one shared time axis, drag across days. With one therapist in view it is that therapist's week. With several (no cap) the same grid shows everyone's appointments at their real times: each block carries a therapist pill (short name; the therapist's colour is the left edge), simultaneous appointments sit side by side, at most 3 lanes per cluster (`capLanes` in `src/domain/laneCap.ts`) with a "+N" chip that opens a list (therapist, patient, time; tap to open details), and lanes narrow the content in steps: 72px and up show therapist pill, patient and start time; 40–72px show the patient's first name with the therapist's short name under it; under 40px only the patient's initials (every block keeps a full accessible name). Free time is tinted where at least one therapist the viewer can book for is free and working; time nobody works stays blank. Tapping it opens the booking sheet with the date and time set and the therapist list limited to those free then (`onlyTherapistIds`). Dragging keeps the appointment's therapist (it can only clash with that therapist's own appointments); moving to another therapist stays a Day-view action. The Day/Week toggle and the `w` shortcut are always available from `tab:`; phones never show Week (they have Day and 3-Day, above). The old 7-card week board was removed.
    - **Colours** (existing tokens only, never colour alone): block left bar = therapist (`therapistColor`, the `chartColors.ts` palette by roster order); fill = status (`APPOINTMENT_BLOCK_STYLE`: confirmed teal-light, rescheduled teal-light + ↻, arrived moss-light + ✓, no-show rust-light + ✕, cancelled slate-light struck through and hidden unless "Show cancelled"); free time moss-light; closed = slate hatch + label; now line rust.
    - **Telling same-name patients apart**: the Patient ID (`mrno`) shows beside the name in the appointment panel, Today's appointments and History (`usePatientDirectory.mrnoFor`), and every patient picker (Book, Start note, New visit) lists name · ID · age sex · condition · phone. Creating a patient in New visit, Book or Start note runs `findSimilarPatients` (same phone by last 10 digits, or a name at least 85% similar, up to three, hidden patients skipped) and shows `SimilarPatients`: each match with ID, age and sex, condition and last visit, plus **Use this patient** and **Different person**. Saving is blocked until one is chosen; New visit and Start note then also require age and sex for a different person (Book has no such fields, so it only records the choice). **Clinic region and server times**: Settings → General → **Region** sets `clinics.timezone` (default Asia/Kolkata) and `clinics.default_country_code` (default +91). Every server-side "today", "8 pm" or clock time is computed in the clinic's zone through `supabase/functions/_shared/zoned.ts` (edge functions run in UTC, which once made a 9 AM booking read "3:30 am" in an email); the public booking page gets the zone from `get_booking_clinic_info` and `clinicNow(date, timeZone)`; `restore_cancelled_appointment` checks closed days on the clinic's local date. Staff screens still use the device's clock. **Push notifications** (`send-push`) name what happened and when ("New appointment · Ananya Rao · Tomorrow, 10:00 am"), one notification per change except that bookings for one therapist inside five minutes share a tag and read "3 new appointments"; tapping opens `/schedule?…&date=…&appointment=<id>` (the schedule opens that appointment's panel once, `?appointment=` in the route's search); nothing is pushed from 11 pm to 6 am clinic time except changes to today's appointments, so booking requests that arrive overnight are summed up in one "N new booking requests came in overnight" push to admin and front desk in the first quarter hour after 6 am (`send-agenda`'s 15-minute run calls `send-push` with `overnight_requests`, which counts pending `appointment_requests` since 11 pm); a subscription that answers 403 is deleted when other sends in the same batch worked (`subscriptionsToRemove`); people with `hide_patient_names` get the time without the name. **Daily agenda** (the clinic's choice: Settings → General → Region and agenda, `clinics.agenda_enabled`, default on, and the send hour `clinics.agenda_hour`, default 8 pm, chosen from 4 pm–10 pm; therapists only choose their own per-appointment email in Notifications): pg_cron calls `send-agenda` every 15 minutes; for a clinic whose local hour equals `agenda_hour` it emails each therapist with a login one list of tomorrow's appointments plus one `.ics` (event UIDs match the per-appointment invite), once per therapist per day (`agenda_log`). **Therapist colors**: a therapist's schedule color (`therapists.color`, default = a palette color picked from the ID by `therapistColor`) is chosen with `TherapistColorPicker`: the eight validated swatches from `chartColors.ts` (each marked with the therapist already using it), a "Custom…" color that must have a contrast of at least 1.8 against white (`isReadableColor`), and a live preview. It appears in Settings → Team → edit, and in a `TherapistColorSheet` opened by tapping a therapist's color dot in the schedule's column header (admins for anyone, a therapist for their own column; the server's therapists update policy enforces the same). New roster-only and onboarding therapists get `nextUnusedColor` so two therapists don't share a color; Settings → Team shows a notice (`colorClashes`) when active therapists do, with "Give X a new color". With more than eight therapists colors repeat. **Phone entry**: every staff-side phone field (Book, Start note, New visit including the alternate phone, the waitlist sheet, Edit patient and its alternate phone, the clinic phone in Settings and Create clinic, and therapist phones in Settings, My account and onboarding) uses `PhoneField` (a compact "+91 ▾" country picker plus the number). The value stays one string in the stored form `"+91 9876543210"` (`joinPhone`/`splitPhone` and the code list live in `src/domain/countryCodes.ts`, shared with the public booking form); numbers saved without a code read as the default country's, and phone comparisons use the last 10 digits. The default code is +91 until a per-clinic setting exists. **`AppointmentDetailsPanel`**: tapping a block/row opens a right-side panel (tab+) or bottom sheet (phone) holding every action. Facts first, in reading order: the patient (condition and the patient's request note in a soft card; the phone number is not printed, Call dials it and shows it as a tooltip), then the therapist (dot + name, with a small **Message** button on the same line when they have a phone), then the booking ("Thu, 1 Oct · 10:00–11:00 AM · 60m", `lengthLabel`) and "Moved from" only when a reschedule actually changed the time. Then **one main action by state** — "Mark arrived" (moss) before arrival; once arrived, "Complete visit" (teal) — with **Add note** and **Create visit** side by side as the secondary pair (Create visit becomes the teal Complete visit after arrival). Below a rule, a row of four icon quick actions: Call, Remind (WhatsApp), Reschedule and No-show (manage rights only). The footer holds Copy details and, for managers, a rust "Cancel appointment" text link (via `ConfirmDialog`); a one-line hint asks managers to add the therapist's phone when it's missing. Close is an ✕ icon. Blocks and rows themselves only show name, time, length and status.
    - **Grid file layout** (`src/components/schedule/`): `TimeGrid.tsx` holds the grid frames (`ResourceDayGrid`, `WeekTimeGrid`, `TimeAxis`); one column is `DayColumn.tsx`; touch/mouse drag and resize is `useGridDrag.tsx`; their shared types and constants (`GridColumn`, `DragGhost`, `PX_PER_MINUTE`, …) are in `gridShared.tsx`. `TimeGrid.tsx` still re-exports the old names, so imports from it keep working.
    - **Grid behaviour**: free time carries a light tint on every device (moss green, slate outside working hours), with "+ time" on hover and a faint "+" on touch screens; the grid opens at the top and only auto-scrolls when "now" (today, within booking hours) or the first appointment would be off-screen (`initialScrollTop`), and only once per date — never while the user is scrolling. Free-time offers (agenda gaps, Find a time) start on the clinic slot grid (`freeGaps(…, { alignToSlots: true })`), not at "now" or right after a 45-minute booking. Below `desktop:` the header drops Today/‹/› (the week strip has them) and Show cancelled / Set closed days move into a ⋮ menu. Declining a request uses `ConfirmDialog`.
    - **Patients list "Book"** opens the same `BookSlotSheet` with the patient pre-selected (`prefilledPatientId`) and their last therapist pre-picked; the old `BookAppointmentDialog` (free datetime field, "No preference" therapist the server now rejects) was removed, along with the unused `bookingService.createAppointmentStaff` wrapper — the RPC remains for older clients.
    - **Keyboard (tab+)**: `t` today, `d` / `w` day/week, ←/→ previous/next, `?` shortcuts help, Esc closes panels and sheets.
    - **Notifications (in-app, no calendar feed)**: WhatsApp via wa.me, one tap per recipient. Wording lives in `src/domain/bookingMessages.ts` (tested); therapist messages use the patient's first name + surname initial only. The booking/reschedule toast offers "WhatsApp patient" and "Notify therapist" (needs `therapists.phone`); the details panel has "Remind", "Message therapist", and after a cancel "Message patient" / "Message therapist". `ReminderSheet` (header "Reminders" on desktop, ⋮ → Send reminders elsewhere; admin/front desk) lists a day's live appointments with a Send per patient and a "Send list" day summary per therapist, ticking to Sent for the session.
    - **Install nudge**: `useInstallPrompt` + `InstallAppBanner` on Schedule and Workspace — phones only, not already installed (standalone), from the second visit, "Not now" snoozes 14 days (localStorage, per device). Android/Chrome uses the captured `beforeinstallprompt`; iPhone shows Share → Add to Home Screen.
    - **No-show history**: `patientAttendance` (last 6 months, by patient id, else last 10 phone digits; past appointments only) feeds `AttendanceNote` in the details panel and booking sheet ("2 no-shows, 1 cancelled… consider calling to confirm"); History rows badge patients with ≥2 no-shows. The booking sheet also warns when the patient already has an upcoming appointment (`nextAppointmentFor`).
    - **Requests inbox**: `RequestsInbox` — a collapsible "N booking requests · oldest 2h" strip above the calendar below `desktop:`, and a Requests section in the rail on desktop; Confirm opens the booking sheet on the requested date (if not past) with the preferred therapist; Decline uses `ConfirmDialog`. **Chrome: two rows.** (1) `ScheduleTabs` (`src/features/schedule/ScheduleTabs.tsx`): Schedule ("My schedule" for therapists) · History · Feedback (admins) on the left, page actions on the right (My hours for therapists, Reminders from `tab:` for admin/front desk, + Book). The page title is screen-reader only. URLs are unchanged (`?tab=bookings&view=schedule|history`, `?tab=feedback`). (2) The day toolbar, in the grid column so the desktop rail lines up with it: ‹ › (from `tab:`), the date as a display-font headline ("Thu, 1 Oct" on phones) with a "Today" marker, a plain summary line ("10 booked · 5 to come · 3 arrived · 1 no-show"), a Today button when away from today, then `TherapistFilter` (below `desktop:`, a popover of checkboxes replacing the old name-chip row), Day/Week, and ⋮ (show cancelled, send reminders on phones, closed days, working hours per therapist, keyboard shortcuts). Below `desktop:` the week strip (`MiniCalendarStrip`) is one row: ‹ days ›, with appointment counts as up to three dots (exact count in the label). **Therapist load**: each grid column header and rail row shows `LoadLine` (`src/components/schedule/LoadLine.tsx`), a capacity bar (booked ÷ working minutes) with a caption from `dayLoad()` in `src/domain/schedule.ts` that says the next useful thing. Today: "4 free now", "3 free from 2:30 PM", "Break till 2:00 PM" (between two working intervals), "1 free from …" (the amber bar says nearly full), "Fully booked"; once the day's working hours are over, a quiet recap "Finished · 6 seen" (no-shows not counted) or "Finished today". Other days: "6 free", "1 free", "Fully booked". Any day: "Off today" / "Day off" (no working hours), "Closed". `tone` colours the bar and caption: the therapist's colour, amber from 70% booked or one slot left, rust when full, grey (`done`) once today's hours are over, no bar when off or closed.
    - **Patient flags and condition** (`src/domain/patientFlags.ts`, loaded once per screen by `usePatientFlagContext` in `src/components/schedule/`): `patientFlags()` → "New patient" (unlinked, or no visits on record), "Package 3/6" (the session this appointment is), "Balance due" (an outstanding invoice, matched by patient ID), "N no-shows" (2+; a rust dot in lists). `PatientFlagPills` shows up to 2 in Today rows and the phone agenda, 1 in History, all in the details panel. `appointmentReason()` gives the condition on file (primary condition, else the latest visit's), else the booking request's note as "Patient says: …"; it's the second line of Today, agenda and History rows, line 3 of grid blocks an hour or longer (and their tooltip), and "Condition" / "Patient says" in the details panel. Grid blocks show the time range only (no "· 1h").
    - **History** (`HistoryView`, `src/components/schedule/HistoryView.tsx`): two control rows. (1) A Past / Upcoming pill switch (teal when selected, as the Ledger's) beside the search field. (2) One row — scrolling sideways on phones — of pill selects (Last / Next 7, 30 or 90 days or a chosen date, whose date input then sits inline; status; therapist for admin / front desk) and, after a thin divider, the past's tappable outcome counters (attended / no-shows / cancelled; a zero counter is hidden unless it's the active filter). Then rows grouped by day ("Yesterday", "Tue, 29 Sept") in one bordered list with the Schedule colour code, flags and condition, and "Show more" every 50.
    - **Phones**: the tabs row shows Schedule · History · Feedback and + Book (Reminders from `tab:`, in ⋮ on phones); "Find a time" lives in ⋮ and in the empty-day card; on a closed day with nothing booked the empty card is the closed notice ("Closed every Thursday. Public booking is off. You can still book here.") instead of a banner plus a card. **Blocks show status by fill** (`appointmentFill`, shared with Workspace's Today rows): upcoming = white card with the therapist's edge; arrived without a visit = tinted in the therapist's colour; visit logged = grey; no-show = rust; cancelled = struck through. `.chip-row` sits in `@layer components` in `index.css` so Tailwind display utilities can hide it (unlayered, it beat `desktop:hidden`). There is no Requests tab: "See all" / "All" (and `?view=requests`, e.g. Workspace's Review link) opens the full list in a `Panel`.
    - **History**: Past / Upcoming toggle, a since/until date, day headings, outcome counts (attended / no-show / cancelled), search, status and therapist filters.
    - **Booking sheet extras**: "First available →" (`firstAvailableSlot`, next 21 days, respects closures, working hours and length); the submit button carries the summary ("Confirm booking · Thu, 1 Oct, 10:30 AM · 30m"); sticky footer on phones.
    - **Working hours and booking outside hours** (`therapists.working_hours`, see schema): the grid shades non-working time (paper) and offers free slots inside it as normal, while off-hours empty cells remain clickable with a dimmer look and explicit aria-label. Staff can visibly book outside hours in both `BookSlotSheet` and the schedule grid. In `BookSlotSheet`, slot generation covers an extended day window based on `bookableWindow`: clinic hours ± `staffBookingBufferHours` (default 3, clamped 0–12; 0 disables booking outside clinic hours) plus the therapist's own hours (if their shift extends further), and the hard `runsPastClose` disable is removed (past times and occupied slots stay disabled). Outside-hours slots are grouped into a single toggle button "Outside hours (N)" that expands into Morning, Afternoon, and Evening groups (auto-expanded if the therapist has no working hours that day or if an outside slot is selected). Booking or rescheduling to an off-hours slot shows a `ConfirmDialog` ("Outside Dr X's hours... Book anyway?" or "Outside clinic hours. Book anyway?"); cancel keeps the sheet open. Dragging or moving an appointment to an off-hours slot in the grid asks the same confirm via `pendingMove`. The schedule grid dynamically extends its vertical hours (`displayHours`, computed via pure `displayHoursFor`) by the staff booking buffer (`staffBookingBufferHours`) on both sides of clinic hours — so a block can be dragged or stretched past closing/before opening (drag and resize clamp to the grid range) — and further to cover the working hours of the therapists in view (a shift running past clinic hours still gets rows) and any early or late bookings beyond that so they are not clipped, strictly filtering to the current week in week mode. Closed days and past times remain blocked; double-booking is still prevented by occupancy checks. Single bookings may go outside therapist or clinic hours after a confirm; repeat (series) bookings cannot. Public booking remains strictly restricted to working hours. Admin/front desk configure the staff booking buffer in Settings → Hours & closures, and assign shifts or custom hours directly from Settings → Team or the schedule kebab.
    - **Repeat bookings**: booking sheet "Repeat this booking" — weekday chips + session count (defaults to sessions left in the patient's open package via `dashboardService.openPackages`), a per-date preview (`seriesDates`, `seriesProblem`) marking clashes / outside hours / past with "Find a time" or "Skip" per date; submits via `confirm_booking_series` (all-or-nothing). The details panel shows "Session k of n" and offers "Cancel this and all following sessions" (`cancel_appointment_series`). Single bookings may go outside therapist or clinic hours after a confirm; repeat (series) bookings cannot.
    - **Start times vs. length** (`clinics.start_step_minutes`, Settings → Hours & closures → "Start times every", 15 / 30 / same as duration; helper `startStepMinutes(clinic)` in `schedule.ts`): `slot_duration_minutes` is the default appointment length (and the length of legacy rows with none); the start step is how often *staff* can start one. The schedule grids (`stepMinutes` prop on `ResourceDayGrid` / `WeekTimeGrid` / phone grids → free-time tint and tap-to-book), Find a time (`FindTimePanel`), the phone free-gap list (`freeGaps` `alignStep`) and the `BookSlotSheet` time list use the step; free time must still hold the default length where a booking is made. The booking sheet's length chips are 15 / 30 / 45 / 60 / 90 (plus the clinic default and a rescheduled appointment's own length). **Public online booking is unchanged and keeps `slot_duration_minutes`.** When an appointment is being moved in the all-therapists Week view, tap targets count only the moving appointment's own therapist (its own time is free, the whole length must fit), not "any therapist is free".
    - **Drag (tab+)**: mouse/pen drag a block to move it (15-minute snaps, across therapist columns in Day view, across days in the single-therapist Week view) or drag its bottom edge to resize; a dashed ghost shows the target and turns red when it isn't free / is closed / past (`dropAllowed`, which allows off-hours slots). Touch (phones and iPad): a swipe scrolls as usual; press and hold a block for 300 ms (a short buzz) to lift it, then drag it with the finger in the same 15-minute steps, across columns too (`useGridDrag` in `TimeGrid.tsx`; a non-passive `touchmove` listener on the grid stops page scrolling only while a block is lifted). Lifting and letting go without moving enters "Tap a free time to move …" mode instead: its targets come every 30 minutes (`PLACE_STEP_MINUTES`, so each is a full finger-height whatever the clinic slot) and only where the appointment's whole length fits, before closing, ignoring its own current time. While dragging (mouse or touch) the grid auto-scrolls near the top/bottom 60px of the visible area (`edgeScrollSpeed`; page scroll on phones, the grid's box elsewhere), faster closer to the edge, and the scrolled distance counts toward the drop time; a lifted block held still never auto-scrolls. The clinic's `slot_duration_minutes` still sets booking targets and default length, not drag steps. Same-therapist in-hours drops save at once with a 10 s Undo toast; dropping on another therapist, another date, or an outside-hours slot asks to confirm via `pendingMove`. Only confirmed/rescheduled appointments the viewer can manage are draggable; therapists can't reassign (server-enforced).
    - **`BookSlotSheet` layout (phone-first)**: a fixed header (title, close ×) and footer (what will be booked, "Fri, 2 Oct, 11:00 AM · 30m · Dr Aishwarya", then a full-width action), with the body scrolling between them; 94dvh bottom sheet on phones, centred dialog from `sm:`. Sections: Patient (Existing / New toggle), Therapist and length (therapist chips with their Schedule colours, length chips), Day (7 day cards, closed days greyed, "Other date" for the calendar), Time (Morning / Afternoon / Evening groups, 4 columns on phones; taken or past times faded; "First available"), then a "Repeat this booking" switch. A request being confirmed shows what the patient asked for at the top.
    - **`BookSlotSheet`**: one sheet for "+ Book", grid/agenda/free-time clicks, request confirmation, and **reschedule** (`rescheduleAppointment` prop: patient and therapist fixed, the moved appointment is ignored when checking occupied time, submits `reschedule_appointment`). A length picker (30/45/60/90 minutes, plus the clinic slot if different — always labelled in minutes via `lengthLabel()`, never "1h"/"1h30") drives the occupied check; times that already passed or overlap the therapist's bookings for the chosen length are disabled. Therapist defaults to the logged-in therapist or the only therapist, and is locked for therapist logins. Closed weekdays and holidays show a warning but can still be booked. A patient with no phone must have one entered. State resets on every open; the reschedule snapshot is taken at open time so a sync mid-edit can't reset the form. `onBooked` returns `{ kind: 'booked' | 'rescheduled', appointmentId, scheduledAt, durationMinutes, … }`; the toast offers WhatsApp and auto-dismisses after 15s.
    - **Clinic closures**: weekly closed days stay in Settings (`clinics.closed_weekdays`); one-off dates and ranges (holidays) are set from the calendar (`ClosedDaysSheet`, admin / front desk) and shown in the rail, strip, grid, booking sheet and the public `/book/$slug` form. Existing appointments on a newly closed day are kept. `isClosedDay` (holiday wins over weekday) and `groupClosedRanges` live in `src/domain/schedule.ts`.
    - **Public form layout**: time first, then details — header (clinic initial/logo, visit length, hours), step 1 "Choose a time" (clinician chips "Anyone available" / each therapist, a scrollable 14-day strip with uniform day cards and "Closed" days, "More dates" inline month, time grid), step 2 "Your details" (name, phone with compact country picker, optional email and reason), and a summary + "Request appointment" bar pinned to the bottom on phones (safe-area padded). The clinic clock is fixed to `Asia/Kolkata` and refreshed every minute via `useClinicNow`. Day status evaluates past, far, closed, holiday, therapist off, and finally end-of-day cutoff. Phone input normalises leading zeros, spaces/dashes, and pasted `+91` or `91` (when 12 digits), storing standardized `+<code> <digits>`.
    - **Workspace header**: one compact card (about 150–180px tall on a phone) — the greeting (therapist's first name when linked) with the short date ("Thu, 1 Oct") beside it on the same line, "+ Book" (opens `BookSlotSheet`; therapist-locked for therapists) and "+ New visit", the stat strip (see Today-First Workspace), then a "needs you" line **only when something needs attention that the page doesn't already list**: the therapist's notes to finish (opens the oldest draft), new feedback, and visits not synced yet (amber). Visits in progress and booking requests aren't repeated there — the Today card right below lists both (with Complete / Confirm). With nothing to show, the line is hidden rather than saying "All caught up"; the header's sync dot covers the synced state. Book / New visit carry icons. While setup is incomplete, an admin sees the guided-setup bar (`SetupProgressBar`) above this card.
    - **Workspace Today card**: one card with tabs "Appointments (n) | Visits (n)" (tab remembered per device) instead of separate "Expected today" and "Today's visits" cards. Appointments (`TodayAppointments`) use flat divided rows at the same density as the Visits list, coloured like the Schedule grid (`appointmentFill` in `scheduleColors.ts`: therapist-colour left edge; white = upcoming, therapist tint = arrived, grey = visit logged, rust = no-show) (time, name, therapist and length from `sm:`, a small status pill; "Next" pill on the next appointment): in-progress visits first (arrived, no visit yet, today's plus any left open in the last 7 days) with a compact "Complete visit" button, then the next 5 upcoming with "Show all", finished ones (visit logged / no-show) folded under "Done (n)". For admin / front desk, **Requests to confirm (n)** comes first: the oldest three pending public booking requests (`RequestsInbox variant="list"`, "See all" → `/schedule?view=requests`) with Confirm (Workspace's `BookSlotSheet` on the requested date if not past, with the preferred therapist, name/phone, notes and time wish — same as Schedule) and Decline (`ConfirmDialog` → `declineAppointmentRequest`); the Appointments tab count includes them.
    - **Visit in progress (notes before the service)**: a "draft visit" is an **arrived appointment with no `visit_id`**, never a row in `visits` (whose service/price/split snapshots feed invoices, payouts and reports). `StartVisitSheet` (appointment panel "Add note", New Visit's "Start a note first") finds or creates the patient, then either **Start note** — for a booked appointment it marks it arrived; for a walk-in it calls `start_walk_in` (arrived appointment now, `source = 'walk_in'`, no overlap check, accepts a not-yet-synced patient by name/phone) — and opens the Core Assessment with `?appointmentId=`, or **Log visit now** (normal New Visit). The note stores `appointment_id`; when New Visit later saves with that `appointmentId`, `consultationNoteService.linkAppointmentNotesToVisit` sets the notes' `visit_id` (and marks the visit documented if a note is completed). "Mark arrived" stays optional — logging a visit marks arrival anyway. Workspace loads appointments even with patient comms off, so a walk-in in progress shows under Today → Appointments (the tab appears only while one is open). A "New patient" created by a Start note attempt that then fails (e.g. offline) is reused on retry, not duplicated.
    - **Patient form**: Name, Phone, Age, Sex, Primary condition, Referring source, then a collapsed "More details (optional)" with Email, Alternate phone and Patient ID (blank = auto-generated; fill only to keep an old record's number) — in New Visit's create-patient step and the Edit patient modal. Search matches the alternate phone too.
    - **App header**: the Thera.Net mark on the left (`BrandMark`, wordmark from `desktop:`, links to Workspace) — the product; nav in the middle (labels from `tab:`); on the right the **clinic pill** (`ClinicSwitcher`: the clinic's uploaded logo or its initial + name; name hidden between `tab:` and `desktop:`, where five nav labels leave no room — tooltip and menu carry it), then `SyncBadge` (a quiet green dot when synced, expanding with text when offline / syncing / pending / failed; its popover is pinned full-width under the header on phones) and the account avatar. The clinic pill is the only clinic switcher, and for admins it also has "+ Add another clinic" (a non-admin with one clinic gets a static label). No date in the header (Workspace shows it).
    - **Thera.Net branding**: `src/components/BrandMark.tsx` — `BrandMark` (header, account menu footer "Thera.Net · v{version}" from `__APP_VERSION__`, defined in `vite.config.ts` from package.json), `AppLoading` (full-screen loading / "Preparing…" in `Shell`), `PoweredBy` ("Powered by Thera.Net" under the public booking and feedback forms). Sign-in/reset use `AuthBrandHeader`, which renders `BrandMark`. The clinic's own logo appears only in the clinic pill, on the public forms' header and on printed documents.
    - **Public form** (`BookingFormPage.tsx`): dates more than 90 days out aren't offered (availability is only fetched that far), and a failed availability fetch no longer blocks the whole form. A start time is hidden when it overlaps the preferred therapist's bookings for their full length; with no preference, only when every therapist is busy (`isPublicSlotTaken`). Past times today are hidden.
    - **History**: `HistorySurface` — search by name/phone, status and therapist filters (therapist filter hidden for therapist logins), 30-day paging; rows open the same details panel.
  - **Workspace "Expected today"** — a new section (not a replacement of
    anything, per the point above), sourced from
    `dashboardService.todayAppointments`, scoped the same way "Seen
    today" already is (clinic-wide for admin/front_desk, own-therapist
    otherwise). Row actions: "Mark arrived" (any clinic member, matching
    the RPC's own membership check), "No-show"/"Cancel"
    (admin/front_desk only), "Create visit" (once `visit_id` is still
    unset). Reschedule is deliberately Schedule-only, not offered inline
    on Workspace — a more deliberate action than a single click, better
    suited to the dedicated management surface. The Schedule's History table carries the same "Create visit" condition (found
    missing in review — an appointment manually marked arrived without a
    visit yet had no way back to New Visit once it wasn't "today" anymore
    and had dropped off Workspace's list; History's table has no
    date-scoping, so it's the recovery path for that case). A second banner
    surfaces the pending-booking-request count for admin/front_desk, linking to
    `/schedule?view=requests`.
  - **Settings** gained a booking-link field in the same Patient
    communications section (client-validated lowercase-alphanumeric-plus-
    hyphens pattern; the DB only enforces uniqueness) with a "Copy link"
    button, alongside the existing module toggle and Google review URL.
  - **`message_log` gets its first writer via the Phase 9 wiring below** —
    every send action, `shareTherapistNotify` included as of the
    `therapists.phone` addition below, now goes through the Business API
    path first (when a recipient phone number is known), and a successful
    send there writes a `message_log` row server-side. Until a clinic
    actually configures the Business API and has an approved template,
    every send still falls through to the share sheet — which still
    doesn't log anything, same gap as before.
  - **A "Book" action on each Patients-list row** (`BookAppointmentDialog.tsx`)
    — same `create_appointment_staff` RPC as the Bookings tab's own "New
    booking" card, reachable straight from a patient's row instead of a
    detour through Requests. Pre-fills name/phone from the patient record
    (phone stays editable — some patients predate having one on file) and
    defaults Therapist to whoever ran their last visit, since "book with
    the same therapist" is the common case. Gated on
    `clinic.enablePatientComms` **and** admin-or-front_desk (`canBook` in
    `PatientsPage.tsx`) — the RPC itself rejects any other role, so the
    role check isn't optional the way the comms-flag check is; a plain
    therapist never sees the button at all, same as Requests → Bookings'
    own gate.
  - **Optional `patient_id` linking at booking/confirm time** — both
    `create_appointment_staff` and `confirm_appointment_request` grew a
    trailing `p_patient_id uuid default null` parameter (drop+create, not
    `create or replace` — see §3c), used at exactly the two entry points
    where identity is already unambiguous, without relaxing the documented
    "`appointments.patient_id` stays null until arrival" rule for every
    other path (a public form submission or a hand-typed name still
    carries real duplicate-name risk, so it still waits for New Visit's
    own search-or-create typeahead):
    - The Patients-list "Book" action above always passes it —
      `BookAppointmentDialog` opens from an already-clicked patient row,
      so there's no name to match and no ambiguity to defer.
    - The Bookings tab's Confirm mini-form (`SchedulePage.tsx`) grew a
      third, optional field alongside Scheduled-for/Therapist: a
      `SearchableSelect` "Link to existing patient · optional" picker
      (options built from `repos.patients.list`, broadened from
      admin-only to admin-or-front_desk for this). Left blank — the
      default — it's exactly today's behavior, identity resolves later.
      Staff only fill it in when they explicitly recognize the requester
      (by the name/phone already shown on the request card) as someone
      already on file; nothing else on the form depends on it.
    Both RPCs check the passed id belongs to the same clinic before
    trusting it. `bookingService.confirmAppointmentRequest` and
    `.createAppointmentStaff` both take the new id as a trailing optional
    parameter, defaulting to `null`, so every existing call site is
    unaffected.
  - **Every "Create visit" link now passes `patientId` through when the
    appointment already has one** (Workspace's "Expected today", both
    mobile card and desktop table, plus Requests → Bookings' Appointments
    table) — found in review right after the two entry points above
    shipped: `NewVisitPage.tsx`'s `?patientId=…` search param already
    pre-selects that exact patient (`repos.patients.get`, skipping the
    typeahead entirely — the same fast path Patient Profile's own "New
    visit" button and the repeat-visit flow use), but every "Create
    visit" `Link` still only passed `prefillName`/`prefillPhone`, on a
    now-stale assumption (a comment on the desktop-table one said so
    outright) that `patientId` is only ever set alongside `visitId`. Once
    the Book/Confirm-picker linking above could set it earlier, that
    assumption broke: a patient already linked at booking time would hit
    "Create visit" and land in the create-new-patient form instead of
    being recognized, risking a duplicate patient record for someone
    already correctly identified.
  - **`NewVisitPage.tsx`'s Condition/Treatments fields collapse behind a
    "+ Add condition / treatments (optional)" disclosure for front_desk
    only** — reception usually doesn't know either at log time (that's
    the therapist's own read of the patient after seeing them, not
    something a booking or walk-in carries), so their path is Patient →
    Therapist → Service → Payment, the four things they always have,
    without two clinical fields sitting in the middle of it. Still one
    click away, and admin/therapist never see it collapsed — this is a
    front_desk-only default, not a permission: the fields were never
    access-gated, only de-prioritized in the one role that usually can't
    fill them in yet. **Auto-expands the moment either field gets a
    non-empty value from anywhere else** — "Repeat last visit" and the
    `?patientId=` prefill (a patient's own `primaryCondition`) both set
    `condition` programmatically, and without this a value could sit
    filled in behind the still-collapsed button and get submitted without
    front desk ever seeing it (found in review, not the shipped behavior).
- **WhatsApp Business Cloud API — wired, pending real templates (Phase 9)**
  — built ahead of the clinic actually having Meta credentials, so that
  turning real sending on is a config step, not a code change.
  - **`clinic_whatsapp_config`** — `phone_number_id`, `access_token`
    (a real Meta secret), `enabled`. Carries **no SELECT policy for any
    client role at all** (RLS enabled, zero policies) — only
    `service_role`, used exclusively inside the Edge Function below,
    can ever read it. Two RPCs give the client everything it legitimately
    needs without exposing the token: `set_whatsapp_config(...)`
    (admin-only write; a `null` access token argument leaves the stored
    one untouched, so re-saving the phone number ID or flipping `enabled`
    doesn't force re-entering the secret) and
    `get_whatsapp_config_status(...)` (admin-only read of `enabled` /
    `phone_number_id` / `has_token: boolean` — never the token itself).
  - **`supabase/functions/send-whatsapp-template/index.ts`** — the one
    place in the app that would ever call Meta's Graph API
    (`https://graph.facebook.com/v20.0/{phone_number_id}/messages`),
    structurally mirroring `invite-therapist/index.ts` (JWT-verified
    caller, a `clinic_members` membership check, a service-role client
    for the privileged read). Template-shaped from the start — the
    caller supplies `templateName`/`languageCode`/`bodyParams`, never
    freeform text — because Meta requires an approved template for any
    business-initiated message outside a 24h customer-service window;
    this function has no opinion on what a given clinic's approved
    template actually says. Returns `{ configured: false }` (not an
    error) when the clinic has no config row or hasn't enabled it. On a
    successful send, writes a `message_log` row (`channel:
    'wa_business_api'`) — see the note above.
  - **Settings** gained a collapsed-by-default "WhatsApp Business API
    (advanced)" sub-block in the Patient communications section
    (`WhatsAppBusinessSubsection` in `SettingsPage.tsx`) — enable toggle,
    phone number ID, and a password-type access-token field that's never
    re-populated with the real value, only a "Connected ✓" / "Not
    connected" status line. Its own small save/status state, not part of
    the section's shared `useClinicSectionForm` dirty-tracking — this is
    a separate table with write-only semantics, not a few more `Clinic`
    columns.
  - **`src/lib/whatsappSend.ts`'s `sendWhatsAppMessage()`** is now the one
    place any send action decides *how* to send: try
    `whatsappBusinessService.sendViaBusinessApi()` first when a recipient
    phone number is known, and fall back to the existing
    `shareTextViaWhatsApp` share sheet whenever the clinic hasn't
    configured it, there's no phone number, Meta rejects the send (e.g. an
    unrecognized template name), or the request fails outright — so
    turning this on for real is purely a Settings config change plus a
    template-name/param swap in `WHATSAPP_TEMPLATES`, not a code change.
    All seven patient/staff-facing send actions (`askForFeedback`,
    `resend`, `askForGoogleReview`, `sendStalePackageReminder`,
    `sendReturnReminder`, `shareBookingConfirmation`,
    `shareTherapistNotify`) go through it, reading the recipient's phone
    off `Patient.phone` (added to `VisitCardData` as `patientPhone`,
    `OpenPackageRow` as `phone`, and threaded through `NewVisitPage`'s
    post-save state and `SchedulePage`'s `justConfirmed` state to reach the
    call sites) or, for `shareTherapistNotify`, off the new
    `therapists.phone` column (nullable text; `RosterCard`'s edit form in
    Settings, next to Registration no. — absent still means share-sheet-
    only for that therapist, exactly like every other action falls back
    when its recipient's phone is unknown).
  - **Template names are hardcoded placeholders** (`WHATSAPP_TEMPLATES` in
    `whatsappSend.ts`, e.g. `'feedback_request_v1'`) — Meta assigns the
    real name when a clinic's own template is approved, and it has no
    relationship to this string; an unrecognized name is exactly what
    makes Meta return `{ configured: true, success: false }`, which this
    wrapper treats the same as "not configured" and falls back to the
    share sheet. Swap these for the clinic's actual approved template
    names (and adjust `bodyParams` ordering to match that template's own
    `{{1}}`, `{{2}}`, ... variables) once real ones exist — there's no way
    to know a template's variable shape in advance, so `bodyParams` here
    is a best-effort guess at "the same information the share-sheet text
    already sends," in the same order.
  - **Phone numbers are normalized, not validated** —
    `normalizePhoneForWhatsApp()` in `whatsappSend.ts` strips non-digits
    and prepends `91` to a bare 10-digit number (this app's phone fields
    are free text with no format enforced, and a 10-digit local number is
    what staff overwhelmingly type); anything else passes through as-is
    and Meta's own validation is the real backstop.
- **Trends review print** (`/insights/trends-print?period=&year=&month=`, linked from
  Reports → Trends as "Print / PDF review") — **internal team review** handout,
  **not** the official **Monthly statement** (`/insights/print`, per-therapist
  Bill/BM/TDS/split for hospitals/partners/therapists). Carries the same
  `period` window as the on-screen trend bar, a focus-month KPI snapshot,
  `RevenueTrendPanel`, therapist dual-bar + `TherapistComparisonTable` when
  enabled, and live retention lists. **No** `MonthlyReportTable`, **no**
  conditions (deferred — free-text condition field would not produce a useful
  pie). `/insights/performance-print` redirects here. Same admin/front_desk gate
  as Reports.
  - **Clinic totals** — `reportService.monthly` for the focus month (revenue +
    visits vs prior month).
  - **Per-therapist breakdown** — dual-bar + comparison table for the focus
    month only (retention % + packages via `repeatVisits` / `monthlyNewCounts`).
  - **Retention follow-ups** — live `singleVisitPatients` and stale
    `openPackages`, labeled as-of today, not historical to the focus month.
- **Trends dashboard's "at a glance" KPI strip gained a Visits card** —
  `ReportsOverviewPage.tsx`'s `KpiCard` strip already had month-over-month
  trend badges on Revenue, Repeat visits, New patients, and Packages
  (`pctChange` against the `revenueTrend` array's last two entries, no
  extra query); raw visit count — "are we busier or quieter," not a
  rate/quality metric like everything else in the strip — was the one gap.
  `visitsThisMonth`/`visitsLastMonth` reuse the same already-fetched
  `trend` array the Revenue card reads from. Grid went from 5 to 6 cards,
  and its breakpoint moved from `lg:grid-cols-6` (1024px) to
  `xl:grid-cols-6` (1280px) — six cards at the narrower width squeezed the
  Revenue card's longest value ("₹1,84,500 ▲ 12%") into wrapping past its
  own card edge; `sm:grid-cols-3` already covers every width from 640px up
  with two comfortable rows of three in the gap between.

---

### 9b. Account menu (personal settings, every role)

Everything about the signed-in person lives in the header avatar menu, separate from the clinic-wide, admin-only Settings page. A bottom sheet on phones, a dropdown from `sm:` up.
- **My account** (sheet): *Profile* (display name for everyone; for a linked therapist also name on invoices, registration no., phone, photo; email read-only) and *Security* (change/set password, sign out of other devices via `auth.signOut({ scope: 'others' })`).
- **My working hours**: a linked therapist's `ShiftRequestSheet` with a live "Your current schedule" summary block at top (headline, last change date and author, Mon–Sun weekly hours list with break intervals, pending requests, and declined requests with admin decision notes). The account menu row displays a one-line subtitle (`useMySchedule`: effective hours summary or "Request pending") and an "Updated" dot until opened (tracked via device `localStorage` `myHoursSeen:<therapistId>`). Pick a shift template + weekdays (submits a pending request for admin approval) or fall through to `WorkingHoursSheet` for custom hours that don't match any template (also a request). A therapist can no longer write `working_hours` directly; see **Shift-based scheduling**. A separate `BreakPlacementControl`, shown alongside it, lets a therapist move their break within an already-approved shift immediately, no approval needed.
- **Notifications**: this device's push switch, a **"Which alerts do you want?"** list of switches for the alerts that apply to the person (booking requests for admin / front desk, changes to my appointments for anyone linked to a therapist profile, low-rated feedback for admin; on by default, per clinic, all devices; stored in `user_push_preferences`) and, for a linked therapist, "Email me appointment updates".
- **Settings**: admins only. Install app and Help & feedback for everyone.
- The avatar shows the linked therapist's photo, otherwise initials.

### 10. Push Notifications

Web Push alerts reach staff and therapists when the app is closed. Opt-in per device from the account menu → Notifications, available to every role (not the admin-only Settings page).

- **Therapist:** confirmed, rescheduled, or cancelled appointment on their own schedule.
- **Admin and front desk:** every new public booking request for the clinic.
- **Admin only:** 1–2 star feedback responses.
- **Content rule:** therapist and feedback payloads carry no patient data (time only, or fixed text). Booking-request payloads carry the patient's name, preferred date, and the chosen slot time (`H:MM AM/PM`), since the staff member chose to see these on the lock screen. The slot is validated server-side and dropped if it isn't a slot label; the name is capped at 60 characters with control characters removed.
- **Shared devices:** signing out removes this browser's subscription, so the next login doesn't receive the previous user's alerts. A single browser subscription can only ever belong to one user, so `register_push_subscription` intentionally reassigns it to whoever enables push most recently on that device — correct for a kiosk, but it used to leave the *previous* user's Settings screen claiming "On for this device" even though their alerts had silently stopped. `pushState()` (`src/features/notifications/pushSubscription.ts`) now also checks that the server-side `push_subscriptions` row for this device's endpoint still belongs to the signed-in user (RLS scopes the check to their own rows) before reporting "on", so a bumped-off user correctly sees the enable prompt again instead of a stale "on" status.
- **iOS:** push works only after the app is added to the Home Screen; Settings shows an install prompt instead of the enable button until then.
- **Delivery:** triggers on `appointments`, `appointment_requests`, and `feedback_responses` call the `send-push` edge function asynchronously via `pg_net`. Recipients are resolved at send time from clinic membership. Subscriptions returning 404 or 410 are removed.

## Application Architecture

### Directory Structure

```
src/domain/              Pure business logic (no framework imports)
                         Money, splits, fiscal year, clinical assessments
                         Unit-tested, fully offline-capable

src/repositories/        Data-access interfaces + Dexie implementations
                         UI reads/writes local only; sync handles remote

src/sync/                Outbox push / delta pull engine
                         Against Supabase realtime & storage

src/services/            Orchestration layer (no React imports)
                         Visit, invoice, report, patient, dashboard,
                         consultation-note, therapist, advance services

src/features/            UI pages and components (React + TanStack Router)
  ├── workspace/         WorkspacePage (Today, Recent, Open Packages, Pending)
  ├── visits/            LedgerPage at /ledger (Visits/Invoices/Daybook sub-tabs); DaybookPage; NewVisitPage
  ├── patients/          PatientsPage, PatientProfilePage, NoteEditorPage
  ├── reports/           ReportsPage at /insights (Trends + monthly statement +
                         performance report), MonthlyLedgerPrintPage,
                         MonthlyPerformancePickerPage, MonthlyPerformanceReportPage
  ├── settings/          SettingsPage at /settings; CreateClinicForm
  ├── invoices/          InvoicePrintPage
  ├── import/            Historical Excel visit import (preview + commit)
  ├── auth/              Login, reset-password
  ├── schedule/          SchedulePage at /schedule (Feedback tab, admin;
                         Bookings tab, admin + front_desk); scheduleSignals.ts
                         (the "new response" count + the front-desk Google-
                         review-eligibility hook, kept out of SchedulePage
                         itself so Workspace's eager bundle can read them
                         without pulling in the route-code-split page)
  ├── publicFeedback/    FeedbackFormPage at /f/$token (anonymous, no Shell)
  ├── publicBooking/     BookingFormPage at /book/$clinicSlug (anonymous, no Shell)
  └── more/              Mobile-only overflow nav page

src/components/          Shared UI components — VisitCard (shared card/table
                         list), BodyChart, ScaleWidget, IssueInvoiceDialog,
                         TakePaymentDialog, RevenueShareEditor, UpiQrModal, SyncBadge,
                         BarChart/PieChart/IndexedTrendChart, MonthlyReportTable,
                         TherapistComparisonCard, SearchableSelect, ui.tsx
                         (shared primitives: Pill, buttons, table cells)

src/lib/                 Utilities (Supabase client, errors, image resize, db)

src/app/                 Shell, router, hooks (useClinicRole, usePermissions,
                         useVisitColumnPrefs, useWorkspaceScope)

supabase/                SQL migrations, RLS policies, RPCs, realtime
                         publications, seed data
```

### App Routes

| Route | Purpose | Access |
|-------|---------|--------|
| `/workspace` (default) | Today's work, recent history, open packages, pending items | All roles |
| `/visits/new` | New visit entry | All roles (billing fields gated by `canBill`) |
| `/ledger` | Historical visit records, patients list, invoices & daybook, URL-addressable sub-tabs (`?tab=visits\|patients\|invoices\|daybook`) | All roles (Invoices/Daybook tabs require billing access) |
| `/patients` | Redirects to `/ledger?tab=patients` | All roles |
| `/patients/$patientId` | Individual patient profile, visit history, payments summary, clinical notes (Back returns to `/ledger?tab=patients`) | All roles |
| `/patients/$patientId/notes/new`, `/patients/$patientId/notes/$noteId` | Core Assessment note editor (Initial/Follow-up) | Therapists & admins (`canViewClinicalNotes`) |
| `/patients/$patientId/notes/$noteId/print` | Printable consultation note | Therapists & admins |
| `/insights` | Dashboard + monthly per-therapist statement (`?tab=monthly`) + monthly performance report picker (`?tab=performance`) | Admins & front_desk (monthly statement and performance report sub-views further gated admin-only, same `canViewPayouts` check) |
| `/insights/print` | Printable monthly ledger (portrait A4) | Admins & front_desk |
| `/insights/performance-print` | Printable monthly performance report — clinic totals, per-therapist chart + table, referral/condition mix, retention follow-ups (portrait A4) | Admins & front_desk |
| `/invoices/$invoiceId/print` | Printable Bill/Bill Cum Receipt (A4/A5) | Anyone who can reach the invoice |
| `/settings` | Clinic configuration, MRNO settings, billing mode, rate setup, feature toggles (in main header nav for admins) | Admins only |
| `/settings/import-visits` | Historical Excel visit import | Admins only |
| `/more` | Mobile-only overflow nav: Reports (admin/front desk), Settings (admin) — icon rows. Booking requests aren't listed; the Schedule tab carries their badge and inbox | All roles |
| `/schedule` (`?tab=feedback\|bookings`, `?view=schedule\|requests\|history`, `?mode=day\|week`, `?date=`, `?therapist=`) | Clinic calendar (see Patient Communications → Schedule), booking requests, appointment history; Feedback tab | Calendar + History: all roles (therapists scoped to their own appointments). Requests: admins + front_desk. Feedback: admins only |
| `/reset-password` | Password reset | Unauthenticated |
| `/f/$token` | Public patient feedback form (Patient Communications, Phase 0) | Unauthenticated — token-scoped, no clinic membership |
| `/book/$clinicSlug` | Public booking request form (Patient Communications, Phase 5) | Unauthenticated — slug-scoped, no clinic membership |
| `/archive`, `/setup`, `/setup/import-visits`, `/invoices`, `/reports`, `/reports/print` | Legacy redirects for old bookmarks | All roles |

---

## Database Schema

*Verified against the live schema (`information_schema.columns`), not
hand-maintained from memory — if this section and the actual database ever
disagree again, trust the database and fix this doc, not the other way
around.*

### Core Tables

#### `clinics`
```sql
id                          uuid PRIMARY KEY
name                        text NOT NULL
address, phone, email, gst_no, logo_path  text (NULLABLE)
partner_hospital_name, partner_hospital_logo_path  text (NULLABLE)
invoice_prefix              text NOT NULL (e.g., "BM")
bm_split_pct                numeric NOT NULL (default 75)
tax_pct                     numeric NOT NULL (default 10)
tds_basis                   text NOT NULL CHECK (IN 'gross_bill', 'bm_share')
fy_start_month              int NOT NULL (default 4 = April)
clinic_type                 text (NULLABLE) — 'individual' | 'multiple'
has_partner                 boolean NOT NULL
billing_mode                text NOT NULL — legacy, maps to clinic_type+has_partner
enable_therapist_split      boolean (NULLABLE)
own_share_label, partner_share_label  text (NULLABLE) — default "BM"/"HV"
last_split_change_at        timestamptz (NULLABLE) — stamped whenever an
                             admin changes hasPartner/bmSplitPct/taxPct/
                             tdsBasis/clinicType; Workspace shows a 14-day
                             "your split changed on X" banner off this
billing_enabled              boolean NOT NULL — legacy: no longer read or editable (billing is always on); server invoice checks still read it (all true)
partner_collects             boolean NOT NULL DEFAULT false — the partner collects patients' payments (only with has_partner)
default_payment_method       text NULL — what payment screens preselect (CHECK: the six methods)
invoicing_access            text NOT NULL — 'everyone' | 'billing_staff'
invoice_policy              text NOT NULL DEFAULT 'on_request' — 'on_request' | 'always' | 'never_nag'
clinical_docs_enabled       boolean NOT NULL DEFAULT true — new clinics start on (migration 20261025110000); existing clinics keep their value
show_therapist_comparison   boolean NOT NULL
walk_in_mrno_prefix         text (NULLABLE, default 'W')
visit_column_prefs          jsonb (NULLABLE) — legacy, superseded by per-user
                             Dexie prefs (useVisitColumnPrefs); no client code
                             reads/writes this column today
upi_vpa, upi_payee_name, upi_qr_path  text (NULLABLE)
upi_qr_enabled               boolean (NULLABLE)
signature_path               text (NULLABLE)
slot_duration_minutes        integer NOT NULL (default 30) — 15|30|45|60
start_step_minutes           smallint NULL — 15|30; staff start times come every this many minutes (null = every slot_duration_minutes). Public booking ignores it
timezone                     text NOT NULL DEFAULT 'Asia/Kolkata' — IANA zone for every server-sent time (emails, push, the agenda, the public booking page); a trigger rejects names Postgres does not know (migration `20261021100000_clinic_region.sql`)
default_country_code         text NOT NULL DEFAULT '+91' — `^\+[0-9]{1,4}$`; the code a phone number without one belongs to (`PhoneField`)
agenda_enabled               boolean NOT NULL DEFAULT true — the clinic sends the evening agenda email (migration `20261021130000_clinic_agenda_switch.sql`)
agenda_hour                  smallint NOT NULL DEFAULT 20 — 0-23, the clinic-local hour `send-agenda` mails tomorrow's appointments (migration `20261021120000_daily_agenda.sql`)
booking_start_hour, booking_end_hour  integer NOT NULL (default 9, 17) — the
                             Schedule grid and every slot picker (staff + public)
staff_booking_buffer_hours   smallint NOT NULL (default 3, range 0–12) — hours
                             before opening and after closing staff may book in
                             BookSlotSheet; 0 disables outside-clinic booking
closed_weekdays              integer[] NOT NULL (default '{}') — 0 = Sunday;
                             weekly closed days (Settings → Online Booking)
onboarding_completed_at      timestamptz (NULLABLE) — set when admin finishes
                             the post–create-clinic wizard; NULL ⇒ Shell keeps
                             redirecting to `/onboarding`
created_by, updated_by       uuid (FOREIGN KEY → auth.users.id, NULLABLE)
updated_at                  timestamptz NOT NULL
```

#### `clinic_members`
```sql
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
user_id         uuid NOT NULL (FOREIGN KEY → auth.users.id)
role            text NOT NULL CHECK (IN 'admin', 'therapist', 'front_desk')
title           text (NULLABLE)
display_name    text (NULLABLE)
last_active_at  timestamptz (NULLABLE) — set by touch_last_active(p_clinic_id) RPC,
                called at most once per device per calendar day (Dexie db.meta
                throttle keyed by BOTH clinic and user id, so a staff member's
                ping on a shared/kiosk device never suppresses a second staff
                member's ping that same day). Settings → Team shows a plain
                "Active today" badge from it — no "N minutes ago" granularity,
                since a once-daily write can't honestly support that precision.
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
PRIMARY KEY (clinic_id, user_id)
```

#### `therapists`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
active          boolean NOT NULL (default true)
user_id         uuid (FOREIGN KEY → auth.users.id, NULLABLE) — linked login
photo_path      text (NULLABLE)
registration_no text (NULLABLE) — printed on invoices under the therapist's name
email_appointment_updates boolean NOT NULL DEFAULT true — when false, `notify-therapist` skips the confirmation/reschedule/cancellation email (push and the manual WhatsApp button are unaffected). The linked therapist sets it from account menu → Notifications.
email_daily_agenda boolean NOT NULL DEFAULT true — no longer read: the agenda is switched per clinic (`clinics.agenda_enabled`, migration `20261021130000_clinic_agenda_switch.sql`). Since `20261021120000_daily_agenda.sql` the DEFAULT of `email_appointment_updates` is false (new therapists get the agenda, not a mail per booking); existing rows keep their value
phone           text (NULLABLE) — lets `shareTherapistNotify` use the WhatsApp
                Business API instead of always falling back to the share sheet
profile_confirmed_at timestamptz (NULLABLE) — set when linked login finishes
                `/onboarding/profile`; NULL triggers profile onboarding
working_hours   jsonb (NULLABLE) — weekly hours: {"0"–"6": [[startMin, endMin], …]},
                gaps are breaks, a missing weekday is a day off, NULL = clinic
                booking hours. Admin/front desk can still write it directly
                via `set_therapist_working_hours` (a therapist can no longer
                write their own — see Shift-based scheduling below). The
                shift-template paths (`assign_shift`,
                `approve_shift_assignment` on a shift request,
                `set_break_placement`, `update_shift_template`'s cascade)
                derive this same JSON shape via `derive_working_hours()`;
                the custom-hours paths (`assign_custom_hours`,
                `approve_shift_assignment` on a custom-hours request) write
                the submitted `custom_hours` JSON verbatim, or NULL for
                "Clinic hours". Either way it stays the single source of
                truth every downstream consumer (TimeGrid, booking form,
                slot generation) already reads — those never needed to
                change. Always validated by `working_hours_valid`. CHECK
                therapists_working_hours_valid (NOT VALID: new writes only)
                guards the column too, and the sync push drops working_hours
                from therapist upserts so a stale local row can't revert it
                (`src/sync/engine.ts`). Client `workingIntervals` reads a
                malformed day as "not working" instead of throwing
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```

#### Shift-based scheduling (`shift_templates`, `therapist_shift_assignments`)

Replaces a therapist's own direct editing of `working_hours` with an admin-controlled model: admin assigns (immediately) a reusable shift template or custom hours; a therapist can request a change (admin-approved) and self-service move their break's placement within an already-approved shift, no approval needed (moving a fixed-duration break never changes total capacity). Both tables are RPC-gated like `appointment_requests` — reads sync normally, no insert/update/delete RLS policy exists on either, every write goes through a `security definer` RPC. A single `derive_working_hours()` function builds the exact same JSON shape `therapists.working_hours` already held, so every downstream consumer (TimeGrid, the booking form, slot generation) needed zero changes.

```sql
-- shift_templates: clinic-defined, reusable envelopes (admin CRUD, Settings → Team).
id                          uuid PRIMARY KEY
clinic_id                   uuid NOT NULL (FOREIGN KEY → clinics.id)
name                        text NOT NULL
start_minute                integer NOT NULL
end_minute                  integer NOT NULL
break_duration_minutes      integer NOT NULL (default 0)
default_break_start_minute  integer (NULLABLE; required whenever break_duration_minutes > 0)
active                      boolean NOT NULL (default true) — deactivated, not deleted
created_at, updated_at      timestamptz NOT NULL

-- therapist_shift_assignments: one row per "which shift (or custom hours) +
-- which weekdays", request/approval history kept, not deleted.
id                  uuid PRIMARY KEY
clinic_id           uuid NOT NULL (FOREIGN KEY → clinics.id)
therapist_id        uuid NOT NULL (FOREIGN KEY → therapists.id)
shift_template_id   uuid (FOREIGN KEY → shift_templates.id, NULLABLE) — exactly one
                    of this or custom_hours is set
custom_hours        jsonb (NULLABLE) — same shape as therapists.working_hours;
                    replaces it wholesale on approval (unlike a shift
                    assignment, which merges by weekday). The JSON-null
                    literal 'null'::jsonb is a sentinel used only on a
                    *pending request* for "Clinic hours" (SQL NULL would
                    violate the exactly-one-of check); the client sees it
                    as `customHours === null` with `shiftTemplateId === null`
                    and labels it "Reset to clinic hours"
weekdays            integer[] (NULLABLE) — required iff shift_template_id is set;
                    NULL on the custom_hours path (weekdays live inside that JSON)
break_start_minute  integer (NULLABLE) — shift-template path only; NULL = the
                    template's own default_break_start_minute
status              text NOT NULL — 'pending' | 'approved' | 'declined' | 'superseded'
                    (superseded: another approved assignment claimed some/all
                    of this row's weekdays, or a custom-hours assignment
                    replaced it entirely — kept as history, not deleted)
note                text (NULLABLE)
decision_note       text (NULLABLE) — admin note recorded when declining a request;
                    decline RPC writes this without touching the therapist's request note
requested_by, decided_by  uuid (FOREIGN KEY → auth.users.id, NULLABLE)
decided_at          timestamptz (NULLABLE)
created_at, updated_at  timestamptz NOT NULL
```

RPCs (all `security definer`, revoked from `anon`): `create_shift_template`/`update_shift_template` (admin/front_desk; the latter cascades — re-derives `working_hours` for every `approved` assignment bound to the edited template, resetting a break placement to the template's new default if it no longer fits), `assign_shift`/`assign_custom_hours` (admin/front_desk, immediate — the admin is already the approver), `request_shift_assignment`/`request_custom_hours` (`is_own_therapist` only, pending; a new request supersedes an existing unactioned one), `approve_shift_assignment`/`decline_shift_assignment` (**admin only** since migration `20261025100000` — front desk can still assign shifts directly but cannot review a therapist's request; the Schedule "N shift requests pending · Review" banner and Settings → Team's pending strip are admin-only too; decline writes `decision_note` while leaving the therapist's `note` intact), `set_break_placement` (`is_own_therapist` or admin/front_desk, immediate, only on an `approved` shift-template assignment — bounds re-validated against the template's current `start_minute`/`end_minute`/`break_duration_minutes` at call time, never cached). A newly-approved assignment's weekdays supersede any overlap on the therapist's other approved shift assignments (`supersede_overlapping_weekdays`); approving a custom-hours assignment supersedes every other approved assignment for that therapist (`supersede_all_assignments`), and assigning/approving a shift supersedes an approved custom-hours row (`apply_shift_hours` checks for one first; if found it is superseded and the shift's hours are derived from `'{}'` rather than merged into the old custom hours — safe because an approved custom-hours row can never coexist with an approved shift row) — custom hours and shift templates are mutually exclusive per therapist. **Days with no shift are days off:** otherwise `apply_shift_hours` builds `working_hours` from the therapist's remaining approved shift assignments only (`rebuild_working_hours_from_shifts`) plus the new shift, never from whatever was stored, so hours set before shifts existed can't linger on days an admin left out (migration `20261012100000`, which also rebuilt existing therapists once). The Team weekly-coverage grid mirrors the schedule: a day missing from stored hours reads as Off, and clinic default hours apply only when a therapist has no stored hours at all.

**"Clinic hours" (NULL working hours).** `WorkingHoursSheet`'s "Clinic hours" option sends `null`. `assign_custom_hours(therapist, null)` inserts no assignment row: it supersedes every approved assignment and sets `therapists.working_hours = NULL` directly, returning NULL (a therapist with zero approved assignments simply uses whatever `working_hours` is). `request_custom_hours(therapist, null)` stores the `'null'::jsonb` sentinel on the pending row; approving it does the same supersede-all + `working_hours = NULL`, never passing the sentinel to `apply_custom_hours`.

**Internal helpers are not callable by clients.** `derive_working_hours`, `supersede_overlapping_weekdays`, `supersede_all_assignments`, `apply_shift_hours`, `apply_custom_hours`, `rebuild_working_hours_from_shifts` have no authorization check of their own, so `execute` is revoked from `public`/`anon`/`authenticated`; the authorized `security definer` RPCs call them as the function owner. `set_break_placement` rejects a NULL break start (it would otherwise delete the break — a capacity increase with no approval).

**Sync.** Both tables carry a `before update` trigger (`set_shift_scheduling_updated_at()` — updated_at only; the shared `set_updated_at()` also writes `updated_by`/`created_by`, which these tables don't have), and every RPC UPDATE also sets `updated_at = now()`, so the sync engine's `updated_at > cursor` pull sees approve/decline/supersede changes. Client mirror: Dexie `version(22)` adds `shift_templates` (`id, clinicId, active`) and `therapist_shift_assignments` (`id, clinicId, therapistId, status, shiftTemplateId`), read-only sync like `appointment_requests`.

**UI.** Settings → Team: `ShiftTemplatesSection` (template CRUD/deactivate) and `ShiftAssignmentsSection` (per-therapist current assignment, a pending-request badge showing the requested shift + weekdays or the actual custom hours / "Reset to clinic hours", the therapist's note, Approve, and Decline with an optional reason). Team member cards display real schedule summaries (`describeSchedule`: template name and days or custom intervals, never generic "Custom schedule" for shift therapists) and a "Set working hours" button opening `SetWorkingHoursFlow` with upcoming conflict checks (`appointmentsOutsideHours`). `AssignShiftDialog` offers a "Custom hours (individual)" option replacing shifts. Coverage grid displays the span of intervals (e.g. `9–5`) rather than "Custom". Schedule view: admin/front desk see a "N pending shift request(s). Review" banner linking to Settings → Team whenever any request is pending. Therapist side: `ShiftRequestSheet` (account menu → My working hours), which displays a "Your current schedule" block (headline, change notice, Mon–Sun hours with breaks, pending request, declined request with note), break control, and the request form with `WorkingHoursSheet` fallback.

#### `user_seen_markers`

Per-user "I have seen X up to <time>" markers behind the notification bell's "new" counts, so they follow a person to every device (migration `20261018120000_user_seen_markers.sql`, Dexie `version(24)`). One row per (user, clinic, marker): `id text` (**deterministic** `"<user_id>:<clinic_id>:<marker_key>"`, enforced by a check constraint, so two devices write the same row), `user_id`, `clinic_id`, `marker_key` (`feedback` | `therapist_appointments`), `seen_at`, `created_at`, `updated_at`. RLS: a user selects/inserts/updates only their own rows (`user_id = auth.uid()` and `is_clinic_member`); no delete policy. A `before insert or update` trigger (`user_seen_markers_guard`) makes `seen_at` **only move forward** and never more than 5 minutes past `now()` (a stale device can't undo a newer look; a wrong clock can't silence the bell), and sets `updated_at`. In `ALL_SYNCED_TABLES` and `CLIENT_WRITABLE_TABLES` (outbox), published to realtime. **Client:** `repos.userSeenMarkers.markSeen/get`; `scheduleSignals.ts` hooks (`useNewFeedbackResponseCount`, `useNewLowRatingFeedbackCount`, `useNewTherapistAppointmentCount`) take the user id and count items newer than `effectiveSeenSince(marker, legacy)` (`domain/seenMarker.ts`): the newest of the synced marker and any old per-device `db.meta` value (carried over into the synced marker once, then deleted), or, with neither, only the **last 30 days** so a cold device never shows years of feedback as new. Counts read **0 until this device has synced once** (no flash). `SchedulePage` stamps the marker on open.

#### `user_push_preferences`

Per-person switches for push alerts (migration `20261018150000_user_push_preferences.sql`, Dexie `version(25)`). A fourth category, **`hide_patient_names`**, was added by `20261021110000_push_hide_patient_names.sql` and is the one switch that is **off by default** (a row with `enabled = true` means "hide"; `PUSH_CATEGORY_DEFAULT` in `send-push/preferences.ts`). **Everyone is on by default; a row exists only once someone has chosen**, so a new alert type needs no backfill. One row per (user, clinic, alert): `id text` (**deterministic** `"<user_id>:<clinic_id>:<category>"`, enforced by a check constraint), `user_id`, `clinic_id`, `category` (`booking_request` | `appointment_changes` | `low_rating_feedback`), `enabled`, `created_at`, `updated_at`. RLS: a user selects/inserts/updates only their own rows (`user_id = auth.uid()` and `is_clinic_member`); no delete policy (switch back on with `enabled = true`); a `before insert or update` trigger keeps `updated_at` server-authoritative. In `ALL_SYNCED_TABLES` and `CLIENT_WRITABLE_TABLES` (outbox), published to realtime; partial index on the "off" rows for the lookup below. **Server:** `send-push` resolves recipients as before, then `withoutSwitchedOff()` drops anyone with an explicit `enabled = false` row for that kind's category in that clinic (**fails open**: a lookup error sends the alert rather than losing it). **One shared mapping:** `supabase/functions/send-push/preferences.ts` (dependency-free) holds the categories, the `kind -> category` map (all four `appointment_*` kinds are `appointment_changes`), the screen copy and `pushCategoriesFor(role, hasTherapistProfile)`; the edge function and the app (`src/domain/pushPreferences.ts` re-exports it) both import it, and a typecheck guard in `pushPreferences.test.ts` fails if a `PushKind` has no switch. **Client:** `repos.userPushPreferences.listForUser/setEnabled`; `MyNotificationsSheet` shows the switches. Email (`therapists.email_appointment_updates`) is a separate switch.

#### `service_catalog`
```sql
id               uuid PRIMARY KEY
clinic_id        uuid NOT NULL (FOREIGN KEY → clinics.id)
category         text NOT NULL — free text, autocompleted client-side
name             text NOT NULL
session_count    int NOT NULL (default 1, package pricing)
base_price_paise bigint NOT NULL
active           boolean NOT NULL (default true)
duration_minutes smallint (NULLABLE, 1–480) — optional length of one session
                 (per session for a package); snapshotted onto visit_items
created_by, updated_by  uuid (NULLABLE)
updated_at       timestamptz NOT NULL
```

#### `patients`
```sql
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
mrno                  text NOT NULL
mrno_source           text NOT NULL — 'hospital' | 'auto'
name                  text NOT NULL
age                   int (NULLABLE)
sex                   text (NULLABLE) — 'M' | 'F' | 'Other'
phone                 text (NULLABLE) — searchable everywhere, but only
                       *displayed* on Patient Profile, not the Patients list
email                 text (NULLABLE) — "More details" section
alt_phone             text (NULLABLE) — alternate phone; also matched by search
primary_condition     text (NULLABLE)
referring_source      text (NULLABLE) — legacy fixed enum, kept only so
                       patients tagged before referring_source_catalog
                       existed keep displaying correctly; no longer written
referring_source_id   uuid (FOREIGN KEY → referring_source_catalog.id, NULLABLE)
                       — current source of truth for new/edited patients
referring_source_detail text (NULLABLE)
no_return_reason_id   uuid (FOREIGN KEY → no_return_reason_catalog.id, NULLABLE)
deleted_at            timestamptz (NULLABLE) — soft delete
created_by, updated_by  uuid (NULLABLE)
updated_at            timestamptz NOT NULL
```

#### `visits`
```sql
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id            uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id          uuid NOT NULL (FOREIGN KEY → therapists.id)
visit_date            date NOT NULL
condition, treatment_notes  text (NULLABLE)
treatment_ids         uuid[] NOT NULL (default '{}') — which treatment_catalog
                       entries were performed this visit. The visit-entry
                       picker (NewVisitPage, EditVisitModal) ranks a clinic's
                       treatments by how often each was tagged in the last 90
                       days (dashboardService.treatmentUsageCounts, via
                       domain/treatmentUsage.ts's rankTreatmentsByUsage) into
                       a "Frequently used" group plus an alphabetical "All
                       treatments" rest — only once there are enough
                       treatments (8+) and some usage history to rank by;
                       otherwise it's a single alphabetical list as before.
service_catalog_id    uuid NOT NULL (FOREIGN KEY → service_catalog.id)
catalog_price_paise   bigint NOT NULL — snapshot at billing time
actual_bill_paise     bigint NOT NULL
adjustment_paise      bigint NOT NULL — actual − catalog
adjustment_reason     text (NULLABLE)
session_index, package_total  int (NULLABLE)
package_group_id      uuid (NULLABLE)
shared_therapist_id   uuid (FOREIGN KEY → therapists.id, NULLABLE) — internal
                       revenue-split assist, reporting only
shared_pct            numeric (NULLABLE)
bm_split_pct, tax_pct, tds_basis  NOT NULL — rate snapshot at billing
bm_share_paise, post_tax_paise, tds_paise, hv_paise  bigint NOT NULL — computed
invoice_id            uuid (FOREIGN KEY → invoices.id, NULLABLE)
pending_payment_note  text (NULLABLE) — "collect later" reason
patient_consent_confirmed  boolean NOT NULL
patient_signature_url text (NULLABLE)
clinical_status       text NOT NULL — 'pending' | 'documented' | 'reviewed'
consultation_note_id  uuid (FOREIGN KEY → consultation_notes.id, NULLABLE)
reauthorization_required  boolean NOT NULL
location              text (NULLABLE) — 'clinic' | 'home'
credits_mode          text NOT NULL (default 'auto') — 'auto' | 'manual': whether the
                       visit_credits rows follow the service lines or were edited by hand
service_lines_count   smallint (NULLABLE, >= 0) — how many live visit_items the visit was saved
                       with (set by visitService.create / updateLines); null = older visit, no
                       check. Read by the invoice builder only (since 20261024100000)
deleted               boolean NOT NULL (default false)
created_by, updated_by  uuid (NULLABLE)
updated_at            timestamptz NOT NULL
INDEXES: clinic+date, patient, clinic+updated
```
RLS (since `20261023100000`): select/insert any clinic member; **update** admin, front desk or the
visit's own therapist (`visits_update`); delete admin or own therapist (`visits_delete`). The soft
delete (an update setting `deleted = true`) follows the delete rule: trigger `visits_guard_soft_delete`
(`guard_visit_soft_delete()`, since `20261024100000`) refuses it with 42501 unless the caller is an
admin or the visit's own therapist (the therapist before the update), or there is no signed-in user.

Triggers:
- `visits_enforce_package_limit` (`enforce_package_session_limit()`): ensures a package cannot exceed its total session limit. Since `20261028210000`, excludes the row itself (`id != new.id`) so upserts (`INSERT ... ON CONFLICT DO UPDATE`) when editing an existing visit session never falsely count the row being updated.
- `visits_enforce_plan` (`enforce_clinic_plan_on_visit_insert()`): checks monthly visit quotas per clinic plan; also excludes `id != new.id` so editing existing visits does not count against new-visit quotas.

#### `visit_items` / `visit_credits` (multi-service, multi-therapist visits)

Migration `20261023100000_visit_items_and_credits.sql`, Dexie `version(26)`. Both hang off a visit
(`visit_id → visits.id ON DELETE CASCADE`), sync through the outbox like visits (in `ALL_SYNCED_TABLES`
and `CLIENT_WRITABLE_TABLES`, published to realtime), soft-delete with `deleted`, carry
`created_by/updated_by/updated_at` set by `set_updated_at()`, and have the sync tombstone and audit
(`audit_row_change`) triggers. A visit with no `visit_items` rows (all older visits) is read as one
implicit line built from its own columns; no backfill.
```sql
-- visit_items: one row per service on a visit
id, clinic_id, visit_id   uuid NOT NULL
position                  int NOT NULL — display order; position 0 = the visit's main service
service_catalog_id        uuid NOT NULL (FOREIGN KEY → service_catalog.id)
service_name              text NOT NULL — snapshot at entry
catalog_price_paise       bigint NOT NULL — snapshot at entry
price_paise               bigint NOT NULL — the line's price before the visit-level adjustment
assisting_therapist_id    uuid (FOREIGN KEY → therapists.id, NULLABLE) — null = the visit's
                           primary delivered it; set = assistant tagged on this service
duration_minutes          smallint (NULLABLE, 1–480) — snapshot of the service's duration
is_package_line           boolean NOT NULL (default false)
session_share_therapist_id uuid (FOREIGN KEY → therapists.id, NULLABLE) — "Share": a colleague who helped
                           with this service (never the one who did it = assisting_therapist_id ?? visit therapist)
session_share_pct         smallint (NULLABLE, 1–99) — their % of this service; whoever did it keeps the rest. Both
                           set or both null. On a PACKAGE line the money moves through package attribution (payBase);
                           on any other line through the visit's revenue shares (autoCredits). Migrations
                           20261026100000 (package lines), 20261026110000 (any service). Names kept for sync
deleted                   boolean NOT NULL (default false)
INDEXES: visit_id; (clinic_id, updated_at, id); UNIQUE (visit_id) WHERE is_package_line AND NOT deleted

-- visit_credits: one row per therapist credited on a visit
id, clinic_id, visit_id   uuid NOT NULL
therapist_id              uuid NOT NULL (FOREIGN KEY → therapists.id)
amount_paise              bigint NOT NULL (>= 0) — share of the visit's actual_bill_paise
deleted                   boolean NOT NULL (default false)
INDEXES: visit_id; (clinic_id, updated_at, id)
```
- A line's **deliverer** is `assisting_therapist_id ?? visits.therapist_id`, so changing the primary
  needs no line updates. Trigger `check_visit_item` rejects an assistant equal to the visit's
  therapist (not checked on a deleted line), a line whose `clinic_id` differs from its visit's, and an
  assistant who isn't a therapist of that clinic; `check_visit_credit` does the clinic check for shares
  and requires the credited therapist to be of that clinic (all errcode 23514).
- **Invoiced visits freeze their lines**: `protect_invoiced_visit_items` rejects insert/update/delete
  of a line whose visit has `invoice_id` (errcode 42501, "This visit is on an invoice; its services are
  frozen."; a delete cascading from a visit/clinic delete is let through, for `admin_delete_clinic` /
  `admin_wipe_clinic_data`). Since `20261024100000` an UPDATE is refused only when a content column
  changes (`visit_id`, `service_catalog_id`, `service_name`, `catalog_price_paise`, `price_paise`,
  `assisting_therapist_id`, `duration_minutes`, `is_package_line`, `deleted`, `position`). The sync and
  backup restore push with an upsert (INSERT … ON CONFLICT DO UPDATE): an upsert of an EXISTING line skips
  the insert check and is judged as an update, so one that changes no content column is accepted; a new
  line, or a changed content column, on an invoiced visit is refused. Shares stay editable after invoicing (internal, not on the invoice; the audit trail logs it).
- Invariants kept by the app (not the server): Σ line `catalog_price_paise` = `visits.catalog_price_paise`;
  Σ line `price_paise` + `adjustment_paise` = `actual_bill_paise`; Σ live credits = `actual_bill_paise`,
  the primary always has a row.
- RLS (both): select any clinic member; **insert** admin, front desk, the parent visit's own therapist,
  or whoever created the visit (`visits.created_by = auth.uid()`, stamped by `set_updated_at()` on the
  server insert, so a therapist logging a visit for a colleague can add its lines and shares, also when
  pushed later from offline; since `20261024100000` only while the visit is not invoiced) — helper
  `can_add_visit_children(visit_id)`; **update/delete** admin, front
  desk or the parent visit's own therapist (`can_edit_visit_children(visit_id)`; update's `with check`
  applies it to the new row, so a line or share can't be moved onto a visit the caller couldn't edit).
  An assisting or unrelated therapist cannot add, change or delete lines or shares, so nobody can credit
  themselves on someone else's visit.
- Client: `repos.visitItems` / `repos.visitCredits` — `listByVisitIds(ids)`, `listByClinic(clinicId,
  range?)` (range = the parent visit's date, inclusive; deleted visits skipped), `bulkPut(rows)` (rows +
  outbox entries in one transaction). Reads skip `deleted` rows, except `listByClinicIncludingDeleted(clinicId)`
  (only for "does anything still reference this?" checks). Dexie indexes: `visit_items: id,
  clinicId, visitId, [clinicId+updatedAt]`; `visit_credits: id, clinicId, visitId, therapistId`.
- **Saving visits (`visitService`)**: `create` takes `lines: {serviceCatalogId, assistingTherapistId?,
  packageContinuation?}[]` (the old single `serviceCatalogId` input still works and becomes one line) and
  writes the visit, its lines and its auto shares (`autoCredits`; a clinic with the therapist split off
  gets one primary share = the bill) through `repos.visits.putWithChildren(visit, items, credits)` — ONE
  Dexie transaction, outbox entries queued visit, then lines, then shares. `visits.service_catalog_id` =
  first line; package columns come from the package line (a continuation, or a multi-session service).
  Both `create` and `updateLines` set `visits.service_lines_count` to the number of live lines written.
  A package continuation (on a line, or the old input's `packageGroupId`) must belong to the same patient
  ("That package belongs to another patient.").
  `updateLines(visitId, lines, adjustment)` refuses invoiced visits ("its services are frozen"), writes
  only rows that changed, recomputes bill and rate snapshot as `updateBilling` does, rewrites shares in
  `auto` mode and returns `sharesOutdated: true` in `manual` mode. `setShares(visitId, rows)` (allowed on
  invoiced visits) requires Σ = bill, no negative share, the package holder (deliverer of the package
  line; the primary with split off) never below that line's net, the primary present, everyone in the
  visit's clinic, and sets `credits_mode = 'manual'`; `recalculateShares` returns to `auto` (both refuse a
  deleted visit: "This visit was deleted.").
  `updateBilling` follows a bill or primary change (auto shares rewritten, manual → `sharesOutdated`);
  a line tagged with the new primary has its tag cleared. **Push order matters** (the server rejects
  some intermediate states permanently and the sync would revert the local row): a line that frees the
  visit's single package slot (removed, or no longer the package line) is queued BEFORE the one that
  takes it (known gap: the sync merges queued entries for a row at its oldest position, so a slot-taking
  row that already had an older pending entry can invert this; the server answers 23505 and the row
  reverts), and a tag-clearing line write is queued before the visit row as a safety ordering
  (`putWithChildren` option `itemsFirst`; the server doesn't require it). `updateLines` without an
  explicit bill keeps the visit's adjustment (new subtotal + old adjustment, reason kept; cleared only
  if that would go below ₹0), refuses deleted visits, keeps an existing line's package flag, and refuses
  to remove a package purchase line while later sessions of that package exist. In manual mode a primary
  change moves the old primary's share row to the new primary when they had none. Legacy `setSplit` still
  writes `shared_therapist_id/shared_pct` and now also two manual share rows (assistant = bill × pct
  rounded to the rupee, primary = remainder); clearing it returns the visit to auto shares.
- **Catalog "never used"**: `visits.countByService` counts visits on the service plus live `visit_items`
  on it (a service used only as a later line of a multi-service visit can't be hard-deleted).
- **Deleting a therapist**: `hard_delete_therapist` (redefined in `20261024100000`) counts, as linked
  records, each visit the therapist is on once — as its therapist, the old split's shared therapist, an
  assistant on a line, or the holder of a share (live and soft-deleted lines/shares: a soft-deleted row
  still references the therapist) — plus their notes and invoices, and refuses with "therapist has N
  linked record(s); deactivate instead of deleting" rather than a raw foreign-key error. Settings → Team
  checks the same first (`features/settings/therapistLinks.ts` `countTherapistLinkedRecords`).

#### `invoices`
```sql
id                  uuid PRIMARY KEY
clinic_id           uuid NOT NULL (FOREIGN KEY → clinics.id)
invoice_no          text NOT NULL — `PREFIX/FY-LABEL/NNNN`
fy_label            text NOT NULL (e.g., "26-27")
seq                 int NOT NULL
issued_at           timestamptz NOT NULL
patient_snapshot    jsonb NOT NULL — patient details at issue time
line_items          jsonb NOT NULL — see "Invoice line items (v2)" below
total_paise         bigint NOT NULL
payment_mode        text NOT NULL — 'Cash' | 'Card' | 'UPI' | 'Insurance'
therapist_id        uuid (FOREIGN KEY → therapists.id, NULLABLE)
supersedes_invoice_id uuid (FOREIGN KEY → invoices.id, NULLABLE) — set on an amendment
clinical_snapshot   jsonb (NULLABLE) — see "Clinical context on the bill" below
created_by, updated_by  uuid (NULLABLE)
updated_at       timestamptz NOT NULL
```
Immutable once issued (DB trigger) — with one narrow exception:
`clinical_snapshot` alone can be corrected in place afterward, see "Editing
clinical details after issuance" below and §3d. Payment status is **not** a
column here — see `invoice_payments` below.

**Invoice line items (v2).** `line_items` is opaque jsonb — a legacy invoice's
entries have only the original 6 fields (`serviceName`, `sessionCount`,
`sessionDates`, `catalogPricePaise`, `adjustmentPaise`, `adjustmentReason`,
`totalPaise`); every invoice issued or amended since the Billing & Notes
Rebuild Phase 1 gets a v2 entry, marked by `lineItemVersion: 2`, adding
`billedSessionCount`, `authorizedSessionCount` (null = not a package),
`ratePerSessionPaise` (snapshotted, never re-derived from live catalog
prices), `rateBasis`, `adjustmentReasons` (a merged group can span more than
one), and `therapistIds` (ditto). `sessionCount`'s meaning is unchanged
(`authorizedSessionCount ?? billedSessionCount`) so old readers of the raw
field still work. All build- and print-side code goes through
`src/domain/invoiceLine.ts` (`isV2Line`, `lineRatePerSessionPaise`,
`sessionCountLabel`, `lineReconciles`, `normalizeAuthorizedCount`,
`invoicePeriod`) rather than reading either shape directly, so the two
sides can't drift the way the invoice-print page and the insurer-packet
summary once did.

**Bill by service, not just by package.** Invoice line grouping
(`invoiceService.ts` → `invoiceLine.ts`'s `groupVisitsForInvoicing`) keys on
`packageGroupId` when present, otherwise on `service + catalog price` — so
several independently-logged (non-package) visits of the same service at
the same price collapse into one line reading "10 sessions," not ten
separate ₹0-context rows. A merged line's `catalogPricePaise` is always the
**sum** of every visit's own snapshot in the group (not one visit's), which
is what keeps `catalogPricePaise + adjustmentPaise = totalPaise` holding
exactly for every line, by construction.

**One invoice line per service.** Billing units, not visits, are what get
grouped: a visit with live `visit_items` contributes one unit per line,
carrying that line's net (`lineNets` — the visit's bill spread pro rata, whole
rupees, exact sum); a visit without live lines is one unit and prints exactly
as before. A unit's catalog snapshot is the line's `catalogPricePaise` and its
adjustment is net − catalog price (with the visit's adjustment reason), so
`lineReconciles` stays true. Only the PACKAGE line groups by `packageGroupId`
(and takes `authorizedSessionCount` from the visit's package total); an add-on
line on a package visit groups by `svc:{serviceCatalogId}:{catalogPricePaise}`
like any other service. The invoice shows only the primary therapist: line
`therapistIds` and the invoice-level `p_therapist_id` (highest total billed
wins) are computed over the visits' primaries, never assistants. Issuing and
amending refuse ("Some of these services are still syncing…") while any of
the visits, their lines or their shares still has an outbox entry
(`pendingVisitSync`; an entry the server refused, i.e. with `error` set, gets its own message telling the user to fix or discard it from the unsynced changes notice), because the server freezes a visit's lines once it
has an invoice and a line pushed afterwards would be rejected and reverted.
They also refuse ("This visit's services haven't all arrived on this device yet. Try again in a
moment.") a visit whose live lines on this device are fewer than its `serviceLinesCount`: its lines
reached the server after the visit and haven't been pulled here yet, so billing it now would bill the
wrong services and freeze the late lines out. Preview, issue and amend share this check (`buildLineItems`);
visits without a count (older ones) are not checked.

**Long-running packages (e.g. post-op TKR/THR rehab, 20-30+ sessions).**
Nothing in the schema or invoicing logic caps a package's session count —
a 24-session package invoices through the exact same line-item build as a
3-session one. The one place volume affects the printed layout: a line's
"Dates of service" column would otherwise list every individual date,
wrapping into an unreadably dense cell past a handful of sessions.
`sessionDatesDisplay()` (`src/domain/invoiceLine.ts`) condenses to a
"from – to (N sessions)" range once a line has more than 8 session dates;
at or under that it still lists every date. Used by both
`InvoicePrintPage.tsx` table variants (legacy and v2); the Insurer Packet's
invoice summary and the issue-invoice preview step never showed the date
list in the first place — they already use the compact `sessionCountLabel`
— so neither needed a change. `SessionLogPrintPage`'s trend grid is
unaffected by volume in a different way: it's one row per session with no
condensing, since a clinical trend genuinely needs every date as its own
row; print pagination (not this page) is what splits a long table across
pages.

**Partial-package printing.** A package billed in full but only partly
delivered prints its real total (not a fabricated partial amount), with a
caption under the service name whenever the row's own arithmetic doesn't
reconcile (`lineReconciles()` — checks `billedSessionCount ×
ratePerSessionPaise + adjustmentPaise = totalPaise` exactly, catching both
a genuine partial delivery and a plain rounding mismatch on a fully-billed
package). The Sessions column itself reads "N delivered of M authorised" on
a non-reconciling row so the printed numbers don't invite the reader to
multiply Rate × the smaller number and land on the wrong answer.

**Clinical context on the bill.** `clinical_snapshot` (nullable jsonb, old
invoices predate it) holds `diagnosis`, `diagnosisIcdCode`,
`referringPhysician`, `physicianRegistrationNo`, `placeOfService`
('clinic' | 'home'), `treatmentPerformed`, `sourceNoteId` (provenance), and
`editedByBiller`. Pre-filled in `IssueInvoiceDialog` from the visit's own
completed note, falling back to the patient's most recent completed heavy
(initial/follow-up) note — a light session note (see Light Session Notes
below) has no referral field to pull from. Editable before issuing, then
frozen with the rest of the invoice (never re-read from the note
afterward). **Multi-visit billing.** Patient Profile's select-visits bar shows the running total ("14 selected · ₹21,000") and one button. For billing users it opens `IssueInvoiceDialog` with `target.visitIds` (all selected, not yet invoiced), which previews and issues ONE invoice via `issueForVisits` and, with "Collected now", records the payment through `collectInvoiceNow` (split across the visits oldest-first) — issue and collect in one step; the same clinical pre-fill and payment-mode choice as a single visit apply. Without billing (Lite) the same bar offers "Collect ₹X", opening `BulkCollectDialog`: one direct payment per owing visit, in full, one method and date; a mid-way failure keeps the earlier ones and says how many. A row's own "Collect ₹X" opens `TakePaymentDialog` on the profile (previously a dead click).

**Preview before issuing.** `IssueInvoiceDialog` is a two-step flow: "Review
invoice" moves from the fields form to a review screen built from
`invoiceService.previewLineItems()` — the same line-item build
`issueForVisits` itself calls (via the shared `buildLineItems` closure in
`invoiceService.ts`), so the preview can never drift from what actually
gets issued. No RPC call happens until "Confirm & issue" on the review
screen; "← Back to edit" returns to the form with every field intact.

**Editing clinical details after issuance.** Once issued, `clinical_snapshot`
alone can still be corrected — a typo'd diagnosis, a missed physician
registration number — without reopening the financial record. "Edit
details" on `InvoicePrintPage` opens `EditInvoiceDetailsDialog`
(`src/components/EditInvoiceDetailsDialog.tsx`), pre-filled from the
invoice's existing snapshot, calling the `update_invoice_clinical_details()`
RPC (§3d). This is deliberately narrower than an amendment: the amount,
line items, and invoice number are untouched and no new invoice number is
minted — for those, "Amend this invoice" (§3b) is still the only path. The
clinical-fields form itself (`InvoiceClinicalFieldsForm`,
`src/components/InvoiceClinicalFields.tsx`) is shared between this dialog
and `IssueInvoiceDialog` rather than duplicated.

**Share via WhatsApp.** "Share via WhatsApp" on `InvoicePrintPage` renders
the same DOM node "Print / Save PDF" shows into an actual PDF, entirely
on-device (`renderElementToPdf` in `src/lib/pdfShare.ts`, via `html2canvas`
+ `jsPDF` — no server round trip, matching this app's offline-first
design), then hands that file to the Web Share API so WhatsApp — or any
other installed app — shows up in the OS share sheet with the real PDF
attached (`shareFileToWhatsApp`). Both libraries are dynamically imported
only when the button is clicked (a ~180KB-gzip chunk that every invoice
view would otherwise pay for, whether or not Share is ever used). Web
Share API's `files` support is mobile-browser-only (recent Chrome/Android,
Safari/iOS); on a browser without it (desktop, mainly), this falls back to
a `wa.me` click-to-chat link carrying just a text summary — WhatsApp's own
link scheme has no way to carry a file, so the fallback is deliberately
text-only rather than silently doing nothing.

**UPI listed and defaulted first.** `PAYMENT_MODES` in `IssueInvoiceDialog`/
`AmendInvoiceDialog` and `PAYMENT_METHODS` in `NewVisitPage`'s direct-
payment collector all list UPI before Cash, and `IssueInvoiceDialog`/
`NewVisitPage` default their selection to UPI — the most common collection
method at an Indian clinic front desk. `AmendInvoiceDialog` is the one
exception: its default still carries over the original invoice's own
`paymentMode` rather than defaulting to UPI, since it's correcting an
already-issued bill's record, not starting a fresh collection.

#### `invoice_counters`
```sql
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
fy_label        text NOT NULL
next_seq        int NOT NULL (default 1)
PRIMARY KEY (clinic_id, fy_label)
```

---

### Financial Tables

#### `invoice_payments`
```sql
id              uuid PRIMARY KEY
invoice_id      uuid NOT NULL (FOREIGN KEY → invoices.id)
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
status          text NOT NULL — 'paid' | 'outstanding' | 'void'
paid_at         timestamptz (NULLABLE)
void_reason     text (NULLABLE) — only on a void row
voided_at       timestamptz (NULLABLE) — only on a void row
created_by, updated_by  uuid (NULLABLE)
created_at, updated_at  timestamptz
```
Lives apart from `invoices` (which is immutable once issued). A missing row
for an invoice reads as **paid** — see the payment-state note in Key Design
Patterns below. Deliberately has **no amount column** — flipping `status` is
the only write this table itself supports; a partial amount toward an
invoice is tracked via `payments` below instead (see
`paymentService.recordInvoicePayment()`), keyed to the invoice's own
constituent visits.

`'void'` is reachable only through `void_invoice()` (see §3c): the
`guard_invoice_void` trigger rejects a client writing it directly and makes
it final.

#### `payments`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
visit_id        uuid NOT NULL (FOREIGN KEY → visits.id)
amount_paise    bigint NOT NULL
method          text NOT NULL — 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque' | 'partner' (collected by the partner; not cash in hand)
received_date   date NOT NULL
notes           text (NULLABLE)
advance_id      uuid (FOREIGN KEY → patient_advances.id, NULLABLE — see below)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```
A payment toward one visit's bill — cash/UPI collection recorded without
requiring an invoice, and supports partial payments (an amount less than
the visit's bill). No `invoice_id` column: this same table is also how a
*partial* payment against an **invoiced** visit's bill is recorded (an
invoice itself has no amount-paid field — see `invoice_payments` above),
so a payment stays keyed to the visit it was collected for either way. For
an invoice spanning several visits, one entered amount is allocated across
those visits' `payments` rows in date order — the shared
`allocateAcrossVisits()` helper in `src/services/advanceService.ts` (both
`paymentService.recordInvoicePayment` and advance draw-down use it, so the
two paths can't allocate differently). `advance_id` is set only when this
payment was drawn down from a patient's advance balance rather than
collected fresh; `visit_id` still stays required either way, so
`computeVisitPaymentState` needs no special-casing for advance-funded
payments.

#### `patient_advances`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
amount_paise    bigint NOT NULL (> 0)
method          text NOT NULL — 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque' | 'partner' (collected by the partner; not cash in hand)
received_date   date NOT NULL
receipt_no      text (NULLABLE) — no numbered series yet, see below
notes           text (NULLABLE)
status          text NOT NULL default 'open' — 'open' | 'exhausted' | 'refunded' | 'void'
deleted         boolean NOT NULL default false
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (id, clinic_id) — backs the composite FK on payments.advance_id below
```
Money received ahead of treatment. **Not a `payments` row until drawn
down** — `computeVisitPaymentState` and everything derived from it (badges,
the needs-receipt queue, dashboard KPIs) stays untouched by an advance
until a real `payments` row is written against a real visit
(`advanceService.applyAdvance`), which stamps that row's `advance_id` and
flips this row's `status` to `'exhausted'` once the balance reaches zero.
Remaining balance is computed, not stored:
`amount_paise − Σ payments.amount_paise where advance_id = this.id`.
`payments.advance_id` is a **composite** FK to `(id, clinic_id)` rather
than a plain `references patient_advances(id)`, so a payment can never
reference a different clinic's advance even by a client bug — RLS already
scopes reads correctly, but this closes the write-side gap outright.
`method` uses the `PaymentMethod` vocabulary (`'cash'|'upi'|…`), not the
older `PaymentMode` (`'Cash'|'Card'|'UPI'|'Insurance'`) that belongs only
to `Invoice.paymentMode` — easy to confuse. **No gap-free numbered receipt
series yet** — `receipt_no` exists but is unused; the printed
`AdvanceReceiptPrintPage` identifies a receipt by date + a short slice of
its id instead. A real counter can be added later with no data migration
if it turns out to matter. Entry point: Patient Profile's "Record advance"
button; `TakePaymentDialog` also surfaces "₹X advance available — apply"
and draws down (oldest advance first) when a patient with an open balance
is being collected from elsewhere.

#### `settlements`
```sql
id                     uuid PRIMARY KEY
clinic_id              uuid NOT NULL (FOREIGN KEY → clinics.id)
year, month            int NOT NULL
amount_received_paise  bigint NOT NULL
received_date          date (NULLABLE)
notes                  text (NULLABLE)
created_by, updated_by uuid (NULLABLE)
updated_at             timestamptz (NULLABLE)
```
Per-month partner-hospital (HV) settlement record, for the Monthly Report's
variance tracking. **Deprecated single-entry model** — superseded by
`settlement_payments` below; left in place (not dropped) for audit/rollback,
and its rows were backfilled into `settlement_payments` as each period's
first tranche (migration `20260912070000_settlement_payments.sql`).
`settlementService.get`/`.save` still read/write it for backward
compatibility, but no UI writes new rows to it anymore.

#### `settlement_payments`
```sql
id                     uuid PRIMARY KEY
clinic_id              uuid NOT NULL (FOREIGN KEY → clinics.id)
year, month            int NOT NULL
amount_received_paise  bigint NOT NULL
received_date          date (NULLABLE)
notes                  text (NULLABLE)
created_by, updated_by uuid (NULLABLE)
updated_at             timestamptz NOT NULL
```
One row per partner-hospital payment **tranche** for a month — replaces
`settlements`' assumption that a month settles in one lump sum. A real
payout is often an advance plus a final payment, sometimes with a deduction
that only makes sense noted against the specific tranche it applied to.
Any number of rows can share `[clinic_id, year, month]`; the month's total
received is their sum (`settlementService.totalReceived`), computed
client-side, not stored. `SettlementCard` (Monthly Statement page) lists
every tranche with edit/delete, and a form to record another.

---

### Clinical Documentation Tables

#### `consultation_notes`
```sql
id                        uuid PRIMARY KEY
clinic_id                 uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id                uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id              uuid NOT NULL (FOREIGN KEY → therapists.id)
visit_id                  uuid (FOREIGN KEY → visits.id, NULLABLE)
appointment_id            uuid (FOREIGN KEY → appointments.id, NULLABLE) — note
                           started from an appointment / walk-in before the
                           visit existed; visit_id is filled in when it's logged
enrollment_id             uuid (FOREIGN KEY → patient_module_enrollments.id, NULLABLE)
note_mode                 text (NULLABLE) — 'initial' | 'followup' | 'session'
                           ('session' = light SOAP note, everything else is
                           the heavy Core Assessment editor; null = legacy
                           row predating this field, treated as heavy)
status                    text NOT NULL — 'draft' | 'completed' | 'archived'
assessment_payload        jsonb (NULLABLE) — either the whole Core Assessment
                           form (history, pain, PSFS, body chart, objective
                           exam, treatment/HEP) or, when note_mode='session',
                           domain/sessionNote.ts's small SOAP payload — one
                           versioned/upcastable blob either way, shape keyed
                           off note_mode, not separate columns per section
authorized_session_count  int (NULLABLE)
notes_text                text (NULLABLE)
nrs_score                 int (NULLABLE) — derived, for outcome tracking
psfs_mean                 numeric (NULLABLE) — derived
red_flag_count            int NOT NULL — derived
created_by, updated_by    uuid (NULLABLE)
updated_at                timestamptz NOT NULL
```

**`visits.consultation_note_id` only ever points at a *completed* note —
a draft never gets written back onto the visit row.**
`consultationNoteService.saveAssessment()` deliberately updates
`visits.clinical_status`/`consultation_note_id` only when `status ===
'completed'` ("a draft save deliberately does not — the note isn't
finished yet, so the visit should keep prompting until it is"). So any
UI that wants to show a visit's note status (draft vs. completed vs.
none) — the Ledger/Workspace/Patient-Profile visit-row "Note" column —
can't trust the visit's own field alone; it has to join against
`consultation_notes` on `visit_id` (`VisitCardData.consultationNoteId`/
`noteStatus`, computed independently at each of those three call sites,
same pattern as `packageInvoicePending` above). Ledger/Workspace fetch
`consultationNotes.listByClinic()` once (clinic-wide, skipped for a
viewer without `canViewClinicalNotes`) and index it by `visitId`; Patient
Profile already loads the patient's full note history via
`listByPatient`, so it just re-indexes what it has.

#### `patient_module_enrollments`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
module_type     text NOT NULL, CHECK in ('gut_screening', 'return_to_sport',
                 'scoliosis_screening', 'face_scale', 'facial_palsy',
                 'consultation_notes')
status          text NOT NULL — episode open/closed state
created_by, updated_by  uuid (NULLABLE)
enrolled_at, updated_at  timestamptz NOT NULL
```
Only `'consultation_notes'` is actually written client-side today
(`consultationNoteService.ts`) — the other five values are schema-permitted
(matching the five region-module response tables above) but nothing in
`src/` creates an enrollment with them.

#### `ai_generation_log`
```sql
id                uuid PRIMARY KEY
clinic_id         uuid NOT NULL (FOREIGN KEY → clinics.id)
consultation_id   uuid NOT NULL (FOREIGN KEY → consultation_notes.id)
raw_ai_output     text NOT NULL
model_name        text NOT NULL
created_at        timestamptz NOT NULL
```

#### Region-module response tables
Each region module (opt-in extensions to Core Assessment) has its own
response table, all following the same shape: `id`, `clinic_id`, `patient_id`,
`enrollment_id` (FK → `patient_module_enrollments.id`, NULLABLE), a `responses
jsonb` blob, one or two derived score/category columns, `created_by`/
`updated_by`, `updated_at`.

- **`screening_responses`** — `computed_score numeric`, `triage_level text`
- **`return_to_sport_responses`** — `computed_score numeric`, `risk_category text`
- **`scoliosis_screening_responses`** — `cobb_angle numeric`, `severity_level text`
- **`face_scale_responses`** — `side_affected`, `visit_label`, `vas_movement`,
  `vas_qol`, `domain_scores jsonb`, `total_score numeric`
- **`facial_palsy_assessments`** — `side_affected`, `visit_label`, `hb_grade`,
  `sunnybrook_resting/voluntary/synkinesis jsonb`, `sunnybrook_score numeric`,
  `synkinesis_total int`

None of the five has a Dexie table, repo, sync entry, or any UI anywhere in
`src/` — they're reserved schema for modules that haven't been built, not
available features. Only `face_scale_responses` and
`facial_palsy_assessments` even have `can_use_module()`-gated RLS on insert/
update (see `clinic_module_settings`/`clinic_entitlements` below); the
other three (`screening_responses`, `return_to_sport_responses`,
`scoliosis_screening_responses`) have no entitlement check at all — any
clinic member can write to them.

#### Consent tables
```sql
consent_form_templates:
  id, clinic_id, consent_type, version, locale, title, body_text, purpose,
  is_active, effective_from, created_by, updated_by, updated_at

consents:
  id, clinic_id, consent_type, template_id (FK), subject_type,
  patient_id (NULLABLE), therapist_id (NULLABLE), granted, granted_at,
  granted_via, evidence_url, withdrawn_at, withdrawn_reason, captured_by,
  created_by, updated_by, updated_at
```
`current_consents` is a **view** (not a table) over `consents` exposing the
latest, still-in-force consent per subject (`is_in_force boolean`).

---

### Additional Tables

#### `feedback_requests` / `feedback_responses` / `message_log` (Patient Communications, Phase 0–3)
```sql
-- feedback_requests: one row per "ask this patient for feedback" action
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
visit_id        uuid NOT NULL (FOREIGN KEY → visits.id)
patient_id      uuid NOT NULL (FOREIGN KEY → patients.id)
therapist_id    uuid NOT NULL (FOREIGN KEY → therapists.id) — denormalized from the visit for RLS
token           text NOT NULL UNIQUE — 256-bit, base64url, server-generated default
status          text NOT NULL — 'pending' | 'responded' | 'expired'
expires_at      timestamptz NOT NULL (default now() + 21 days)
created_by, updated_by  uuid (NULLABLE)
created_at, updated_at  timestamptz NOT NULL
-- one pending request per visit — unique partial index on visit_id where status = 'pending'

-- feedback_responses: the patient's submission (only written by
-- submit_feedback_response(), a SECURITY DEFINER function — no client INSERT policy exists)
id           uuid PRIMARY KEY
request_id   uuid NOT NULL UNIQUE (FOREIGN KEY → feedback_requests.id)
clinic_id    uuid NOT NULL (FOREIGN KEY → clinics.id) — denormalized so admin-only RLS needs no join
rating       smallint NOT NULL (1-5)
comment      text (NULLABLE)
created_at   timestamptz NOT NULL
updated_at   timestamptz NOT NULL (default now()) — always == created_at;
             the row is immutable, this column exists only because the
             sync engine hardcodes updated_at as every table's delta
             column (Phase 2 migration)

-- message_log: shared audit trail for every send action across all four
-- patient-comms workflows (only feedback_request is wired up so far)
id                    uuid PRIMARY KEY
clinic_id             uuid NOT NULL (FOREIGN KEY → clinics.id)
kind                  text NOT NULL — 'feedback_request' | 'booking_confirmation' | 'therapist_notify' |
                        'google_review' | 'reminder_stale_package' | 'reminder_single_visit' |
                        'payment_reminder'
recipient_patient_id  uuid (NULLABLE, FOREIGN KEY → patients.id)
recipient_phone       text (NULLABLE)
channel               text NOT NULL — 'wa_share' | 'wa_business_api'
sent_by               uuid (NULLABLE, FOREIGN KEY → auth.users.id)
sent_at               timestamptz NOT NULL
```
RLS: `feedback_requests` is member-visible (status carries no rating/comment
content) but only admin/front_desk/own-therapist can insert or update it —
same shape as the visits table's own admin-or-own-therapist policies.
`feedback_responses` SELECT is `is_clinic_admin()` only — front desk and
therapists get zero visibility into ratings/comments, at the database layer,
not just hidden in the UI. Two SECURITY DEFINER RPCs — `get_feedback_request_by_token()`
and `submit_feedback_response()` — are explicitly granted EXECUTE to `anon`;
every other function in this schema either relies on `is_clinic_member()`
failing for an anonymous caller or explicitly revokes that default. A
`public_rpc_rate_limit` table (self-pruning, no cron dependency) throttles
both by client IP.

`feedback_requests` is a synced Dexie table (`ALL_SYNCED_TABLES`, pulled
like any other clinic data) but **not** in `CLIENT_WRITABLE_TABLES` — staff
creation and resend both go through online-only RPCs
(`create_feedback_request`, `rotate_feedback_request_token`) rather than
the outbox, so the local write is always a `putLocal` caching a
server-confirmed row, never a queued push. (An earlier version created
through the outbox with `token` left unset for the column default to fill
in; that meant the token — and so the ability to share it — didn't exist
until the next sync pull, so the very first "Ask for feedback" click never
opened a share sheet. See `create_feedback_request` below.)
`feedback_responses` (Phase 2) is also synced, but read-only client-side —
`ALL_SYNCED_TABLES` without `CLIENT_WRITABLE_TABLES`, same shape as
`invoices` — since a response is only ever written by the anonymous
patient's own SECURITY DEFINER RPC call; it needed an `updated_at` column
added (a permanent alias for `created_at`, purely so the sync engine's
hardcoded delta-column assumption holds) since the row is otherwise
immutable. `message_log` has no Dexie table or repo at all — the app never
reads or writes it directly.

`create_feedback_request(p_visit_id uuid) returns table(...)` (Phase 1,
added after the outbox-creation gap above was found) — `security invoker`,
EXECUTE revoked from `public`/`anon` and granted only to `authenticated`.
Derives `clinic_id`/`patient_id`/`therapist_id` from the `visits` row
rather than trusting client-supplied values, then inserts a new
`feedback_requests` row — or, on `ON CONFLICT (visit_id) WHERE status =
'pending'` against the existing `feedback_requests_one_pending_per_visit`
partial unique index (a double-click race), rotates the existing pending
row's token instead of erroring — and returns the full row in one round
trip. The existing `feedback_requests_insert` RLS policy is the real
authorization boundary.

`rotate_feedback_request_token(p_request_id uuid) returns text` (Phase 1) —
`security invoker`, EXECUTE revoked from `public`/`anon` and granted only
to `authenticated`. Rotating an existing row's token is an UPDATE, where
column defaults never fire, so "resend" needs this small RPC rather than
the outbox; the existing `feedback_requests_update` RLS policy is the real
authorization boundary, same as any other invoker-security RPC in this
schema.

**`clinics.google_review_url`** (Phase 3) — nullable text; unset means the
Google review nudge never shows, on either the public thank-you page or
the staff visit-row action, regardless of rating.
`submit_feedback_response(p_token text, p_rating int, p_comment text)
returns text` (was `returns void` through Phase 0-2) — now returns the
clinic's `google_review_url` when `p_rating >= 4` and one is configured,
`null` otherwise; the public thank-you page conditions "Leave a Google
review" on this return value instead of a second round trip. Return-type
changes require dropping the function first (grants don't survive a drop,
so the migration re-states them).

`list_google_review_eligible_requests(p_clinic_id uuid) returns setof uuid`
— `security definer` (unlike `rotate_feedback_request_token` above, this
one must bypass RLS on purpose), EXECUTE revoked from `public`/`anon` and
granted only to `authenticated`. Lets a front_desk caller — who has zero
RLS visibility into `feedback_responses` at all, not just a filtered view
of it — ask "which requests currently qualify for a Google review nudge"
without the function ever returning a rating or a comment, just bare
`request_id`s where `rating >= 4`. The function body re-implements its own
narrower check (`is_clinic_member`) rather than relying on RLS, since RLS
itself is what's being deliberately bypassed here.

#### `appointments` / `appointment_requests` / `clinic_closed_dates` (Patient Communications, Phase 5 + Schedule MVP)
```sql
-- appointments: one confirmed expected attendance (not a billed visit)
id                     uuid PRIMARY KEY
clinic_id              uuid NOT NULL (FOREIGN KEY → clinics.id)
patient_id             uuid (NULLABLE, FOREIGN KEY → patients.id) — resolved at arrival
patient_name, patient_phone  text NOT NULL — raw values, kept after patient_id resolves
therapist_id           uuid (NULLABLE, FOREIGN KEY → therapists.id)
scheduled_at           timestamptz NOT NULL
source                 text NOT NULL (default 'booking') — 'booking' | 'walk_in'
                        (start_walk_in: a visit in progress started at the desk)
series_id              uuid (NULLABLE, indexed) — shared by the sessions of one
                        repeat booking (confirm_booking_series)
duration_minutes       integer NOT NULL (default 30, CHECK 5–240) — Schedule MVP;
                        backfilled from clinics.slot_duration_minutes
status                 text NOT NULL — 'confirmed'|'rescheduled'|'no_show'|'cancelled'|'arrived'
request_id             uuid (NULLABLE, FOREIGN KEY → appointment_requests.id)
visit_id               uuid (NULLABLE, FOREIGN KEY → visits.id)
reschedule_count       integer NOT NULL (default 0)
previous_scheduled_at  timestamptz (NULLABLE)
created_by, updated_by uuid (NULLABLE)
created_at, updated_at timestamptz NOT NULL

-- clinic_closed_dates: one row per closed calendar day (holiday / one-off closure)
id           uuid PRIMARY KEY
clinic_id    uuid NOT NULL (FOREIGN KEY → clinics.id)
closed_date  date NOT NULL — UNIQUE (clinic_id, closed_date)
label        text (NULLABLE) — "Diwali", "Staff training"
removed_at   timestamptz (NULLABLE) — soft delete: the sync pull only sees
             upserts, so "reopen" sets this instead of deleting the row
created_at, updated_at  timestamptz NOT NULL (set_updated_at trigger)
```
RLS: `appointments` SELECT is clinic-member-wide; `appointment_requests`
SELECT is admin/front_desk; `clinic_closed_dates` SELECT is clinic-member-wide
(RLS was missing entirely on this table until `20261001100000`). None of the
three has a write policy — every write is a SECURITY DEFINER RPC:
`confirm_booking_slot`, `create_appointment_staff`, `reschedule_appointment`,
`cancel_appointment`, `mark_appointment_no_show` (all gated by
`can_manage_appointment`, overlap checked by `therapist_has_overlap` using each
row's `duration_minutes`), `mark_appointment_arrived` / `link_appointment_visit`
(any clinic member), `confirm_booking_series` (same rules as a single booking,
all-or-nothing; clashes listed as UTC ISO times the client localises) /
`cancel_appointment_series(series, from)`, `set_therapist_working_hours`
(admin/front_desk only — see **Shift-based scheduling** for
`create_shift_template`, `update_shift_template`, `assign_shift`,
`assign_custom_hours`, `request_shift_assignment`, `request_custom_hours`,
`approve_shift_assignment`, `decline_shift_assignment`, `set_break_placement`,
all on `shift_templates`/`therapist_shift_assignments`, the same RPC-gated,
no-direct-write pattern as this table),
`start_walk_in(clinic, therapist, name, phone?, patient?)` (arrived walk-in, no
overlap check, own therapist or admin/front desk), `restore_appointment_slot`
(drag Undo, see Review fixes below), and
`set_clinic_closed_dates` /
`remove_clinic_closed_dates` (admin/front_desk, ranges up to 366 days). The
public `get_booking_availability(slug, start, end)` returns weekly closed
days, live (`removed_at is null`) closed dates, and non-cancelled
appointments with their `duration_minutes`, plus `therapistHours` (id → working_hours
for active therapists with custom hours). `reschedule_appointment(id, at, duration?, therapist?)`
(drop-and-recreate, pattern 3c): reassigning needs `can_manage_appointment` for both the
current and the new therapist; a pure resize (same start and therapist) doesn't bump
`reschedule_count` or the status.
**Review fixes** (`20261004100000_schedule_review_fixes.sql`):
- **No double booking under concurrency**: trigger `appointments_overlap_guard`
  (BEFORE INSERT OR UPDATE on `appointments`) takes a per-therapist
  `pg_advisory_xact_lock` and re-runs `therapist_has_overlap`, so two bookings at the
  same moment can't both commit. It skips walk-ins (`source = 'walk_in'`), cancelled
  rows, unassigned rows and updates that don't change the time, length or therapist
  (status changes, sync re-saves).
- `confirm_booking_series` compares requested starts by position, so duplicate
  timestamps in one request are flagged as clashes.
- `cancel_appointment_series` requires `can_manage_appointment` for **every** session it
  would cancel (sessions can have been moved to another therapist).
- `restore_appointment_slot(id, at, duration, therapist|null, status, reschedule_count,
  previous_scheduled_at)` backs the calendar's Undo after a drag. It restores the exact
  previous state, including Unassigned (admin / front desk only), and can only wind
  `reschedule_count` back, never forward.
- The `clinic_closed_dates` dedup in `20261001100000` breaks `created_at` ties on
  `ctid`, so a rebuild with duplicates from one transaction no longer aborts.
All three are synced, read-only Dexie tables (`ALL_SYNCED_TABLES` without
`CLIENT_WRITABLE_TABLES`); `clinic_closed_dates` arrived in Dexie `version(20)`,
and `repos.clinicClosedDates.listByClinic` filters out soft-deleted rows.
**Deploy order**: apply the migration before shipping the client — the sync
pull of `clinic_closed_dates` needs its `updated_at` column.

#### `audit_log`
```sql
id           bigint PRIMARY KEY
clinic_id    uuid (NULLABLE, FOREIGN KEY → clinics.id)
table_name   text NOT NULL
row_id       uuid NOT NULL
action       text NOT NULL — 'create' | 'update' | 'delete'
old_data, new_data  jsonb (NULLABLE)
changed_by   uuid (NULLABLE, FOREIGN KEY → auth.users.id)
changed_at   timestamptz NOT NULL
```

#### `no_return_reason_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
is_closed       boolean NOT NULL
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
```
Every clinic gets an 8-item starter set (Moved away / relocated, Discomfort
with treatment, Cost / could not afford, Recovered — no longer needed care,
Switched to another provider, Lost contact / unreachable, Scheduling
conflict, Referred elsewhere) — seeded by `create_clinic_with_admin()` for
new clinics and by a one-time backfill migration for existing ones. Fully
editable afterward from Reports' "Manage reasons" panel (add / deactivate /
mark "counts as closed"); the starter rows aren't locked, just pre-filled.

#### `referring_source_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
detail_label    text (NULLABLE) — label for the follow-up detail field this
                source needs (e.g. "Referring doctor"), null if it needs none
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (clinic_id, name)
```
Clinic-editable list of referral channels shown when adding/editing a
patient (Settings → Catalog → Referral sources), same add / deactivate-not-delete / edit
pattern as `no_return_reason_catalog`. Seeded with the app's original six
labels (Hospital referral, Doctor referral, Walk-in, Word of mouth, Online,
Other) for every clinic — new via `create_clinic_with_admin()`, existing via
a backfill migration. `patients.referring_source_id` is the source of truth
for patients tagged after this catalog existed; the legacy
`patients.referring_source` enum column is kept (not backfilled) so older
patients keep displaying via the old `REFERRING_SOURCE_LABELS` fallback —
see `dashboardService.referralSourceStats` for how both are reconciled.

#### `treatment_catalog`
```sql
id              uuid PRIMARY KEY
clinic_id       uuid NOT NULL (FOREIGN KEY → clinics.id)
name            text NOT NULL
active          boolean NOT NULL (default true)
created_by, updated_by  uuid (NULLABLE)
updated_at      timestamptz NOT NULL
UNIQUE (clinic_id, name)
```
Clinic-editable list of treatment types (Manual Therapy, Exercise Therapy,
Kinesio Taping, ...), managed from Settings → Treatments, its own tab
alongside Services and Referral sources (all three used to be stacked in
one "Services" tab; split apart so each is its own scroll). Independent of
the billing-side `service_catalog` — one visit is
billed under one service package but can record several treatment types
performed via `visits.treatment_ids`, picked from the catalog on both the
visit-logging and edit-visit forms — plus a free-text add-on
(`visits.treatment_notes`, the same field clinical shorthand notes always
used) for anything not in the list, grouped under one "Treatments" field
on both forms. Displayed as a single combined "Treatments" column/cell
everywhere the visits table shows it (Ledger, Workspace, Patient Profile)
— catalog names joined by commas, then the free-text add-on after a dash
if present (`treatmentsDisplayText` in `components/VisitCard.tsx`) — not
two separate columns. Independent of Core Assessment/clinical docs too, so
it works for every clinic regardless of `clinicalDocsEnabled`. Patient
Profile's Care plan card shows a per-package breakdown (e.g. "Manual
Therapy: 4 · Exercise: 6") computed client-side from the patient's own
visits — no separate
aggregation query. Seeded with a 6-item starter set for every clinic.
Also shown as a toggleable "Treatments" column/row on the Visits table
(Ledger, Workspace, Patient Profile) — a separate `VisitColumnKey` from the
pre-existing free-text `'treatment'` (treatmentNotes) column.

#### `clinic_module_settings`, `clinic_entitlements` — live at the RLS layer, zero client integration
Not dead — `can_use_module(clinic_id, module_key)` (defined in
`20260718000001_module_registry.sql`, revised in
`20260721000001_entitlements_audit_log.sql`) checks `clinic_entitlements`
(fail-open: no row = entitled) then `clinic_module_settings` (fail-closed
otherwise, further gated by the caller's `clinic_members.role` against
`allowed_roles`), and is called from the insert/update RLS policies on
`consultation_notes`, `face_scale_responses`, and `facial_palsy_assessments`.
Every write to those three tables runs through it today.

What's genuinely missing is the **client side**: no Dexie table, no repo,
no sync, no UI anywhere in `src/` reads or writes either table — so nothing
in the app currently sets a narrower entitlement or surfaces a "this module
is off" state. In practice every clinic reads as fully entitled, because
nothing has ever populated `clinic_entitlements` with a restrictive row,
and every clinic gets a `clinic_module_settings` row for `'consultation_notes'`
seeded `enabled = true` (both the one-time backfill and the
`seed_default_module_settings()` AFTER INSERT trigger, in
`20260721000001_entitlements_audit_log.sql`). This is `can_use_module()`'s
**real, always-on gate for whether a note can be written at all** — but
there's no Settings toggle for it, so it stays on for every clinic by
construction, indefinitely, until someone writes SQL by hand.

**This is easy to conflate with `clinics.clinical_docs_enabled` (client-side,
has a Settings toggle) — but they act at different layers and never
conflict.** `can_use_module()` decides whether a note *can be written*
(server-side, RLS, always on). `clinical_docs_enabled` is a client-side
*visibility* flag deciding which clinical-documentation surfaces render.
Four read it:

| Surface | What `clinical_docs_enabled` gates |
| --- | --- |
| `visitService.ts` | auto-flags a new visit `clinicalStatus: 'pending'` |
| `NewVisitPage.tsx` | the "Add clinical note" CTA on the post-save screen |
| `LedgerPage.tsx` | the "Not documented" filter checkbox |
| `ReportsOverviewPage.tsx` | the modality-usage chart (query, nav entry, section) |

**One surface differs from those four, deliberately.**
`PatientProfilePage`'s `ConsultationNotePanel` — "New note" / "Continue
draft" — is gated on role (`canViewClinicalNotes`, i.e. every therapist,
never front desk) and *not* on `clinical_docs_enabled`. **Confirmed
intentional, not an inconsistency to fix:** notes access is role-based only
— every therapist always has it, full stop. The `clinical_docs_enabled`
surfaces above are a separate, opt-in layer on top of that baseline: does
*this clinic* want the per-visit reminder, the "Not documented" filter, and
the modality report — a workflow/reporting preference, not an access gate.
A clinic with the flag off still has every therapist able to write notes
from Patient Profile at any time; it just isn't nudged to do so on every
visit or tracked for completeness.

**Rule for any new consultation-notes entry point:** gate on
`canViewClinicalNotes` for access (matches Patient Profile). Gate on
`clinical_docs_enabled` only if the new surface is itself a reminder/filter/
report in the same spirit as the four above — not if it's a place to
actually write a note, which should behave like Patient Profile's baseline
and stay available regardless of the flag.

**Confirmed not tier-gated either** — no `PlanFeature` in `src/domain/plans.ts`
covers clinical notes today, by design (its own docstring excludes
"anything clinical-note- or advanced-module-content-shaped ... still open
design work"). **Tier restriction — note printing:** Lite cannot print or save-as-PDF a clinical note, session log or insurer packet. `PlanFeature` `notePrinting` (Lite off, Solo and above on) feeds `usePermissions().canPrintNotes`; `NotePrintPage`, `SessionLogPrintPage` and `InsurerPacketPage` render a `LockedSectionNotice` instead of the document (so a typed URL gets the same answer), and the entry links (note editor "Print", patient profile "Session log / Insurer packet") become a disabled "· Solo+" label. Writing notes is never gated. Display-level only — printing is client-side.

Note also that no admin-facing control exists for the *real* gate: turning
consultation notes genuinely off for a clinic means flipping
`clinic_module_settings.enabled` for `'consultation_notes'` by hand in SQL.
The Settings toggle does not do this, despite reading like it might.

The `modules` reference table these two originally pointed to was dropped
(`20260820000001_drop_unused_modules_table.sql`), taking its FK on
`module_key` with it via CASCADE. Restored as a plain `CHECK` constraint
(`20260823120000_restore_module_key_check.sql`) against the same seven
keys the `modules` table used to hold: `'gut_screening'`,
`'return_to_sport'`, `'scoliosis_screening'`, `'face_scale'`,
`'facial_palsy'`, `'consultation_notes'`, `'invoicing'`. Don't build new
gating logic on top of this without first confirming the tier-subscription
plan is what's meant to populate it — `can_use_module()`'s fail-open
default is backwards for a paywall and would need to change before these
tables can gate a paid tier.

#### `clinic_plans` — the tier boundary, service-role write only
Added as Phase 0 of the tier-subscription plan
(`20260823120001_clinic_plans.sql`). One row per clinic:

```sql
clinic_plans (
  clinic_id             uuid PRIMARY KEY (FOREIGN KEY → clinics.id, CASCADE)
  plan_tier             text NOT NULL, CHECK in ('lite', 'solo', 'clinic', 'clinic_plus')
  status                text NOT NULL DEFAULT 'active', CHECK in ('active', 'past_due', 'read_only')
  max_members           int NOT NULL       -- tunable per clinic, seeded from tier
  visit_cap_per_month   int                -- NULL = unlimited
  updated_at            timestamptz NOT NULL DEFAULT now()
)
```

RLS is deliberately asymmetric: `clinic_plans_select` lets any clinic
member read their own clinic's row, and there is **no write policy at
all**. With RLS enabled and zero write policies, Postgres denies every
`INSERT`/`UPDATE`/`DELETE` from the `authenticated` role outright — only
`service_role` (which bypasses RLS) can write this table. This is the
actual fix for the plan-tier-must-not-be-self-serve-editable problem: a
`plan_tier` column on `clinics` itself couldn't get this property, since
`clinics_update` already grants clinic admins unrestricted column access
and `clinics` rides the client-writable outbox.

Seeded automatically, mirroring `add_creator_as_admin()` and
`seed_default_module_settings()` (both existing AFTER INSERT triggers on
`clinics`): `seed_default_clinic_plan()` inserts a `lite` / `active` / 1
seat / 50 visits-per-month row for every newly created clinic. All four
existing clinics at migration time were backfilled as `clinic_plus` /
`active` / unlimited — a deliberate placeholder that grandfathers today's
de-facto behavior (nothing has ever been gated), not a real tier
assignment; real per-clinic tiers need deciding before enforcement
(seat cap, visit cap, invoicing gate — none of it is wired up yet) lands
on top of this table.

**Read path (Phase 1):** `useEntitlements(clinicId)` (`src/app/useEntitlements.ts`)
is the sole read point. `clinic_plans` has no Dexie table and isn't part of
the sync engine's generic per-table pull (`ALL_SYNCED_TABLES` in
`src/lib/db.ts`) — that loop assumes every table has an `id` primary key,
and this one is keyed by `clinicId`. Instead the hook fetches it directly
via Supabase, exactly mirroring `useClinicRole`'s pattern: cached as JSON in
Dexie's `meta` table (key `plan:${clinicId}`) so the tier survives offline,
a fresh online fetch always wins, and an unresolved fetch never flashes the
least-restrictive default (`lite`/1 seat/50 visits — the same fail-closed
default `DEFAULT_PLAN` uses when nothing has loaded yet). The hook also
returns `seatsUsed` (a live `clinic_members` count, online-only — `null`
when unknown) and `visitsThisMonth` (computed from local Dexie visits via
`repos.visits.list`, so it works offline). `src/domain/plans.ts` holds the
pure tier → feature map (`tierIncludes()`) the hook's `can()` reads, plus
`currentMonthRange()` — both unit-tested.

No UI reads this yet — Phase 1 only builds the read path. Enforcement
(Phase 2) and the Settings `plan` section (Phase 3) are what consume it.

**Enforcement (Phase 2):** four gates, all reading `clinic_plans` directly
(server-side) so none of them can be bypassed by a client that doesn't call
`useEntitlements()`:

- **Invoicing** — `issue_invoice()` checks plan status and tier *before*
  the pre-existing `clinic_entitlements('invoicing')` /
  `billing_enabled` / `invoicing_access` chain. Full precedence: **plan
  status (`read_only` blocks outright) → plan tier (`lite` blocks) →
  `clinic_entitlements` → `billing_enabled` → `invoicing_access`.** Each
  layer raises its own distinct error message.
- **New patients** — `enforce_clinic_plan_on_patient_insert()`, a
  `BEFORE INSERT` trigger on `patients`, blocks while `status <> 'active'`.
  Edits to existing patients are unaffected — only new rows are gated.
- **New visits** — `enforce_clinic_plan_on_visit_insert()`, a
  `BEFORE INSERT` trigger on `visits`, blocks while `status <> 'active'`,
  and separately enforces `visit_cap_per_month` **with a +20 buffer**
  (a hard block at the exact cap risks losing a real visit to a
  multi-device offline-sync race — the buffer absorbs that, the client
  pre-check below is the real day-to-day gate). Counted by the visit's own
  `visit_date`'s calendar month, not today's date — this is also what
  makes `importVisitsService.ts`'s bulk historical importer safe with no
  special-casing: it writes through this exact same insert path (no
  separate RPC to exempt), but imported rows are virtually always dated in
  past months, so they don't touch the current month's count. A same-month
  bulk import can still hit the buffer.
- **Seat cap** — the `invite-therapist` edge function counts
  `clinic_members` against `clinic_plans.max_members` before inviting or
  re-linking an existing account to the clinic (both add a
  `clinic_members` row, both count). Fails open if a clinic somehow has no
  `clinic_plans` row (shouldn't happen — every clinic is seeded one).
- **Client pre-check** — `NewVisitPage.tsx`'s `save()` reads
  `useEntitlements(clinic.id)` and blocks before attempting to save once
  `visitsThisMonth >= visitCapPerMonth`, so a normal user sees a clear
  message before ever reaching the server buffer above.

Deliberately **not** touched: `can_use_module()` / `consultation_notes` /
the five assessment-module keys. `clinics.clinical_docs_enabled` and
`clinic_module_settings('consultation_notes')` were previously suspected of
being two conflicting gates on the same feature; traced precisely, they act
at different layers — server-side write permission vs. client-side surface
visibility — and never conflict. See the dead-infrastructure section above
for the full mechanism, including a real inconsistency it surfaced (Patient
Profile's notes entry point isn't gated by `clinical_docs_enabled` while
three comparable surfaces are) that is still undecided. Adding a third
(plan-tier) gate would need to go through `can_use_module()` specifically,
since that's the one that actually governs whether a note can be written.
The five module keys have zero client code today regardless, so gating them
has no practical effect yet. Deferred to the still-open "advanced modules
content" planning pass.

**Bug fixed during Phase 2 testing:** `clinic_plans_updated` (Phase 0) used
the generic `set_updated_at()` trigger function, which unconditionally sets
`updated_by`/`created_by` — columns `clinic_plans` doesn't have (there's no
write path through an authenticated user's own session for this table).
Every `UPDATE` failed until `20260823130001_fix_clinic_plans_updated_trigger.sql`
gave it its own minimal trigger function that only sets `updated_at`. Caught
by direct testing before anything in production exercised the broken path.

**Settings UI (Phase 3)** — the first user-visible part of the tier plan.
`SettingsPage.tsx` gains an "Account" group with a read-only `plan` section
(`PlanSection`): tier, status, seats used/limit, visits this month/cap, and
a per-feature "what's included" list, all read from `useEntitlements()`.
Every section resolves to one of three states, per the design in Part 3 of
the tier plan:

- **available** — normal.
- **locked** — above the tier (`billing`, gated on `can('invoicing')`).
  Stays visible in the rail, greyed with a lock glyph; clicking it shows
  `LockedSectionNotice` (informational only — "Included in Solo and
  above," no CTA button, since there's no self-serve upgrade flow yet) in
  place of the real form.
- **hidden** — genuinely inapplicable, not a paywall (`partner`, gated on
  `can('revenueSplit')` — a Lite/Solo clinic can't have a hospital
  revenue-split relationship at all under its plan). Filtered out of both
  nav lists at render time; a mid-session redirect effect bounces `activeKey`
  away from `partner` if the resolved plan stops including it, mirroring
  the existing pattern `LedgerPage.tsx`/`ReportsPage.tsx` already use for a
  role changing mid-session.

**Lite can collect, not invoice.** `usePermissions().canCollectPayment` is `canBill` without the plan term (`billingEnabled` and `invoicingAccess` only), so a Lite clinic records direct payments on a visit (`Collect ₹X`, the "Due" footer and Not-collected filter all stay meaningful) and is never told to "Ask billing" — that pill shows only when the user can neither invoice nor collect. New Visit's **Payment** card (Collected now / Take payment later, method, UPI QR), the post-save "Take payment" button and Workspace's Dues tile all follow `canCollectPayment`, so a Lite visit can be saved as collected in the form itself; "Give bill" and the invoice-policy prompt stay on `canBill`. Visit components take a separate `canCollect` prop (defaults to `canInvoice`); issuing an invoice stays on `canInvoice`/`canBill`. **Lite UX around the plan limits.** (1) *Visit cap:* the 50-visits/month block stays, but `VisitCapNotice` (New visit page and Settings → Your plan) warns from 80% (`visitCapStatus`, `VISIT_CAP_WARN_AT` in `src/domain/plans.ts`) and says so plainly when reached, with an "Ask to upgrade" mailto from `upgradeMailto()` (`src/lib/support.ts`, needs `VITE_SUPPORT_EMAIL`; without it the text is "Contact us to upgrade"); the save error says nothing entered is lost. (2) *Seat cap:* hitting the login limit no longer hides the Add team member form — `loginsLocked` turns "Needs login" off and disables it with a hint, so a no-login roster therapist (bookable, appears on the schedule) can always be added. (3) *Monthly statement:* `usePermissions().canViewMonthlyStatement` (admin, any plan) gates Reports → Monthly statement; without a partner/therapist split configured it is billed totals, visits and patients. The Attribution audit stays on `canViewPayouts` (`revenueSplit`).

The **Clinical notes** toggle (`clinicalDocsEnabled`) lives on Settings → General (`ClinicalDocsSection`), not in the plan-locked Billing tab.

`usePermissions()` folds `useEntitlements()` into `canBill` (also requires
`can('invoicing')` now, ahead of the pre-existing `billingEnabled`/
`invoicingAccess` checks) and `canViewPayouts` (also requires
`can('revenueSplit')`) — since `LedgerPage.tsx`'s Invoices tab and
`ReportsPage.tsx`'s Attribution Audit tab both already consume those two
booleans, tier-gating happens there for free. `TherapistComparisonCard.tsx`
needed its own `can('revenueSplit')` check instead (it's gated on
`clinic.showTherapistComparison`, not a `usePermissions()` flag).

Team's Invite form locks (with the same informational-only copy) once
`clinic_members.length >= maxMembers` — a client-side hint only, since
`invite-therapist`'s own seat-cap check (Phase 2) is the real boundary.

See **Guided setup** above (`/setup`, `src/domain/setupGuide.ts`).

**Header layout budget** (`Shell.tsx`'s `<header>`) — the desktop header
row has a fixed width to spend (`max-w-6xl`, ~1120px usable) and five
things wanting it: the Thera.Net mark, nav, the clinic pill, sync badge,
account trigger. (Current layout: mark left, nav, then clinic pill + sync +
account on the right — see Schedule → App header.) With a text
label on all of them at once it doesn't fit — six labelled nav items plus
the clinic name alone overran it by ~160px, which showed up first as the
account dropdown rendering off-screen at iPad-portrait widths (the row
overflowed, taking the `right-0`-anchored panel's anchor with it) and then,
after a stopgap `overflow-x-auto`, as a squeezed horizontally-scrolling nav
even on a full-width screen. Three rules keep it fitting, and a change to
any element in this row has to keep them true:
- **Only the clinic name shrinks.** The nav and the sync/account cluster are
  `shrink-0`; the clinic pill's name truncates, and between `tab:` and
  `desktop:` it is hidden (the pill keeps the clinic logo + ▾, the name is
  in its tooltip and menu), so clicked targets never squeeze.
- **Nav labels are `desktop:`-only** (1000px+). Between `sm:` and there,
  the nav is icons carrying `aria-label` + `title` (the label span is
  `display:none`, which screen readers skip, so the accessible name has to
  come from the attribute). This is what makes the row fit an iPad in
  portrait at all.
- **Five nav items, not six** — Settings lives in the account menu's Clinic
  section instead (see below), under the same `role === 'admin'` gate the
  `NAV` filter used to apply. Mobile is unaffected: `/more` has always been
  its route there, and the phone tab bar is hand-built, not `NAV`-driven.
The sync badge deliberately keeps its text label (`Synced`/`3 pending`/
`Offline`) rather than collapsing to a bare dot — sync state is the one
thing in this row a user needs to read, not decode.

**Account menu** (`AccountMenu` in `src/app/Shell.tsx`) — one dropdown,
same markup at every breakpoint (the name/role label collapses to just the
initials-avatar trigger below `sm:`), replacing what used to be two
separate, independently-built account areas: a flat always-visible
name+Sign-out pair on desktop, and an ad-hoc hamburger-icon dropdown on
mobile with its own copy of the same `NameEditor`. Panel contents: the
guided-setup bar for an admin while setup is incomplete (see Guided setup), a "Change
password" action (Settings moved to the main header nav for admins, removing duplication), (`ChangePasswordDialog`,
`src/components/ChangePasswordDialog.tsx` — calls
`supabase.auth.updateUser({ password })` directly, since the account menu
only exists post-login, unlike `ResetPasswordPage.tsx`'s invite/recovery-
link flow which first has to establish a session from the email link's
token), Help & Feedback, Sign out, and a "Thera.Net · v{version}" footer.
Clinic switching and "Add another clinic" moved to the header's clinic pill
(`ClinicSwitcher`) — the menu no longer lists clinics.

**Multi-clinic accounts** — one admin can create and switch between
multiple clinics under a single login; the schema/RLS/billing/sync layers
were already built for this (every policy is keyed off a row's own
`clinic_id`, `clinic_members`' PK is the composite `(clinic_id, user_id)`,
`clinic_plans`' PK is `clinic_id` so each clinic gets its own independent
plan/seat-count) — the gap was entirely client-side UI, closed as follows:

- **Switching clinics**: `AccountMenu` lists every clinic in `db.clinics`
  (alphabetically) whenever an account has 2+, and clicking one writes
  `db.meta.put({ key: 'activeClinicId', value: clinic.id })` and navigates
  to `/workspace` — landing anywhere on a per-record route (e.g.
  `/patients/$patientId`) would point at an id belonging to the clinic
  just left. `Shell.tsx`'s `clinic` resolution (`clinics.find(c => c.id
  === activeClinicId)`) and the `useClinicRole`/`useEntitlements` hooks
  that key their own `db.meta` caches off `clinicId` do the rest — nothing
  else needed to change for the switch to ripple through the whole app.
- **Adding a second clinic**: `CreateClinicForm` (`create_clinic_with_admin`
  RPC — no DB-level limit on clinics-per-admin) takes a `variant: 'page' |
  'dialog'` prop. `'page'` is the original zero-clinic-account screen
  (`Shell.tsx` renders it once sync confirms the account truly has no
  clinics). `'dialog'` is the same fields/logic, bare, wrapped by
  `AddClinicDialog` and opened from `AccountMenu`'s "Add another clinic"
  item — gated to `role === 'admin'` of the currently active clinic, same
  as the Settings-tab gate. Creating a clinic from either entry point
  makes it the new active clinic immediately.
- **Active clinic resolution** (`src/app/useActiveClinic.ts`, one place):
  `resolveActiveClinic(clinics, pointer)` treats `undefined` (Dexie query
  still loading) differently from `null` (pointer never set). The stored
  pointer `meta.activeClinicId` is the user's choice and is written only by
  `setActiveClinic(id)` (an explicit switch/create, awaited before
  navigating) or once to seed it when it has never been set. A stale pointer
  (removed membership, mid-resync) is never overwritten: the first clinic is
  shown meanwhile and the choice returns when that clinic is known again.
  This replaced a Shell effect that overwrote the pointer with `clinics[0]`
  whenever `clinics` resolved before the pointer read, resetting multi-clinic
  users on refresh. A non-empty `clinics` list always yields a clinic once the
  pointer read settles, so the zero-clinic `CreateClinicForm` only shows for a
  settled, truly empty account.
- **Sync cursor reconciliation** (`SyncEngine.reconcileClinicMembership`,
  `src/sync/engine.ts`) — every table's pull cursor (`db.meta` key
  `` `cursor:${table}` ``) only moves forward against `updated_at`, so a
  clinic that becomes newly visible on this device (a fresh invite, or
  this same account creating/joining a second, pre-existing clinic) can
  have rows — including its own `clinics` row — older than a cursor this
  device already advanced while syncing its first clinic; those rows
  would never come back from an incremental `.gt(cursor)` pull. Before
  every `push()`/`pull()` cycle, a cheap uncursored
  `clinic_members` query for the signed-in user's own membership rows is
  compared against a `db.meta`-cached `knownClinicIds` set; if it grew,
  every `cursor:*` entry is deleted, forcing one full EPOCH-based re-pull
  (safe, since RLS still scopes exactly what returns) — a general "always
  re-verify membership before trusting a cursor" pattern worth applying
  anywhere else a cursor's validity depends on which rows a user can even
  see. **Known limitation**: a membership being *removed* is not handled
  symmetrically — pull only adds/updates, so a clinic's already-synced
  rows linger in local Dexie after the membership granting access to them
  is revoked, until that table is cleared for some other reason (e.g.
  sign-out). Not addressed here; would need explicit tombstone/reconcile
  logic if it becomes a real problem.

**Pilot kill switch (Phase 4)** — pilot clinics need to run with zero tier
limits until payments are integrated, without hand-editing every clinic's
`clinic_plans` row (that's the wrong tool: per-clinic override, not a
global pause). `platform_config` is a singleton-row table (`id boolean
primary key default true check (id)` forces exactly one row):

```sql
platform_config (
  id                          boolean PRIMARY KEY DEFAULT true CHECK (id)
  tier_enforcement_enabled    boolean NOT NULL DEFAULT true
  updated_at                  timestamptz NOT NULL DEFAULT now()
)
```

RLS: `select` for any authenticated user (a boolean, not sensitive — every
clinic needs to read it), **no write policy** — same service-role-only
pattern as `clinic_plans`; flipped via manual SQL, same as tier assignment
itself. `tier_enforcement_enabled()` (SQL function, `stable`) wraps the
read with `coalesce(..., true)` so a missing row fails toward *enforced*,
matching the fail-closed-for-monetization principle the whole tier design
follows.

Every Phase 2 enforcement point checks it first and skips its own logic
entirely when it's `false`: `issue_invoice()` (only the two tier checks —
the pre-existing `clinic_entitlements`/`billing_enabled`/`invoicing_access`
checks are a separate, unrelated concern and stay active regardless),
`enforce_clinic_plan_on_patient_insert()`/`enforce_clinic_plan_on_visit_insert()`
(early-return), and `invite-therapist` (reads `platform_config` alongside
`clinic_plans`).

Client-side, `useEntitlements()` fetches `platform_config` in the same
round trip as `clinic_plans`, cached in `db.meta` under a fixed
(non-clinic-scoped) key with the same fail-closed-to-`true` default. The
hook exposes `enforcementEnabled: boolean`, and `can()` returns `true`
unconditionally when it's `false` — since every Phase 3 UI gate
(`SettingsPage.tsx`'s locked/hidden resolution, `usePermissions()`'s
`canBill`/`canViewPayouts`) already derives from `can()`, this alone
unlocks all of them with no changes needed in those files. Three call
sites read `maxMembers`/`visitCapPerMonth` directly instead of through
`can()`, so they carry an explicit `enforcementEnabled` guard: `Therapists()`'s
`atSeatCap`, `NewVisitPage.tsx`'s visit-cap pre-check, and
the guided setup's seat-limited copy for the invite step. `PlanSection` shows a
"Tier limits are paused for pilot testing" note when disabled, so a future
admin doesn't mistake fully-unlocked plans for a bug.

Verified live against a disposable test clinic set to `read_only` status
and a deliberately-impossible visit cap: with the switch off, a patient
insert, a visit insert, and (implicitly, same code path) invoicing all
succeed despite both restrictions; flipping the switch back on immediately
re-blocks the same clinic with no other change.

---

### `push_subscriptions`

One row per subscribed browser (`endpoint` unique), keyed to `auth.users(id)`. Users can insert, update, and delete only their own rows; reads for sending use the service role. Written by the browser on enable, deleted on disable and sign-out, and pruned by `send-push` on 404/410.

Triggers `appointments_push`, `appointment_requests_push`, and `feedback_responses_push` call `notify_push()`, which posts `{kind, clinic_id, row_id}` to `send-push`.

## Key Design Patterns

### 0. Deploys and open tabs (`src/sw.ts`, `src/app/registerServiceWorker.ts`, `src/app/updateStore.ts`, `src/app/appUpdate.ts`)
Every route except Workspace is `React.lazy()`, and `cleanupOutdatedCaches()`
deletes the previous precache once a new worker is *active*. A new worker used
to take over open tabs at once (`skipWaiting` + `clients.claim`), so the page
on screen kept old chunk hashes and its next lazy route failed to load.
**The new worker now waits.** `sw.js` only calls `skipWaiting()` when the page
posts `{type:'SKIP_WAITING'}` (and `clients.claim()` runs on `activate`, which
only matters for the very first install). The app registers `/sw.js` itself
(`registerServiceWorker()`, called from `main.tsx`; `vite.config.ts` has
`registerType: 'prompt'`, `injectRegister: false`), so an open tab keeps
running the version it loaded, from the old precache, until it is switched:
- **Banner** (`components/UpdateBanner.tsx`, mounted in `Shell`): "A new version
  is available", the running `v{version} · {build}`, **Refresh** and **Later**.
  Refresh first syncs pending outbox changes (8 s cap, skipped offline), then
  activates the waiting worker; the page reloads on `controllerchange`. Later
  snoozes 4 h; after 8 h of waiting the banner is sticky (no Later). Timings and
  rules are pure functions in `updateStore.ts` (`SNOOZE_MS`, `STICKY_AFTER_MS`,
  `bannerVisible`, `isSticky`).
- **Safe-moment apply:** a tab hidden for 2 min that has nothing unsynced and no
  open dialog or typed-in field (`isBusyDocument` heuristic) switches itself.
  A tab opened while an update is already waiting switches immediately (once per
  minute at most).
- **Update checks:** `registration.update()` every 30 min while the tab is
  visible and online, and when it regains focus; never closer than 15 min. It
  only re-fetches `sw.js` (about 20 KB, conditional) from the static host — no
  Supabase traffic. `vercel.json` serves `/sw.js` with `no-cache`.
- **Account menu:** footer shows `Thera.Net v{package version} · {short commit}`
  (`__APP_VERSION__`, `__APP_BUILD__` from `vite.config.ts`: `VERCEL_GIT_COMMIT_SHA`,
  else `git rev-parse`, else `dev`). "Refresh app" runs
  `checkForUpdateAndReload()` (check, wait for install, sync, switch).
**Bridge:** a worker that finds no `thera-sw-protocol-2` cache marker calls `skipWaiting()` on install (and writes the marker on activate), so pages from before the waiting protocol, which cannot promote a waiting worker, are not stuck on the old version; every later deploy waits for the banner. **Only one tab switches unprompted:** cold-start and background auto-apply first ask other tabs over a `BroadcastChannel` (`tabPresence.ts`) and show the banner instead when another tab answers, since the switch takes over every tab. `activateWaiting` is idempotent, there is one `controllerchange` listener per page (our own switch reloads; a switch made by another tab clears this tab's banner), and a worker that never takes over resets the state (and reloads, on the stale-chunk recovery path).
`installAppUpdateHandling(router)` remains as the safety net: `vite:preloadError`
triggers a silent reload, and if another tab switched versions and this one lost
its chunks, the *next in-app navigation* becomes a full load of its target
(immediate if hidden). `reloadForNewVersion()` is the single reload entry point
(60-second cooldown) and first activates a waiting worker, since a plain reload
would otherwise still serve the old version. Not built: a "minimum supported
version" lock for breaking releases. Not browser-tested at the time of writing;
the flow to verify on a real deploy is open app, push, wait for the banner,
Refresh.

### 0a. Dialogs, notices and confirms (`components/dialogBehavior.ts`, `lib/notify.ts`, `components/NoticeHost.tsx`)
Native `alert()` / `confirm()` / `prompt()` are not used for user-facing messages (they look wrong in a
phone PWA and iOS standalone can suppress them). `notify.error()` / `notify.info()` show a dismissable
notice (`role="alert"` / `status`, auto-dismiss) and `askConfirm({ title, message, confirmLabel,
destructive, typeToConfirm })` returns a `Promise<boolean>` for a styled confirm (type-to-confirm replaces
`prompt()`); both work from non-React code, and `NoticeHost` (mounted once in `main.tsx`) renders them: the same message raised again shows a count (×N) instead of a stack of copies, at most 3 notices are on screen (oldest dropped), errors stay 30 s and info 5 s, and hovering or focusing a notice pauses its timer. Segmented controls expose their state to assistive tech (`aria-pressed` on the date presets and Patients chips, `role=tablist`/`tab` + `aria-selected` on the Ledger tabs).
`ConfirmDialog` takes `open`/`onConfirm`/`onCancel` for places that own the state. **The main dialogs and sheets use
`useDialogBehavior(open, onClose, canClose?)`** on their `role="dialog"` panel (a dialog that stays mounted while closed must pass its real `open`, and one that can be mid-save passes `canClose` so Escape can't interrupt it); every modal component uses it (payment/invoice/advance dialogs, booking and schedule sheets, account dialogs, `StartVisitSheet`, `AssignShift*`, `UpiQrModal`, the letterhead preview); only the two inline dialogs inside `SettingsPage` and `ScheduleBookingsView` still hand-roll theirs: Escape closes only the topmost
open dialog, Tab/Shift+Tab stay inside it, focus moves in on open and back to the opener on close.
`ErrorNote` is `role="alert"`. The only native dialogs left are the three unsaved-changes route guards
(Settings, session note editor, note editor): the router blocker must answer synchronously.

### 0b. Phone layout conventions
Checked at 375px wide (and 375x640 for pop-ups) with the app booted in headless
Chromium against mocked Supabase responses — a quick way to catch what a code
read misses (clipped pills, tables wider than their card).
- **Pop-up panels use `.dialog-panel`** (`index.css`): capped at the visible
  height (`100dvh`, `100vh` fallback) and scrolling inside. A centered panel
  without it loses its top and its action buttons off-screen on a short phone or
  with the keyboard open, with no way to scroll to them. Long forms (the team
  member edit form) also pin the Save/Cancel footer outside the scrolling body.
- **Charts/cards nested in a `SectionCard` use `.chart-panel`**: a bordered card
  from `sm:` up, a flat divided section on phones, so the chart gets the card's
  full width instead of a box inside a box.
- **Wide tables on phones.** The month breakdown hides secondary columns below
  `tab:` (Month, revenue, MoM %, visits on a phone; all seven from tablet width).
  The therapist comparison stays a real table at every width — sticky Therapist
  column, tighter cell padding, no caption lines, a "swipe sideways" hint — because
  a per-therapist card list read worse than a table. The Monthly statement keeps its
  deliberate sticky-column sideways scroll.
- **Long lists in Reports collapse** (`ShowMore.tsx`: `useShowMore` + `ShowMoreFooter`):
  5 rows by default, then "Show more / Show all /
  Show less". Used by Single-visit patients and the Referral sources patient/partner
  lists, which grow with the clinic; a
  list's `resetKey` (filter, selected source) collapses it back to the first page.
  Footer totals still cover the whole list ("Total (all 43)"). Bounded lists — the
  6-item modalities chart, a handful of therapists, ≤12 months — don't need it.
- **Chart headline numbers are `text-xl font-semibold`** (`text-2xl` on the
  utilisation cards), not bold display size, so they don't dominate the chart under them.
- **A "vs …" KPI label and its comparison figure read as one phrase** ("vs last
  month: ₹26,932"), never "vs last month · Last month: ₹26,932".
- **Don't repeat a heading at several levels** (card title, eyebrow, sub-heading,
  table heading all saying "therapist comparison"): one title per block.

### 1. Offline-First with Outbox Sync
- **Dexie** for local IndexedDB storage
- **Outbox table** (in Supabase) for tracking changes made offline
- **Sync engine** pushes to Supabase when online, pulls deltas to stay in sync
- **Collision handling** — visit/patient/invoice conflicts resolved server-side
- **Sign-out clear must gate on `loading`, not just `!session`** —
  `Shell.tsx` wipes every synced Dexie table plus the outbox on sign-out
  (privacy: prevents one account's cached data leaking to the next login
  on a shared device). `useSession()`'s state starts as `{loading: true,
  session: null}` for one render before the real `getSession()` call
  resolves — that transient `null` is not a confirmed sign-out. The
  clearing effect must check `loading === false` before treating `session
  === null` as "actually signed out"; keying it off `session` alone fires
  the wipe on every app launch/reload, discarding any outbox entry not
  yet pushed to the server (e.g. a patient added while offline, then the
  tab closed before sync ran) with no warning and no way to recover it.
- **Only a deliberate sign-out wipes the outbox** (`src/app/sessionLoss.ts`).
  `signOutSafely` (which already syncs first and warns) marks the sign-out
  voluntary right before `auth.signOut()`. If the session ends any other way
  (expired/revoked refresh token, sign-out in another tab, password change on
  another device) and the outbox is not empty, `Shell` **keeps** all local data,
  stops the engine, and the login screen shows how many changes are still saved
  on the device (`UnsyncedNotice`). `db.meta.lastUserId` records who owns the
  local store. On the next sign-in: same user -> resume syncing; a different
  user with nothing pending -> clear then continue; a different user **with**
  pending work -> `ForeignPendingScreen` (Discard and continue / Sign out) and
  syncing stays off, since the rows would otherwise be pushed under the wrong
  account. `SyncEngine.sync()` also no-ops while stopped. The session effect in `Shell` is keyed by **user id** (not the session object, which Supabase replaces on every token refresh), runs queued one at a time, and re-checks cancellation before every clear; a hot-swap to another account clears only when nothing is waiting to sync, otherwise the owner check above applies. The voluntary-sign-out flag expires after 15 s so a failed sign-out cannot make a later involuntary loss look deliberate. In the 'keep' case (`unsyncedWork.ts`) every synced row **not referenced by the outbox is purged** and the pull cursors are reset (the next sign-in re-pulls), so the readable cache of patient data is not left on the device; the login notice and the foreign-account screen offer **Download unsynced changes** (a JSON file of the data behind each queued change). A device with unsynced work but no recorded owner (`lastUserId` absent, from before owners were recorded) is treated like a different account (`confirm-discard`) instead of being synced blind; an empty, new device is unaffected. After a session
  starts the app calls `navigator.storage.persist()` (`lib/persistStorage.ts`)
  so the browser doesn't evict the outbox.
- **Walk-in IDs are reserved by the server when online** (`20261015120000_reserve_walk_in_mrno.sql`): `reserve_walk_in_mrno(clinic, prefix, yy)` (security definer, member-checked, authenticated-only) returns the next `{prefix}{yy}-NNNN` from a persistent per-clinic counter table (`walk_in_mrno_counters`, RLS on with no policies) that never goes below the highest number already used by a patient, so two reservations made before either patient syncs still differ. `patientService.create` uses it online and falls back to the local mint offline or on any error (a reserved number that is already used locally is ignored).
- **Colliding walk-in IDs are re-issued, not reverted.** Walk-in IDs
  (`W26-0001`) are minted from the local list, so two offline devices can mint
  the same one; the server's unique `(clinic_id, mrno)` rejects the later push
  (`23505`). `SyncEngine.push` detects that (`isMrnoCollision`), and for an
  auto-minted ID replaces it with the next free number from local + server rows
  (`reissueWalkInMrno`, up to 3 tries) and pushes again. A typed hospital ID is
  left as a visible failure: the patient is kept and the outbox entry is not retried each cycle until the row is edited again. The re-issue re-reads the row in a transaction, escapes the `LIKE` prefix, and tells the user ("ID W26-0001 was taken, so X is now W26-0003"). Previously the permanent-failure path reverted to
  server truth, which deleted the patient locally and stranded its visits.
- **Sync status tells the truth.** `lastSuccessAt` (persisted in `db.meta`,
  display only) feeds the badge: "Last synced 14:32 / 12 min ago", "Sync issue"
  when the last attempt errored, amber "Not synced recently" past 30 minutes
  while online. `lastSyncAt` stays in-memory and is still the Shell's "first
  sync has settled" gate, so a persisted value can never satisfy it. The
  "Preparing..." screen offers Retry and Sign out after 15 s
  (`PreparingEscape`).
- **Unsaved work registry** (`lib/unsavedWork.ts`): screens register a probe with `useUnsavedWorkProbe(() => dirty)` (the booking sheet, both note editors); `hasUnsavedWork()` feeds the update system's background-apply check alongside the DOM heuristic. The booking sheet asks "Discard this booking?" when Escape, the backdrop or the X would throw away typed patient details.

### 1b. Push order for service lines and shares (`visit_items` / `visit_credits`)
Lines and shares are separate rows from the visit and sync as separate outbox entries, so the order they reach the server matters.
- **The outbox merges every queued entry for one row at that row's OLDEST queued position.** A later edit never moves a row later in the queue. Anything that relies on "queued after X" must account for this.
- **A package-line swap queues the slot-freeing row first.** The server allows one live package line per visit (unique index), so the line that stops being the package line (or is removed) is queued before the line that takes the slot (`putWithChildren`; tag-clearing line writes go before the visit row via `itemsFirst`). Known gap: a slot-taking row that already had an older pending entry can invert this, the server answers 23505 and the row reverts.
- **Do not issue an invoice while a visit's lines or shares are pending or refused.** `issue_invoice` freezes lines the moment `invoice_id` is set, so unsynced lines would be rejected (42501) and the bill would not match. The app refuses with a message instead.
- **The server freezes lines once `invoice_id` is set, but not shares** (who gets paid is internal and not on the invoice). An upsert of an existing frozen line that changes no content column passes (backup restore, sync retry); a new line or a real change is refused.
- **A visit can arrive on another device before its lines.** `visits.service_lines_count` records how many live lines the visit was saved with, and the invoice builder refuses a visit with fewer local lines than that. Any new path that rewrites a visit's lines must set it too.
- Backup restore follows the same rule: visits are put first, then `visit_items`, then `visit_credits`.

### 2. Revenue Split Snapshot at Billing
- **Rates stored with each visit** (bm_split_pct, tax_pct, tds_basis)
- **Computed once at invoice time**: bm_share, post_tax, tds, hv
- **Immutable invoice** via DB trigger
- **Rate changes** only affect new visits, not historical records

### 2b. Reporting-Layer Attribution (`reportService.monthly`'s `netPostTaxPaise`)
The per-visit split above answers "how was this bill divided between the
clinic and the partner hospital" — a billing fact, never touched after the
fact. A separate question, answered only at the reporting layer (never
stored on the visit itself), is "how much did this THERAPIST actually
generate" — which the raw per-visit numbers get wrong for two real cases:

- **Multi-session packages**: a package's full price is billed on one
  session's visit; every other session is logged separately at ₹0 so it
  isn't double-billed. Naively summing `postTaxPaise` per therapist credits
  100% of a 3-session package to whoever logged session 1, even when a
  colleague ran the other two.
- **Same-visit revenue shares**: a visit's bill can be shared between the
  therapists on it — today as `visit_credits` rows (each therapist's ₹ share
  of the bill, from the service lines or edited by hand); on older visits
  without credit rows, as the legacy % (`visits.shared_therapist_id`/`shared_pct`,
  no longer written).

Both are folded into ONE number, `TherapistMonthRow.netPostTaxPaise`
(`reportService.ts`), rather than kept as parallel concepts: the base is
each row's summed `postTaxPaise`, adjusted by (1) the manual-split delta
(a same-visit % moved between two named therapists, always net-zero across
the month) and (2) an automatic package-attribution delta, computed
**per package group, as explicit movements the biller gives away** —
`attributionMovements()` in `src/domain/payBase.ts`:
1. Find the group's **billing visit**: the visit whose live **package
   line** (`visit_items.is_package_line`) has `price_paise > 0`. For groups
   billed before lines existed, today's rule over the visits **without
   lines** — the largest bill (everything else is logged at ₹0 by
   convention) — so a continuation with a paid add-on (a bigger bill) can
   never become the billing visit; mixed groups work. A group where every
   visit has lines but none has a priced package line has **nothing to
   attribute** (no max-bill fallback over visits with lines).
2. The package's **base**: with a package line, that line's part of the
   billing visit's Post-Tax (and clinic share) when those are split over the
   visit's live lines by their nets (`lineNets`) with
   `largestRemainderRupees` — the same rule `line_share` uses, so the
   biller's held amount and the base agree to within ₹1 (the per-session
   floor below absorbs the difference) — so a consultation billed in the
   same visit never leaks into the sessions; without lines, the visit's
   whole figures.
   `perSessionShare = floor(base / 100 / packageTotal) × 100` — a fixed
   whole-rupee amount, computed from the package's **declared** session
   count so it stays stable as later sessions get logged.
3. The **biller** is whoever holds the package money, read from the
   **stored shares, never the live setting**: the package line's deliverer
   (`assisting_therapist_id ?? visit therapist`) on the billing visit if that
   therapist's effective credit there (stored rows if valid, else the
   repaired ones) is ≥ the package line's net; otherwise the billing visit's
   primary (e.g. the visit was billed with split off, so every rupee sits
   with the primary). A visit without lines: its therapist. So switching the
   setting never changes who billed a package. A session's **runner**
   follows the **current** setting: split on → the deliverer of that
   session visit's package line; split off → the session visit's primary;
   a visit without lines → its therapist. Consequence: toggling the
   therapist-split setting re-attributes package sessions whose package line
   names an assistant, in every month (closed ones included). For every *other*
   logged session whose runner is **not** the biller, move one
   `perSessionShare` from the biller's row to the runner's. A session the
   biller ran themselves needs no delta.
4. Whatever isn't explicitly claimed this way stays with the biller —
   including the share reserved for sessions **not yet logged**. Earlier
   versions of this algorithm divided evenly across only the *logged*
   sessions, which silently dropped the un-logged share into neither
   row (confirmed on live data as ~53% of a month's revenue missing from
   every therapist's Net); the current version never leaves a rupee
   unattributed.

**Settlement is scoped to the report's own month, not the whole package.**
Step 3's giving-loop only considers sibling sessions whose own `visitDate`
falls inside the report's `[from,to]` window — a package spanning several
months settles **incrementally**, one month's sessions at a time, instead
of re-applying every session's share retroactively whenever a later
month's report touches the same group. Two consequences worth knowing:
- **A past month's report is immutable to later events.** Re-running
  `monthly()` for a month that has already "closed" always reproduces the
  same numbers, because no future visit's date can ever fall inside a
  past window — there is no stored/materialized report to retroactively
  edit, only a live computation over dated rows.
- **The biller can get a zero-visit row with a negative Net** in a later
  period, if a colleague runs that period's session of a package the
  biller billed earlier. This is the debit actually landing, not a bug —
  the row is forced into existence via `rowFor` specifically so the debit
  has somewhere to go; an earlier version of this fix instead skipped
  creating the row (`rowsById.get` returning nothing), which silently
  credited the colleague without debiting anyone and broke the invariant
  below for any package spanning more than one report period.

Deltas always sum to zero **within a single `monthly()` call**, so
`total.netPostTaxPaise` is untouched, and `sum(rows.netPostTaxPaise)`
always equals `total.netPostTaxPaise` for every report period — with no
exception, unlike an earlier version of this doc that carved one out for
cross-month packages (that carve-out described the bug, not a real
limit).

This is the one number used everywhere a therapist's own "how much revenue
did I generate" is shown — Trends KPI/chart, Therapist Comparison (both the
trend and the live table — which also gained a `Post Tax {own}` column and a
Total row alongside Net, so the reconciliation is visible there too, not
just on the Monthly Statement), and the Monthly Statement's "Net" column
(shown unconditionally, unlike "Shared" which stays behind the
`enableTherapistSplit` opt-in). There is no separate "gross attributed
revenue, ignoring splits" concept anymore — that used to be a parallel
`attributedRevenuePaise` field/column, folded into `netPostTaxPaise` instead
so there's one lens, not two.

**Pay base — one function for each therapist's money** (`src/domain/payBase.ts`).
Both mechanisms live in ONE pure module, never re-implemented elsewhere:
`attributionMovements(input)` returns every therapist-to-therapist
`Movement` for a `[from,to]` window (`mechanism` `line_share` |
`manual_split` | `package_attribution`), each carrying the gross,
clinic-share and post-tax amount moved (and `repaired: true` on a
`line_share` from repaired shares, below); `payBaseByTherapist(input)` puts
every in-window visit's billed amounts under its primary therapist and
applies every movement (equal and opposite, so Σ over therapists always
equals Σ over visits on all three bases). Input is
`{ visits, packageGroups, items, credits, splitEnabled, from, to }`
(`items` / `credits`: `visit_items` / `visit_credits` rows by visit id, for
the window's visits AND every package group's visits; empty maps = every
visit is a visit without lines, i.e. the pre-lines behaviour exactly). The
function is pure, so callers fetch everything themselves —
`loadPayBaseInput` in `reportService.ts` (package groups via
`repos.visits.listByPackageGroup`, then ONE `listByVisitIds` call per child
table, plus the clinic's `enableTherapistSplit`, default on); the audit uses
the same loader. Rules:
- **A visit with live credit rows** moves one `line_share` per non-primary
  therapist, from the primary: gross = that therapist's ₹ share; clinic share
  and post-tax = the same proportion (share ÷ bill) of the visit's own
  figures, split over all the visit's shares (primary at index 0) with
  `largestRemainderRupees` (`src/domain/money.ts` — the ONE proportional
  money-split rule, also behind `lineNets` and the package base: floor each
  part's whole rupees, leftover rupees to the largest remainders, ties to
  the lower index, zero weights last, stray paise to the next in line), so
  each base sums exactly to the visit's figure. Credit rows replace the
  legacy split — the two never both apply. Rows are valid only if they
  include a row for the primary, hold no negative share and sum to the bill;
  otherwise they are recomputed with `autoCredits(lines, primary, bill,
  { splitEnabled })` for the report, and every movement from them carries
  `repaired: true`. A repair that moves nothing (e.g. everything lands on
  the primary) produces no movement and so **no audit row** — the repair is
  then invisible in the audit.
- **A visit without credit rows** keeps the legacy formula, so closed months
  reproduce to the rupee: `sharedPct` moves `roundToRupeeHalfUp(amount ×
  sharedPct / 100)` of the bill, clinic share and post-tax each
  (`manual_split`); no split → nothing moves.
- A package session moves `perSessionShare` of clinic share and post-tax
  (above), and **no gross** (so `Shared` is exactly the revenue-share /
  legacy-split movement).
- **A share on a paid service.** Any non-package line may carry `session_share_therapist_id` + `session_share_pct`
  ("Share" pill on a service row). `autoCredits` gives that colleague `roundToRupeeHalfUp(line net × pct / 100)`
  and the line's deliverer the rest, so the shares still total the bill (₹2,000 done by Prem shared with BM at 30% →
  Prem ₹1,400, BM ₹600; with a ₹200 discount the % applies to the ₹1,800 net → ₹1,260 / ₹540). It flows through the
  visit's credit rows and `line_share` movements like any other share; `autoCredits` ignores the share on a PACKAGE
  line (below) so nothing counts twice, and ignores it when the clinic's split is off. A visit whose shares were
  edited manually keeps them (Edit split wins). Exact ₹ amounts: Edit split after saving.
- **A colleague's part of a package session.** A package line may carry the same two columns
  (New Visit / Edit visit: "Share" pill on a package row, with the clinic's therapist split on). The
  session's per-session share then splits: the helper gets `roundToRupeeHalfUp(share × pct / 100)` of the clinic
  share and of post-tax, the runner (the line's deliverer) keeps the rest, both paid by the biller as separate
  `package_attribution` movements (the helper's carries `packageRole: 'helper'`, both carry `sessionSharePct`);
  a recipient who is the biller moves nothing. It works on any session including the billing visit's own, is
  ignored when the split is off, and a line without the columns behaves exactly as before. The audit's Basis reads
  "Session 2 of 3 · Dr B helped (40%) · from Dr A's ₹3,000 package billed …" / "run by Dr C (keeps 60%)". The next
  session of the same package starts with the last session's share (`lastPackageShare`, if that colleague is still
  active), editable and marked "Same as last session".
`reportService` (Shared / Net / `netClinicSharePaise`) and the attribution
audit both read from it; future payroll will too. **Never compute
therapist attribution anywhere else** — add an input to `PayBaseInput`
instead. `TherapistMonthRow.netClinicSharePaise` is the clinic share after
the same movements (the payroll base); like Net, its Total equals the
billed `clinicSharePaise`.

**Manual Shared and package attribution move money on different bases.**
The `Shared` column is a % of the **gross** bill; the amount actually
reflected in `Net` for the same split is the same % applied to
**post-tax**. Same visit, two different numbers by design — `Shared` is a
useful gross reconciliation figure against the original bill, `Net` is the
real take-home. The Monthly Statement's Shared column tooltip states this
explicitly so it doesn't read as the two disagreeing by mistake.

**Attribution audit view** (`attributionAuditService.ts`,
`AttributionAuditPage.tsx`, Reports → "Attribution audit" tab): a
per-transaction ledger for a month — every rupee any mechanism moved,
with the visit, patient, from/to therapist, and gross/post-tax amounts —
so a disputed Shared or Net figure can be traced back to the specific
visit(s) that produced it, rather than taken on faith. Built from the
same `loadPayBaseInput` + `attributionMovements()` output `reportService`
aggregates (same source visits, lines and shares, same in-window scoping for
package attribution; the movement → entry mapping is an exhaustive `switch`) so the list
always sums to the same deltas that produced that month's Net figures. A **Basis** column
shows what the moved amount is a share OF — a bare "₹500" moved between
two names is unverifiable on its own: for `manual_split`, the full visit
bill and the % applied; for `line_share` ("Revenue share"), the full visit
bill (gross is the therapist's ₹ share of it; entries from repaired shares
show a **Repaired** tag, `AttributionEntry.repaired`); for
`package_attribution`, the package's price (its package line's net, or the
billing visit's bill for visits without lines), the package's declared session count, and which session
number triggered this row (e.g. "Session 2 of 3 · ₹1,500 package"). Gross
is null for every `package_attribution` row by design — continuation
sessions are billed at ₹0, so only a Post-Tax share (derived from the
billing visit) ever moves there; the UI explains this via a tooltip on
the empty cell rather than leaving it unexplained.

The audit tab also has a **therapist filter** (rows where they gave or received) and a patient search, a
**Gave / Received / Net change** summary per therapist, and **Download CSV** of the visible rows (pure helpers in
`features/reports/attributionAuditView.ts`). A package row's Basis names the runner, the biller, the package
price and the date the package was billed (`AttributionEntry.billingVisitDate`), e.g. "Session 2 of 3 · run by
Dr B · from Dr A's ₹3,000 package billed 23/10/26". The Monthly Statement's Shared cell and the negative-Net
"Why?" link open the audit for that month filtered to that therapist (`/insights?tab=audit&therapist=`).

**My credits and debits** (`features/workspace/MyCreditsCard.tsx`): a plain therapist (not clinic-wide, therapist
split on, more than one active therapist) sees a Workspace section with the last six months of their own audit rows:
Credits, Debits and Net change, each row naming the patient, date, colleague and reason ("Share of the visit",
"Package session 2 of 3, run by Dr B, package billed 23/10/26"). It reads the same `attributionAuditService.monthly`
rows filtered to the therapist (`myRows`, `myBasisText` in `attributionAuditView.ts`) and never shows a visit's
bill or a package's price.

**`hv_paise` (Partner Share) is the bill split between the two
organizations, pre-tax — not "everything that isn't the clinic's post-tax
take."** `hvPaise = billPaise - bmSharePaise`, so `bmSharePaise + hvPaise
=== billPaise` always. An earlier formula (`billPaise - postTaxPaise`)
silently folded TDS into the partner-share figure, since
`postTaxPaise = bmSharePaise - tdsPaise` — the partner's column read as
their share plus the clinic's own withheld tax, overstating it by exactly
the TDS every time. `TDS Deducted` already has its own column, so this was
a wrong formula, not a missing one. Fixed going forward in
`computeVisitSplit` (`src/domain/split.ts`); existing rows were backfilled
live via a flag-gated bypass of the invoice-freeze trigger (migration
`20260822034435_backfill_hv_paise.sql` — the same `app.allow_invoice_amendment`
flag `amend_invoice()` uses for `invoice_id` re-points, extended to also
cover `hv_paise`, since correcting this one snapshot field is the same
kind of narrow, flag-gated exception; every other financial field on an
invoiced visit stays frozen either way). `hv_paise` never drives real
payout logic — the hospital settlement in `MonthlyStatementPage` reconciles
against `postTaxPaise` only — so the backfill carries no risk to real
figures, only to a previously-mislabeled report column.

### 2c. One function for each therapist's money (`payBase`)
`src/domain/payBase.ts` is the ONLY place that decides how much of a visit's money belongs to which therapist (revenue shares, legacy splits, package attribution). Monthly reports, the attribution audit and any future payroll all read it. **Never re-derive attribution elsewhere**: add an input to `PayBaseInput` instead. See §2b for the rules.

### 3. Sequential Gap-Free Invoices
- **Server-issued numbers** via `issue_invoice()` RPC
- **Per-clinic per-FY counter** in `invoice_counters` table
- **Prevents concurrent duplicates** with DB locking
- **Online-only** to maintain gap-free guarantee

### 3b. Invoice Amendments
A TPA/insurance payer sometimes asks for a corrected bill-cum-receipt on an
already-issued invoice (e.g. missing visit dates added). Invoices are
immutable by design (`invoices_immutable` trigger, corrections raise "issued
invoices are immutable; corrections require an amendment record") — so a
correction is a brand-new invoice that **supersedes** the old one, never an
edit to it. Both stay on record for audit; only the latest is what a payer
should honor.

- **`invoices.supersedes_invoice_id`** — a one-directional forward pointer
  (new → old) only. The old invoice can never be updated to point at its
  replacement without violating immutability, so "X is amended by Y" is
  always derived by querying `where supersedes_invoice_id = X.id`, never
  stored on X itself.
- **`amend_invoice()` RPC** mirrors `issue_invoice()`'s membership/
  entitlement/access checks and gets its own real, gap-free sequential
  invoice number from the same counter — but accepts visit IDs already on
  the invoice being amended (in addition to any newly-added, previously
  uninvoiced visits) and stamps `supersedes_invoice_id`.
- **`protect_invoiced_visit()` trigger bypass**: re-pointing `invoice_id`
  on an already-invoiced visit is normally blocked unconditionally.
  `amend_invoice()` sets a transaction-local flag
  (`set_config('app.allow_invoice_amendment', 'true', true)`) that the
  trigger checks specifically for that one field — every other financial-
  field freeze on an invoiced visit stays fully enforced even during an
  amendment, so an amendment can only add/re-point visits, never edit a
  visit's billed amount. The same flag also gates `hv_paise` (extended in
  `20260822034435_backfill_hv_paise.sql` to backfill the corrected
  Partner Share formula, §2b) — the only two fields this bypass ever
  covers; every other check in the trigger's OR-chain is unconditional.
- **UI**: `InvoicePrintPage` shows a "Superseded by …" banner on an old
  invoice and an "Amendment to …" banner on the new one, each linking to
  the other. "Amend this invoice" opens `AmendInvoiceDialog`
  (`src/components/AmendInvoiceDialog.tsx`), which carries the original's
  own visits forward and lets staff pick additional uninvoiced visits for
  the same patient before issuing.
- **Reporting impact**: none needed — `reportService`/`dashboardService`
  query `visits` directly, and each visit's `invoice_id` always points to
  whichever invoice currently claims it, so reports automatically reflect
  only the latest state.

### 3c. Voiding an invoice, and the invoice policy
An amendment can add visits or re-point them but never change a billed amount,
so a wrong price, patient or date on an issued invoice had no fix. **Void**
keeps the invoice and its number in the series, marked VOID, and releases its
visits so they can be corrected and billed again with a new invoice.

- **`void_invoice(invoice_id, reason)` RPC** (`supabase/migrations/20261005110000_void_invoice.sql`): membership / entitlement / `billing_enabled` gates like `issue_invoice()` and `amend_invoice()`, but **admin / front desk only whatever `invoicing_access` says** (`20261001195227_void_invoice_staff_only.sql` — voiding can release another person's invoiced visits and can't be undone, so a therapist can issue and amend but not void; the print page hides the button for them); a reason is required; refuses an invoice that was already amended ("void the latest version") or is already void. It upserts `invoice_payments` to `status = 'void'` (with `void_reason`, `voided_at`) — **no UPDATE on `invoices`**, which stay immutable — and sets `visits.invoice_id = null` using the same `app.allow_invoice_amendment` transaction flag `amend_invoice()` uses (every other frozen visit field stays frozen). It returns the `invoice_payments` row id so the client mirrors the same row. Payments already recorded stay with the visits (they are `payments` rows, not on the invoice), so a fully paid voided visit becomes `collected_no_receipt` and can be billed again.
- **Void is final everywhere**: `computeVisitPaymentState` treats a visit still pointing at a void invoice as not invoiced (never as paid), and `backupService.restoreBundle` never pushes a status row for a voided invoice, never overwrites one that is void on the device, and releases visits an older backup still links to one — the server rejects client writes to a void row, so a restore would otherwise leave permanently failing sync rows and put released visits back on a dead invoice.
- **Client**: `invoiceService.voidInvoice()` (online only) calls the RPC then mirrors locally (`visits.markUninvoiced`, `invoicePayments.putLocal`, no outbox). `VoidInvoiceDialog` (reason required; says received money stays recorded) opens from the print page's "Void invoice"; a void invoice shows a VOID watermark, a VOID stamp, a banner with the reason, and no Edit details / Amend / Void actions. The Invoices tab shows a "Void" pill and excludes void invoices from its totals.
- **Invoice policy** (`clinics.invoice_policy`, Settings → Billing → "Bills after a visit"): a payment is always recorded; an invoice is a separate, immutable document, so the clinic chooses what the app nudges. `on_request` (default): a **Give bill** button on the saved-visit screen, Needs receipt list kept. `always`: the bill step (the usual review-then-issue dialog, never issued silently) opens straight after a visit saved as paid. `never_nag`: the Needs receipt list and the Invoices-tab badge are hidden. Display-level only — `issue_invoice()` enforces nothing here.
- **Saved-visit screen**: **Take payment · ₹X** (while anything is still owed; part payments fine) and **Give bill** (replacing "Issue invoice"; primary once nothing is owed). "Record payment" on an invoice is now also **Take payment** — it is the same dialog (`TakePaymentDialog`) and the same `payments` rows.

**"Not invoiced" nudge for a trailing package session** — `issue_invoice()`
sweeps in every session that exists in a package group *at issue time*
(including ₹0 continuations), stamping `invoice_id` on all of them. A
session logged **after** that point never gets swept in, so two ₹0 rows
of the same package can show arbitrarily different lock state (one 🔒,
one not) with nothing explaining why — this is exactly the case
Invoice Amendments exists to fix, but nothing pointed a viewer at it.
`VisitCardData.packageInvoicePending` (`src/components/VisitCard.tsx`)
closes that gap: true for a ₹0 package-continuation row whose own
`invoiceId` is null but a sibling in the same `packageGroupId` already
has one, rendered as an amber "Not invoiced" pill next to the status
chip. Computed independently at each of the three places that build
`VisitCardData` (Ledger, Workspace, Patient Profile) since each already
shapes its own rows from a different source query — Ledger/Workspace
check the full package group via `repos.visits.listByPackageGroup()`
(their loaded visit list is date/day-scoped and would miss an
out-of-window sibling), while Patient Profile scans its already-loaded,
unbounded per-patient visit history directly.

### 3c. Adding a Parameter to an Existing RPC Function (Postgres identity gotcha)

Postgres identifies a function by **name + argument types**, not name
alone. `create or replace function` with a **changed argument list does
not replace the existing function** — it silently creates a second,
distinct one alongside it. `issue_invoice()`/`amend_invoice()` needed a new
optional trailing `p_clinical_snapshot jsonb default null` parameter for
Billing & Notes Rebuild Phase 1's clinical-context feature; the naive
`create or replace` approach would have left the old N-arg function live
next to a new N+1-arg one, and the moment both matched a call (any
unrefreshed client still sending the old arg set), PostgREST/Postgres can
no longer tell which one to call — **invoice issuance hard-fails clinic-
wide for the deploy window**, on the one operation in this app that can't
be retried offline.

**Correct pattern, used by the migration that added this field**: an
explicit `drop function <exact old signature>` followed by
`create function <new signature>`, in the same migration transaction, so
exactly one candidate function ever exists. PostgREST's own
missing-key-resolves-to-SQL-default behavior then means an old client
sending only the original argument set still succeeds against the new
function (the omitted parameter resolves to its `default`), while a
refreshed client sending the new key succeeds too. Any signature-scoped
grant/revoke (e.g. `revoke execute … from anon`, see RLS Hardening in
Phase-0-era migrations) must be **re-issued against the new signature** —
it does not carry over from the old one, since as far as Postgres is
concerned this is a different function, not an edit to the old one.

### 3d. Invoice Clinical-Details Editing
Amendment (§3b) is the right tool for a correction that changes what's
being billed — added visits, a different total. Most real-world "fix this
invoice" requests are narrower than that: a diagnosis was mistyped, a
physician's registration number was missing. Minting a whole new invoice
number for a metadata typo is disproportionate, so `clinical_snapshot` gets
its own narrow in-place edit path instead.

- **`reject_invoice_mutation()` trigger, narrowed**: previously rejected
  every update unconditionally. Now allows an update through IFF (a) it
  runs inside `update_invoice_clinical_details()`'s transaction-local
  `set_config('app.allow_invoice_clinical_edit', 'true', true)` bypass —
  the same pattern §3b's amendment flag uses — AND (b) no column outside
  `clinical_snapshot` actually changed, checked column-by-column in the
  trigger itself as a second line of defense against a bug in the RPC.
  Every other financial field (amount, line items, invoice number, payment
  mode, `supersedes_invoice_id`, …) stays genuinely immutable.
- **`update_invoice_clinical_details()` RPC** — same membership +
  `invoicing_access` permission check as `issue_invoice()`/`amend_invoice()`
  (any clinic member when `all_staff`, admin/front_desk only when
  `billing_staff`), `security definer` so it can bypass invoices' select-
  only RLS policy the same way the other two invoice RPCs do.
- **`invoices` now carries the generic `audit_log` trigger** (see §M0's
  `audit_row_change()`), added in the same migration. It was deliberately
  excluded when `audit_log` first shipped, on the reasoning that a fully
  immutable table could never produce a meaningful before/after row — that
  reasoning no longer holds now that one field can change, so every
  clinical-details edit gets a genuine before/after audit row like any
  other editable table.
- **UI**: `EditInvoiceDetailsDialog` (see "Editing clinical details after
  issuance" in §3) — reachable from `InvoicePrintPage`'s "Edit details"
  button, hidden once an invoice is superseded (same guard as "Amend this
  invoice").
- Migration: `20260827000004_invoice_clinical_edit.sql`.

### 4. Walk-In MRNO Auto-Generation
- **Sequential per clinic per year**: `PREFIXYY-NNNN` (W26-0001, W26-0002)
- **Sequence derived by scanning** existing walk-in MRNOs (no running counter)
- **Naturally resets each January** when YY changes
- **Auto-widening** past 9999 via padStart no-op behavior
- **Collision retry loop** for offline generation safety

### 5. Episode of Care via Enrollments
- **patient_module_enrollments** tracks when a patient enters/exits a clinical episode
- **Consultation notes** linked to enrollment for follow-up context
- **Carry-forward** logic in follow-up mode uses this enrollment

### 6. Role-Based Access Control (Server-Side RLS)
- **Three roles**: admin, therapist, front_desk
- **Postgres RLS policies** restrict table visibility and write scope
- **Helper functions**: `is_clinic_member()`, `is_clinic_admin()`
- **SECURITY DEFINER RPCs** bypass RLS where needed (e.g., `issue_invoice()`)

### 7. Audit Trail & Compliance
- **audit_log table** logs mutations per row (`table_name`, `row_id`, `action`)
- **old_data / new_data** capture the full before/after row as jsonb
- **changed_by** tracks who made the change
- **created_by / updated_by** on financial tables (visits, invoices, payments)

### 8. Soft Deletes for Safety
- **Patients**: `deleted_at` — soft delete, still resolves in notes
- **Visits**: `deleted` boolean — hard delete via RPC only
- **Therapists**: `active` boolean — deactivation, hard delete only if zero visits

### 9. Date Display: Short On-Screen, Full On Paper
- **"Today" is the local calendar day — `toLocalDateStr(new Date())` (`src/domain/schedule.ts`), never `new Date().toISOString().slice(0, 10)`.** Visit and payment dates are local `YYYY-MM-DD` strings; the UTC date is a day behind from midnight to 5:30 AM in India, which dated an early-morning visit (and its payment) yesterday and made Today's list, Collected and the Daybook disagree. `dashboardService` (`todayWorklist`, `recentVisits`, the repeat-visit lookback), New visit's default date, the payment dialogs' dates and the note baseline all use the local day.
- **`formatDateDM`** (`DD/MM`, no year) — the default for interactive
  on-screen dates: visit rows/cards, invoice dates, note editor/list dates.
  The year is redundant when the date is always close to "now" in context.
- **`formatDateDMY`** (`DD/MM/YY`) — reserved for dates that can legitimately
  be a very different year: first/last visit, package start, arbitrary
  date-range filter text, historical import rows.
- **All printed/exported documents keep full-year dates unconditionally**
  (visits CSV, invoice print, monthly ledger print, note print) — they're
  standalone records that may be reviewed later without app context.
- Both functions live in `src/domain/fiscalYear.ts`; the choice between them
  is a per-usage judgment call, not something to change without checking
  which bucket a given date falls into.

### 9b. iPhone Safe Areas

`index.html` sets `viewport-fit=cover` (with the `black-translucent` status bar), so content runs edge to edge and `env(safe-area-inset-*)` is non-zero. Anything anchored to a screen edge must pad by it: the Shell header (`pt-[env(safe-area-inset-top)]`), the phone tab bar and `<main>` bottom padding, bottom sheets (`pb-[max(1rem,env(safe-area-inset-bottom))]` — `Panel`, `BookSlotSheet` footer, `ReminderSheet`, `WorkingHoursSheet`, `ClosedDaysSheet`, `AppointmentDetailsPanel`), toasts above the tab bar (`bottom-[calc(5rem+env(safe-area-inset-bottom))]`), and the public booking form's pinned bar. New edge-anchored UI should follow the same pattern.

### 9c. Typography — three families, fixed roles

Defined in `src/index.css`; use the classes, never ad-hoc families (`font-serif`, `font-mono`, inline `fontFamily`):
- **Fraunces** (`font-display`) — page and section titles, card titles, the greeting, the Schedule date headline, the Thera.Net wordmark, and **patient names wherever they appear** (visit cards, package cards and table rows, Today appointment and request rows, Ledger).
- **IBM Plex Sans** (body default) — everything else: labels, buttons, pills, table text, therapist names, times.
- **IBM Plex Mono** (`font-num`) — money, stat-tile numbers, patient IDs (MRNO), invoice numbers. Tabular figures so columns line up.

### 9d. Page titles

A top-level page doesn't repeat its name as a big heading when a visible nav item already names it: the `<h1>` is screen-reader only (`sr-only`). That's Schedule and Ledger at every width (bottom bar on phones, top nav from `sm:`), and Patients and Reports from `sm:` (`sm:sr-only`). Patients and Reports are reached through **More** on phones, where nothing else names them, so they keep a compact `text-lg` title there. Workspace's greeting is its title. Settings, More and detail pages keep a visible `text-lg` title. The Ledger's "+ New visit" button shows from `sm:` only — the phone bar's + is New visit.

**New visit's return target**: `/visits/new` takes `from` (`/workspace`, `/schedule`, `/ledger`, `/patients`), set by whatever opened it — the appointment panel (`returnTo`), Today's Complete visit, the Ledger and Patients buttons, the phone bar's + (the page it's tapped on). Done / Cancel / the invoice print's ← Back return there. Without `from`, a visit opened with a `patientId` returns to that patient's profile (the profile's own New visit button) and anything else to Workspace. Previously every appointment-started visit (which carries `patientId`) ended on the patient profile.

**New visit layout & quick-picks (Phase 1)**:
- **Responsive breakpoint (`desktop:` at 1000px)**: The two-column layout (sidebar + visit form) switches on at `desktop:` (1000px), not `tab:` (744px). On phones and iPad portrait (768px–834px), the layout remains a single full-width column, avoiding cramped multi-column squeezing and preventing on-screen keyboard collisions. iPad landscape (1024px+) and desktop remain two columns with sticky patient sidebar.
- **Compact confirmed patient banner**: Replaces vertical SummaryTiles with a compact horizontal ribbon (~60px): Line 1 shows Patient Name, Patient ID (`patient.mrno`), Age/Sex/Condition, `Edit` link, and quick action buttons (`[ ✍️ Start note ]` preserving arrival tracking, and `[ Change ]` at top right). Line 2 folds active package status (`📦 Service (X/Y)`, `Renew soon` badge, `+N more` pill) and last visit summary into a single scannable row.
- **Quick-pick services**: Top 3 services ranked by usage over the last 90 days (`rankServicesByUsage` in `src/domain/serviceUsage.ts`, `dashboardService.serviceUsageCounts`), falling back to catalog order. Rendered as 1-tap chips above `+ Add another service`; automatically hidden if inactive or already added to the visit. Tapping a package service chip adds a package-purchase row with its catalog price.
- **Multiple open package chips**: When a patient has $\ge 2$ open packages, `ServiceRows` renders package chips (`[ 📦 Name (X of Y) ]`) so staff can tap to continue any package with one tap rather than dropping to a blank row.
- **New package while one is open** (`openSamePackage` in `ServiceRows.tsx`): a row that buys a package service (more than one session) while the patient still has a session open on that same service gets one quiet amber line under it — "{name} still has session 3 of 3 on this package. This starts a new one." — with two links, **Use remaining session** (swaps the row for the continuation, keeping a colleague's share) and **Keep new package** (hides the line). Not blocking, because renewing early is legitimate. The general "has an open package" line is hidden while this one covers the same package. **Quick add** (was "Suggested") skips free services (₹0) and a package that is already open.
- **Patient card details** (New Visit): *Last visit* shows date, service, package session info, and therapist name, with an elevated **[ ↻ Repeat visit ]** action button that pre-fills therapist, condition, notes, treatments, location, and service from that visit in one click. A patient with **no open package but one that just finished** shows "Package — Last package finished 25/10/26 · Exercise Therapy 7 Days (7 of 7 used)" with a **[ + Renew {N}d pkg ]** action button that immediately adds that package service to the visit lines (`lastFinishedPackage` in `draftVisit.ts`).
- **Treatments "+ N more"** is the last chip of the same row (`MultiToggle`'s `trailing`), not a row of its own. **Services**: "+ Add another service" is a dashed chip under the last service, on the same row as the "Quick add:" chips, left-aligned; it is not shown while a row is still empty (that empty row is where the next service goes).
- **New Visit layout (unified card for patient and visit context, two columns on desktop)**: the container expands to `max-w-5xl` (1024px) utilizing side whitespace without cramping. The left column is permanently a single unified `SectionCard` (sticky `22.5rem` on `desktop:`): before patient selection, it holds patient search/creation and the This visit context; once selected, it smoothly transitions to patient identity, recessed history well (`bg-[var(--paper)]`), and This visit context with no structural or column jumping. The Place of service segmented toggle (`Clinic` | `Home visit`) sits cleanly to the right of the **This visit** section header (`font-display text-base font-semibold text-[var(--ink)]`).
- **Navigational header & back button**: Single compact row featuring the outlined `BackLink`-style back button (`‹ Workspace`, `‹ Ledger`, `‹ Schedule`, or `‹ Patients`), the `New visit` `<h1>` title immediately beside it, and the live amber `● Unsaved changes` badge to the far right. Patient identity is housed cleanly within the dedicated patient card in the left column without redundant subtitle duplication.
- **Unsaved changes & discard confirmation**: Intercepts in-app navigation (`Workspace`, `Ledger`, `Schedule`, `Reports`, `Settings`), browser back/forward, and form Cancel/Back actions via TanStack Router's `useBlocker` (`withResolver: true`). If dirty, opens a styled `<ConfirmDialog>` ("Discard this visit? You have unsaved changes...") with "Keep editing" and "Discard & leave"; untouched forms exit immediately without prompting.
- **Start clinical note integration**: `StartVisitSheet` portals directly to `document.body` (`z-50`), eliminating background bleed-through. When opened from New Visit with a confirmed patient, it displays the patient's identity tile directly, tailors actions to "Start note" and "Cancel", and seamlessly creates the walk-in and transitions to Core Assessment note editor.
- **Treatments folds once** (`shouldFoldTreatments`, `visibleTreatmentOptions` in `draftVisit.ts`): the chips are one list (most used first, the first six plus anything ticked, "+ N more" for the rest) with "Other treatments / notes" below. When a service is chosen after something was ticked or typed, the card folds to one line ("Exercise Therapy · SMR/MFR · FM An/Re", **Edit ▾**); never while ticking, never again once re-opened, and open again for the next patient. **Done ▴** folds it by hand.
- **Balance due line** in the patient card: "Balance due ₹2,000 · 1 unpaid visit" (amber) from the patient's own visits by the Ledger's rule (`patientDue` in `domain/patientDue.ts`: `computeVisitPaymentState` + `visitDuePaise`, so it cannot disagree with the Ledger or Workspace).
- **Patient card** (New Visit): structured hierarchy. *Header*: name (`font-display`) + Edit link (Change button at the right), then "Patient ID <span className="font-num">W26-0002</span> · 45y · M" (condition deduplicated to the interactive condition selector). *Recessed History Well* (`bg-[var(--paper)]`): contains open packages (progress dots, started date, payment badge) or finished package with `[ + Renew {N}d pkg ]`, and last visit with payment badge, session index, who treated, treatments, and `[ ↻ Repeat visit ]`. Elevated white pill action buttons (`bg-[var(--surface)]`) pop out against the well background. Bottom full-width action provides the clinical bridge (`Start a note first`).
- **Therapist default skips people who have left**: a returning patient's last therapist is the default only while still active (`lastActiveTherapistId`); otherwise the logged-in therapist is used. Before, an inactive therapist was picked but the field (active therapists only) looked empty while the visit would have been credited to them; Save now also refuses a therapist who isn't in the list ("Choose who treated the patient.").
- **Messages**: "Choose a patient first, or add a new one.", "Choose who treated the patient.", "Check the service marked in red.", "Add a reason for the discount or extra.", "Choose a service." / "Choose a service for each row, or remove the empty one.", "Only one package per visit — remove X or the other one.", "Enter their share (1–99%).", "Package session 3 of 7 · ₹0", "First visit". The same wording is used in Edit visit.
- **Open package line** (no package on the visit yet): "**Open package:** Advanced Therapy 3 Days — 1 session left (2 of 3 used)." with **Use a session for this visit (₹0)**; with two or more: "**Open packages:** Aravind has 2. Use one for this visit (₹0):" and a chip per package ("Advanced Therapy 3 Days · 1 session left"). Replaces "has an open package (session 3 of 3). It isn't used on this visit. Add package session", which did not say which package or what the link does.
- **A share's empty % is not an error until it matters**: a share just added shows no "Enter the % to share." (and no red card) until its % box is left empty or Save is pressed (`revealProblems` on `ServiceRows`, set by a failed Save); the box starts empty, not with a "0" placeholder that read as 0%.
- **Payment layout**: Row 1 keeps `[ Collected now | Take payment later ]` and payment method chips (`[ UPI | Cash | Card | Other ▾ ]`) side-by-side without wrapping when UPI is selected. Row 2 holds `[ 📷 Show UPI QR ]` and "Scan to collect ₹X directly to clinic UPI" cleanly underneath.
- **Integrated Total & Save within Payment card (Unified Checkout)**: Services card contains pure clinical services without any billing or discount clutter. All billing math and payment options live in the Payment card. Directly beneath the payment method and UPI QR controls, `BillAdjustmentFields` provides the compact adjustment bar with a joined pill `[ ₹ | % | 10 ]` and 1-tap reason quick-pick chips (`[ Loyalty ] [ Package / Bulk ] [ Staff / Family ] [ + Other... ]`). In the flush recessed footer (`-mx-5 -mb-5 mt-4 rounded-b-2xl border-t border-[var(--border)] bg-[var(--paper)] px-5 py-3.5 space-y-1.5`): (1) Single clean summary line directly above total combining service breakdown and discount math (`₹5,400 (Advanced 3 Days) − ₹540 discount (10% · Loyalty)`, or `1 service · Advanced 3 Days · Exercise Therapy` when no discount), (2) Big price before label (`₹4,860 TOTAL` in `font-num text-2xl font-extrabold`) left-aligning numbers cleanly, (3) Clean `Save visit` button without `<kbd>` badge clutter with hover shortcut (`title="Save visit (⌘ + Enter)"`) and responsive proportional layout on mobile.
- **Service rows and picker**: Every service row is rendered as a clean, unified single card (`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-3.5`) without nested "box-in-box" borders. When editing/selecting a service, the search input integrates seamlessly with a magnifying glass icon, no redundant "Service" title, and an instant "Cancel" option. Package rows display reassuring per-session clarity and usage badges (`3-session package · ₹1,800/session · Uses 1 of 3 today`). Subtle remove button (`✕`) is consistently available on all rows (clearing the single row to blank search, or removing additional rows). The dropdown list separates name and metadata (left) from price in tabular numerals (right) with sticky category headers and checkmarks for selected items.
- **Share row layout**: "Shared with" on its own line on phones, then the colleague box, the % box (% sign inside, no spinner) and the remove button on one line, then "Their share of this service ≈ ₹x" (sessions say "session"); from `sm:` the label and controls share one line.
- **Typography and sizing system**: (1) Section Card titles (`Patient`, `This visit`, `Treatments`, `Services`, `Payment`) and patient names use `font-display` serif (`Fraunces` 16px font-semibold); (2) Field labels uniformly use `text-xs font-medium text-[var(--muted)]` (`Date`, `Therapist *`, `Condition`, `Service`, `Other treatments / notes`, `Quick add:`); (3) Patient IDs (MRNOs), prices, totals, and rupee values consistently use `font-num` (`IBM Plex Mono` tabular numerals) aligning with Ledger and Invoices; (4) Interactive chips are 32px height with 12px medium text.
- **Smart compact adjustment drawer (`BillAdjustmentFields`)**: Collapsed by default as `+ Discount / Extra`. When expanded, renders a clean, recessed card (`rounded-xl border border-[var(--border)] bg-[var(--paper)] p-2.5`):
  1. **Row 1 ("How Much")**: (a) Mode toggle `[ Discount | Extra ]`; (b) Fused compact input + unit toggle `[ 10 | % | ₹ ]` (~84px wide with center-aligned font-num value); (c) Context-aware 1-tap pill presets adapting dynamically to % vs ₹ and Discount vs Extra:
     - Discount %: `[ 5% ] [ 10% ] [ 15% ] [ 20% ]`
     - Discount ₹: `[ ₹100 ] [ ₹200 ] [ ₹500 ]` plus smart round-off chip when the subtotal has an odd rupee remainder (e.g. `[ Round to ₹5,000 ]` on ₹5,400);
     - Extra ₹: `[ +₹150 ] [ +₹300 ] [ +₹500 ]`
     - Extra %: `[ +5% ] [ +10% ] [ +15% ] [ +20% ]`;
     (d) Live computed delta badge (e.g. `−₹540` or `+₹200`) right beside presets; (e) Dismiss `✕` on far right.
  2. **Row 2 ("Why")**: Context-aware reasons with matching `rounded-full` pill geometry:
     - Discount reasons: `[ ✓ Package / Bulk ] [ Loyalty ] [ Staff / Family ] [ Courtesy ] [ + Other... ]`, auto-linked to `Package / Bulk` when a package is in the cart or `Loyalty` otherwise;
     - Extra reasons: `[ ✓ Consumables / Tape ] [ Home Visit ] [ Extended Session ] [ Equipment ] [ + Other... ]`, auto-linked to `Consumables / Tape`;
     - `+ Other...` expands an inline auto-focused input with an instant cancel button.
  3. Suppresses standalone summary boxes (`hideSummaryBoxes`) when integrated into unified checkout footer.
- **Therapist label says why** (`therapistReason` in `draftVisit.ts`): beside the Therapist label small grey text reads "Booked" (the appointment's therapist), or "You" (the patient card already names the last visit's therapist, so no label for that default); nothing for a hand-picked therapist. It used to repeat the name already in the field.
- **Post-save confirmation screen (`VisitLoggedCard`)**: Designed to eliminate mobile "button stack fatigue" (previously 6 stacked full-width outlines) with an aesthetic receipt card and tactile layout:
  1. **Celebratory Header**: Soft teal checkmark badge `[ ✓ ]` with `Visit logged` in `Fraunces` serif alongside the formatted visit date (`25 Oct 2026`).
  2. **Recessed Receipt Card**: Includes Patient Name, Patient ID, repositioned top-right `[ ✎ Edit ]` subtle pill button, package progress indicator with filled/open visual dots (`● ● ○ Package session (2 of 3) · ₹0`), and metadata grid (Service, Date, Therapist).
  3. **Primary Hero Action**: Single full-width solid teal CTA for the immediate priority action (`Take payment · ₹X` if owed, else `▤ Add clinical note`, else `🧾 Give bill`).
  4. **Compact Secondary Action Tile Grid**: 2- or 3-column tactile icon tiles for remaining patient actions (`[ 🧾 Give bill ]`, `[ ☆ Request review ]`, `[ 👤+ Another visit for Patient ]`) saving ~130px of vertical height.
  5. **Split Bottom Navigation**: Single split row pairing `[ Done ]` (4 cols) and `[ 👤+ Log visit for next patient ]` (8 cols) side-by-side.
- **Phone header**: on phones the app header is hidden on `/visits/new` (`shouldShowPhoneAppHeader` in `Shell.tsx`; the bottom tab bar is hidden there too) and the page shows a slim sticky header — back arrow (asks before discarding), "New visit · {patient}" and an amber dot while there are unsaved changes.

**Ledger top, two rows at every width**: (1) the Visits / Invoices / Daybook switch, the patient-filter chip when set, and "+ New visit" on the right (from `sm:`). (2) The Visits toolbar, directly on the page (no card, no field labels): the **date presets on the left**, then on the right search ("Find patient or ID"), therapist select (from `sm:`), a **Filters** button (count badge of active filters, teal when any are on) that expands the three "only" checkboxes (and therapist on phones) in a row below, and ⋮ (Export CSV, Generate report). On phones the presets are their own horizontally scrolling row above search / Filters / ⋮. Landing with `?filter=not_collected` (Workspace's Dues tile) starts on All time with Not collected on and the filters open. The "Includes N unsynced visits" caption shows only while visits are waiting to sync (the header's sync dot covers "all synced").

### 10. Responsive Breakpoints & the Mobile-Card/Table Split
- **Two custom breakpoints** (`src/index.css`'s `@theme`), not Tailwind's
  defaults: `tab:` at 744px (iPad Mini portrait — deliberately below
  Tailwind's `md:` 768px, so the phone/tablet split doesn't misclassify it)
  and `desktop:` at 1000px. Every "does this count as a working tablet"
  decision in the app uses `tab:`, so the answer stays consistent app-wide.
- **Every table needs a phone-card twin.** A bare `<table>` with no
  `tab:hidden`/`hidden tab:block` pair renders unusably on a phone —
  horizontal scroll inside a cramped column, not a bug that shows up in
  typecheck/lint/tests. The established pattern (Workspace's Packages
  table, Ledger, Patients, Reports, Invoices, Attribution Audit, and —
  since this pattern's writeup — Workspace's "Expected today" and
  Requests' Feedback/Appointments tables) is always the same two blocks:
  `<div className="tab:hidden space-y-2">` of rounded-2xl pill cards
  (phone, below 744px) immediately followed by
  `<div className="hidden tab:block overflow-x-auto"><table>...</table></div>`
  (tab: and up) — same data, same actions, just laid out differently.
  When adding a new table-shaped list, build both from the start rather
  than shipping the table alone and coming back for the card later.
- **Header width budget** (`Shell.tsx`'s header) — the row carries the
  brand, five nav items, the sync badge, and the account trigger inside
  `max-w-6xl`, which doesn't fit with full text everywhere at once. These
  rules keep it fitting, all the way down to a 744px iPad-portrait width:
  1. Only the clinic pill's name shrinks (truncates; hidden between
     `tab:` and `desktop:`) — the Thera.Net mark, nav and the
     sync/account cluster are `shrink-0`, so a tight row never squeezes
     the things you click.
  2. Nav item labels show from `tab:` up; below that they're icon-only
     with `aria-label`/`title` carrying the accessible name (a
     `hidden`/`display:none` span is skipped by screen readers).
  3. `SyncBadge`'s text label collapses to just the status dot only while
     `quiet` (online, nothing queued, nothing failed — `status.syncing`
     excluded too, i.e. mid-sync ranks as "has something to say") — and
     even then only below `tab:` (744px), since measured, there's room for
     the full pill (dot + "Synced") right alongside the nav labels at
     every iPad-portrait width. The moment there's something to report
     (offline, syncing, pending, failed) it expands at every width, phone
     included — a state a person is actively waiting to resolve shouldn't
     need a tap on a bare dot to read. `SyncStatusBanners` separately
     covers offline/failure states with a full-width banner regardless of
     breakpoint or badge state.
  4. The account trigger's display name is `desktop:`-only (was `sm:`) —
     below that it's just the avatar initials. This one's still
     deliberately conservative rather than measured-and-widened like
     SyncBadge, since the dropdown it opens already repeats the name.
- **Visit table row backgrounds use one CSS variable on the `<tr>`, applied
  on every `<td>`.** `VisitCard.tsx` sets `--visit-row-bg` per row and
  gives each cell the same `bg-[var(--visit-row-bg)]` +
  `group-hover:bg-[var(--teal-light)]` classes (including the sticky
  Status column) so stripes and hover stay even — Safari won't reliably
  paint alternating `bg-[var(--paper)]` / `bg-[var(--surface)]` classes on
  sticky cells when the class name swaps row to row. Status pills stay the
  standard rounded `Pill` components; contrast comes from the pill tones,
  not full-width cell fills.
- **Sync-freshness caption** (`syncFreshnessCaption` in `syncCopy.ts`) — a
  shared one-liner ("As of last sync HH:MM." / "Includes N unsynced
  visits.") for any screen whose numbers are derived from local Dexie data
  that might be behind the server or ahead of the last-sync timestamp.
  Unsynced local changes take priority in the copy — "as of 14:02" would
  understate what's actually showing if newer edits are still queued.
  Ledger's totals and Workspace's "Collected today" stat both carry it;
  any other screen aggregating from `visits` (or another synced table)
  for a number people check repeatedly through the day should too.
- **A `<button>` needs `uppercase` re-declared, not inherited.** Every
  sortable column header goes through `SortHeader` (`sortable.tsx`),
  which wraps the label in a `<button>` so the whole header is clickable.
  Browsers reset a `<button>`'s `text-transform` to `none` by default,
  and that reset doesn't inherit through from the ancestor `<th>` — so
  every sortable header silently rendered in plain case while every
  plain, non-sortable `<th className={th}>` in the same table correctly
  showed the `th`/`thNum` uppercase styling, a mismatch easy to miss
  since nothing in typecheck/lint/tests catches a CSS property silently
  not applying. Fixed by adding `uppercase` directly to `SortHeader`'s
  `<button>` class list. The general lesson: a `<button>` (or `<input>`/
  `<select>`) wrapping styled text doesn't automatically inherit
  `text-transform`/`letter-spacing` the way a plain element would —
  re-declare them on the control itself, don't assume the ancestor's
  class is enough.

### 5. Revenue-Split Change Visibility (Workspace)
A `hasPartner`/`bmSplitPct`/`taxPct`/`tdsBasis`/`clinicType` edit in Settings
already recomputes every not-yet-invoiced visit's split
(`recomputeUninvoicedSplits`) — but that recompute was previously invisible
to anyone but the admin who made it, so a therapist's Net figure could move
with no explanation. `clinics.last_split_change_at` is stamped by both
`saveProfile()`/`savePartner()` (SettingsPage) whenever their own
`splitAffected` check trips; `WorkspacePage`'s `SplitChangeBanner` shows a
plain-language notice for 14 days afterward, dismissible per-device (Dexie
`meta` key `splitChangeAck:{clinicId}`, keyed by the exact timestamp so a
*later* change re-shows the banner even if an earlier one was dismissed).

### 6. Therapist Self-Serve "My Numbers"
Reports/Monthly Statement are admin/front_desk-only (§ Locked Decisions),
which previously meant a therapist asking "how much have I made this month"
needed an admin to run a report for them. `WorkspacePage`'s
`MyNumbersThisMonth` (visible to any signed-in user with a linked
`therapists` row, i.e. `useWorkspaceScope().myTherapistId`) calls the same
`reportService.monthly()` every report page uses, computed live from local
Dexie, and reads out only that one therapist's own row (`netPostTaxPaise`,
`visitCount`) — never another therapist's figures or a clinic-wide total —
so it doesn't widen the admin/front_desk reports boundary, just answers one
narrower question in real time.

### 7. Attribution Audit Link on a Negative Net
A package-attribution debit (§2b) can leave a therapist with a genuine
zero-visit, negative-Net row — correct, but indistinguishable from a bug to
someone who hasn't read reportService's own doc comment. `MonthlyReportTable`
accepts an optional `auditLinkMonth`; when set, any row whose
`netPostTaxPaise < 0` gets a "Why?" link straight to that month's
Attribution Audit tab (`/insights?tab=audit`). Only `MonthlyStatementPage`
passes it — the print surfaces (`MonthlyLedgerPrintPage`,
`MonthlyPerformanceReportPage`) have no in-app navigation to link to.

---

## Deferred Ideas

Recorded so they aren't re-discovered from scratch, not because they're
scheduled — pick back up only if the underlying need actually shows up.

- **Per-visit or per-location partner/split, not per-clinic.** Today
  `hasPartner`/`partnerHospitalName`/`bmSplitPct` all live on the `clinics`
  row — one clinic can have exactly one partner hospital and one split. A
  practice whose therapists split time across two or more partner hospitals
  with different splits has to run each as a separate "clinic" in the app
  today, which fragments the same patients/therapists across accounts.
  Fixing this properly means moving partner/split from clinic-level to
  visit-level or location-level — a materially bigger change (schema,
  `computeVisitSplit` call sites, every report surface) than the other
  partnership improvements shipped alongside this note, so it was
  deliberately deferred rather than bundled in. Revisit if multi-hospital
  therapists turn out to be a real, recurring setup rather than a
  hypothetical.

---

## Key Technologies

### Frontend
- **React 18** with hooks
- **TanStack Router** for URL-first routing
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Dexie** for IndexedDB local-first storage
- **Supabase Client** for realtime subscriptions and storage

### Backend
- **Supabase** (Postgres database)
- **Row-Level Security (RLS)** policies
- **Postgres Functions** (SECURITY DEFINER RPCs)
- **DB Triggers** for immutability and audit trails

### Testing & Quality
- **Vitest** for unit tests
- **Playwright** for e2e smoke tests
- **TypeScript strict mode** (`tsc --noEmit`)
- **ESLint** for code quality

---

## Security & Data Governance

- **Every table carries `clinic_id`** — RLS restricts all access to clinic members
- **Patient data is health data** — no anonymous read path
- **Issued invoices and visits frozen** by DB triggers; corrections go through the invoice-amendment feature (§3b) — a new invoice that supersedes the old one, never an edit to it
- **Rate/tax changes apply to new visits only** — history keeps the rates it was billed under
- **Completed clinical notes are final on the server**: `consultation_notes_completed_lock` rejects (SQLSTATE 42501, so the app reverts its local copy) any change to a completed note's content, scores, mode, patient, episode or session count; linking it to its visit/appointment, reassigning the therapist and archiving stay allowed
- **Database-only edge functions** (`send-push`, `send-agenda`, `notify-therapist`) check an `x-hook-secret` header (`_shared/hookAuth.ts`) against the `EDGE_HOOK_SECRET` setting; the database sends it from Vault secret `edge_hook_secret` through `edge_hook_headers()` (migration `20261022120000_edge_hook_secret.sql`). With no setting the functions accept every call, so the secret can be switched on after deploying
- **Export monthly CSVs** — this app should never be the only copy of financial records

---

## Deployment & Environment

### One-Time Setup
1. Create Supabase project
2. Apply migrations in filename order from `supabase/migrations/`
3. Run `supabase/seed.sql`
4. Provision a clinic and its first admin via `supabase/provision_clinic.sql`
   / grant further clinic access via `supabase/setup_members.sql`
5. Deploy the `invite-therapist` edge function (`supabase/functions/`) —
   used by Settings → Team to invite a new login without exposing a
   service-role key to the browser. `supabase/config.toml` pins
   `[functions.invite-therapist] verify_jwt = false` so browser CORS
   preflights reach the handler (the function still checks the caller's
   JWT + admin role inside). Redeploy after changing the function or
   config: `supabase functions deploy invite-therapist`. Ensure
   Authentication → URL configuration lists every production/staging
   origin in **Redirect URLs** (the invite link uses
   `{origin}/reset-password`) and that **SMTP** or Supabase's built-in
   mailer is configured under Authentication → Email — without it,
   `inviteUserByEmail()` creates the user but no message is delivered.
6. `cp .env.example .env` and fill in project URL + anon key
7. `npm install && npm run dev`

### Development Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server on :5173 |
| `npm test` | Unit tests (domain + services) |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run e2e` | Playwright smoke tests |

### Sync & Offline Handling
- **SyncBadge** component shows connection state and sync status
- **Outbox pattern** queues changes offline
- **Delta pull** on reconnection fetches updates
- **Realtime subscriptions** keep local store fresh

---

## Phase Roadmap

### Phase 1: Ledger & Revenue ✅ LIVE
- Visit entry and ledger
- Invoice issuance (gap-free sequential)
- Revenue split tracking
- Offline-first sync
- Historical import

### Phase 2: Core Assessment ✅ LIVE
- Consultation notes (initial/follow-up)
- Clinical assessment fields (ROM, MMT, neuro, pain profiling)
- Episode-of-care tracking
- Outcome tracking with direction-aware cards

### Phase 3: Role Model & Billing Access ✅ LIVE
- Server-side role enforcement (admin/therapist/front_desk)
- Billing access gating
- Therapist comparison chart
- Nav restructure

### Phase 3b: Sync Fixes & Patient ID Redesign ✅ LIVE
- Sequential walk-in MRNO format (PREFIXYY-NNNN)
- Auto-widening behavior
- Yearly reset capability
- Schema drift fixes (missing columns)
- useClinicRole empty clinicId fix

